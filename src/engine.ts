/**
 * GameEngine — 所有游戏逻辑的唯一入口
 *
 * CLI 和 Web 是薄适配器，只负责 I/O。
 * 所有命令处理、回合管道、存档管理都在这里。
 */

import type { GameSession, Monster } from './types.js'
import { initGameState, getSession, setSession, getFacts, initItemRegistry, advanceTime } from './game-state.js'
import { CLASS_TEMPLATES, createGameSession, createInitialNPCs } from './game-data.js'
import { GameFactStore } from './game-facts.js'
import { DossierManager } from './dossier.js'
import { QuestManager } from './quest-manager.js'
import { ChapterManager } from './chapter-manager.js'
import { getChapter } from './story-script.js'
import { checkBrokenPromises, changeTrust } from './trust-system.js'
import { checkSafety } from './safety.js'
import { getEarlyGuidance, checkIdleEvent, resetIdleTracking } from './events.js'
import { initDMAgent, dmRespond, getDMMessages, restoreDMMessages, muteDMTools, unmuteDMTools } from './dm-agent.js'
import { consumeActions, type SceneActions, type ClassifiedSuggestion, type ClassifiedSceneActions } from './tools/set-actions.js'
import { consumeTrustChanges } from './tools/change-trust.js'
import { validateNarrative, type ToolCallRecord } from './narrative-validator.js'
import { consumeSpeakingNPCs, consumePendingTalkData } from './tools/talk.js'
import { classifyIntent, formatActionResult, shouldPreExecute, quickMatch, type ActionResult } from './rules-agent.js'
import { executeAction } from './action-executor.js'
import { getActiveEffectsSummary } from './effect-manager.js'
import { isBuffSpell, type GridMoveRecord } from './combat-manager.js'
import { manhattan, posEqual, type GridPos } from './combat-grid.js'
import {
  executeMonsterPhase, getCombatSummary, executePlayerTurn,
  attemptFlee, checkCombatEnd, awardLoot, endCombat, startCombat,
  executeAllyTurns,
} from './combat-manager.js'
import { validateParty } from './party-manager.js'
import { pickNarrative } from './combat-narrative.js'
import { UseItemTool } from './tools/use-item.js'
import { renderPrologue, renderWorldGuide } from './world-guide.js'
import { WORLD_OVERVIEW, locations, connections } from './data/maps.js'
import { getDefaultSubLocation, getSubLocationName, getPlayerSubLocation, getNPCSubLocation } from './npc-mobility.js'
import { resolveAudio, type AudioState } from './audio-config.js'
import { consumeAmbianceOverride } from './tools/set-ambiance.js'
import { getLoreStore } from './lore/index.js'
import { resetJournalTurnCounter } from './dm-journal.js'
import { consumeGameOver, type GameOverData } from './tools/game-over.js'
import { consumeTradeProposal } from './tools/propose-trade.js'
import { localize, StreamingLocalizer } from './i18n-terms.js'
import { SetActionsStreamFilter, parseSetActionsBlock } from './setactions-stream-filter.js'
import { injectPendingActions } from './tools/set-actions.js'
import { readFileSync } from 'fs'
import { checkAvailableHints, markHintShown, formatEnemyDescForPrompt } from './bestiary.js'
import monstersJsonData from '../data/monsters.json' with { type: 'json' }
import npcCombatJsonData from '../data/npc-combatants.json' with { type: 'json' }
const COMBAT_DB_ALL = [...monstersJsonData, ...npcCombatJsonData] as unknown as import('./types.js').Monster[]

// ─── <think> 标签流式解析器 ─────────────────────────
// DM 用 <think>...</think> 包裹内部推理，引擎分离为 dm_thinking 事件

class ThinkTagParser {
  private inThink = false
  private buffer = ''

  /** 处理一个 text chunk，返回 { narrative, thinking } */
  process(chunk: string): { narrative: string; thinking: string } {
    let narrative = ''
    let thinking = ''
    const input = this.buffer + chunk
    this.buffer = ''

    let i = 0
    while (i < input.length) {
      if (!this.inThink) {
        const openIdx = input.indexOf('<think>', i)
        if (openIdx === -1) {
          // 检查末尾是否可能是不完整的 <think 标签
          const tail = input.slice(Math.max(i, input.length - 7))
          if (tail.length < 7 && '<think>'.startsWith(tail)) {
            this.buffer = tail
            narrative += input.slice(i, input.length - tail.length)
          } else {
            narrative += input.slice(i)
          }
          break
        }
        narrative += input.slice(i, openIdx)
        this.inThink = true
        i = openIdx + 7 // skip '<think>'
      } else {
        const closeIdx = input.indexOf('</think>', i)
        if (closeIdx === -1) {
          // 检查末尾是否可能是不完整的 </think 标签
          const tail = input.slice(Math.max(i, input.length - 8))
          if (tail.length < 8 && '</think>'.startsWith(tail)) {
            this.buffer = tail
            thinking += input.slice(i, input.length - tail.length)
          } else {
            thinking += input.slice(i)
          }
          break
        }
        thinking += input.slice(i, closeIdx)
        this.inThink = false
        i = closeIdx + 8 // skip '</think>'
      }
    }
    return { narrative, thinking }
  }

  /** 刷新剩余 buffer */
  flush(): { narrative: string; thinking: string } {
    const buf = this.buffer
    this.buffer = ''
    if (this.inThink) {
      this.inThink = false
      return { narrative: '', thinking: buf }
    }
    return { narrative: buf, thinking: '' }
  }
}

// ─── NPC 战斗数据缓存（用于状态恢复系统） ─────────

let _npcCombatDb: Array<{ name: string; recoveryTurns?: number }> | null = null
function getNpcCombatDb(): Array<{ name: string; recoveryTurns?: number }> {
  if (!_npcCombatDb) {
    _npcCombatDb = JSON.parse(readFileSync('data/npc-combatants.json', 'utf-8'))
  }
  return _npcCombatDb!
}

// ─── NPC 状态恢复检查 ──────────────────────────────

function checkNPCConditionRecovery(session: GameSession): void {
  const npcCombatDb = getNpcCombatDb()
  for (const npc of session.npcs) {
    if (!npc.condition || npc.condition === 'normal') continue
    if (npc.conditionTurn == null) continue

    const combatData = npcCombatDb.find(c => c.name === npc.name)
    const recoveryTurns = combatData?.recoveryTurns ?? 10
    const elapsed = session.turnCount - npc.conditionTurn

    if (npc.condition === 'unconscious' && elapsed >= recoveryTurns) {
      npc.condition = 'recovering'
      npc.conditionTurn = session.turnCount
    } else if (npc.condition === 'recovering' && elapsed >= recoveryTurns) {
      npc.condition = 'wounded'
      npc.conditionTurn = session.turnCount
    } else if (npc.condition === 'wounded' && elapsed >= recoveryTurns) {
      npc.condition = 'normal'
      npc.conditionTurn = undefined
    }
  }
}

// ─── 自动检测敌对 NPC ──────────────────────────

/**
 * 检测是否有 NPC 达到敌对阈值，返回需要触发的 NPC 列表
 *
 * 检测条件：
 * - 信任度 ≤ combat 阈值
 * - 在同一位置
 * - 状态正常（非昏迷/恢复中）
 * - 冷却时间已过（3 轮）
 * - 当前不在战斗中
 */
async function checkHostileNPCs(session: GameSession): Promise<Array<{ npc: string; response: string }>> {
  if (session.combat?.active) return []

  const { evaluateResponse } = await import('./trust-system.js')
  const { getPersonality } = await import('./npc-relationships.js')

  const playerLoc = session.worldState.currentLocation
  const playerSub = session.worldState.currentSubLocation

  // 初始化冷却记录
  if (!session.npcHostileCooldowns) {
    session.npcHostileCooldowns = new Map()
  }

  const hostileNPCs: Array<{ npc: string; response: string }> = []

  for (const npc of session.npcs) {
    // 1. 检查位置
    if (npc.location !== playerLoc) continue
    const npcSub = npc.subLocation ?? npc.homeBase
    if (npcSub !== playerSub) continue

    // 2. 检查状态
    if (npc.condition === 'unconscious' || npc.condition === 'recovering') continue

    // 3. 检查信任度
    const response = evaluateResponse(npc)
    if (response.type !== 'combat_trigger') continue

    // 4. 检查冷却（存档恢复后 Map 可能退化为普通对象）
    if (session.npcHostileCooldowns && !(session.npcHostileCooldowns instanceof Map)) {
      session.npcHostileCooldowns = new Map(Object.entries(session.npcHostileCooldowns))
    }
    if (!session.npcHostileCooldowns) session.npcHostileCooldowns = new Map()
    const lastTrigger = session.npcHostileCooldowns.get(npc.name)
    if (lastTrigger !== undefined) {
      const cooldownRemaining = 3 - (session.turnCount - lastTrigger)
      if (cooldownRemaining > 0) continue
    }

    // 5. 获取响应类型
    const personality = getPersonality(npc.name)
    const combatResponse = response.combatResponse ?? personality.combatResponse

    hostileNPCs.push({ npc: npc.name, response: combatResponse })
  }

  return hostileNPCs
}

// ─── 战斗结束后 NPC 状态同步 ──────────────────────

function syncNPCConditionAfterCombat(
  session: GameSession,
  combatMonsters: Array<{ name: string; hp: number; maxHp: number }>,
  combatAllies?: Array<{ id: string; name: string; hp: number; maxHp: number }>,
): void {
  for (const monster of combatMonsters) {
    const npc = session.npcs.find(n => n.name === monster.name)
    if (!npc) continue
    if (monster.hp <= 0) {
      npc.condition = 'unconscious'
      npc.conditionTurn = session.turnCount
    } else if (monster.hp < monster.maxHp / 2) {
      npc.condition = 'wounded'
      npc.conditionTurn = session.turnCount
    }
  }
  // 同伴状态同步：倒地 → 昏迷 + 离队
  for (const ally of (combatAllies ?? [])) {
    const npc = session.npcs.find(n => n.name === ally.name)
    if (!npc) continue
    if (ally.hp <= 0) {
      npc.condition = 'unconscious'
      npc.conditionTurn = session.turnCount
      session.party = (session.party ?? []).filter(n => n !== ally.name)
    } else if (ally.hp < ally.maxHp / 2) {
      npc.condition = 'wounded'
      npc.conditionTurn = session.turnCount
    }
  }
}

// ─── 选项分类（复用 rules-agent quickMatch，图标与执行一致） ──────────────────

const ACTION_TYPE_ICONS: Record<string, string> = {
  MOVE: 'ra-compass',
  LOOK: 'ra-eye-monster',
  SEARCH: 'ra-telescope',
  ATTACK: 'ra-sword',
  TALK: 'ra-speech-bubble',
  REST: 'ra-health',
  BUY: 'ra-gold-bar',
  SELL: 'ra-gold-bar',
  FLEE: 'ra-footprint',
  USE: 'ra-potion',
  GIVE: 'ra-hand',
}

function classifySuggestion(text: string): ClassifiedSuggestion {
  const clean = text.startsWith('★') ? text.slice(1) : text
  const action = quickMatch(clean)
  if (action) {
    const icon = ACTION_TYPE_ICONS[action.type] || 'ra-scroll-unfurled'
    return { text, actionType: action.type.toLowerCase(), icon }
  }
  return { text, actionType: 'narrative', icon: 'ra-scroll-unfurled' }
}

function classifyActions(actions: SceneActions): ClassifiedSceneActions {
  if (!actions.suggestions || !Array.isArray(actions.suggestions)) {
    console.error(`[debug-actions] classifyActions: suggestions 不是数组!`, typeof actions.suggestions, JSON.stringify(actions.suggestions))
    return { details: actions.details ?? [], suggestions: [] }
  }
  return {
    details: actions.details,
    suggestions: actions.suggestions.map(s => classifySuggestion(s)),
  }
}

// ─── 重复检测工具 ────────────────────────────────

/** 检测流式文本是否陷入重复循环。返回截断后的文本，或 null 表示无重复 */
function detectRepetition(text: string, windowSize = 80): string | null {
  if (text.length <= windowSize * 2) return null
  const tail = text.slice(-windowSize)
  const head = text.slice(0, -windowSize)
  const idx = head.indexOf(tail)
  if (idx !== -1) return text.slice(0, idx + windowSize)
  return null
}

/**
 * 截断修复：LLM 同时生成 text + tool_calls 时可能把最后一句话写到一半就停了。
 * 如果文本末尾不是完整句子（中文句号/问号/叹号/省略号/引号），
 * 截到最后一个完整句子并补省略号。
 */
function trimToLastSentence(text: string): string {
  const trimmed = text.trimEnd()
  if (!trimmed) return trimmed
  // 以句终标点或引号结尾 → 完整句子，不处理
  if (/[。！？…」』"）\n]$/.test(trimmed)) return trimmed
  // 找最后一个句终标点的位置
  const lastEnd = Math.max(
    trimmed.lastIndexOf('。'),
    trimmed.lastIndexOf('！'),
    trimmed.lastIndexOf('？'),
    trimmed.lastIndexOf('…'),
    trimmed.lastIndexOf('"'),
    trimmed.lastIndexOf('」'),
  )
  if (lastEnd > 0 && lastEnd > trimmed.length * 0.5) {
    // 截到最后一个完整句子，加省略号表示自然收尾
    const fixed = trimmed.slice(0, lastEnd + 1)
    console.log(`[dm] 截断修复: "${trimmed.slice(-20)}" → 截到 ${lastEnd + 1}/${trimmed.length}`)
    return fixed
  }
  // 没有句终标点，或只在很前面才有 → 不截（可能是极短文本），补省略号
  return trimmed + '……'
}

// ─── NPC 立绘映射 ──────────────────────────────

const NPC_PORTRAITS: Record<string, string> = {
  '格雷格': 'portraits/greg-ironfist.png',
  '小莉': 'portraits/xiao-li.png',
  '艾琳娜': 'portraits/elena-silverleaf.png',
  '维克多': 'portraits/victor-blackstone.png',
  '卡恩': 'portraits/kahn-the-traveler.png',
  '陈妈': 'portraits/chen-ma.png',
  '格罗姆': 'portraits/grom.png',
  '叶绿': 'portraits/ye-lv.png',
  '韩猛': 'portraits/han-meng.png',
}

const MONSTER_PORTRAITS: Record<string, string> = {
  'Shadow': 'portraits/monster-shadow.png',
  'Ghoul': 'portraits/monster-ghoul.png',
  'Mimic': 'portraits/monster-mimic.png',
  'Eclipsed Beast': 'portraits/monster-eclipsed-beast.png',
}


// ─── 命令结果类型 ──────────────────────────────

export interface CommandResult {
  type: string
  data?: any
  text?: string
  savePath?: string
  success?: boolean
  message?: string
}

// ─── 回合事件类型 ──────────────────────────────

export type TurnEvent =
  | { type: 'broken_promise'; npcName: string; reason: string }
  | { type: 'safety_block'; reason: string }
  | { type: 'dm_text_delta'; text: string }
  | { type: 'actions_loading' }
  | { type: 'combat_interrupt'; responder: string; victim: string; portrait: string; immediate: boolean }
  | { type: 'dm_end'; combat: boolean; pendingMonster: boolean; actions: SceneActions | ClassifiedSceneActions | null; hasPendingTrade?: boolean; text?: string }
  | { type: 'dm_error'; message: string }
  | { type: 'combat_monster'; text: string; playerHp?: number; playerMaxHp?: number; allies?: any[] }
  | { type: 'combat_ally'; text: string }
  | { type: 'combat_status'; text: string; ended: boolean; result?: string }
  | { type: 'combat_init'; monsters: any[]; round: number; initiative: any[]; narrative?: string; allies?: any[] }
  | { type: 'combat_action_req'; targets: any[]; spells: any[]; items: any[]; playerHp: number; playerMaxHp: number; activeEffects?: any[]; allies?: any[] }
  | { type: 'quest_completed'; questName: string; text: string }
  | { type: 'quest_progress'; questName: string; text: string; current?: number; required?: number }
  | { type: 'npc_unlock'; npcName: string; portrait: string; firstFacts: string[] }
  | { type: 'npc_update'; text: string }
  | { type: 'auto_save'; path?: string }
  | { type: 'audio'; bgm: string; ambient: string }
  | { type: 'npc_speaking'; npcName: string; portrait: string }
  | { type: 'combat_portraits'; monsters: Array<{ id: string; name: string; portrait: string; hp: number; maxHp: number }> }
  | { type: 'game_over'; reason: string; canContinue: boolean; continueHint?: string }
  | { type: 'narrative_warning'; text: string }
  | { type: 'important_warning'; title: string; text: string }
  | { type: 'item_acquired'; text: string }
  | { type: 'trade_proposal'; npc: string; items: any[]; totalPrice: number; canBargain: boolean }
  | { type: 'death_pending' }
  | { type: 'death'; epilogue?: string }
  | { type: 'sync'; session: GameSession; dossier: any; questHint: QuestHint | null }
  | { type: 'combat_narrative'; text: string }
  | { type: 'combat_narrative_actions'; actions: SceneActions }
  | { type: 'dm_thinking'; text: string }
  | { type: 'system_message'; text: string }
  | { type: 'bestiary_hint'; text: string; npc: string; monster: string }
  /**
   * 统一的"发现"弹窗事件，承载 POI 发现、物品获取（系统发放）或两者兼有的场景。
   * - Search 同时找到 POI + 物品 → 单条事件包含 poi + items + gold（前端单一弹窗）
   * - Move 首次到达 POI → 仅 poi
   * - Search 找到物品但无新 POI → 仅 items / gold
   */
  | { type: 'discovery';
      source: 'search' | 'arrival';
      poi?: { id: string; nameZh: string; areaId: string; areaName: string; description: string };
      items?: Array<{ name: string; quantity: number; description?: string }>;
      gold?: number;
    }
  /** Boss 巢穴入口确认 — 玩家到达有遭遇的 POI 时弹出，需确认"踏入"才开战 */
  | { type: 'lair_entrance';
      poi: { id: string; nameZh: string; areaId: string; areaName: string };
      entranceText: string;
      encounterDescription: string;
      image?: string;
    }
  // ── 战棋网格事件 ──
  /** 战斗开始时发送完整棋盘状态 */
  | { type: 'combat_grid_init'; grid: any }
  /** 单位移动（前端播放逐格滑动动画） */
  | { type: 'combat_grid_move'; unitId: string; path: Array<{ x: number; y: number }> }
  /** 单位出生（召唤/分裂） */
  | { type: 'combat_grid_spawn'; unit: any }
  /** 单位死亡 */
  | { type: 'combat_grid_death'; unitId: string }
  /** 战棋攻击结果 */
  | { type: 'combat_grid_attack'; attackerId: string; targetId: string; damage: number; hit: boolean; isCritical: boolean; narrative: string }
  /** 战棋战斗结束 */
  | { type: 'combat_grid_end'; result: 'victory' | 'defeat'; loot?: any }

// ─── 默认选项 fallback ──────────────────────────

export function buildFallbackActions(session: GameSession): SceneActions {
  const loc = session.worldState.currentLocation
  const subLoc = session.worldState.currentSubLocation
  const time = session.worldState.timeOfDay
  const isNight = time === 'night'
  const inCombatAftermath = session.npcs.some(n =>
    n.condition === 'unconscious' && n.location === loc &&
    (n.subLocation ?? n.homeBase) === subLoc
  )
  const npcsHere = session.npcs.filter(n =>
    n.location === loc && (n.subLocation ?? n.homeBase) === subLoc
    && n.condition !== 'unconscious' && n.condition !== 'recovering'
  )
  const suggestions: string[] = []

  // 场景优先：刚打完仗 → 搜索 + 可能的回程beat推荐
  if (inCombatAftermath) {
    suggestions.push('搜索周围')
    // 检查是否有"回去汇报"类beat（如 ch2_report_elena）
    if (session.chapter) {
      const chapterDef = getChapter(session.chapter.currentChapter)
      if (chapterDef) {
        for (const beat of chapterDef.beats) {
          if (session.chapter.completedBeats.includes(beat.id)) continue
          if (beat.requires && !beat.requires.every((r: string) => session.chapter!.completedBeats.includes(r))) continue
          if (beat.trigger === 'auto') continue
          // 信任驱动的副本 beats 不应作为系统推荐 — 它们是玩家自然探索时
          // 触发的隐藏内容，被推荐会暴露"你和某 NPC 信任度够了"的元信息
          if (beat.trustGate) continue
          const [bType, bTarget] = beat.trigger.split(':')
          if (bType === 'talk' && bTarget) {
            const npc = session.npcs.find(n => n.name === bTarget)
            if (npc) {
              if (npc.location !== loc) {
                const destArea = locations[npc.location]
                if (destArea) suggestions.push(`★回${destArea.nameZh}找${bTarget}`)
              } else {
                const npcSub = npc.subLocation ?? npc.homeBase
                if (npcSub && npcSub !== subLoc) {
                  const area = locations[loc]
                  const poi = area?.pointsOfInterest.find((p: any) => p.id === npcSub)
                  if (poi) suggestions.push(`★前往${(poi as any).nameZh}找${bTarget}`)
                } else {
                  suggestions.push(`★和${bTarget}交谈`)
                }
              }
            }
          }
          break  // 只取第一个可推进的beat
        }
      }
    }
    if (suggestions.length < 3) {
      const area = locations[loc]
      if (area) {
        const otherPoi = area.pointsOfInterest.find((p: any) => p.discovered !== false && p.id !== subLoc)
        if (otherPoi) suggestions.push(`前往${(otherPoi as any).nameZh}`)
      }
    }
    return { details: [], suggestions: suggestions.slice(0, 3) }
  }

  // 章节感知：优先推荐能推进主线的操作
  if (session.chapter) {
    const chapterDef = getChapter(session.chapter.currentChapter)
    if (chapterDef) {
      for (const beat of chapterDef.beats) {
        if (session.chapter.completedBeats.includes(beat.id)) continue
        if (beat.requires && !beat.requires.every((r: string) => session.chapter!.completedBeats.includes(r))) continue
        if (beat.trigger === 'auto') continue
        // 跳过信任驱动的副本 beats（设计为玩家探索的奖励，不作系统推荐）
        if (beat.trustGate) continue

        const [type, target] = beat.trigger.split(':')
        if (type === 'talk' && target) {
          const npc = npcsHere.find(n => n.name === target)
          if (npc && !suggestions.includes(`★和${target}交谈`) && !suggestions.includes(`和${target}交谈`)) {
            suggestions.push(`★和${target}交谈`)
          } else if (!npc) {
            // NPC 不在当前子地点 → 推荐前往
            const npcData = session.npcs.find(n => n.name === target)
            if (npcData) {
              const npcSub = npcData.subLocation ?? npcData.homeBase
              if (npcData.location !== loc) {
                // 不同区域 → 跨区导航
                const destArea = locations[npcData.location]
                const navText = destArea ? `★前往${destArea.nameZh}找${target}` : ''
                if (navText && !suggestions.includes(navText)) suggestions.push(navText)
              } else if (npcSub && npcSub !== subLoc) {
                // 同区域不同子地点 → 子地点导航
                const area = locations[loc]
                if (area) {
                  const poi = area.pointsOfInterest.find((p: any) => p.id === npcSub)
                  const navText = poi ? `★前往${(poi as any).nameZh}找${target}` : ''
                  if (navText && !suggestions.includes(navText)) suggestions.push(navText)
                }
              }
            }
          }
        } else if (type === 'arrive' && target) {
          const destArea = locations[target]
          if (destArea && target !== loc) {
            if (isNight && (target === 'twilight-woods' || target === 'greyspine-mines' || target === 'shatterstone-wastes')) {
              // 夜间不推荐去危险区域
            } else {
              suggestions.push(`★前往${destArea.nameZh}`)
            }
          }
        }
        if (suggestions.length >= 3) break
      }
    }
  }

  // 深夜特殊建议
  if (isNight && suggestions.length === 0) {
    // 深夜在酒馆 → 休息或和格雷格聊
    if (subLoc === 'shattered-shield-tavern') {
      const greg = npcsHere.find(n => n.name === '格雷格')
      if (greg) suggestions.push('和格雷格交谈')
      suggestions.push('休息到天亮')
    }
    // 深夜在其他地方 → 回酒馆
    else if (loc === 'dawnbreak-town') {
      suggestions.push('回碎盾亭酒馆')
    }
  }

  // 补充：在场 NPC（非主线已推荐的）
  for (const npc of npcsHere) {
    const s = `和${npc.name}交谈`
    if (!suggestions.includes(s) && suggestions.length < 3) suggestions.push(s)
  }

  // 补充：其他子地点（深夜不推荐商店/公会）
  const area = locations[loc]
  if (area && suggestions.length < 3) {
    const otherPois = area.pointsOfInterest.filter((p: any) => {
      if (p.id === subLoc) return false
      if (p.discovered === false) return false
      // 深夜不推荐商店类地点
      if (isNight && (p.id === 'sturdy-anvil' || p.id === 'adventurer-guild' || p.id === 'silver-scale-guild')) return false
      return true
    })
    if (otherPois.length) suggestions.push(`前往${(otherPois[0] as any).nameZh}`)
  }

  return { details: [], suggestions: suggestions.slice(0, 3) }
}

/** 从建议文本中提取关键词（NPC名、地点名）用于语义去重 */
function extractKeywords(text: string, session: GameSession): string[] {
  const keywords: string[] = []
  // NPC 名字
  for (const npc of session.npcs) {
    if (text.includes(npc.name)) keywords.push(npc.name)
  }
  // 地点中文名
  for (const loc of Object.values(locations)) {
    if (text.includes(loc.nameZh)) keywords.push(loc.nameZh)
    for (const poi of loc.pointsOfInterest) {
      if (text.includes((poi as any).nameZh)) keywords.push((poi as any).nameZh)
    }
  }
  return keywords
}

// ─── 主线提示（常驻，不受 DM 行为影响） ──────────

interface QuestHint {
  /** 当前章节标题 */
  chapter: string
  /** 当前主线目标描述 */
  objective: string
  /** 推荐动作（人类可读，如"前往暮色森林"） */
  action: string
  /** 进度指示：已完成beat数 / advanceWhen要求数 */
  progress: string
}

/**
 * 根据当前章节和已完成 beat 推算下一步主线方向。
 * 设计原则：始终给出明确的行动指引，即使玩家迷路也能找到方向。
 */
export function getQuestHint(session: GameSession): QuestHint | null {
  if (!session.chapter) return null
  const chapterDef = getChapter(session.chapter.currentChapter)
  if (!chapterDef) return null

  const completed = session.chapter.completedBeats
  const loc = session.worldState.currentLocation

  // 找到第一个未完成的、前置满足的、非auto的、非信任驱动副本的beat
  let nextBeat = null
  for (const beat of chapterDef.beats) {
    if (completed.includes(beat.id)) continue
    if (beat.trigger === 'auto') continue
    if (beat.requires && !beat.requires.every(r => completed.includes(r))) continue
    // 跳过信任驱动的副本 beats（同 buildFallbackActions 的处理）
    if (beat.trustGate) continue
    nextBeat = beat
    break
  }

  // 所有beat已完成 → 章节即将推进
  if (!nextBeat) {
    return {
      chapter: chapterDef.title,
      objective: '本章任务已完成',
      action: chapterDef.nextChapter ? '等待剧情推进...' : '最终章',
      progress: `${chapterDef.advanceWhen.length}/${chapterDef.advanceWhen.length}`,
    }
  }

  // 根据 trigger 类型生成指引
  const [type, target] = nextBeat.trigger.split(':')
  let objective = ''
  let action = ''

  if (type === 'talk' && target) {
    const npc = session.npcs.find(n => n.name === target)
    const npcLoc = npc?.location
    const npcSub = npc?.subLocation ?? npc?.homeBase
    const subLoc = session.worldState.currentSubLocation
    const sameLocation = npcLoc === loc
    const sameSubLocation = sameLocation && npcSub === subLoc

    // 根据beat id 给出更具体的目标描述
    if (nextBeat.id.includes('meet')) {
      objective = `前去见${target}`
    } else if (nextBeat.id.includes('report')) {
      objective = `回去向${target}汇报`
    } else if (nextBeat.id.includes('quest')) {
      objective = `与${target}讨论任务`
    } else {
      objective = `与${target}交谈`
    }

    if (sameSubLocation) {
      action = `和${target}交谈`
    } else if (sameLocation && npcSub) {
      // 同区域不同子地点
      const area = locations[loc]
      const poi = area?.pointsOfInterest.find((p: any) => p.id === npcSub)
      action = poi ? `前往${(poi as any).nameZh}找${target}` : `去找${target}`
    } else if (npcLoc) {
      const area = locations[npcLoc]
      action = area ? `前往${area.nameZh}找${target}` : `去找${target}`
    } else {
      action = `找到${target}`
    }
  } else if (type === 'arrive' && target) {
    const area = locations[target]
    const areaName = area?.nameZh ?? target
    if (target === loc) {
      objective = `探索${areaName}`
      action = '继续深入探索'
    } else {
      objective = `前往${areaName}`
      action = `前往${areaName}`
    }
  } else if (type === 'combat_end') {
    objective = '完成战斗'
    action = '击败敌人'
  } else if (type === 'search') {
    objective = '搜索周围环境'
    action = '搜索周围'
  }

  // 计算进度
  const advanceBeats = chapterDef.advanceWhen
  const doneCount = advanceBeats.filter(id => completed.includes(id)).length

  return {
    chapter: chapterDef.title,
    objective,
    action,
    progress: `${doneCount}/${advanceBeats.length}`,
  }
}

// ─── 存档迁移 ──────────────────────────────────

// 旧存档物品名迁移（英文→中文）
const ITEM_NAME_MIGRATION: Record<string, string> = {
  'Shortsword': '短剑',
  'Shortsword +1': '短剑 +1',
  'Longsword': '长剑',
  'Shortbow': '短弓',
  'Leather Armor': '皮甲',
  'Chain Shirt': '锁子甲',
  'Healing Potion': '治疗药水',
  'Antidote': '解毒剂',
  'Shadow Ward Potion': '暗影防护药水',
  'Mine Key': '矿道钥匙',
  "Darian's Journal": '达里安的日志',
  'Hempen Rope': '麻绳',
  'Torch': '火把',
}

function migrateItemNames(session: GameSession): void {
  const migrate = (name: string) => ITEM_NAME_MIGRATION[name] ?? name

  // 玩家背包
  for (const item of session.player.inventory) {
    item.name = migrate(item.name)
  }
  // 装备槽
  if (session.player.equipped.weapon) {
    session.player.equipped.weapon.name = migrate(session.player.equipped.weapon.name)
  }
  if (session.player.equipped.armor) {
    session.player.equipped.armor.name = migrate(session.player.equipped.armor.name)
  }
  // NPC 背包
  for (const npc of session.npcs) {
    for (const item of npc.inventory ?? []) {
      item.name = migrate(item.name)
    }
    // shopPricing 键迁移
    if (npc.shopPricing) {
      const newPricing: Record<string, number> = {}
      for (const [key, val] of Object.entries(npc.shopPricing)) {
        newPricing[migrate(key)] = val
      }
      npc.shopPricing = newPricing
    }
  }
}

export function migrateSession(session: GameSession): void {
  migrateItemNames(session)
  const defaults = createInitialNPCs()
  for (const npc of session.npcs) {
    if (npc.role === undefined) {
      const def = defaults.find(d => d.name === npc.name)
      if (def) {
        npc.role = def.role
        if (npc.inventory === undefined) npc.inventory = def.inventory ?? []
        if (npc.shopPricing === undefined) npc.shopPricing = def.shopPricing
      }
    }
    if (npc.homeBase === undefined) {
      const def = defaults.find(d => d.name === npc.name)
      if (def) {
        npc.homeBase = def.homeBase
        npc.mobility = def.mobility
        if (npc.subLocation === undefined) npc.subLocation = def.subLocation
      }
    }
  }
  if (session.worldState.currentSubLocation === undefined) {
    session.worldState.currentSubLocation = getDefaultSubLocation(session.worldState.currentLocation)
  }
  // Phase 6: DM Journal 字段(旧存档没有)
  if (session.dmJournal === undefined) {
    session.dmJournal = []
  }
  if (session.npcMemories === undefined) {
    session.npcMemories = {}
  }
}

// ─── 重连回顾 ──────────────────────────────────

export function buildResumeRecap(session: GameSession): string {
  const locationNames: Record<string, string> = {
    'dawnbreak-town': '破晓镇', 'twilight-woods': '暮色森林',
    'greyspine-mines': '灰脊矿道', 'shatterstone-wastes': '碎石荒原',
  }
  const loc = locationNames[session.worldState.currentLocation] ?? session.worldState.currentLocation
  const subLocId = session.worldState.currentSubLocation
  const subLocName = subLocId ? getSubLocationName(subLocId) : ''

  const lines: string[] = [
    `[断线重连 — 对话回顾，请基于以下信息延续之前的对话，不要重新开场]`,
    `当前位置: ${loc}${subLocName ? ' · ' + subLocName : ''} | 第${session.turnCount}轮`,
  ]

  const recentEvents = session.events.slice(-5)
  if (recentEvents.length) {
    lines.push(`\n最近发生的事：`)
    for (const e of recentEvents) lines.push(`  - [第${e.turn}轮] ${e.fact}`)
  }

  const recentNpcLogs: string[] = []
  for (const npc of session.npcs) {
    const logs = npc.interactionLog ?? []
    if (logs.length > 0) {
      recentNpcLogs.push(`  ${npc.name}: ${logs.slice(-3).join('；')}`)
    }
  }
  if (recentNpcLogs.length) {
    lines.push(`\n最近的NPC对话：`)
    lines.push(...recentNpcLogs)
  }

  const activeQuests = session.quests.filter(q => q.status === 'active')
  if (activeQuests.length) lines.push(`\n当前任务: ${activeQuests.map(q => q.name).join('、')}`)

  if (session.chapter) {
    const cm = new ChapterManager(session)
    lines.push(`当前章节: ${cm.getChapterTitle()}`)
  }

  return lines.join('\n')
}

// ─── GameEngine ──────────────────────────────────

export class GameEngine {
  session: GameSession
  dossier: DossierManager
  private turnsSinceLastSave = 0
  private justResumed = false
  // TODO: bargainState 目前不持久化——刷新页面会丢失砍价状态。
  // 如需持久化，需要将此字段移入 session 并在 sync 时序列化到 localStorage。
  private bargainState: {
    npc: string
    items: Array<{ name: string; price: number; quantity: number }>
    lastPrice: number
    round: number
  } | null = null

  constructor(session: GameSession, dossier?: DossierManager) {
    this.session = session
    this.dossier = dossier ?? new DossierManager()
  }

  /** 激活全局状态（在每次操作前调用） */
  private activate(): void {
    setSession(this.session)
  }

  /**
   * 检测玩家输入是否包含"坦白暴力"行为
   *
   * 检测逻辑：
   * 1. 输入包含暴力相关关键词（攻击、打、杀、伤害等）
   * 2. 输入提到了某个 NPC 的名字
   * 3. 语气是坦白/承认（不是否认或询问）
   */
  private detectViolenceConfession(
    input: string,
    session: GameSession
  ): { isConfession: boolean; victimName?: string } {
    // 暴力关键词
    const violenceKeywords = [
      '攻击', '打', '杀', '伤害', '袭击', '揍', '砍', '刺',
      '昏迷', '打倒', '打伤', '弄伤', '弄晕', '打昏'
    ]

    // 否定词（如果包含否定词，不算坦白）
    const negationWords = ['没', '不', '没有', '不是', '未曾', '从未', '并非']

    // 疑问词（如果是疑问句，不算坦白）
    const questionWords = ['吗', '呢', '？', '?', '是否']

    // 间接叙述词（如果是转述，不算坦白）
    const indirectWords = ['听说', '据说', '有人', '别人', '他们']

    // 检查是否包含暴力关键词
    const hasViolenceKeyword = violenceKeywords.some(kw => input.includes(kw))
    if (!hasViolenceKeyword) return { isConfession: false }

    // 检查是否包含否定词、疑问词或间接叙述词
    const hasNegation = negationWords.some(nw => input.includes(nw))
    const hasQuestion = questionWords.some(qw => input.includes(qw))
    const hasIndirect = indirectWords.some(iw => input.includes(iw))
    if (hasNegation || hasQuestion || hasIndirect) return { isConfession: false }

    // 检查是否提到了某个 NPC 的名字
    for (const npc of session.npcs) {
      if (input.includes(npc.name)) {
        return { isConfession: true, victimName: npc.name }
      }
    }

    return { isConfession: false }
  }

  /**
   * 判断是否可以跨区域追踪
   * @param fromLocation 追踪起点区域
   * @param toLocation 追踪目标区域
   * @param toSubLocation 追踪目标子区域
   * @returns 是否可以追踪
   */
  private async canTrackAcrossLocations(
    fromLocation: string,
    toLocation: string,
    toSubLocation?: string
  ): Promise<boolean> {
    // 同区域内总是可以追踪
    if (fromLocation === toLocation) return true

    // 矿道中层/下层不可追踪（太危险，地形复杂）
    if (toLocation === 'greyspine-mines' && toSubLocation) {
      const untrackableSubLocations = ['abandoned-barracks', 'abyss-altar', 'void-prism']
      if (untrackableSubLocations.includes(toSubLocation)) {
        console.log(`[tracking] 目标区域不可追踪: ${toLocation}/${toSubLocation}`)
        return false
      }
    }

    // 检查是否有连接路径（直接或间接）
    const hasConnection = connections.some(
      conn => (conn.from === fromLocation && conn.to === toLocation) ||
              (conn.from === toLocation && conn.to === fromLocation)
    )

    if (!hasConnection) {
      console.log(`[tracking] 区域间无连接: ${fromLocation} -> ${toLocation}`)
      return false
    }

    console.log(`[tracking] 可以追踪: ${fromLocation} -> ${toLocation}`)
    return true
  }

  // ─── 生命周期 ────────────────────────────

  /** 创建新游戏 */
  static createGame(name: string, classId: string): GameEngine {
    const session = createGameSession(name, classId)
    initGameState(session)
    initDMAgent()

    const engine = new GameEngine(session)

    // 章节自动事件
    if (session.chapter) {
      new ChapterManager(session).processAutoBeats()
    }

    return engine
  }

  /** 从存档恢复 */
  static resumeGame(session: GameSession, dossierData?: any, dmMessages?: any[]): GameEngine {
    migrateSession(session)
    initGameState(session)
    initDMAgent()

    if (dmMessages?.length) {
      restoreDMMessages(dmMessages)
    }

    // 战斗状态不持久化：如果读档时处于战斗中，清空战斗状态（CombatGrid 是 class
    // 实例，JSON 往返后方法丢失；pre-combat 存档策略保证这里大概率是空的，但
    // 如果前端缓存了旧的 combat 对象，这里兜底处理——回到战斗前状态，下次移动
    // 可能重新触发遭遇（lair_entrance 或区域随机）
    let combatWasRewound = false
    if (session.combat?.active || session.combat?.grid) {
      console.log('[resume] 清除过期的战斗状态（战斗不持久化）')
      session.combat = null
      combatWasRewound = true
      // 清除 pending_encounter，避免一加载就立刻重新开战
      delete session.worldState.flags['pending_encounter']
      // 清除已触发的 lair_entrance，让玩家再次到达时重新弹入口卡片
      for (const key of Object.keys(session.worldState.flags)) {
        if (key.startsWith('poi_encounter_triggered_')) {
          delete session.worldState.flags[key]
        }
      }
      // 标记给前端显示提示（setState 时 read）
      ;(session as any).__combatRewound = true
    }

    const dossier = dossierData ? DossierManager.fromJSON(dossierData) : new DossierManager()
    resetIdleTracking()

    const engine = new GameEngine(session, dossier)
    engine.justResumed = !dmMessages?.length
    return engine
  }

  /** 从磁盘加载存档 */
  static loadGame(slotName: string): GameEngine {
    const loaded = GameFactStore.load(slotName)
    const loadedSession = (loaded as any).session as GameSession
    const dossierData = loadedSession.dossierData
    return GameEngine.resumeGame(loadedSession, dossierData)
  }

  // ─── 命令处理 ────────────────────────────

  /** 处理斜杠命令，返回结构化数据。返回 null 表示不是命令。 */
  executeCommand(input: string): CommandResult | null {
    this.activate()
    const session = this.session
    const facts = getFacts()

    if (input === '/status') {
      const p = session.player
      const m = p.abilityModifiers

      // Derive className from abilities
      const classId = Object.entries(CLASS_TEMPLATES).find(([, t]) =>
        t.abilities.STR === p.abilities.STR &&
        t.abilities.DEX === p.abilities.DEX
      )?.[0] ?? ''
      const className = CLASS_TEMPLATES[classId]?.nameZh ?? ''

      const xpNext = p.level < 3 ? (p.level === 1 ? 100 : 300) : 999

      // Format attributes as object with displayable values (frontend reads attrs[key] directly)
      const fmtMod = (v: number) => v >= 0 ? `+${v}` : `${v}`
      const attributes: Record<string, string> = {}
      for (const key of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const) {
        attributes[key] = `${p.abilities[key]} (${fmtMod(m[key])})`
      }

      // Equipment as array (frontend expects data.equipment = [{name, desc, slot}])
      const equipment: Array<{ name: string; desc: string; slot: string }> = []
      if (p.equipped.weapon) equipment.push({ name: p.equipped.weapon.name, desc: p.equipped.weapon.description, slot: 'weapon' })
      if (p.equipped.armor) equipment.push({ name: p.equipped.armor.name, desc: p.equipped.armor.description, slot: 'armor' })

      return {
        type: 'status',
        data: {
          name: p.name, level: p.level, hp: p.hp, maxHp: p.maxHp,
          gold: p.gold, xp: p.xp, xpNext, className,
          attributes,
          equipment,
          spells: p.spells.map(s => ({
            name: s.name, desc: s.description,
            remaining: s.remaining, max: s.usesPerRest,
            isCantrip: s.usesPerRest === 0,
          })),
          skills: [...p.skills],
          inventory: p.inventory.map(i => ({ name: i.name, type: i.type, desc: i.description })),
          activeEffects: (p.activeEffects ?? []).map(e => ({
            name: e.name, type: e.type, value: e.value,
            remaining: e.remainingTurns, source: e.source,
          })),
          playerSummary: facts.getPlayerSummary(),
        },
      }
    }

    if (input === '/inventory') {
      const p = session.player
      // Equipment as array (frontend expects data.equipment = [{name, desc, slot}])
      const equipment: Array<{ name: string; desc: string; slot: string }> = []
      if (p.equipped.weapon) equipment.push({ name: p.equipped.weapon.name, desc: p.equipped.weapon.description, slot: 'weapon' })
      if (p.equipped.armor) equipment.push({ name: p.equipped.armor.name, desc: p.equipped.armor.description, slot: 'armor' })
      return {
        type: 'inventory',
        data: {
          equipment,
          items: p.inventory.map(i => ({ name: i.name, type: i.type, description: i.description, quantity: 1 })),
          gold: p.gold,
        },
      }
    }

    if (input === '/quest') {
      const qm = new QuestManager(session)
      const activeQuests = qm.getActiveQuests()
      const completedQuests = session.quests.filter(q => q.status === 'completed')
      // Frontend expects data.quests (array) with status field and description (not desc)
      const quests = [
        ...activeQuests.map(q => ({
          name: q.name, description: q.description, status: 'active' as const,
          objectives: q.objectives.map((o, i) => ({
            text: o, done: q.objectivesCompleted[i],
          })),
          reward: q.reward,
        })),
        ...completedQuests.map(q => ({
          name: q.name, description: q.description, status: 'completed' as const,
          objectives: q.objectives.map((o, i) => ({
            text: o, done: q.objectivesCompleted[i],
          })),
          reward: q.reward,
        })),
      ]
      return {
        type: 'quest',
        data: {
          quests,
          xp: session.player.xp,
          level: session.player.level,
          xpNext: session.player.level < 3 ? (session.player.level === 1 ? 100 : 300) : null,
        },
      }
    }

    if (input === '/map') {
      const currentLoc = locations[session.worldState.currentLocation]
      // 计算从当前区域可达的相邻区域
      const reachableAreas = connections
        .filter(c => c.from === session.worldState.currentLocation || c.to === session.worldState.currentLocation)
        .map(c => {
          const destId = c.from === session.worldState.currentLocation ? c.to : c.from
          const dest = locations[destId]
          return dest ? { id: destId, nameZh: dest.nameZh, description: c.description } : null
        })
        .filter(Boolean)
      return {
        type: 'map',
        data: {
          currentLocation: session.worldState.currentLocation,
          worldOverview: WORLD_OVERVIEW,
          locations: Object.values(locations).map(loc => ({
            id: loc.id, nameZh: loc.nameZh, danger: loc.dangerLevel, description: loc.description,
          })),
          currentSubLocation: session.worldState.currentSubLocation,
          currentSubLocationName: currentLoc?.pointsOfInterest?.find((p: any) => p.id === session.worldState.currentSubLocation)?.nameZh ?? '',
          subLocations: currentLoc?.pointsOfInterest
            ?.map((p: any) => ({
              id: p.id,
              nameZh: p.discovered !== false ? p.nameZh : '???',
              description: p.discovered !== false ? p.description : '',
              discovered: p.discovered !== false,
              isCurrent: p.id === session.worldState.currentSubLocation,
              npcs: (() => {
                if (p.discovered === false) return []  // 未发现的地点不显示NPC
                const here = session.npcs.filter(n =>
                  n.location === session.worldState.currentLocation &&
                  (n.subLocation ?? n.homeBase) === p.id)
                return here.filter(n => this.dossier.isUnlocked(n.name)).map(n => n.name)
              })(),
            })) ?? [],
          reachableAreas,
        },
      }
    }

    if (input === '/shop') {
      const loc = session.worldState.currentLocation
      const shopNpc = session.npcs.find(n =>
        n.shopPricing && (n.inventory ?? []).length > 0 && n.location === loc
      )
      if (!shopNpc) return { type: 'shop', data: null }
      return {
        type: 'shop',
        data: {
          npcName: shopNpc.name,
          playerGold: session.player.gold,
          items: (shopNpc.inventory ?? []).map(i => ({
            name: i.name, type: i.type, description: i.description,
            bonus: i.bonus, price: shopNpc.shopPricing?.[i.name] ?? 0,
          })),
        },
      }
    }

    if (input === '/npc' || input === '/npc ') {
      const trustMap: Record<string, number> = {}
      for (const npc of session.npcs) trustMap[npc.name] = npc.trust
      // 附带 NPC 位置信息，供前端渲染"交谈"按钮和灰显不在场 NPC
      const LOC_NAMES: Record<string, string> = {
        'dawnbreak-town': '破晓镇', 'twilight-woods': '暮色森林',
        'greyspine-mines': '灰脊矿道', 'shatterstone-wastes': '碎石荒原',
      }
      // 只显示已解锁（遇到过/被提到过）的 NPC 位置
      const unlockedNames = new Set(this.dossier.listUnlocked())  // 使用 dossier key（短名），不是 entry.name（全名）
      const npcLocations: Record<string, { location: string; subLocation: string; locationZh: string; subLocationZh: string }> = {}
      for (const npc of session.npcs) {
        if (!unlockedNames.has(npc.name)) continue  // 未解锁的 NPC 不显示
        const sub = npc.subLocation ?? npc.homeBase ?? ''
        const subName = getSubLocationName(sub)
        npcLocations[npc.name] = {
          location: npc.location,
          subLocation: sub,
          locationZh: LOC_NAMES[npc.location] ?? npc.location,
          subLocationZh: subName,
        }
      }
      console.log(`[npc-panel] player at: ${session.worldState.currentLocation}/${session.worldState.currentSubLocation}`)
      console.log(`[npc-panel] npcLocations keys:`, Object.keys(npcLocations))
      console.log(`[npc-panel] dossier.toListData keys:`, this.dossier.toListData(trustMap).map(n => `${n.key}(${n.name})`))
      for (const [name, loc] of Object.entries(npcLocations)) {
        console.log(`[npc-panel] ${name}: ${loc.location}/${loc.subLocation}`)
      }
      return {
        type: 'npc_list',
        data: {
          npcs: this.dossier.toListData(trustMap).map(n => ({
            ...n,
            condition: session.npcs.find(npc => npc.name === n.key)?.condition ?? 'normal',
          })),
          npcLocations,
          playerLocation: session.worldState.currentLocation,
          playerSubLocation: session.worldState.currentSubLocation,
        },
      }
    }

    if (input.startsWith('/npc ') && input.length > 5) {
      const npcName = input.slice(5).trim()
      const npc = session.npcs.find(n => n.name === npcName)
      const profileData = this.dossier.toProfileData(npcName, npc?.trust ?? 0)
      return {
        type: 'npc_detail',
        data: profileData,
        text: this.dossier.renderProfile(npcName), // CLI fallback
      }
    }

    if (input === '/recap') {
      const events = session.events
      const critical = events.filter(e => e.importance === 'critical')
      const recent = events.slice(-10)
      const npcLogs: Array<{ name: string; logs: string[] }> = []
      for (const npc of session.npcs) {
        if ((npc.interactionLog ?? []).length > 0) {
          npcLogs.push({ name: npc.name, logs: npc.interactionLog! })
        }
      }
      return {
        type: 'recap',
        data: {
          critical: critical.map(e => ({ turn: e.turn, fact: e.fact })),
          recent: recent.map(e => ({ turn: e.turn, fact: e.fact })),
          clues: session.player.clues,
          npcDialogues: npcLogs,
          quests: {
            active: session.quests.filter(q => q.status === 'active').map(q => q.name),
            completed: session.quests.filter(q => q.status === 'completed').map(q => q.name),
          },
        },
      }
    }

    if (input === '/chapter') {
      if (!session.chapter) return { type: 'chapter', data: null }
      const cm = new ChapterManager(session)
      return {
        type: 'chapter',
        data: {
          title: cm.getChapterTitle(),
          exploration: cm.getExploration(),
          discoveries: cm.getDiscoveryLabels(),
        },
      }
    }

    if (input === '/help') {
      return {
        type: 'help',
        data: {
          commands: [
            { cmd: '/status', desc: '查看角色状态' },
            { cmd: '/quest', desc: '查看任务进度' },
            { cmd: '/npc', desc: '查看已知人物' },
            { cmd: '/npc <名>', desc: '查看人物详情' },
            { cmd: '/world', desc: '查看世界指南' },
            { cmd: '/map', desc: '查看地图' },
            { cmd: '/inventory', desc: '查看背包' },
            { cmd: '/shop', desc: '查看附近商店' },
            { cmd: '/recap', desc: '故事回顾' },
            { cmd: '/chapter', desc: '查看章节进度与探索度' },
            { cmd: '/save', desc: '保存游戏' },
            { cmd: '/saves', desc: '查看存档列表' },
            { cmd: '/load <名>', desc: '加载存档' },
            { cmd: '/quit', desc: '退出游戏' },
          ],
        },
      }
    }

    if (input === '/world') {
      return { type: 'world', text: renderWorldGuide() }
    }

    if (input === '/save') {
      session.dossierData = this.dossier.toJSON()
      const path = getFacts().save()
      return { type: 'save', savePath: path }
    }

    if (input === '/saves') {
      return { type: 'saves', data: { saves: GameFactStore.listSaves() } }
    }

    if (input.startsWith('/load')) {
      const slotName = input.slice('/load'.length).trim()
      if (!slotName) {
        return { type: 'saves', data: { saves: GameFactStore.listSaves() } }
      }
      try {
        const loaded = GameFactStore.load(slotName)
        const loadedSession = (loaded as any).session as GameSession
        migrateSession(loadedSession)
        this.session = loadedSession
        initGameState(loadedSession)
        initDMAgent()
        resetIdleTracking()
        this.dossier = loadedSession.dossierData
          ? DossierManager.fromJSON(loadedSession.dossierData)
          : new DossierManager()
        return { type: 'load', success: true, message: `存档已加载: ${slotName}` }
      } catch (err) {
        return { type: 'load', success: false, message: `加载失败: ${(err as Error).message}` }
      }
    }

    if (input === '/quit') {
      session.dossierData = this.dossier.toJSON()
      const path = getFacts().save('web-quit')
      return { type: 'quit', savePath: path }
    }

    // 不是命令
    return null
  }

  // ─── 回合处理 ────────────────────────────

  /** 处理一个游戏回合，返回事件流 */
  async *processTurn(input: string): AsyncGenerator<TurnEvent> {
    this.activate()
    const session = this.session
    const facts = getFacts()

    // 战斗中禁止自由文本输入，必须使用操作按钮
    if (session.combat?.active) {
      yield { type: 'dm_error', message: '战斗中请使用操作按钮（攻击/法术/物品/逃跑/防御）。' }
      return
    }

    // 安全检查
    const safety = checkSafety(input)
    if (safety.level === 'block') {
      yield { type: 'safety_block', reason: safety.reason! }
      session.dossierData = this.dossier.toJSON()
      facts.save('quicksave')
      return
    }

    session.turnCount++

    // Phase 5: 重置 lore 工具的 per-turn 调用计数(每 turn 5 次上限)
    getLoreStore().resetTurnCounter()
    // Phase 6: 重置 DM Journal 的 per-turn 写入计数(每 turn 2 次上限)
    resetJournalTurnCounter()

    // NPC 状态恢复检查 + 队伍校验
    checkNPCConditionRecovery(session)
    validateParty(session)

    // 暴力后果战斗打断标记（阶段2不再直接 return，让 DM 先叙事再触发）
    let pendingCombatInterrupt: { responderName: string; victimName: string; subLocation: string; immediate: boolean } | null = null

    // 暴力后果检查
    const alertJson = session.worldState.flags['violence_alert'] as string | undefined
    if (alertJson && !session.combat?.active) {
      try {
        const alert = JSON.parse(alertJson)
        if (!alert.responded) {
          const elapsed = session.turnCount - alert.triggerTurn
          console.log(`[consequence] 暴力后果检查: turn=${session.turnCount}, trigger=${alert.triggerTurn}, elapsed=${elapsed}/${alert.delay}, victim=${alert.victimName}, arrived=${alert.arrivedResponder || '无'}`)

          // ── 追击状态更新：根据玩家当前位置设定追击额外延迟 ──
          // 设计：发现倒计时（alert.delay）固定不变，追击延迟取决于玩家最终位置
          // alert.chaseDelay = 0（在场）/ 1（同区域）/ 2（跨区域）
          const playerAtScene = session.worldState.currentLocation === alert.location &&
            session.worldState.currentSubLocation === alert.subLocation
          const sameArea = session.worldState.currentLocation === alert.location

          if (playerAtScene) {
            // 玩家在现场
            alert.chaseDelay = 0
          } else if (sameArea) {
            // 同区域逃跑（草药堂→酒馆）：不需要 canTrack
            if (alert.chaseDelay !== 1) {
              console.log(`[consequence] 玩家在镇内移动，追击延迟=1轮`)
              if (!alert.chaseWarned) {
                yield { type: 'narrative_warning', text: `身后传来急促的脚步声和怒喊——有人正在赶来！` }
                alert.chaseWarned = true
              }
            }
            alert.chaseDelay = 1
            alert.chaseLocation = session.worldState.currentLocation
            alert.chaseSubLocation = session.worldState.currentSubLocation
          } else {
            // 跨区域逃跑（镇→森林）：需要 canTrack
            const { getPersonality: getTrackP } = await import('./npc-relationships.js')
            const hasTracker = alert.arrivedResponder
              ? getTrackP(alert.arrivedResponder).canTrack
              : session.npcs.some(n =>
                  n.name !== alert.victimName &&
                  n.condition !== 'unconscious' &&
                  getTrackP(n.name).canFight &&
                  getTrackP(n.name).canTrack
                )
            const canReach = await this.canTrackAcrossLocations(
              alert.location,
              session.worldState.currentLocation,
              session.worldState.currentSubLocation
            )

            if (hasTracker && canReach) {
              if (alert.chaseDelay !== 2) {
                console.log(`[consequence] 玩家跨区域逃离，追击延迟=2轮`)
                if (!alert.chaseWarned) {
                  yield { type: 'narrative_warning', text: `你逃离了现场，但你能感觉到身后有人在追踪你的足迹...` }
                  alert.chaseWarned = true
                }
              }
              alert.chaseDelay = 2
              alert.chaseLocation = session.worldState.currentLocation
              alert.chaseSubLocation = session.worldState.currentSubLocation
              alert.trackingAttempted = true
            } else {
              // 追踪失败
              alert.responded = true
              alert.trackingFailed = true
              console.log(`[consequence] 追踪失败：${!hasTracker ? '无追踪能力的NPC' : '目标区域不可追踪'}`)
              yield { type: 'narrative_warning', text: `你逃进了更深处，暂时甩掉了追踪...` }
            }
          }
          session.worldState.flags['violence_alert'] = JSON.stringify(alert)

          // 发现前预警（发现倒计时快到时）
          if (!alert.discoveryTurn) {
            const remaining = alert.delay - (session.turnCount - alert.triggerTurn)
            if (remaining === 1) {
              yield { type: 'narrative_warning', text: '⚠️ 远处传来急促的脚步声和喊叫声，有人正在赶来！' }
            }
          }

          // 阶段 1：发现（延迟到期，确定响应者）
          if (elapsed >= alert.delay && !alert.arrivedResponder) {
            const { getPersonality: getP } = await import('./npc-relationships.js')

            let responder = null
            let alreadyOnSite = false

            // 如果有强制指定的响应者（call_guards），直接使用
            if (alert.forceResponder) {
              const forcedNpc = session.npcs.find(n => n.name === alert.forceResponder)
              if (forcedNpc &&
                  forcedNpc.condition !== 'unconscious' &&
                  forcedNpc.condition !== 'recovering' &&
                  getP(forcedNpc.name).canFight) {
                responder = forcedNpc
                alreadyOnSite = (forcedNpc.subLocation ?? forcedNpc.homeBase) === alert.subLocation
                console.log(`[consequence] 使用强制指定的响应者: ${alert.forceResponder}`)
              } else {
                console.log(`[consequence] 强制响应者 ${alert.forceResponder} 不可用，回退到自动选择`)
              }
            }

            // 自动选择
            if (!responder) {
              const candidates = session.npcs.filter(n =>
                n.name !== alert.victimName &&
                n.condition !== 'unconscious' &&
                n.condition !== 'recovering' &&
                getP(n.name).canFight
              )

              // 如果是跨区域追踪，只选择有追踪能力的 NPC
              const trackingCandidates = alert.trackingAttempted
                ? candidates.filter(n => getP(n.name).canTrack)
                : candidates

              responder = trackingCandidates.sort((a, b) => {
                let scoreA = 0, scoreB = 0
                const subLoc = alert.subLocation
                // 同一子地点（当场目击）→ 最高优先
                if ((a.subLocation ?? a.homeBase) === subLoc) scoreA += 10
                if ((b.subLocation ?? b.homeBase) === subLoc) scoreB += 10
                // 受害者的 bond NPC 优先，bond weight 越高越优先
                const bondA = (getP(a.name).bonds ?? []).find((bd: any) => bd.npcName === alert.victimName)
                const bondB = (getP(b.name).bonds ?? []).find((bd: any) => bd.npcName === alert.victimName)
                if (bondA) scoreA += 5 + bondA.weight * 3  // 艾琳娜(1.5)=9.5, 格罗姆(0.5)=6.5
                if (bondB) scoreB += 5 + bondB.weight * 3
                // 守卫
                if (a.role === 'guard') scoreA += 3
                if (b.role === 'guard') scoreB += 3
                // 有追踪能力的 NPC 更快察觉
                if (getP(a.name).canTrack) scoreA += 2
                if (getP(b.name).canTrack) scoreB += 2
                return scoreB - scoreA
              })[0] ?? null
              if (responder) {
                alreadyOnSite = ((responder as any).subLocation ?? (responder as any).homeBase) === alert.subLocation
              }
              console.log(`[consequence] 阶段1: 候选响应者=${trackingCandidates.map(c => c.name).join(',') || '无'}, 追踪=${alert.trackingAttempted || false}, 当场=${alreadyOnSite}`)
            }
            if (responder) {
              alert.arrivedResponder = responder.name

              // ── 阶段 1：发现 ──
              // 响应者到达受害者处，发现暴行，触发信任度传播
              // 这一阶段不触发战斗——只是"消息传开了"
              const { moveNPC } = await import('./npc-mobility.js')
              if (!alreadyOnSite) {
                moveNPC(responder, alert.subLocation, session)
              }
              if (alreadyOnSite) alert.immediateResponse = true

              // 触发信任度传播（发现暴行时）
              if (!alert.trustCascadeTriggered) {
                const { propagateViolenceTrust } = await import('./trust-system.js')
                const cascadeResult = propagateViolenceTrust(
                  session,
                  alert.victimName,
                  responder.name,
                  alert.witnesses ?? [],
                  `暴力事件：${alert.victimName}被攻击`
                )
                alert.trustCascadeTriggered = true
                console.log(`[trust-cascade] ${cascadeResult.summary}`)
              }

              // 标记发现完成，进入追击阶段
              alert.discoveryTurn = session.turnCount
              session.worldState.flags['violence_alert'] = JSON.stringify(alert)
              console.log(`[consequence] ${responder.name} 发现暴行（发现阶段完成，追击延迟=${alert.chaseDelay ?? 0}）`)
            } else {
              alert.responded = true

              // 检查是否是追踪失败（有追踪尝试但无追踪者）
              if (alert.trackingAttempted) {
                const failedTrackerName = alert.forceResponder || '追踪者'
                const trackingFailedNarratives: Record<string, string> = {
                  '韩猛': `韩猛在矿道入口停下，盯着黑暗深处，拳头握得咯咯作响。"该死...那里连我都不敢进。"`,
                  '艾琳娜': `艾琳娜站在矿道入口，琥珀色的眼睛闪过一丝复杂的情绪。"你选择了一条更危险的路。"`,
                  '格雷格': `格雷格在矿道入口沉默地站了很久，最后转身离开，背影透着说不出的疲惫。`,
                }
                const narrative = trackingFailedNarratives[failedTrackerName] || `${failedTrackerName}在危险区域边缘停下，无法继续追踪。`
                yield { type: 'narrative_warning', text: `🚫 ${narrative}` }
              }

              // 即使无人响应，也要触发信任度传播
              if (!alert.trustCascadeTriggered) {
                const { propagateViolenceTrust } = await import('./trust-system.js')
                const cascadeResult = propagateViolenceTrust(
                  session,
                  alert.victimName,
                  null,
                  alert.witnesses ?? [],
                  `暴力事件：${alert.victimName}被攻击`
                )
                alert.trustCascadeTriggered = true
                console.log(`[trust-cascade] ${cascadeResult.summary}`)
              }

              session.worldState.flags['violence_alert'] = JSON.stringify(alert)
              console.log(`[consequence] 无人响应（所有能战斗的NPC都不可用或追踪失败）`)
            }
          }

          // ── 追击阶段：发现完成后，等 chaseDelay 轮追上玩家 ──
          if (alert.discoveryTurn && !alert.responded && alert.arrivedResponder) {
            const chaseSinceTurn = session.turnCount - alert.discoveryTurn
            const chaseDelay = alert.chaseDelay ?? 0

            // 追击预警（追上前 1 轮）
            if (chaseDelay >= 2 && chaseSinceTurn === chaseDelay - 1) {
              const trackerName = alert.arrivedResponder
              const personalizedWarnings: Record<string, string> = {
                '韩猛': '⚠️ 你听到韩猛的怒吼声从远处传来："站住！懦夫！"',
                '艾琳娜': '⚠️ 森林中的鸟雀突然惊飞，一个冷静的声音在身后响起："跑不掉的。"',
                '格雷格': '⚠️ 沉重的脚步声越来越近，你感觉到一股压迫性的杀意...',
                '卡恩': '⚠️ 你感到背后一阵寒意，仿佛有双眼睛在黑暗中注视着你...',
              }
              yield { type: 'narrative_warning', text: personalizedWarnings[trackerName] || '⚠️ 追踪者正在接近！' }
            }

            // 追上了 → 触发战斗
            if (chaseSinceTurn >= chaseDelay) {
              alert.responded = true
              alert.combatJustStarted = alert.arrivedResponder
              // 响应者移动到玩家当前位置
              const respNpc = session.npcs.find(n => n.name === alert.arrivedResponder)
              if (respNpc) {
                const { moveNPC } = await import('./npc-mobility.js')
                respNpc.location = session.worldState.currentLocation
                moveNPC(respNpc, session.worldState.currentSubLocation ?? '', session)
              }
              pendingCombatInterrupt = {
                responderName: alert.arrivedResponder,
                victimName: alert.victimName,
                subLocation: session.worldState.currentSubLocation ?? alert.subLocation,
                immediate: chaseDelay === 0,
              }
              session.worldState.flags['violence_alert'] = JSON.stringify(alert)
              console.log(`[consequence] ${alert.arrivedResponder} 追上玩家！（追击延迟=${chaseDelay}轮）→ 准备战斗`)
            }
          }
        }
      } catch { /* malformed alert JSON, ignore */ }
    }

    // 检查过期承诺
    const brokenPromises = checkBrokenPromises(session)
    for (const bp of brokenPromises) {
      const result = changeTrust(session, bp)
      if (result.applied) {
        yield { type: 'broken_promise', npcName: bp.npcName, reason: bp.reason }
      }
    }

    // 自动检测敌对 NPC
    const hostileNPCs = await checkHostileNPCs(session)
    if (hostileNPCs.length > 0) {
      console.log(`[hostile-npc] 检测到 ${hostileNPCs.length} 个敌对 NPC:`, hostileNPCs.map(h => `${h.npc}(${h.response})`).join(', '))

      // 只处理第一个敌对 NPC（避免同时触发多个战斗）
      const { npc: hostileNPC, response: combatResponse } = hostileNPCs[0]

      // 记录冷却时间
      if (!session.npcHostileCooldowns) {
        session.npcHostileCooldowns = new Map()
      }
      session.npcHostileCooldowns.set(hostileNPC, session.turnCount)

      // 根据响应类型执行
      if (combatResponse === 'fight') {
        // 直接战斗
        yield { type: 'narrative_warning', text: `⚔️ ${hostileNPC}对你的敌意已经到达极限，发起了攻击！` }

        const monstersJson = await import('../data/monsters.json', { with: { type: 'json' } })
        const npcCombatJson = await import('../data/npc-combatants.json', { with: { type: 'json' } })
        const allDb = [...monstersJson.default, ...npcCombatJson.default] as Monster[]

        try {
          // 战斗前存档：参见 pending_encounter 路径的说明
          try {
            session.dossierData = this.dossier.toJSON()
            facts.save('autosave')
            this.turnsSinceLastSave = 0
          } catch (err) { console.warn('[save] hostile-npc pre-combat save failed:', (err as Error).message) }

          const combat = startCombat(session, [hostileNPC], allDb)
          yield* this.emitCombatStart(`${hostileNPC}向你发起攻击！`)
          return
        } catch (e: any) {
          console.error(`[hostile-npc] 触发战斗失败:`, e)
        }
      } else if (combatResponse === 'call_guards') {
        // 召唤守卫
        yield { type: 'narrative_warning', text: `🚨 ${hostileNPC}大声呼救，召唤守卫！` }

        const { getPersonality } = await import('./npc-relationships.js')
        const personality = getPersonality(hostileNPC)
        const guards = personality.bonds
          .map(b => session.npcs.find(n => n.name === b.npcName))
          .filter(n => n && getPersonality(n.name).canFight)

        if (guards.length > 0) {
          const guard = guards[0]!
          yield { type: 'narrative_warning', text: `${guard.name}将在 2 轮后赶到。` }

          // 如果已有 violence_alert（原始暴力事件），复用其 victim 并更新响应者
          // 不要把"因信任级联变敌对的NPC"误设为暴力受害者
          const existingAlertJson = session.worldState.flags['violence_alert'] as string | undefined
          if (existingAlertJson) {
            try {
              const existingAlert = JSON.parse(existingAlertJson)
              // 原始 alert 还没处理完 → 更新响应者为守卫，缩短延迟
              if (!existingAlert.responded) {
                existingAlert.forceResponder = guard.name
                existingAlert.delay = Math.min(existingAlert.delay, (session.turnCount - existingAlert.triggerTurn) + 2)
                session.worldState.flags['violence_alert'] = JSON.stringify(existingAlert)
              }
            } catch { /* malformed, fall through to create new */ }
          } else {
            // 没有现有 alert（纯信任敌对，无原始暴力事件）→ 创建新 alert
            const witnesses = session.npcs
              .filter(n =>
                n.name !== hostileNPC &&
                n.location === session.worldState.currentLocation &&
                (!session.worldState.currentSubLocation || n.subLocation === session.worldState.currentSubLocation)
              )
              .map(n => n.name)

            session.worldState.flags['violence_alert'] = JSON.stringify({
              triggerTurn: session.turnCount,
              victimName: hostileNPC,
              location: session.worldState.currentLocation,
              subLocation: session.worldState.currentSubLocation,
              delay: 2,
              responded: false,
              forceResponder: guard.name,
              witnesses,
            })
          }
        }
      } else if (combatResponse === 'flee') {
        // 逃跑
        const npc = session.npcs.find(n => n.name === hostileNPC)!
        const safeLocation = npc.homeBase
        const currentSub = npc.subLocation ?? npc.homeBase

        if (safeLocation !== currentSub) {
          npc.subLocation = safeLocation
          yield { type: 'narrative_warning', text: `💨 ${hostileNPC}惊恐地逃到了${safeLocation}。` }
        } else {
          npc.subLocation = currentSub === 'tavern-main' ? 'tavern-kitchen' : 'tavern-main'
          yield { type: 'narrative_warning', text: `💨 ${hostileNPC}惊恐地躲到了角落里。` }
        }
      } else if (combatResponse === 'plot_revenge') {
        // 事后报复
        yield { type: 'narrative_warning', text: `😈 ${hostileNPC}冷冷地看着你，眼中闪过一丝杀意...` }
        session.worldState.flags[`${hostileNPC}_revenge`] = true
      } else if (combatResponse === 'ban_from_location') {
        // 禁入
        yield { type: 'narrative_warning', text: `🚫 ${hostileNPC}愤怒地驱赶你："滚出去！你不再受欢迎！"` }
        session.worldState.flags[`${hostileNPC}_banned`] = true
      }
    }

    // 构建 DM 输入
    const parts: string[] = []

    if (this.justResumed) {
      this.justResumed = false
      const recap = buildResumeRecap(session)
      parts.push(recap)
    }

    if (safety.level === 'warn') parts.push(`[DM安全指令: ${safety.dmInstruction}]`)
    const guidance = getEarlyGuidance(session.turnCount)
    if (guidance) parts.push(guidance)
    const idle = checkIdleEvent(input)
    if (idle) parts.push(idle)

    // Violence alert DM context injection
    const alertData = session.worldState.flags['violence_alert']
    if (alertData) {
      try {
        const alert = JSON.parse(alertData as string)

        // 计算 bondNote（响应者和受害者的亲近关系），[世界事件] 和 [战斗触发] 都会用
        let bondNote = ''
        if (alert.arrivedResponder) {
          const { getPersonality: getPForDm } = await import('./npc-relationships.js')
          const responderP = getPForDm(alert.arrivedResponder)
          if (responderP.bonds?.some((b: any) => b.npcName === alert.victimName)) {
            bondNote = `${alert.arrivedResponder}与${alert.victimName}关系亲近，怒火中烧。`
          }
        }

        // ── DM 注入：发现前的倒计时预告 ──
        if (!alert.responded && !alert.discoveryTurn) {
          const remaining = alert.delay - (session.turnCount - alert.triggerTurn)
          if (remaining > 0 && remaining <= 3) {
            parts.push(`[世界事件预告：${alert.victimName}的遭遇即将被发现，约${remaining}轮后]`)
          }
        }

        // ── DM 注入：发现阶段（刚发现时注入一次）──
        // ⚠️ chaseDelay === 0 时不注入 [世界事件]！
        // 原因：如果响应者当场（玩家就在现场），下方的 [战斗触发] 会在同一回合触发，
        //       两个 tag 同时出现会让 DM 遇到"这一轮只描写到达，不描写攻击" vs
        //       "描写战斗开场的第一个动作" 的矛盾指令，陷入分析瘫痪直到超时。
        //       所以 chaseDelay=0 的情况完全交给 [战斗触发] 处理（arrival + 开战合并叙事）。
        if (alert.discoveryTurn === session.turnCount && alert.arrivedResponder) {
          const chaseDelay = alert.chaseDelay ?? 0
          if (chaseDelay > 0) {
            // 玩家不在场：暴力事件被发现，只写远处氛围
            const victimNpc = session.npcs.find((n: any) => n.name === alert.victimName)
            const victimCondition = victimNpc?.condition === 'unconscious' ? '昏迷倒地' : '受伤'
            const bondNoteParen = bondNote ? `（${bondNote}）` : ''
            parts.push(`[世界事件：${alert.victimName}的遭遇被发现了。${alert.arrivedResponder}发现${alert.victimName}${victimCondition}。${bondNoteParen}你不在现场——只需让玩家感受到远处的不安氛围（犬吠、飞鸟惊起、风中隐约的喊声）。${alert.arrivedResponder}正在追踪你。]`)
          }
          // chaseDelay === 0：不注入任何 [世界事件]，等下方 [战斗触发] 统一处理
        }

        // ── DM 注入：追击到达，战斗即将开始 ──
        // 当 chaseDelay === 0 时这里是唯一的叙事源，需要同时承担"到达 + 开战"
        if (alert.combatJustStarted) {
          const responderName = alert.combatJustStarted
          parts.push(`[战斗触发：${responderName}因你对${alert.victimName}的暴行冲上来！${bondNote}用1-2句直接描写——${responderName}出现的瞬间到挥出第一击，不需要铺垫到达/质问的步骤，一气呵成进入战斗。数值由系统处理。]`)
          delete alert.combatJustStarted
          session.worldState.flags['violence_alert'] = JSON.stringify(alert)
        }
      } catch { /* ignore malformed */ }
    }

    // ── 规则预处理：分级意图识别 + 机械动作预执行 ──
    let action = await classifyIntent(input, session)

    // Adaptive tool reminder
    // 降低周期（5→3），并对纯叙事场景（NARRATIVE/SEARCH/MOVE 成功/NARRATIVE 降级）强化 SetActions 提醒。
    // 这些场景 DM 容易沉浸于长篇描写，忘记工具收尾，导致 dm-patch 二次请求多花 1 次 LLM 调用。
    const reminders: string[] = []
    const narrativeTypes: string[] = ['NARRATIVE', 'SEARCH', 'MOVE', 'LOOK']
    const isNarrativeScene = narrativeTypes.includes(action.type)
    if (isNarrativeScene || session.turnCount % 3 === 0) {
      reminders.push('回应结束前必须调用SetActions设置选项——纯叙事场景最容易忘记。')
    }
    if (session.turnCount % 3 === 0) {
      reminders.push('NPC对话后请调用ChangeTrust更新信任（日常±1）。')
      reminders.push('伤害/物品/金币变化必须通过工具，不要在文本中编造数值。')
    }
    if (reminders.length) parts.push(`[系统提醒] ${reminders.join(' ')}`)
    console.log(`[rules-agent] 输入: "${input}" → 分类: ${JSON.stringify(action)}`)
    let actionResult: ActionResult | null = null

    // ── 加权时间累积：小动作累积到阈值自动推进时段 ──
    // 注意：MOVE 和 REST 在工具内部直接推进时间，所以这里 cost 为 0
    const TIME_COST: Record<string, number> = {
      TALK: 2, SEARCH: 2, BUY: 1, SELL: 1, GIVE: 1, USE: 1,
      ATTACK: 0, LOOK: 0, FLEE: 0, NARRATIVE: 0, MOVE: 0, REST: 0,
    }
    const TIME_THRESHOLD = 20
    const cost = TIME_COST[action.type] ?? 0
    if (cost > 0) {
      session.timeAccum = (session.timeAccum ?? 0) + cost
      console.log(`[time] ${action.type} +${cost} → 累积 ${session.timeAccum}/${TIME_THRESHOLD}`)
      if (session.timeAccum >= TIME_THRESHOLD) {
        const newTime = advanceTime()
        session.timeAccum = 0
        console.log(`[time] 累积到达阈值，时间推进至: ${newTime}`)
        const transitions: Record<string, string> = {
          '清晨': '🌅 夜色渐退，东方泛起鱼肚白……清晨到来了。',
          '下午': '☀️ 日头高悬，不知不觉已经到了下午。',
          '黄昏': '🌆 余晖染红天际，黄昏的阴影开始蔓延……',
          '深夜': '🌙 夜幕低垂，街灯摇曳，深夜的破晓镇显得格外安静——也格外危险。',
        }
        yield { type: 'system_message', text: transitions[newTime] ?? `时间流逝，现在是${newTime}。` }
      }
    }

    // ── 巢穴入口确认：玩家点击"踏入"按钮或输入相关关键词 ──
    if (
      !session.combat?.active &&
      /^(踏入|进入|闯入|深入|走进|冲进)/.test(input.trim())
    ) {
      const currentLoc = locations[session.worldState.currentLocation]
      const currentSubLoc = session.worldState.currentSubLocation
      const lairPoi = (currentLoc?.pointsOfInterest ?? []).find((p: any) =>
        p.id === currentSubLoc && p.discovered && p.encounter &&
        !session.worldState.flags[`poi_encounter_triggered_${p.id}`]
      )
      if (lairPoi) {
        session.worldState.flags[`poi_encounter_triggered_${lairPoi.id}`] = true
        session.worldState.flags['pending_encounter'] = lairPoi.encounter!.monsters.join(',')
        console.log(`[lair] 玩家确认踏入 ${lairPoi.nameZh}，触发遭遇: ${lairPoi.encounter!.monsters.join(',')}`)
        parts.push(
          `[叙事引导] 玩家深吸一口气，踏入了「${lairPoi.nameZh}」。` +
          `${lairPoi.encounter!.description} ` +
          `用2-3句描写玩家踏入巢穴的瞬间——光线骤变、空气凝固、` +
          `敌人察觉到入侵者的那个紧张时刻。战斗即将开始。`
        )
        action = { type: 'NARRATIVE' }
        actionResult = null
      }
    }

    if (shouldPreExecute(action)) {
      actionResult = await executeAction(action, session)
      console.log(`[rules-agent] 预执行: ${action.type} → 成功:${actionResult.success} 工具:${actionResult.toolsCalled.join(',')}`)
      console.log(`[rules-agent] 结果: ${actionResult.output.slice(0, 200)}`)

      // Move 失败降级：目的地不在地图注册表中 → 不注入硬失败，降级为叙事探索
      if (action.type === 'MOVE' && actionResult.unknownDestination) {
        const currentLoc = locations[session.worldState.currentLocation]
        const locName = currentLoc?.nameZh ?? session.worldState.currentLocation
        const dest = (action as any).destination ?? input
        parts.push(
          `[叙事引导] 玩家想在「${locName}」附近探索「${dest}」方向，` +
          `但这不是已知的可达地点。请在叙事中自由描写这次探索——` +
          `可以是路径受阻、发现新线索、环境描写或角色感受。` +
          `不要提及"系统"、"地图"或"无法前往"等游戏外概念。`
        )
        action = { type: 'NARRATIVE' }
        actionResult = null
        console.log(`[rules-agent] Move 降级为 NARRATIVE: 目的地「${dest}」不在注册表中`)

      // ATTACK 空目标 → POI 遭遇触发：当前 location 有已发现且未触发的 encounter POI
      } else if (action.type === 'ATTACK' && !(action as any).target && !session.combat?.active) {
        const currentLoc = locations[session.worldState.currentLocation]
        const encounterPoi = (currentLoc?.pointsOfInterest ?? []).find((p: any) =>
          p.discovered && p.encounter && !session.worldState.flags[`poi_encounter_triggered_${p.id}`]
        )
        if (encounterPoi) {
          session.worldState.flags[`poi_encounter_triggered_${encounterPoi.id}`] = true
          session.worldState.flags['pending_encounter'] = encounterPoi.encounter!.monsters.join(',')
          console.log(`[combat] POI encounter triggered at ${encounterPoi.nameZh}: ${encounterPoi.encounter!.monsters.join(',')}`)
          parts.push(
            `[叙事引导] 玩家在「${encounterPoi.nameZh}」发起攻击。` +
            `这里有${encounterPoi.encounter!.monsters.join('和')}。` +
            `战斗即将开始，请用2-3句描写玩家冲入战斗的场景。`
          )
          action = { type: 'NARRATIVE' }
          actionResult = null
        } else {
          parts.push(formatActionResult(actionResult))
        }

      // Look 失败降级：目标不在 POI/NPC 注册表中 → 注入位置上下文，让 DM 自由描写
      } else if (action.type === 'LOOK' && actionResult.notFound) {
        const currentLoc = locations[session.worldState.currentLocation]
        const locName = currentLoc?.nameZh ?? session.worldState.currentLocation
        const target = (action as any).target ?? input
        const pois = (currentLoc?.pointsOfInterest ?? [])
          .filter((p: any) => p.discovered)
          .map((p: any) => `${p.nameZh}(${p.description?.slice(0, 30) ?? ''})`)
          .join('、')
        parts.push(
          `[叙事引导] 玩家想在「${locName}」观察「${target}」。` +
          `当前位置已知地点：${pois || '无'}。` +
          `请根据当前位置的氛围和世界观自由描写玩家观察到的场景。` +
          `如果玩家提到的事物可能对应某个已知地点，自然地融入描写中。` +
          `不要提及"未发现"或"系统"等游戏外概念。`
        )
        action = { type: 'NARRATIVE' }
        actionResult = null
        console.log(`[rules-agent] Look 降级为 NARRATIVE: 目标「${target}」不在注册表中`)
      } else {
        parts.push(formatActionResult(actionResult))

        // 首次击败无辜NPC提示（弹窗形式）
        if (actionResult.firstInnocentKill) {
          yield {
            type: 'important_warning',
            title: '低语',
            text: '刀刃所向，非善非恶...只是选择。\n\n但选择，终将塑造你。',
          }
        }
        // Search 发现：POI / 物品 / 金币 合并到单条 discovery 事件
        // （前端复用同一个弹窗组件展示，避免连续弹两次）
        const dp = actionResult.discoveredPoi
        const lg = actionResult.lootGranted
        if (dp || lg) {
          const areaId = session.worldState.currentLocation
          const area = locations[areaId]
          if (dp) session.worldState.flags[`poi_visited_${dp.id}`] = true

          // 物品按 name 聚合数量（蜘蛛丝 x2 而不是两条）
          let aggregatedItems: Array<{ name: string; quantity: number; description?: string }> | undefined
          if (lg && lg.items.length > 0) {
            const counter = new Map<string, { name: string; quantity: number; description?: string }>()
            for (const it of lg.items) {
              const exist = counter.get(it.name)
              if (exist) exist.quantity++
              else counter.set(it.name, { name: it.name, quantity: 1, description: it.description })
            }
            aggregatedItems = Array.from(counter.values())
          }

          yield {
            type: 'discovery',
            source: 'search',
            poi: dp ? {
              id: dp.id, nameZh: dp.nameZh,
              areaId, areaName: area?.nameZh ?? areaId,
              description: dp.description,
            } : undefined,
            items: aggregatedItems,
            gold: lg && lg.gold > 0 ? lg.gold : undefined,
          }
          console.log(`[discovery] 搜索: ${dp ? dp.nameZh : ''}${dp && lg ? ' + ' : ''}${lg ? `${lg.items.length}件物品/${lg.gold}金` : ''}`)
        }
      }
    } else {
      // NARRATIVE 路径：检查输入是否含战斗意图 + 当前位置有 POI 遭遇
      if (!session.combat?.active && /突袭|偷袭|袭击|攻击|冲上去|杀|先下手|进攻|开打/.test(input)) {
        const currentLoc = locations[session.worldState.currentLocation]
        const encounterPoi = (currentLoc?.pointsOfInterest ?? []).find((p: any) =>
          p.discovered && p.encounter && !session.worldState.flags[`poi_encounter_triggered_${p.id}`]
        )
        if (encounterPoi) {
          session.worldState.flags[`poi_encounter_triggered_${encounterPoi.id}`] = true
          session.worldState.flags['pending_encounter'] = encounterPoi.encounter!.monsters.join(',')
          console.log(`[combat] POI encounter triggered via narrative intent at ${encounterPoi.nameZh}`)
          parts.push(
            `[叙事引导] 玩家在「${encounterPoi.nameZh}」展现了战斗意图。` +
            `这里有${encounterPoi.encounter!.monsters.join('和')}。` +
            `战斗即将开始，请用2-3句描写紧张的战斗前奏。`
          )
        }
      }
      console.log(`[rules-agent] 跳过预执行: ${action.type} (TALK/NARRATIVE 交给 DM)`)
    }

    // 交互上下文绑定：记录当前正在和谁交互
    if (action.type === 'TALK' && action.npc) {
      session.interactionNpc = action.npc
    } else if ((action.type === 'BUY' || action.type === 'SELL') && action.npc) {
      session.interactionNpc = action.npc
    } else if (action.type === 'MOVE' && actionResult?.success) {
      // 移动后自动绑定目标地点的 NPC（如果只有一个，直接绑定；多个时绑定第一个）
      const npcsAtDest = session.npcs.filter(n =>
        n.location === session.worldState.currentLocation &&
        (n.subLocation ?? n.homeBase) === session.worldState.currentSubLocation &&
        n.condition !== 'unconscious'
      )
      session.interactionNpc = npcsAtDest.length > 0 ? npcsAtDest[0].name : undefined
      if (session.interactionNpc) console.log(`[interaction] 移动后自动绑定: ${session.interactionNpc}`)
      // 到达新地点 → 解锁该地点所有 NPC（你看到了他们）
      const moveChapterNum = parseInt((session.chapter?.currentChapter ?? 'ch1').replace(/\D/g, ''), 10) || 1
      for (const npc of npcsAtDest) {
        const result = this.dossier.unlock(npc.name, session.turnCount, moveChapterNum)
        console.log(`[move-unlock] ${npc.name}: ${result ? 'newly unlocked' : 'already unlocked'}, isUnlocked=${this.dossier.isUnlocked(npc.name)}`)
        if (result) {
          yield { type: 'npc_unlock', npcName: npc.name, portrait: NPC_PORTRAITS[npc.name] ?? '', firstFacts: this.dossier.getFirstFacts(npc.name) }
        }
      }
      // POI 首次到达 → 弹出发现卡片（有遭遇的 POI 由 lair_entrance 代替）
      const poiId = session.worldState.currentSubLocation
      const visitKey = `poi_visited_${poiId}`
      if (poiId && !session.worldState.flags[visitKey]) {
        session.worldState.flags[visitKey] = true
        const areaId = session.worldState.currentLocation
        const area = locations[areaId]
        const poi = area?.pointsOfInterest.find((p: any) => p.id === poiId)
        // 有未触发遭遇的 POI → 跳过普通 discovery，下面用 lair_entrance 代替
        const hasLairEncounter = poi?.encounter &&
          !session.worldState.flags[`poi_encounter_triggered_${poi.id}`]
        if (poi && !hasLairEncounter) {
          yield {
            type: 'discovery',
            source: 'arrival',
            poi: {
              id: poiId,
              nameZh: poi.nameZh,
              areaId,
              areaName: area.nameZh,
              description: poi.description,
            },
          }
          console.log(`[discovery] 首次到达: ${poi.nameZh} (${poiId})`)
        }
      }

      // Boss 巢穴入口确认：到达有遭遇的 POI 时弹出确认卡片
      {
        const lairPoiId = session.worldState.currentSubLocation
        const lairAreaId = session.worldState.currentLocation
        const lairArea = locations[lairAreaId]
        const lairPoi = lairArea?.pointsOfInterest.find((p: any) => p.id === lairPoiId)
        if (
          lairPoi?.encounter &&
          lairPoi.discovered &&
          !session.worldState.flags[`poi_encounter_triggered_${lairPoi.id}`]
        ) {
          yield {
            type: 'lair_entrance',
            poi: {
              id: lairPoi.id,
              nameZh: lairPoi.nameZh,
              areaId: lairAreaId,
              areaName: lairArea.nameZh,
            },
            entranceText: lairPoi.encounter.entranceText ?? lairPoi.encounter.description,
            encounterDescription: lairPoi.encounter.description,
          }
          console.log(`[lair] 巢穴入口: ${lairPoi.nameZh} — 等待玩家确认踏入`)
        }
      }
    }

    // Set violence alert for consequence system (NPC attacks only)
    if (action.type === 'ATTACK' && actionResult?.success) {
      const targetNpc = session.npcs.find(n => n.name === action.target)
      if (targetNpc) {
        // 检查是否已有暴力警报（重复暴力 → 加速响应，不重置）
        const existingAlert = session.worldState.flags['violence_alert']
          ? JSON.parse(session.worldState.flags['violence_alert'] as string)
          : null

        if (existingAlert && !existingAlert.responded) {
          // 已有未响应的警报 → 缩短剩余延迟（每次额外暴力减 2 轮，最少 1 轮后响应）
          // 如果响应者已到达（阶段1完成），不干预——下轮就开打
          if (existingAlert.arrivedResponder) {
            console.log(`[consequence] 重复暴力但${existingAlert.arrivedResponder}已在场，不重置`)
          } else {
            const elapsed = session.turnCount - existingAlert.triggerTurn
            const remaining = existingAlert.delay - elapsed
            existingAlert.delay = elapsed + 1
            session.worldState.flags['violence_alert'] = JSON.stringify(existingAlert)
            console.log(`[consequence] 重复暴力！加速响应: 剩余${remaining}→1轮`)
          }
        } else {
          // 新的暴力警报
          let delay = 5
          const time = session.worldState.timeOfDay
          if (time === 'night') delay += 4
          else if (time === 'evening') delay += 2

          // Check witnesses at same sub-location
          const witnesses = session.npcs.filter(n =>
            n.name !== action.target &&
            n.location === session.worldState.currentLocation &&
            (n.subLocation ?? n.homeBase) === session.worldState.currentSubLocation &&
            n.condition !== 'unconscious'
          )
          const { getPersonality } = await import('./npc-relationships.js')
          // 同子地点且能战斗的 NPC → 当场目击，0轮立即反应
          const onSiteFighters = witnesses.filter(n => getPersonality(n.name).canFight)
          // 受害者有亲近 NPC（bond>=1.0 的战斗型 NPC）→ 更快赶来
          const bondedFighter = session.npcs.find(n => {
            if (n.name === action.target || n.condition === 'unconscious') return false
            const p = getPersonality(n.name)
            return p.canFight && p.bonds.some(b => b.npcName === action.target && b.weight >= 1.0)
          })
          if (onSiteFighters.length > 0) {
            delay = 0
          } else {
            if (witnesses.length > 0) delay -= 3
            if (witnesses.some(n => !getPersonality(n.name).canFight)) delay -= 1
            if (bondedFighter) delay -= 2
            delay = Math.max(1, delay)
          }

          // 收集目击者名称列表（用于信任度传播）
          const witnessNames = witnesses.map(n => n.name)

          // 预计算首选响应者（用于日志）
          const candidateResponders = session.npcs
            .filter(n => n.name !== action.target && n.condition !== 'unconscious' && getPersonality(n.name).canFight)
            .sort((a, b) => {
              const pA = getPersonality(a.name), pB = getPersonality(b.name)
              const bondA = pA.bonds.find(bd => bd.npcName === action.target)
              const bondB = pB.bonds.find(bd => bd.npcName === action.target)
              const sA = (bondA ? 5 + bondA.weight * 3 : 0) + (pA.canTrack ? 2 : 0)
              const sB = (bondB ? 5 + bondB.weight * 3 : 0) + (pB.canTrack ? 2 : 0)
              return sB - sA
            })
          const likelyResponder = candidateResponders[0]

          session.worldState.flags['violence_alert'] = JSON.stringify({
            triggerTurn: session.turnCount,
            victimName: action.target,
            location: session.worldState.currentLocation,
            subLocation: session.worldState.currentSubLocation,
            delay,
            responded: false,
            witnesses: witnessNames,
          })

          // 详细日志
          const delayBreakdown = onSiteFighters.length > 0
            ? `→0(当场目击: ${onSiteFighters.map(n => n.name).join(',')})`
            : [
              `基础5`,
              time === 'night' ? '+4(夜间)' : time === 'evening' ? '+2(傍晚)' : '',
              witnesses.length > 0 ? `-3(目击者${witnessNames.join(',')})` : '',
              witnesses.some(n => !getPersonality(n.name).canFight) ? '-1(平民报信)' : '',
              bondedFighter ? `-2(亲近战友${bondedFighter.name})` : '',
            ].filter(Boolean).join(' ')
          console.log(`[consequence] 暴力警报: 受害者=${action.target}, 延迟=${delay}轮(${delayBreakdown}), 目击者=[${witnessNames.join(',')}], 首选响应者=${likelyResponder?.name ?? '无'}(canTrack=${likelyResponder ? getPersonality(likelyResponder.name).canTrack : false})`)
        }
      }
    }

    parts.push(input)

    // Rules Agent 调完后等一下再调 DM，避免 API 限流
    if (action.type !== 'NARRATIVE') {
      console.log(`[dm] Rules Agent 用了 API，等 1.5s 再调 DM...`)
      await new Promise(r => setTimeout(r, 1500))
    }

    // DM 流式响应（带超时保护 + 重复检测）
    console.log(`[dm] 调用 DM API...`)
    const dmStart = Date.now()
    let fullText = ''
    let repetitionDetected = false
    const toolsCalled: ToolCallRecord[] = actionResult
      ? actionResult.toolsCalled.map(t => ({ toolName: t }))
      : []
    const thinkParser = new ThinkTagParser()
    const localizer = new StreamingLocalizer()  // 术语中文化安全网
    const saFilter = new SetActionsStreamFilter()  // 防御 DM 的 inline <setactions> 幻觉
    try {
      const timeoutMs = 120000 // 120 秒超时（之前 60 秒对长 thinking 流太紧张）
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true }, timeoutMs)

      for await (const event of dmRespond(parts.join('\n\n'))) {
        if (timedOut) {
          console.error(`[dm] DM 响应超时 (${timeoutMs}ms)`)
          yield { type: 'dm_error', message: 'DM 响应超时，请重试。' }
          break
        }
        if (event.type === 'thinking_delta') {
          const thinking = (event as any).thinking ?? ''
          if (thinking) yield { type: 'dm_thinking', text: thinking }
        } else if (event.type === 'text_delta') {
          const text = event.text ?? ''
          if (text.includes("'content': [") || text.includes('(Empty response:') || text.includes("'type': 'thinking'") || text.includes('[DEBUG]')) continue
          // <think> 标签分离：思考→dm_thinking，叙事→dm_text_delta
          const parsed = thinkParser.process(text)
          if (parsed.thinking) yield { type: 'dm_thinking', text: parsed.thinking }
          if (parsed.narrative) {
            // 过滤 DM 的 inline <setactions> 伪 XML 块
            const filtered = saFilter.feed(parsed.narrative)
            for (const block of filtered.detectedBlocks) {
              const parsedBlock = parseSetActionsBlock(block)
              if (parsedBlock && injectPendingActions(parsedBlock)) {
                console.log(`[dm] 拦截 inline <setactions> 块并注入 (details=${(parsedBlock.details ?? []).length}, suggestions=${(parsedBlock.suggestions ?? []).length})`)
              }
            }
            if (filtered.output) {
              fullText += filtered.output
              const truncated = detectRepetition(fullText)
              if (truncated) {
                console.warn(`[dm] 重复检测触发，截断输出 (${fullText.length}→${truncated.length}字)`)
                fullText = truncated
                repetitionDetected = true
                break
              }
              // 流式术语替换：buffer 可能跨越 token 边界的英文术语片段
              const localized = localizer.feed(filtered.output)
              if (localized) yield { type: 'dm_text_delta', text: localized }
            }
          }
        } else if (event.type === 'tool_result' && event.name) {
          toolsCalled.push({ toolName: event.name })
          // DM Talk 工具不在这里更新 interactionNpc（输入参数不可见）
          // interactionNpc 由 npc_speaking 检测更新（见下方）
          // 物品/金币变化时发送专门的物品通知事件
          if (event.name === 'TransferItem' && event.output && !event.isError) {
            const out = String(event.output)
            if (out.includes('获得物品') || out.includes('获得') || out.includes('支付')) {
              yield { type: 'item_acquired', text: out }
            }
          }
        }
      }
      clearTimeout(timer)
      // Flush think parser 残留 buffer
      const flushed = thinkParser.flush()
      if (flushed.thinking) yield { type: 'dm_thinking', text: flushed.thinking }
      if (flushed.narrative) {
        // flushed.narrative 也过一遍 filter
        const flushedFiltered = saFilter.feed(flushed.narrative)
        for (const block of flushedFiltered.detectedBlocks) {
          const parsedBlock = parseSetActionsBlock(block)
          if (parsedBlock) injectPendingActions(parsedBlock)
        }
        fullText += flushedFiltered.output
      }
      // flush saFilter 尾部
      const saTailMain = saFilter.flush()
      for (const block of saTailMain.detectedBlocks) {
        const parsedBlock = parseSetActionsBlock(block)
        if (parsedBlock) {
          injectPendingActions(parsedBlock)
          console.log(`[dm] flush 时拦截 inline <setactions> 残留块`)
        }
      }
      if (saTailMain.output) fullText += saTailMain.output
      // Flush streaming localizer 尾部 buffer（防止最后几个字符卡在 buffer 里）
      const tail = localizer.flush()
      if (tail) yield { type: 'dm_text_delta', text: tail }
      // Post-hoc 清理：streaming 分片可能绕过逐 chunk 过滤
      const emptyIdx = fullText.indexOf('(Empty response:')
      if (emptyIdx !== -1) fullText = fullText.substring(0, emptyIdx)
      // 过滤 DM 泄漏的调试/元信息行
      fullText = fullText.split('\n').filter(line => !line.startsWith('[DEBUG]')).join('\n')
      // 同步中文化到完整文本（记录/存档用），和流式输出保持一致
      fullText = localize(fullText)
      // 截断修复：LLM 可能在调用 SetActions 时截断最后一句话
      fullText = trimToLastSentence(fullText)
      // 超时兜底：DM 超时 0 字时发一段占位 narrative，避免玩家面对空白屏
      if (!fullText.trim()) {
        const fallback = timedOut
          ? '空气凝固了片刻，世界仿佛屏住了呼吸。'
          : '一阵静默之后，空气中残留着未说出口的话语。'
        console.warn(`[dm] 空响应，发送兜底文本 (timedOut=${timedOut})`)
        yield { type: 'dm_text_delta', text: fallback }
        fullText = fallback
      }
      console.log(`[dm] DM 响应完成: ${fullText.length}字, ${Date.now() - dmStart}ms`)
    } catch (err) {
      console.error(`[dm] DM 错误:`, (err as Error).message)
      yield { type: 'dm_error', message: (err as Error).message.slice(0, 100) }
    }

    // 游戏终局检查（DM 调用了 GameOver 工具？）
    const gameOver = consumeGameOver()
    if (gameOver) {
      yield { type: 'game_over', reason: gameOver.reason, canContinue: gameOver.canContinue, continueHint: gameOver.continueHint }
    }

    // 交易提案检查（DM 调用了 ProposeTradeAction？）
    // 注意：trade 检查必须在 dm_end yield 之前，因为 dm_end 需要知道是否有交易卡片
    const trade = consumeTradeProposal()
    const hasPendingTrade = !!trade
    if (trade) {
      if (trade.canBargain !== false) {
        this.bargainState = {
          npc: trade.npc,
          items: trade.items.map(i => ({ name: i.name, price: i.price, quantity: i.quantity ?? 1 })),
          lastPrice: trade.totalPrice,
          round: 0,
        }
      } else {
        // 最终价格，清空砍价状态
        this.bargainState = null
      }
      yield { type: 'trade_proposal', npc: trade.npc, items: trade.items, totalPrice: trade.totalPrice, canBargain: trade.canBargain }
    }

    // Consume trust changes from ChangeTrust tool
    const trustChanges = consumeTrustChanges()
    if (trustChanges.length > 0) {
      toolsCalled.push({ toolName: 'ChangeTrust' })
    }

    // 检测坦白暴力行为（本轮有 ATTACK 预执行时跳过——玩家在攻击，不是在坦白）
    const confessionDetected = action.type !== 'ATTACK'
      ? this.detectViolenceConfession(input, session)
      : { isConfession: false }
    if (confessionDetected.isConfession && confessionDetected.victimName) {
      const victim = confessionDetected.victimName
      const currentNPC = session.interactionNpc

      if (currentNPC && currentNPC !== victim) {
        // 不能向受害者本人坦白；检查受害者是否有暴力证据
        const victimNPC = session.npcs.find(n => n.name === victim)
        const hasEvidence =
          victimNPC?.condition === 'unconscious' ||
          victimNPC?.condition === 'recovering' ||
          (typeof session.worldState.flags['violence_alert'] === 'string' &&
           (session.worldState.flags['violence_alert'] as string).includes(victim))

        if (hasEvidence) {
          console.log(`[confession] 检测到坦白暴力行为: 受害者=${victim}, 当前NPC=${currentNPC}`)

          // 触发信任度传播
          const { propagateViolenceTrust } = await import('./trust-system.js')
          const cascadeResult = propagateViolenceTrust(session, victim, currentNPC, [], '坦白暴力行为')

          // 发送信任度传播事件
          if (cascadeResult.changes.length > 0) {
            console.log(`[confession] 信任度传播完成: ${cascadeResult.changes.length}个NPC受影响`)
          }
        }
      }
    }

    // Unified narrative validation
    console.log(`[validator] 本轮工具调用: ${toolsCalled.map(t => t.toolName).join(',') || '无'}`)
    console.log(`[validator] DM文本长度: ${fullText.length}字`)
    const narrativeWarnings = validateNarrative(fullText, toolsCalled, session)
    if (narrativeWarnings.length) console.log(`[validator] 警告: ${narrativeWarnings.map(w => `${w.category}:${w.autoApplied ? '自动修正' : '仅警告'}`).join(', ')}`)
    for (const w of narrativeWarnings) {
      if (w.autoApplied) {
        yield { type: 'npc_update', text: `[信任修正] ${w.description}` }
      } else {
        yield { type: 'narrative_warning', text: `[系统] ${w.description}` }
      }
    }

    // NPC 立绘：Talk 工具记录了本轮所有说话的 NPC
    const speakers = consumeSpeakingNPCs()
    if (speakers.length === 0) {
      // Fallback：DM 叙事中出现 NPC 对话格式但没调 Talk 工具
      for (const npc of session.npcs) {
        if ((fullText.includes(`${npc.name}:`) || fullText.includes(`${npc.name}：`))
            && NPC_PORTRAITS[npc.name]) {
          speakers.push(npc.name)
        }
      }
    }
    for (const name of speakers) {
      if (NPC_PORTRAITS[name]) {
        yield { type: 'npc_speaking', npcName: name, portrait: NPC_PORTRAITS[name] }
      }
    }
    // 最后一个说话的 NPC 成为当前交互对象
    if (speakers.length > 0) {
      session.interactionNpc = speakers[speakers.length - 1]
    }

    // 音频：DM 可能通过 SetAmbiance 覆盖，否则代码自动选择
    const ambianceOverride = consumeAmbianceOverride()
    const autoAudio = resolveAudio(
      session.worldState.currentLocation,
      session.worldState.currentSubLocation,
      session.worldState.timeOfDay,
      !!session.combat?.active,
    )
    const finalBgm = ambianceOverride?.bgm ?? autoAudio.bgm
    console.log(
      `[audio] BGM=${finalBgm} ambient=${autoAudio.ambient}` +
      ` (loc=${session.worldState.currentLocation}` +
      `${session.worldState.currentSubLocation ? '/' + session.worldState.currentSubLocation : ''}` +
      ` time=${session.worldState.timeOfDay}` +
      `${session.combat?.active ? ' combat' : ''}` +
      `${ambianceOverride ? ' [DM-override]' : ''})`
    )
    yield {
      type: 'audio',
      bgm: finalBgm,
      ambient: autoAudio.ambient,
    }

    // DM 结束 + 场景选项
    let dmActions = consumeActions()
    console.log(`[debug-actions] dmActions.suggestions=${JSON.stringify(dmActions?.suggestions?.slice(0, 3))}, dmActions.details=${dmActions?.details?.length}`)

    // ─── SetActions 遗漏补丁 ────────────────────────────────
    // DM 有时会"忘记"调用 SetActions,导致前端没有可点选的后续选项。
    // 如果本轮 DM 没调 SetActions、且当前场景确实**需要**选项(非战斗、非交易
    // 弹窗、非 game over),发一个"补丁请求"让 DM 补调一次,只保留 SetActions
    // 工具,prompt 明确要求"不要再写叙事,只调 SetActions"。
    //
    // 关键效果:补丁请求的 user+assistant 消息会被持久化到 dmMessages,后续
    // LLM 看到这段"系统反馈"后会逐渐学会每轮都主动调用 SetActions。
    // 这是典型的反馈学习(in-context learning),几个 turn 后问题应该自然消失。
    //
    // 补丁失败时(LLM 再次漏调 / 网络错误)静默走 fallback,不中断主流程。
    const needsActions = !dmActions && !hasPendingTrade && !session.combat?.active
    if (needsActions) {
      console.log('[dm-patch] DM 遗漏 SetActions,发送补丁请求...')
      // 通知前端：DM 文本已结束,正在补充选项(改善等待体验)
      yield { type: 'actions_loading' }
      try {
        muteDMTools(['SetActions'])
        // 带超时的补丁请求：最多等 10 秒,超时直接走 fallback
        const patchPromise = (async () => {
          for await (const _ev of dmRespond(
            '【系统反馈】你刚才的叙事结束后没有调用 SetActions 为玩家提供后续行动选项。\n' +
            '请**只调用 SetActions 工具**(不要再写任何叙事、不要调用其他工具),' +
            '为当前场景生成 2-3 个玩家此刻最自然的后续行动选项。',
          )) { /* 只消费事件 */ }
        })()
        const timeout = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000))
        const result = await Promise.race([patchPromise.then(() => 'done' as const), timeout])
        if (result === 'timeout') {
          console.warn('[dm-patch] ⚠ 补丁请求超时(10s),走 fallback')
        } else {
          const patched = consumeActions()
          if (patched) {
            dmActions = patched
            console.log(`[dm-patch] ✓ 补丁成功,获得 ${patched.suggestions?.length ?? 0} 个选项`)
          } else {
            console.log('[dm-patch] ⚠ DM 在补丁请求中仍未调用 SetActions,走 fallback')
          }
        }
      } catch (patchErr) {
        console.warn(
          `[dm-patch] 补丁请求异常: ${(patchErr as Error).message},走 fallback`,
        )
      } finally {
        unmuteDMTools()
      }
    }

    const fallback = buildFallbackActions(session)
    console.log(`[debug-actions] fallback.suggestions=${JSON.stringify(fallback.suggestions?.slice(0, 3))}`)
    const actions = dmActions ?? fallback
    try {
      // DM 提供了选项时，把 fallback 中的★主线建议智能合并（去重）
      if (dmActions && fallback.suggestions) {
        const questSuggestions = fallback.suggestions.filter(s => s.startsWith('★'))
        if (questSuggestions.length > 0) {
          if (!actions.suggestions) actions.suggestions = []
          for (const qs of questSuggestions) {
            const questText = qs.slice(1)
            const keywords = extractKeywords(questText, session)
            const dupIdx = actions.suggestions.findIndex(s =>
              keywords.some(kw => s.includes(kw))
            )
            const detailDup = (actions.details ?? []).some(d =>
              keywords.some(kw => d.label.includes(kw))
            )
            if (dupIdx >= 0) {
              actions.suggestions[dupIdx] = `★${actions.suggestions[dupIdx]}`
            } else if (!detailDup) {
              actions.suggestions.push(qs)
            }
          }
        }
      }
      // 过滤无效选项：不能和昏迷/死亡 NPC 交互
      if (actions.suggestions) {
        const invalidNpcs = session.npcs
          .filter(n => n.condition === 'unconscious' || n.condition === 'recovering')
          .map(n => n.name)
        actions.suggestions = actions.suggestions.filter(s =>
          !invalidNpcs.some(name => s.includes(name) && (s.includes('交谈') || s.includes('对话') || s.includes('聊') || s.includes('问') || s.includes('说')))
        )
      }
    } catch (mergeErr) {
      console.error(`[debug-actions] 选项合并崩溃:`, (mergeErr as Error).message)
      console.error(`[debug-actions] stack:`, (mergeErr as Error).stack?.split('\n').slice(0, 5).join('\n'))
      console.error(`[debug-actions] actions.suggestions=`, JSON.stringify(actions.suggestions))
    }
    // ─── 暴力后果战斗打断（DM 叙事完毕后触发） ───
    if (pendingCombatInterrupt) {
      const pci = pendingCombatInterrupt
      const responderNpc = session.npcs.find(n => n.name === pci.responderName)
      if (responderNpc && responderNpc.condition !== 'unconscious') {
        const monstersJson = (await import('../data/monsters.json', { with: { type: 'json' } })).default
        const npcCombatJson = (await import('../data/npc-combatants.json', { with: { type: 'json' } })).default
        const allDb = [...monstersJson, ...npcCombatJson]
        const { startCombat } = await import('./combat-manager.js')
        try {
          // 战斗前存档
          try {
            session.dossierData = this.dossier.toJSON()
            facts.save('autosave')
            this.turnsSinceLastSave = 0
          } catch (err) { console.warn('[save] consequence pre-combat save failed:', (err as Error).message) }

          startCombat(session, [pci.responderName], allDb as any)
          console.log(`[consequence] ${pci.responderName} 发起战斗！（DM 叙事后触发）`)

          // 先发 dm_end 关闭上一段叙事
          yield {
            type: 'dm_end',
            combat: true,
            pendingMonster: !!session.combat?.pendingMonsterTurn,
            actions: null as any,
          }

          // 追击打断过渡弹窗：前端显示 NPC 立绘 + 追击原因，
          // 玩家有 ~3s 理解发生了什么，同时后台 LLM 生成叙事。
          yield {
            type: 'combat_interrupt',
            responder: pci.responderName,
            victim: pci.victimName,
            portrait: NPC_PORTRAITS[pci.responderName] ?? '',
            immediate: pci.immediate,
          }

          // 追击打断：先显示战斗 UI（deferActionReq=true → 按钮禁用），
          // 等 DM 叙事后再解锁——让玩家先看到追击叙事，再操作。
          const quickNarrative = pci.immediate
            ? `${pci.responderName}当场出手，截住了你！`
            : `${pci.responderName}追上来了！`
          yield* this.emitCombatStart(quickNarrative, true)

          // DM 生成有上下文的战斗开场叙事
          const loc = getSubLocationName(pci.subLocation)
          const playerAction = input.length > 20 ? input.substring(0, 20) + '…' : input
          yield* this.combatDMNarrative(
            `${pci.responderName}因为玩家对${pci.victimName}的暴行而冲上来与玩家战斗。` +
            `玩家刚才正在"${playerAction}"。场景在${loc}。` +
            (pci.immediate ? `${pci.responderName}就在旁边，当场目击了一切，立刻出手。` : `${pci.responderName}赶到现场，截住了玩家。`) +
            `请描写这个被打断的戏剧性瞬间——先简短描写玩家当前行动的场景，然后急转直下，${pci.responderName}出现并发起攻击。用2-3句话，营造紧张感。`
          )

          // 叙事结束后才解锁玩家输入
          yield* this.emitCombatActionReq()
          session.dmMessages = getDMMessages()
          yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
          return
        } catch (err) {
          console.error(`[consequence] 战斗触发失败:`, (err as Error).message)
        }
      }
      pendingCombatInterrupt = null
    }

    // 注意：dm_end 已经从此处后移到所有副作用 yield 完成之后（见 sync 之前）
    // 这样可以避免 input 提前解锁——例如：DM 叙事刚结束 → 解锁 → 后台触发随机
    // 遭遇 → combatDMNarrative 又开始流式叙事，用户感知"输入框解锁后还在出文字"。
    // actions / hasPendingTrade 在此预先固化，后续不再修改。
    const dmEndActions = actions ? classifyActions(actions) : null
    const dmEndHasPendingTrade = hasPendingTrade

    // 剧情保底遭遇：关键探索节点完成后，下次移动 100% 触发战斗
    // 双保险：如果玩家不移动，8 轮后也强制触发（防止卡住）
    if (!session.combat?.active && !session.worldState.flags['pending_encounter'] && session.chapter) {
      const ch = session.chapter
      const loc = session.worldState.currentLocation
      const locData = locations[loc]

      // 定义剧情保底配置：
      // triggerAfterBeat: 这个 beat 完成后，下次移动保证遭遇
      // maxIdleTurns: 如果不移动，等这么多轮后强制触发
      const storyEncounters: Array<{
        combatBeat: string; location: string
        triggerAfterBeat: string; maxIdleTurns: number
        monsters?: string[]  // 指定怪物，不填则从区域池随机
      }> = [
        { combatBeat: 'ch2_forest_combat', location: 'twilight-woods', triggerAfterBeat: 'ch2_meet_hunter', maxIdleTurns: 10, monsters: ['Spider Matriarch', 'Giant Spider', 'Giant Spider'] },
        { combatBeat: 'ch3_shadow_boss', location: 'greyspine-mines', triggerAfterBeat: 'ch3_enter_mines', maxIdleTurns: 8, monsters: ['Shadow Weaver', 'Shadow'] },
        { combatBeat: 'ch4_eclipsed_boss', location: 'shatterstone-wastes', triggerAfterBeat: 'ch4_tower_discovery', maxIdleTurns: 6, monsters: ['Eclipsed Beast'] },
      ]

      for (const se of storyEncounters) {
        if (ch.completedBeats.includes(se.combatBeat)) continue
        if (!ch.completedBeats.includes(se.triggerAfterBeat)) continue
        if (loc !== se.location) continue

        const flagKey = `story_encounter_armed_${se.combatBeat}`

        // 标记"已就绪"——triggerAfterBeat 完成后设置
        if (!session.worldState.flags[flagKey]) {
          session.worldState.flags[flagKey] = session.turnCount
          console.log(`[combat] 剧情遭遇已就绪: ${se.combatBeat}，等待玩家移动或${se.maxIdleTurns}轮后触发`)
        }

        const armedTurn = Number(session.worldState.flags[flagKey])
        const turnsWaiting = session.turnCount - armedTurn

        // 触发条件：玩家移动了 OR 等太久了
        const shouldTrigger = action.type === 'MOVE' || turnsWaiting >= se.maxIdleTurns

        if (shouldTrigger && locData) {
          // 如果玩家当前在 Boss POI 且巢穴入口未确认，让 lair_entrance 流程处理
          const atLairPoi = (locData.pointsOfInterest ?? []).find((p: any) =>
            p.id === session.worldState.currentSubLocation &&
            p.discovered && p.encounter &&
            !session.worldState.flags[`poi_encounter_triggered_${p.id}`]
          )
          if (atLairPoi && action.type === 'MOVE') {
            console.log(`[combat] 剧情保底遭遇延迟: 玩家在 ${atLairPoi.nameZh} 巢穴入口，等待确认踏入`)
            continue
          }
          const picked = se.monsters ?? [(locData.monsterPool as string[])[0]]
          session.worldState.flags['pending_encounter'] = picked.join(',')
          delete session.worldState.flags[flagKey]
          console.log(`[combat] 剧情保底遭遇触发（${se.combatBeat}）：${picked.join(',')}，${action.type === 'MOVE' ? '玩家移动触发' : `等待${turnsWaiting}轮触发`}`)
        }
      }
    }

    // 原地待机遭遇：危险区域内不移动，每 3 轮检查一次（15% 概率）
    if (!session.combat?.active && !session.worldState.flags['pending_encounter']) {
      const loc = locations[session.worldState.currentLocation]
      if (loc && loc.monsterPool.length > 0 && (loc as any).dangerLevel !== 'safe') {
        const cooldownKey = `encounter_cooldown_${session.worldState.currentLocation}`
        const lastTurn = Number(session.worldState.flags[cooldownKey] ?? 0)
        const turnsSinceLast = session.turnCount - lastTurn
        if (turnsSinceLast >= 3 && action.type !== 'MOVE') {
          // 每 3 轮检查一次，15% 概率
          if (Math.random() < 0.15) {
            const pool = loc.monsterPool as string[]
            const picked = pool[Math.floor(Math.random() * pool.length)]
            session.worldState.flags['pending_encounter'] = picked
            session.worldState.flags[cooldownKey] = session.turnCount
            console.log(`[combat] 原地待机遭遇触发：${picked}（${turnsSinceLast}轮未移动）`)
          }
        }
      }
    }

    // 区域遭遇自动触发战斗（Move 工具或待机检查设置了 pending_encounter flag）
    const pendingEncounter = session.worldState.flags['pending_encounter'] as string | undefined
    if (pendingEncounter && !session.combat?.active) {
      // 战斗前强制存档：保证 autosave 反映"战斗前"的干净状态
      // 战斗中不会存档，所以这是玩家重新读档时能回到的最近安全点
      try {
        session.dossierData = this.dossier.toJSON()
        facts.save('autosave')
        this.turnsSinceLastSave = 0
        console.log(`[save] pre-combat snapshot saved (encounter: ${pendingEncounter})`)
        yield { type: 'auto_save' }
      } catch (err) {
        console.warn('[save] pre-combat save failed:', (err as Error).message)
      }

      delete session.worldState.flags['pending_encounter']
      const monsterNames = pendingEncounter.split(',')
      try {
        const monstersJson = (await import('../data/monsters.json', { with: { type: 'json' } })).default
        const npcCombatJson = (await import('../data/npc-combatants.json', { with: { type: 'json' } })).default
        const allDb = [...monstersJson, ...npcCombatJson]
        const { startCombat: startCombatFn } = await import('./combat-manager.js')
        startCombatFn(session, monsterNames, allDb as any)
        console.log(`[combat] 区域遭遇触发：${monsterNames.join(', ')}`)
        const namesZh = monsterNames.map(n => localize(n)).join('和')
        yield { type: 'narrative_warning', text: `⚔️ 遭遇战斗！${namesZh}向你发起攻击！` }
        // Emit combat_init + combat_action_req for structured combat UI
        yield* this.emitCombatStart(`${namesZh}向你发起攻击！`)
        const loc = session.worldState.currentLocation === 'twilight-woods' ? '暮色森林' : session.worldState.currentLocation === 'greyspine-mines' ? '灰脊矿道' : '碎石荒原'
        yield* this.combatDMNarrative(`${namesZh}从暗处现身，向玩家发起突袭！描写怪物出现的方式、它们的外貌和威胁感，以及战斗一触即发的紧迫氛围。`)
      } catch (err) {
        console.error(`[combat] 遭遇触发失败:`, (err as Error).message)
      }
    }

    // 战斗立绘：战斗进行时发送怪物立绘数据
    if (session.combat?.active) {
      const monsterPortraits = session.combat.monsters
        .filter(m => m.hp > 0)
        .map(m => ({
          id: m.id, name: m.name,
          portrait: MONSTER_PORTRAITS[m.name] ?? NPC_PORTRAITS[m.name] ?? '',
          hp: m.hp, maxHp: m.maxHp,
        }))
      if (monsterPortraits.length) {
        yield { type: 'combat_portraits', monsters: monsterPortraits }
      }
    }

    // 怪物回合
    if (session.combat?.pendingMonsterTurn) {
      // 保存怪物数据用于战后 NPC 状态同步（endCombat 会清空 combat）
      const combatMonstersSnapshot = session.combat.monsters.map(m => ({ name: m.name, hp: m.hp, maxHp: m.maxHp }))
      const monsterResult = executeMonsterPhase(session)
      if (monsterResult.log.length > 0) {
        yield { type: 'combat_monster', text: monsterResult.log.join('\n'), playerHp: session.player.hp, playerMaxHp: session.player.maxHp, allies: (session.combat?.allies ?? []).map(a => ({ id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp })) }
      }
      if (monsterResult.ended) {
        syncNPCConditionAfterCombat(session, combatMonstersSnapshot, session.combat?.allies)
        yield {
          type: 'combat_status',
          text: monsterResult.result === 'victory' ? '战斗胜利！' : '战斗失败...',
          ended: true, result: monsterResult.result,
        }
        if (session.chapter) {
          new ChapterManager(session).onEvent('combat_end')
        }
      } else {
        const status = getCombatSummary(session)
        if (status) yield { type: 'combat_status', text: status, ended: false }
        // Emit combat_action_req for next player turn
        yield* this.emitCombatStart()
      }
    } else if (session.combat?.active) {
      const status = getCombatSummary(session)
      if (status) yield { type: 'combat_status', text: status, ended: false }
      // Combat was started by attack pre-execution, emit structured combat events
      yield* this.emitCombatStart()
    }

    // 任务检查
    const qm = new QuestManager(session)
    const { completed: objCompleted, progress: objProgress } = qm.checkCombatObjectives()
    for (const r of objCompleted) {
      yield { type: 'quest_completed', questName: r.questName, text: r.text }
    }
    for (const p of objProgress) {
      yield { type: 'quest_progress', questName: p.questName, text: p.text, current: p.current, required: p.required }
    }

    // Beat 补偿：DM 叙事中出现 NPC 对话但没调 Talk 工具时，也触发 talk beat
    if (session.chapter) {
      const cm = new ChapterManager(session)
      for (const npc of session.npcs) {
        if (npc.location !== session.worldState.currentLocation) continue
        if (speakers.includes(npc.name)) continue  // Talk 工具已触发过，不重复
        // 检测叙事中 NPC 说话：名字后跟引号/冒号 或 「」引号
        const hasDialogue = fullText.includes(`${npc.name}：`) || fullText.includes(`${npc.name}:`)
          || (fullText.includes(npc.name) && (fullText.includes(`"`) || fullText.includes(`"`)))
        if (hasDialogue) {
          cm.onEvent('talk', npc.name)
        }
      }
    }

    // NPC 档案更新 — 先同步执行所有解锁（避免用户在 yield 间隙查询到旧状态），再 yield 通知
    //
    // 解锁条件（满足任一）：
    //   1. spokeTo：Talk 工具已经调用过（Talk 内部已校验子地点匹配），无条件解锁
    //   2. sameSpot：NPC 与玩家在同一房间（location + subLocation 都一致），叙事中提到即解锁
    //
    // 为什么要检查 subLocation：破晓镇这种"一个 location 下有多个子地点"的设计下，
    // 仅靠 location 过滤会导致"在酒馆听人提到艾琳娜"就解锁艾琳娜（她实际在公会分部）。
    const chapterNum = parseInt((session.chapter?.currentChapter ?? 'ch1').replace(/\D/g, ''), 10) || 1
    const spokeTo = new Set(speakers) // Talk 工具调用的 NPC 一定解锁
    const turnPlayerSub = getPlayerSubLocation(session)
    const npcUnlocks: Array<{ npcName: string; portrait: string; firstFacts: string[] }> = []
    const npcUpdates: string[] = []
    for (const npc of session.npcs) {
      if (input.includes(npc.name) || fullText.includes(npc.name)) {
        const sameArea = npc.location === session.worldState.currentLocation
        const npcSub = getNPCSubLocation(npc)
        const sameSpot = sameArea && (!npcSub || !turnPlayerSub || npcSub === turnPlayerSub)
        if (sameSpot || spokeTo.has(npc.name)) {
          const unlock = this.dossier.unlock(npc.name, session.turnCount, chapterNum)
          if (unlock) npcUnlocks.push({ npcName: npc.name, portrait: NPC_PORTRAITS[npc.name] ?? '', firstFacts: this.dossier.getFirstFacts(npc.name) })
        }
        const update = this.dossier.onInteraction(npc.name, npc.trust, session.turnCount, chapterNum)
        if (update) npcUpdates.push(update)
      }
    }
    // 解锁已完成，现在 yield 通知前端
    for (const u of npcUnlocks) yield { type: 'npc_unlock', npcName: u.npcName, portrait: u.portrait, firstFacts: u.firstFacts }
    for (const t of npcUpdates) yield { type: 'npc_update', text: t }

    // 同步 dossierData 到 session（供下一轮 ChapterManager.findPendingBeat 的 requiredFacts 检查使用）
    session.dossierData = this.dossier.toJSON()

    // 章节推进
    if (session.chapter) {
      new ChapterManager(session).advanceTurn()
    }

    // ─── NPC 记忆提取（Talk 后台提取互动要点） ───
    const talkData = consumePendingTalkData()
    if (talkData.length > 0) {
      try {
        const { extractMemory } = await import('./npc-memory-extractor.js')
        const { appendInteraction, updateImpressions, syncPromises } = await import('./npc-memory.js')
        for (const { npcName, playerMessage, talkOutput } of talkData) {
          const result = await extractMemory({
            npcName, playerMessage, dmNarrative: fullText, talkToolOutput: talkOutput, session,
          })
          if (result) {
            appendInteraction(session, npcName, result.interaction)
            if (result.impressions.length > 0) {
              updateImpressions(session, npcName, result.impressions)
            }
          }
          syncPromises(session, npcName)
        }
      } catch (err) {
        console.warn(`[npc-memory] 提取失败:`, (err as Error).message)
      }
    }

    // ─── 非 Talk 互动的代码生成记忆（零 LLM 成本） ───
    {
      const { appendInteraction: appendMem } = await import('./npc-memory.js')
      const ch = session.chapter?.currentChapter ?? 'ch1'
      const talkedNpcs = new Set(talkData.map(t => t.npcName))

      // 攻击 NPC
      if (action.type === 'ATTACK' && action.target) {
        const targetNpc = session.npcs.find(n => n.name === action.target)
        if (targetNpc) {
          appendMem(session, action.target, {
            turn: session.turnCount, chapter: ch,
            summary: `玩家攻击了${action.target}`, type: 'combat', mood: '敌对',
          })
        }
      }

      // 在场目击：同场景 NPC 在 DM 叙事中被提及但没通过 Talk 互动
      // 创建 witness 类型记忆（轻量，不调 LLM）
      for (const npc of session.npcs) {
        if (talkedNpcs.has(npc.name)) continue  // Talk 已处理
        if ('target' in action && npc.name === action.target) continue // 攻击已处理
        if (npc.location !== session.worldState.currentLocation) continue
        if (npc.condition === 'unconscious') continue
        // 检查 DM 叙事中是否提到了这个 NPC
        if (fullText.includes(npc.name)) {
          appendMem(session, npc.name, {
            turn: session.turnCount, chapter: ch,
            summary: `在场目睹：${input.slice(0, 15)}`, type: 'witness',
          })
        }
      }
    }

    // DM 消息持久化
    session.dmMessages = getDMMessages()

    // ─── dm_end 在此延迟发出（原本在主叙事流刚结束时就发） ───
    // 此时所有副作用已完成：随机/剧情遭遇、combatDMNarrative、怪物回合、
    // npc_unlock 卡片、quest_progress 等都已 yield。combat 字段反映最终状态，
    // 前端读到 combat:true 时不会解锁 input；combat:false 时所有视觉元素已落地，
    // 此刻解锁 input 是安全的。
    yield {
      type: 'dm_end',
      combat: !!session.combat?.active,
      pendingMonster: !!session.combat?.pendingMonsterTurn,
      actions: dmEndActions,
      hasPendingTrade: dmEndHasPendingTrade,
      text: fullText || undefined,  // 后端处理后的完整文本（截断修复、本地化等）
    }

    // ─── 怪物图鉴暗示（每回合最多 1 条） ───
    const bestiaryHints = checkAvailableHints(session)
    if (bestiaryHints.length > 0) {
      const hint = bestiaryHints[0]
      markHintShown(session, hint.id)
      yield { type: 'bestiary_hint', text: hint.hintText, npc: hint.npc, monster: hint.monster }
    }

    // 同步
    yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }

    // 死亡检测
    if (session.player.hp <= 0) {
      yield* this.handleDeath()
      return
    }

    // Game Over 只有一个条件：HP = 0（上面已处理）
    // 全镇敌对不是 Game Over，而是持续的生存压力（NPC 会主动攻击玩家）

    // 自动存档（战斗中不存档——战斗状态不持久化，见 combat-grid 设计文档）
    this.turnsSinceLastSave++
    if (this.turnsSinceLastSave >= 5 && !session.combat?.active) {
      session.dossierData = this.dossier.toJSON()
      facts.save('autosave')
      this.turnsSinceLastSave = 0
      yield { type: 'auto_save' }
    }
  }

  // ─── 砍价状态管理 ────────────────────────────

  /** 清空砍价状态（交易成功或玩家取消后调用） */
  clearBargain(): void {
    this.bargainState = null
  }

  /** 处理砍价回合：跳过 Rules Agent，直接注入砍价上下文给 DM */
  async *processBargain(playerText: string): AsyncGenerator<TurnEvent> {
    if (!this.bargainState) {
      yield* this.processTurn(playerText)
      return
    }

    // 硬限制：最多 2 轮砍价，防止 DM 不遵守规则
    if (this.bargainState.round >= 2) {
      this.bargainState = null
      yield* this.processTurn(playerText)
      return
    }

    this.activate()
    const session = this.session
    const facts = getFacts()

    this.bargainState.round++
    const { npc, items, lastPrice, round } = this.bargainState

    session.turnCount++
    checkNPCConditionRecovery(session)

    const itemList = items.map(i => `${i.name} x${i.quantity} @${i.price}金`).join('、')
    const bargainContext = `[砍价进行中] 玩家正在与${npc}砍价。上次报价：${itemList}，总价${lastPrice}金。这是第${round}轮砍价。玩家说："${playerText}"。请根据NPC性格决定是否让价。如果同意降价，调用ProposeTradeAction给出新价格。如果拒绝，也调用ProposeTradeAction但设canBargain=false表示最终价格。最多允许2轮砍价。`

    const parts: string[] = [bargainContext, playerText]

    console.log(`[bargain] 第${round}轮砍价，${npc}，上次总价${lastPrice}金`)

    // DM 流式响应（带超时保护）
    const dmStart = Date.now()
    let fullText = ''
    const toolsCalled: ToolCallRecord[] = []
    const bargainLocalizer = new StreamingLocalizer()
    let bargainTimedOut = false
    try {
      const timeoutMs = 120000
      const timer = setTimeout(() => { bargainTimedOut = true }, timeoutMs)
      for await (const event of dmRespond(parts.join('\n\n'))) {
        if (bargainTimedOut) {
          console.error(`[bargain] DM 响应超时 (${timeoutMs}ms)`)
          yield { type: 'dm_error', message: '砍价响应超时，请重试。' }
          break
        }
        if (event.type === 'thinking_delta') {
          const thinking = (event as any).thinking ?? ''
          if (thinking) yield { type: 'dm_thinking', text: thinking }
        } else if (event.type === 'text_delta') {
          const text = event.text ?? ''
          if (text.includes("'content': [") || text.includes('(Empty response:') || text.includes("'type': 'thinking'") || text.includes('[DEBUG]')) continue
          const localized = bargainLocalizer.feed(text)
          if (localized) yield { type: 'dm_text_delta', text: localized }
          fullText += text
        } else if (event.type === 'tool_result' && event.name) {
          toolsCalled.push({ toolName: event.name })
          if (event.name === 'TransferItem' && event.output && !event.isError) {
            const out = String(event.output)
            if (out.includes('获得物品') || out.includes('获得') || out.includes('支付')) {
              yield { type: 'item_acquired', text: out }
            }
          }
        }
      }
      clearTimeout(timer)
      const tail = bargainLocalizer.flush()
      if (tail) yield { type: 'dm_text_delta', text: tail }
      const bargainEmptyIdx = fullText.indexOf('(Empty response:')
      if (bargainEmptyIdx !== -1) fullText = fullText.substring(0, bargainEmptyIdx)
      fullText = localize(fullText)
      // 超时兜底
      if (!fullText.trim()) {
        const fallback = bargainTimedOut
          ? `${npc}沉吟良久，似乎还在权衡利弊。`
          : `${npc}没有立即回应。`
        console.warn(`[bargain] 空响应，发送兜底文本 (timedOut=${bargainTimedOut})`)
        yield { type: 'dm_text_delta', text: fallback }
        fullText = fallback
      }
      console.log(`[bargain] DM 响应完成: ${fullText.length}字, ${Date.now() - dmStart}ms`)
    } catch (err) {
      console.error(`[bargain] DM 错误:`, (err as Error).message)
      yield { type: 'dm_error', message: (err as Error).message.slice(0, 100) }
    }

    // 检查新的交易提案
    const newTrade = consumeTradeProposal()
    if (newTrade) {
      if (newTrade.canBargain !== false) {
        this.bargainState = {
          npc: newTrade.npc,
          items: newTrade.items.map(i => ({ name: i.name, price: i.price, quantity: i.quantity ?? 1 })),
          lastPrice: newTrade.totalPrice,
          round,
        }
      } else {
        this.bargainState = null
      }
      yield { type: 'trade_proposal', npc: newTrade.npc, items: newTrade.items, totalPrice: newTrade.totalPrice, canBargain: newTrade.canBargain }
    } else {
      // DM 没有发新报价，清空砍价状态
      this.bargainState = null
    }

    // NPC 立绘
    const speakers = consumeSpeakingNPCs()
    for (const name of speakers) {
      if (NPC_PORTRAITS[name]) {
        yield { type: 'npc_speaking', npcName: name, portrait: NPC_PORTRAITS[name] }
      }
    }

    // 场景选项
    const dmActions = consumeActions()
    const actions = dmActions ?? buildFallbackActions(session)
    yield {
      type: 'dm_end',
      combat: false,
      pendingMonster: false,
      actions: actions ? classifyActions(actions) : null,
    }

    // 同步
    session.dmMessages = getDMMessages()
    yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }

    this.turnsSinceLastSave++
    if (this.turnsSinceLastSave >= 5 && !session.combat?.active) {
      session.dossierData = this.dossier.toJSON()
      facts.save('autosave')
      this.turnsSinceLastSave = 0
      yield { type: 'auto_save' }
    }
  }

  // ─── 战斗 DM 叙事 ────────────────────────────

  /** 自动构建当前战斗上下文（地点、时间、玩家状态、敌人信息） */
  private buildCombatContext(): string {
    const session = this.session
    const ws = session.worldState
    const loc = getSubLocationName(ws.currentSubLocation ?? '') || ws.currentLocation
    const timeMap: Record<string, string> = { morning: '清晨', noon: '正午', afternoon: '下午', evening: '傍晚', night: '深夜' }
    const time = timeMap[ws.timeOfDay] ?? ws.timeOfDay
    const player = session.player
    const hpPct = Math.round((player.hp / player.maxHp) * 100)
    const hpDesc = hpPct > 75 ? '状态良好' : hpPct > 40 ? '有些疲惫，身上带着伤' : hpPct > 15 ? '伤痕累累，摇摇欲坠' : '命悬一线'
    const weapon = player.equipped?.weapon?.name ?? '徒手'
    const armor = player.equipped?.armor?.name

    const combat = session.combat
    let enemyDesc = ''
    if (combat?.monsters) {
      const alive = combat.monsters.filter(m => m.hp > 0)
      if (alive.length > 0) {
        enemyDesc = formatEnemyDescForPrompt(alive, session, COMBAT_DB_ALL, localize)
      }
    }

    let ctx = `[场景] ${loc}，${time}。`
    const classId = Object.entries(CLASS_TEMPLATES).find(([, t]) =>
      JSON.stringify(t.abilities) === JSON.stringify(player.abilities))?.[0] ?? ''
    const className = CLASS_TEMPLATES[classId]?.nameZh ?? '冒险者'
    ctx += ` 玩家${player.name}，${className}，装备${weapon}${armor ? `和${armor}` : ''}，${hpDesc}。`
    if (enemyDesc) ctx += ` 对手：${enemyDesc}。`
    return ctx
  }

  /** 调用 DM 生成 2-3 句战斗场景叙事（开场/结束/逃跑）
   *  大部分工具被临时静音，只保留 SetActions 以便生成后续选项 */
  private async *combatDMNarrative(scene: string): AsyncGenerator<TurnEvent> {
    const context = this.buildCombatContext()
    let fullText = ''
    muteDMTools()  // 🔇 静音：只保留 SetActions
    const combatSaFilter = new SetActionsStreamFilter()  // 防御 inline <setactions> 幻觉
    let combatDmTimedOut = false
    try {
      const timeoutMs = 120000
      const timer = setTimeout(() => { combatDmTimedOut = true }, timeoutMs)
      for await (const event of dmRespond(
        `[战斗叙事请求]\n${context}\n${scene}\n\n` +
        `用2-3句话描写这个场景。语言要有画面感和冲击力，像小说一样。不要提及HP/AC/骰子等数值。\n\n` +
        `叙事结束后，思考玩家此刻最自然的后续行动，通过工具调用接口调用 SetActions 提供选项。` +
        `不要在文本中写 <setactions> 标签或 JSON — 必须通过真正的 function calling 接口。`
      )) {
        if (combatDmTimedOut) {
          console.error(`[combat-dm] 战斗叙事超时 (${timeoutMs}ms)`)
          break
        }
        if (event.type === 'text_delta') {
          const text = event.text ?? ''
          if (text.includes('(Empty response:') || text.includes("'type': 'thinking'")) continue
          // 过滤 inline <setactions> 块
          const filtered = combatSaFilter.feed(text)
          for (const block of filtered.detectedBlocks) {
            const parsedBlock = parseSetActionsBlock(block)
            if (parsedBlock && injectPendingActions(parsedBlock)) {
              console.log(`[combat-dm] 拦截 inline <setactions> 块并注入`)
            }
          }
          if (filtered.output) {
            fullText += filtered.output
            const truncated = detectRepetition(fullText)
            if (truncated) {
              console.warn(`[combat-dm] 重复检测触发，截断输出 (${fullText.length}→${truncated.length}字)`)
              fullText = truncated
              break
            }
          }
        }
      }
      clearTimeout(timer)
      // flush filter
      const saTailCombat = combatSaFilter.flush()
      for (const block of saTailCombat.detectedBlocks) {
        const parsedBlock = parseSetActionsBlock(block)
        if (parsedBlock) injectPendingActions(parsedBlock)
      }
      if (saTailCombat.output) fullText += saTailCombat.output
      const emptyIdx = fullText.indexOf('(Empty response:')
      if (emptyIdx !== -1) fullText = fullText.substring(0, emptyIdx)
      fullText = trimToLastSentence(fullText)
      // 超时兜底：DM 没给战斗叙事时，发一段通用文本保证不空白
      if (!fullText.trim()) {
        fullText = combatDmTimedOut
          ? '战斗中的时间仿佛被拉长，每一次呼吸都变得沉重。'
          : '战况在片刻寂静中继续。'
        console.warn(`[combat-dm] 空响应，发送兜底文本 (timedOut=${combatDmTimedOut})`)
      }
      yield { type: 'combat_narrative', text: localize(fullText.trim()) }
      // 如果 DM 调用了 SetActions 生成了选项，传出去
      const narrativeActions = consumeActions()
      if (narrativeActions) {
        yield { type: 'combat_narrative_actions', actions: narrativeActions }
      }
    } catch (err) {
      console.error('[combat-dm] 战斗叙事失败:', (err as Error).message?.slice(0, 80))
    } finally {
      unmuteDMTools()  // 🔊 恢复：后续 DM 调用恢复全部工具
      consumeActions() // 兜底清理
    }
  }

  // ─── 死亡结局生成 ────────────────────────────

  /**
   * 统一的死亡处理：存档 → 通知前端等待 → DM 生成结局 → 发送 death 事件
   * 所有 hp<=0 的分支都应调用此方法，避免散落的 yield { type: 'death' }
   */
  private async *handleDeath(): AsyncGenerator<TurnEvent> {
    const session = this.session
    const facts = getFacts()

    session.dossierData = this.dossier.toJSON()
    facts.save('death-save')

    // 通知前端：DM 正在生成结局
    yield { type: 'death_pending' }

    // 用主 DM 生成结局（它拥有完整上下文）
    let epilogue = ''
    muteDMTools()
    try {
      const recentEvents = session.events.slice(-10).map((e: any) => e.fact).join('；')
      const prompt =
        `[死亡结局]\n` +
        `玩家「${session.player.name}」在「${locations[session.worldState.currentLocation]?.nameZh ?? '未知'}」倒下了。\n` +
        `HP 归零，冒险到此结束。\n\n` +
        `近期经历：${recentEvents}\n\n` +
        `请写一段简短的结局（3-4句话），包含：\n` +
        `1. 用文学化的语言描写倒下的最后时刻\n` +
        `2. 用一句"如果……"的反思提示，暗示玩家本可以做出不同选择（基于实际发生的事件）\n\n` +
        `语气：悲壮但不绝望，像小说的章节结尾。不要提及数值、系统或游戏机制。`

      const timeoutMs = 120000
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true }, timeoutMs)
      for await (const event of dmRespond(prompt)) {
        if (timedOut) break
        if (event.type === 'text_delta') {
          const text = event.text ?? ''
          if (text.includes('(Empty response:') || text.includes("'type': 'thinking'")) continue
          epilogue += text
          const truncated = detectRepetition(epilogue)
          if (truncated) {
            console.warn(`[death] 重复检测触发，截断结局 (${epilogue.length}→${truncated.length}字)`)
            epilogue = truncated
            break
          }
        }
      }
      clearTimeout(timer)

      const emptyIdx = epilogue.indexOf('(Empty response:')
      if (emptyIdx !== -1) epilogue = epilogue.substring(0, emptyIdx)
      epilogue = localize(epilogue.trim())
    } catch (err) {
      console.error('[death] 结局生成失败:', (err as Error).message?.slice(0, 80))
    } finally {
      unmuteDMTools()
      consumeActions()  // 清理 DM 可能调用的 SetActions
    }

    // 兜底：DM 生成失败时用固定文本
    if (!epilogue) {
      epilogue = '意识在黑暗中渐渐远去，像一盏被风吹灭的烛火。' +
        '你倒在冰冷的地面上，周围的声音逐渐模糊——' +
        '也许，故事本不该在这里结束。'
    }

    console.log(`[death] 结局: ${epilogue.slice(0, 100)}...`)
    yield { type: 'death', epilogue }
  }

  // ─── 战斗初始化事件辅助 ────────────────────

  /** 生成 combat_init + combat_action_req 事件对 */
  /**
   * @param narrative  combat_init 事件的即时叙事文本
   * @param deferActionReq  true = 只发 combat_init,不发 combat_action_req(调用方自行在叙事后发)
   */
  private *emitCombatStart(narrative?: string, deferActionReq = false): Generator<TurnEvent> {
    const combat = this.session.combat
    if (!combat?.active) return

    combat.phase = 'player_turn'

    // 切换战斗 BGM
    const combatAudio = resolveAudio(
      this.session.worldState.currentLocation,
      this.session.worldState.currentSubLocation,
      this.session.worldState.timeOfDay,
      true,
    )
    yield { type: 'audio', bgm: combatAudio.bgm, ambient: combatAudio.ambient }

    const aliveMonsters = combat.monsters.filter(m => m.hp > 0)

    // 发送战斗立绘（确保所有战斗触发路径都显示立绘）
    yield {
      type: 'combat_portraits',
      monsters: aliveMonsters.map(m => ({
        id: m.id, name: m.name,
        portrait: MONSTER_PORTRAITS[m.name] ?? NPC_PORTRAITS[m.name] ?? '',
        hp: m.hp, maxHp: m.maxHp,
      })),
    }

    const aliveAllies = (combat.allies ?? []).filter(a => a.hp > 0)

    yield {
      type: 'combat_init',
      monsters: aliveMonsters.map(m => ({
        id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp,
        portrait: MONSTER_PORTRAITS[m.name] ?? NPC_PORTRAITS[m.name] ?? '',
      })),
      allies: aliveAllies.map(a => ({
        id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp,
        portrait: NPC_PORTRAITS[a.name] ?? '',
      })),
      round: combat.round,
      initiative: combat.initiativeOrder,
      narrative,
    }

    // ── 战棋网格初始化事件 ──
    if (combat.grid) {
      const gridData = combat.grid.toJSON()
      // 补充名称和立绘到 grid units
      for (const gu of gridData.units) {
        if (gu.side === 'player') {
          (gu as any).name = this.session.player.name;
          (gu as any).portrait = ''
          const pgs = combat.playerGridStats
          if (pgs) { (gu as any).hp = this.session.player.hp; (gu as any).maxHp = this.session.player.maxHp }
        } else if (gu.side === 'enemy') {
          const m = combat.monsters.find(mon => mon.id === gu.id)
          if (m) { (gu as any).name = m.name; (gu as any).portrait = MONSTER_PORTRAITS[m.name] ?? NPC_PORTRAITS[m.name] ?? ''; (gu as any).hp = m.hp; (gu as any).maxHp = m.maxHp }
        } else {
          const a = combat.allies.find(al => al.id === gu.id)
          if (a) { (gu as any).name = a.name; (gu as any).portrait = NPC_PORTRAITS[a.name] ?? ''; (gu as any).hp = a.hp; (gu as any).maxHp = a.maxHp }
        }
      }
      yield { type: 'combat_grid_init', grid: gridData }
    }

    if (!deferActionReq) {
      yield* this.emitCombatActionReq()
    }
  }

  /** 发送 combat_action_req — 解锁玩家输入 + 战斗按钮 */
  private *emitCombatActionReq(): Generator<TurnEvent> {
    const combat = this.session.combat
    if (!combat?.active) return
    const aliveMonsters = combat.monsters.filter(m => m.hp > 0)
    const aliveAllies = (combat.allies ?? []).filter(a => a.hp > 0)
    yield {
      type: 'combat_action_req',
      targets: aliveMonsters.map(m => ({ id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp })),
      allies: aliveAllies.map(a => ({ id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp })),
      spells: this.session.player.spells
        .filter(s => s.remaining > 0 || s.usesPerRest === 0)
        .map(s => ({ name: s.name, desc: s.description, remaining: s.remaining, max: s.usesPerRest, isCantrip: s.usesPerRest === 0, isBuff: isBuffSpell(s.name) })),
      items: this.session.player.inventory
        .filter(i => i.type === 'potion')
        .map(i => ({ name: i.name, desc: i.description })),
      playerHp: this.session.player.hp,
      playerMaxHp: this.session.player.maxHp,
      activeEffects: (this.session.player.activeEffects ?? []).map(e => ({
        name: e.name, type: e.type, remaining: e.remainingTurns, source: e.source,
      })),
    }
  }

  // ─── 结构化战斗动作处理 ────────────────────

  /** 处理结构化战斗输入（按钮点击），返回事件流 */
  async *processCombatAction(action: {
    action: 'attack' | 'spell' | 'item' | 'flee' | 'defend'
    targetId?: string
    spellId?: string
    itemId?: string
  }): AsyncGenerator<TurnEvent> {
    this.activate()
    const session = this.session
    session.interactionNpc = undefined  // 战斗中清除对话绑定
    const combat = session.combat
    if (!combat?.active) {
      yield { type: 'dm_error', message: '当前没有战斗。' }
      return
    }

    // 保留 combat.monsters 引用，战后用于 NPC 状态同步
    const combatMonsters = combat.monsters
    // enemyNames 用于注入 DM 叙事 prompt —— 用中文显示名（localize 保证英文怪物名被替换）
    const enemyNames = combatMonsters.map(m => localize(m.id)).join('、')

    let skipAfterPhase = false

    // ── 按先攻值拆分：玩家前 / 玩家后（怪物和同伴分开）──
    const playerInit = combat.initiativeOrder.find(e => e.isPlayer)?.initiative ?? 0
    const beforeMonsterIds = combat.initiativeOrder
      .filter(e => !e.isPlayer && !e.isAlly && e.initiative > playerInit)
      .map(e => e.id)
    const afterMonsterIds = combat.initiativeOrder
      .filter(e => !e.isPlayer && !e.isAlly && e.initiative <= playerInit)
      .map(e => e.id)
    const beforeAllyIds = combat.initiativeOrder
      .filter(e => e.isAlly === true && e.initiative > playerInit)
      .map(e => e.id)
    const afterAllyIds = combat.initiativeOrder
      .filter(e => e.isAlly === true && e.initiative <= playerInit)
      .map(e => e.id)
    // 兼容旧接口
    const beforePlayerIds = beforeMonsterIds
    const afterPlayerIds = afterMonsterIds

    // 怪物命中叙事 helper
    // 注意：monsterName/targetName 可能是英文怪物名（"Cockatrice"/"Goblin_2"），
    // 走 localize 把它们转成中文显示名再代入模板。
    const emitMonsterNarratives = function* (hits: any[]) {
      for (const mhit of hits) {
        const monsterZh = localize(mhit.monsterName)
        if (mhit.targetIsAlly) {
          // 怪物攻击同伴的叙事
          const outcome = mhit.isCritical ? 'monster_critical_ally' : mhit.hit ? 'monster_hit_ally' : 'monster_miss_ally'
          const text = pickNarrative(outcome as any, { monster: monsterZh, ally: mhit.targetName })
          if (text) yield { type: 'combat_narrative' as const, text }
          if (mhit.allyKilled) {
            const downText = pickNarrative('ally_down' as any, { ally: mhit.targetName })
            if (downText) yield { type: 'combat_narrative' as const, text: downText }
          }
        } else {
          const isNpc = session.npcs.some(n => n.name === mhit.monsterName)
          const prefix = isNpc ? 'npc' : 'monster'
          const outcome = mhit.isCritical ? `${prefix}_critical` : mhit.hit ? `${prefix}_hit` : `${prefix}_miss`
          const text = pickNarrative(outcome as any, { monster: monsterZh })
          if (text) yield { type: 'combat_narrative' as const, text }
        }
      }
    }

    // 同伴行动叙事 helper
    const emitAllyNarratives = function* (hits: any[]) {
      for (const ahit of hits) {
        // 根据同伴的 combatBehavior 选择叙事风格（subdue 用专属压制模板）
        const ally = session.combat?.allies.find(a => a.name === ahit.allyName)
        const isSubdue = ally?.combatBehavior === 'subdue'
        const outcome = ahit.targetKilled
          ? 'ally_kill'
          : ahit.isCritical
            ? (isSubdue ? 'ally_subdue_critical' : 'ally_critical')
            : ahit.hit
              ? (isSubdue ? 'ally_subdue_hit' : 'ally_hit')
              : 'ally_miss'
        // target 可能是英文怪物名，localize
        const text = pickNarrative(outcome as any, { ally: ahit.allyName, target: localize(ahit.targetName) })
        if (text) yield { type: 'combat_narrative' as const, text }
      }
    }

    // ── Phase 1: 先攻高于玩家的敌人先行动 ──
    if (beforePlayerIds.length > 0) {
      combat.phase = 'monster_turn'
      const monsterResult = executeMonsterPhase(session, beforePlayerIds, false)

      yield* emitMonsterNarratives(monsterResult.hits ?? [])
      if (monsterResult.log.length > 0) {
        yield { type: 'combat_monster', text: monsterResult.log.join('\n'), playerHp: session.player.hp, playerMaxHp: session.player.maxHp, allies: (session.combat?.allies ?? []).map(a => ({ id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp })) }
      }

      if (monsterResult.ended && monsterResult.result === 'defeat') {
        combat.phase = 'ended'
        syncNPCConditionAfterCombat(session, combatMonsters, session.combat?.allies)
        yield { type: 'combat_status', text: '战斗失败...', ended: true, result: 'defeat' }
        yield { type: 'combat_narrative', text: `${enemyNames}的攻势如潮水般涌来。最后一击落下时，你的视野开始模糊，膝盖触地的声音像是从很远的地方传来。` }
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        if (session.player.hp <= 0) {
          yield* this.handleDeath()
        }
        return
      }
      combat.phase = 'player_turn'
    }

    // ── Phase 1.5: 高先攻同伴行动 ──
    if (beforeAllyIds.length > 0 && combat.active) {
      const allyResult = executeAllyTurns(session, beforeAllyIds)
      // 发送盟友网格移动动画
      for (const gm of allyResult.gridMoves) {
        yield { type: 'combat_grid_move', unitId: gm.unitId, path: gm.path }
      }
      yield* emitAllyNarratives(allyResult.hits)
      if (allyResult.log.length > 0) {
        yield { type: 'combat_ally', text: allyResult.log.join('\n') }
      }
      const allyCheck = checkCombatEnd(session)
      if (allyCheck.ended && allyCheck.result === 'victory') {
        combat.phase = 'ended'
        const loot = awardLoot(session)
        const lootText = `战斗胜利！获得: ${loot.items.join(', ')}${loot.gold ? ` + ${loot.gold}金币` : ''}`
        yield { type: 'combat_status', text: lootText, ended: true, result: 'victory' }
        syncNPCConditionAfterCombat(session, combatMonsters, session.combat?.allies)
        endCombat(session)
        yield* this.combatDMNarrative(`同伴们帮你解决了${enemyNames}。描写战斗结束后同伴间的默契和战后余韵。`)
        if (session.chapter) new ChapterManager(session).onEvent('combat_end')
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        return
      }
    }

    // Execute player action
    if (action.action === 'flee') {
      const result = await attemptFlee(session)
      yield {
        type: 'combat_status',
        text: result.log.join('\n'),
        ended: result.ended,
        result: result.ended ? 'fled' : undefined,
      }
      if (result.ended) {
        // 逃跑成功 → 结束战斗
        combat.phase = 'ended'
        skipAfterPhase = true
        syncNPCConditionAfterCombat(session, combatMonsters, session.combat?.allies)

        // 逃跑不等于脱罪：重置暴力警报，2 轮后另一个 NPC 来追
        const alertJson = session.worldState.flags['violence_alert'] as string | undefined
        if (alertJson) {
          try {
            const alert = JSON.parse(alertJson)
            if (alert.responded && alert.arrivedResponder) {
              alert.responded = false
              alert.arrivedResponder = null
              alert.triggerTurn = session.turnCount
              alert.delay = 2  // 2 轮后下一个追兵到
              session.worldState.flags['violence_alert'] = JSON.stringify(alert)
              console.log(`[consequence] 逃跑成功但暴力警报重置：2轮后新追兵`)
              yield { type: 'narrative_warning', text: '你暂时甩掉了追兵，但镇子不会忘记你的所作所为...' }
            }
          } catch { /* ignore */ }
        }

        // 逃跑叙事用模板，不调 LLM（战斗中需要快速响应）
        yield { type: 'combat_narrative', text: `你抓住一个空隙，从${enemyNames}的攻势中挣脱出来。身后传来愤怒的吼叫和追逐的脚步，但你已经冲出了战圈。` }
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        return
      }
      // 逃跑失败 → 浪费回合，怪物正常回合继续（skipAfterPhase=false）
    } else if (action.action === 'defend') {
      combat.playerDefending = true
      yield { type: 'combat_status', text: '你摆出防御姿态，AC临时+2。', ended: false }
    } else if (action.action === 'item' && action.itemId) {
      // Use potion/item in combat
      const useResult = await UseItemTool.execute({ itemId: action.itemId, action: 'use' })
      yield { type: 'combat_status', text: useResult.output, ended: false }
    } else {
      // Attack or spell
      const method = action.action === 'spell' ? 'spell' : 'weapon'
      const targetId = action.action === 'spell' ? (action.targetId ?? combat.monsters.find(m => m.hp > 0)?.id ?? '') : (action.targetId ?? '')
      const turnResult = executePlayerTurn(session, targetId, method, action.spellId)

      // 玩家行动叙事
      if (turnResult.hit !== undefined) {
        const isNpcTarget = session.npcs.some(n => n.name === turnResult.targetName)
        let narrativeOutcome: string
        if (turnResult.killed) narrativeOutcome = isNpcTarget ? 'player_kill_npc' : 'player_kill'
        else if (turnResult.isCritical) narrativeOutcome = 'player_critical'
        else if (turnResult.hit) narrativeOutcome = 'player_hit'
        else narrativeOutcome = 'player_miss'
        const weaponName = session.player.equipped.weapon?.name ?? '武器'
        const narrative = pickNarrative(narrativeOutcome as any, { target: localize(turnResult.targetName ?? '敌人'), weapon: weaponName })
        if (narrative) yield { type: 'combat_narrative', text: narrative }
      }

      // executePlayerTurn already handles victory (endCombat + loot)
      if (turnResult.ended) {
        syncNPCConditionAfterCombat(session, combatMonsters, session.combat?.allies)
        // Combine round log + loot into a single ended message
        const lines = [...turnResult.roundLog]
        if (turnResult.result === 'victory' && turnResult.loot) {
          const { items, gold } = turnResult.loot
          if (items.length || gold) lines.push(`获得: ${items.join(', ')}${gold ? ` + ${gold}金币` : ''}`)
        }
        yield { type: 'combat_status', text: lines.join('\n'), ended: true, result: turnResult.result }

        // 首次击败无辜NPC警告
        if (turnResult.firstInnocentKill) {
          yield {
            type: 'important_warning',
            title: '低语',
            text: '刀刃所向，非善非恶...只是选择。\n\n但选择，终将塑造你。',
          }
        }

        const isNpcFight = combatMonsters.some(m => session.npcs.some(n => n.name === m.name))
        yield* this.combatDMNarrative(
          turnResult.result === 'victory'
            ? (isNpcFight
                ? `玩家的最后一击将${enemyNames}击倒在地，对方失去意识。描写这个人与人对决的结局——胜利者站在倒下的对手面前，周围人的反应，以及这场冲突留下的紧张余韵。`
                : `玩家一击制胜，${enemyNames}轰然倒下！描写最后致命一击的画面，战利品散落的场景，以及战斗后短暂的宁静。`)
            : `${enemyNames}的攻势压垮了玩家。描写玩家倒下的最后时刻——是什么样的一击终结了战斗，意识模糊中最后的感知。`
        )
        if (session.chapter) new ChapterManager(session).onEvent('combat_end')
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        return
      }
      yield { type: 'combat_status', text: turnResult.roundLog.join('\n'), ended: false }
    }

    // Check if combat ended after player action (defend/item won't end it, but flee might have returned above)
    const endCheck = checkCombatEnd(session)
    if (endCheck.ended) {
      combat.phase = 'ended'
      if (endCheck.result === 'victory') {
        const loot = awardLoot(session)
        const lootText = `战斗胜利！获得: ${loot.items.join(', ')}${loot.gold ? ` + ${loot.gold}金币` : ''}`
        yield { type: 'combat_status', text: lootText, ended: true, result: 'victory' }
      } else if (endCheck.result === 'defeat') {
        yield { type: 'combat_status', text: '战斗失败...', ended: true, result: 'defeat' }
      }
      syncNPCConditionAfterCombat(session, combatMonsters, session.combat?.allies)
      endCombat(session)
      yield* this.combatDMNarrative(
        endCheck.result === 'victory'
          ? `${enemyNames}终于倒下了！描写战场上恢复平静的瞬间，玩家擦去汗水或鲜血，审视这场胜利的余波。`
          : `玩家在${enemyNames}的猛攻下再也支撑不住。描写最后的挣扎和倒下的瞬间，战场归于沉寂。`
      )
      if (session.chapter) new ChapterManager(session).onEvent('combat_end')
      yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
      if (session.player.hp <= 0) {
        yield* this.handleDeath()
      }
      return
    }

    // ── Phase 2.5: 低先攻同伴行动 ──
    if (!skipAfterPhase && afterAllyIds.length > 0 && combat.active) {
      const allyResult = executeAllyTurns(session, afterAllyIds)
      // 发送盟友网格移动动画
      for (const gm of allyResult.gridMoves) {
        yield { type: 'combat_grid_move', unitId: gm.unitId, path: gm.path }
      }
      yield* emitAllyNarratives(allyResult.hits)
      if (allyResult.log.length > 0) {
        yield { type: 'combat_ally', text: allyResult.log.join('\n') }
      }
      const allyCheck = checkCombatEnd(session)
      if (allyCheck.ended && allyCheck.result === 'victory') {
        combat.phase = 'ended'
        const loot = awardLoot(session)
        const lootText = `战斗胜利！获得: ${loot.items.join(', ')}${loot.gold ? ` + ${loot.gold}金币` : ''}`
        yield { type: 'combat_status', text: lootText, ended: true, result: 'victory' }
        syncNPCConditionAfterCombat(session, combatMonsters, session.combat?.allies)
        endCombat(session)
        yield* this.combatDMNarrative(`同伴们协力击败了${enemyNames}。描写最后的敌人倒下的瞬间和团队战后的喘息。`)
        if (session.chapter) new ChapterManager(session).onEvent('combat_end')
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        return
      }
    }

    // ── Phase 3: 先攻低于/等于玩家的敌人后行动 ──
    // 仅当战斗仍在进行 + 有存活的目标时执行（防御性：避免已死怪物列表或战斗结束后误触）
    const livingAfterPlayerIds = afterPlayerIds.filter(id =>
      (combat.monsters.find(m => m.id === id)?.hp ?? 0) > 0
    )
    if (!skipAfterPhase && combat.active && livingAfterPlayerIds.length > 0) {
      combat.phase = 'monster_turn'
      combat.pendingMonsterTurn = false
      const monsterResult = executeMonsterPhase(session, livingAfterPlayerIds, true)

      yield* emitMonsterNarratives(monsterResult.hits ?? [])
      if (monsterResult.log.length > 0) {
        yield { type: 'combat_monster', text: monsterResult.log.join('\n'), playerHp: session.player.hp, playerMaxHp: session.player.maxHp, allies: (session.combat?.allies ?? []).map(a => ({ id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp })) }
      }

      if (monsterResult.ended) {
        combat.phase = 'ended'
        syncNPCConditionAfterCombat(session, combatMonsters, session.combat?.allies)
        yield {
          type: 'combat_status',
          text: monsterResult.result === 'victory' ? '战斗胜利！' : '战斗失败...',
          ended: true, result: monsterResult.result,
        }
        if (monsterResult.result === 'victory') {
          const isNpcFight2 = combatMonsters.some(m => session.npcs.some(n => n.name === m.name))
          yield* this.combatDMNarrative(
            isNpcFight2
              ? `${enemyNames}终于倒下。描写这场人与人对决的结局和战后余韵。`
              : `${enemyNames}终于倒下。描写最后一个敌人倒地的画面和劫后余生的片刻喘息。`
          )
        } else {
          yield { type: 'combat_narrative', text: `${enemyNames}的攻势如潮水般涌来。最后一击落下时，你的视野开始模糊，世界在眼前逐渐暗去。` }
        }
        if (session.chapter) new ChapterManager(session).onEvent('combat_end')
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        if (session.player.hp <= 0) {
          yield* this.handleDeath()
        }
        return
      }
    } else if (!skipAfterPhase && combat.active && livingAfterPlayerIds.length === 0) {
      // 后段无存活敌人，但战斗仍在进行（不应该发生），补一次空结算清理状态
      executeMonsterPhase(session, [], true)
    }

    // Next round — send updated state for player's next turn
    if (session.combat?.active) {
      const activeCombat = session.combat
      activeCombat.phase = 'player_turn'
      activeCombat.playerDefending = false
      const aliveMonsters = activeCombat.monsters.filter(m => m.hp > 0)
      const roundAliveAllies = (activeCombat.allies ?? []).filter(a => a.hp > 0)
      yield {
        type: 'combat_action_req',
        targets: aliveMonsters.map(m => ({ id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp })),
        allies: roundAliveAllies.map(a => ({ id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp })),
        spells: session.player.spells
          .filter(s => s.remaining > 0 || s.usesPerRest === 0)
          .map(s => ({ name: s.name, desc: s.description, remaining: s.remaining, max: s.usesPerRest, isCantrip: s.usesPerRest === 0, isBuff: isBuffSpell(s.name) })),
        items: session.player.inventory
          .filter(i => i.type === 'potion')
          .map(i => ({ name: i.name, desc: i.description })),
        playerHp: session.player.hp, playerMaxHp: session.player.maxHp,
        activeEffects: (session.player.activeEffects ?? []).map(e => ({
          name: e.name, type: e.type, remaining: e.remainingTurns, source: e.source,
        })),
      }
      yield {
        type: 'combat_portraits',
        monsters: aliveMonsters.map(m => ({
          id: m.id, name: m.name,
          portrait: MONSTER_PORTRAITS[m.name] ?? NPC_PORTRAITS[m.name] ?? '',
          hp: m.hp, maxHp: m.maxHp,
        })),
      }
    }

    yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }

    // Death check
    if (session.player.hp <= 0) {
      yield* this.handleDeath()
    }
  }

  // ─── DM 开场 ────────────────────────────

  /** 流式发送 DM 开场叙事 */
  async *streamOpening(): AsyncGenerator<TurnEvent> {
    this.activate()
    const session = this.session
    const classZh = Object.values(CLASS_TEMPLATES).find(t =>
      t.abilities.STR === session.player.abilities.STR &&
      t.abilities.INT === session.player.abilities.INT
    )?.nameZh ?? '冒险者'

    const prompt = [
      `新游戏开始。玩家角色: ${session.player.name}，${classZh}。`,
      '请开始第一幕：马车上醒来。简短3-4段。',
      '叙事结束后通过工具调用接口调用 SetActions 提供初始选项。',
      '重要：不要在文本中写 <setactions> 标签、JSON 或任何伪工具调用 — 必须通过真正的 function calling 接口调用。',
    ].join('\n')

    let fullText = ''
    const openingLocalizer = new StreamingLocalizer()
    const openingSaFilter = new SetActionsStreamFilter()
    let openingTimedOut = false
    try {
      const timeoutMs = 120000 // 开场叙事给 120 秒（首次调用可能较慢）
      const timer = setTimeout(() => { openingTimedOut = true }, timeoutMs)
      for await (const event of dmRespond(prompt)) {
        if (openingTimedOut) {
          console.error(`[opening] DM 开场超时 (${timeoutMs}ms)`)
          yield { type: 'dm_error', message: '开场叙事生成超时，请刷新重试。' }
          break
        }
        if (event.type === 'thinking_delta') {
          const thinking = (event as any).thinking ?? ''
          if (thinking) yield { type: 'dm_thinking', text: thinking }
        } else if (event.type === 'text_delta') {
          const text = event.text ?? ''
          if (text.includes("'content': [") || text.includes('(Empty response:') || text.includes("'type': 'thinking'") || text.includes('[DEBUG]')) continue
          // 防御 DM 的 inline tool call 幻觉:先过滤掉 <setactions>...</setactions>
          // 伪 XML 块,把块内的 JSON 注入为真正的 pendingActions
          const filtered = openingSaFilter.feed(text)
          for (const block of filtered.detectedBlocks) {
            const parsed = parseSetActionsBlock(block)
            if (parsed && injectPendingActions(parsed)) {
              console.log(`[opening] 拦截 DM inline <setactions> 块,已注入为真 SetActions (details=${(parsed.details ?? []).length}, suggestions=${(parsed.suggestions ?? []).length})`)
            }
          }
          if (filtered.output) {
            const localized = openingLocalizer.feed(filtered.output)
            if (localized) yield { type: 'dm_text_delta', text: localized }
            fullText += filtered.output
          }
        }
      }
      clearTimeout(timer)
      // flush filter 尾部
      const saTail = openingSaFilter.flush()
      for (const block of saTail.detectedBlocks) {
        const parsed = parseSetActionsBlock(block)
        if (parsed && injectPendingActions(parsed)) {
          console.log(`[opening] flush 时拦截 DM inline <setactions> 残留块并注入`)
        }
      }
      if (saTail.output) {
        const localized = openingLocalizer.feed(saTail.output)
        if (localized) yield { type: 'dm_text_delta', text: localized }
        fullText += saTail.output
      }
      const tail = openingLocalizer.flush()
      if (tail) yield { type: 'dm_text_delta', text: tail }
      const openEmptyIdx = fullText.indexOf('(Empty response:')
      if (openEmptyIdx !== -1) fullText = fullText.substring(0, openEmptyIdx)
      fullText = localize(fullText)
      fullText = trimToLastSentence(fullText)
      // 超时兜底：开场叙事必须有内容，否则玩家无法开始游戏
      if (!fullText.trim()) {
        const fallback = '马车在颠簸中缓缓前行，车轮碾过砾石的声音将你从昏沉中唤醒。你眨了眨眼，试图记起自己为何在这里——记忆如同被雾气包裹，朦胧不清。'
        console.warn(`[opening] 空响应，发送兜底文本 (timedOut=${openingTimedOut})`)
        yield { type: 'dm_text_delta', text: fallback }
        fullText = fallback
      }
    } catch (err) {
      yield { type: 'dm_error', message: (err as Error).message.slice(0, 100) }
    }

    // 开场音频
    const openAudio = resolveAudio(
      session.worldState.currentLocation,
      session.worldState.currentSubLocation,
      session.worldState.timeOfDay,
      false,
    )
    yield { type: 'audio', bgm: openAudio.bgm, ambient: openAudio.ambient }

    const dmOpenActions = consumeActions()
    const fallbackOpen = buildFallbackActions(session)
    const actions = dmOpenActions ?? fallbackOpen
    // 开场也智能合并★主线建议（语义去重）
    if (dmOpenActions && fallbackOpen.suggestions) {
      const questSuggestions = fallbackOpen.suggestions.filter(s => s.startsWith('★'))
      if (questSuggestions.length > 0) {
        if (!actions.suggestions) actions.suggestions = []
        for (const qs of questSuggestions) {
          const questText = qs.slice(1)
          const keywords = extractKeywords(questText, session)
          const dupIdx = actions.suggestions.findIndex(s =>
            keywords.some(kw => s.includes(kw))
          )
          const detailDup = (actions.details ?? []).some(d =>
            keywords.some(kw => d.label.includes(kw))
          )
          if (dupIdx >= 0) {
            actions.suggestions[dupIdx] = `★${actions.suggestions[dupIdx]}`
          } else if (!detailDup) {
            actions.suggestions.push(qs)
          }
        }
      }
    }
    yield { type: 'dm_end', combat: false, pendingMonster: false, actions: actions ? classifyActions(actions) : null }

    // 开场 NPC 解锁（只有"真的在同一房间"才算见面）
    //   - 同 location：排除车夫提到外地 NPC
    //   - 同 subLocation：排除在酒馆听人提到公会的艾琳娜（她虽在同镇但不同房间）
    //   - subLocation 为空时（如荒野过场）放宽，只按 location 判断
    const openChapterNum = parseInt((session.chapter?.currentChapter ?? 'ch1').replace(/\D/g, ''), 10) || 1
    const openPlayerSub = getPlayerSubLocation(session)
    for (const npc of session.npcs) {
      if (!fullText.includes(npc.name)) continue
      if (npc.location !== session.worldState.currentLocation) continue
      const npcSub = getNPCSubLocation(npc)
      const sameSpot = !npcSub || !openPlayerSub || npcSub === openPlayerSub
      if (!sameSpot) continue
      const notice = this.dossier.unlock(npc.name, 0, openChapterNum)
      if (notice) yield { type: 'npc_unlock', npcName: npc.name, portrait: NPC_PORTRAITS[npc.name] ?? '', firstFacts: this.dossier.getFirstFacts(npc.name) }
    }

    session.dmMessages = getDMMessages()
    yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
  }

  // ─── 工具方法 ────────────────────────────

  getPrologue(): string {
    return renderPrologue()
  }

  getWorldGuide(): string {
    return renderWorldGuide()
  }

  // ─── 战棋网格动作处理 ────────────────────────────

  async *processGridAction(msg: {
    action: 'grid_move' | 'grid_attack' | 'grid_spell' | 'grid_defend' | 'grid_flee' | 'grid_item'
    target?: { x: number; y: number }
    targetId?: string
    spellName?: string
    itemName?: string
  }): AsyncGenerator<TurnEvent> {
    this.activate()
    const session = this.session
    const combat = session.combat
    if (!combat?.active || !combat.grid) {
      yield { type: 'dm_error', message: '当前没有战棋战斗。' }
      return
    }

    const grid = combat.grid
    const player = session.player
    const playerUnit = grid.getUnit('player')
    if (!playerUnit) {
      yield { type: 'dm_error', message: '玩家单位丢失。' }
      return
    }

    const { pickNarrative } = await import('./combat-narrative.js')
    const { executePlayerTurn, executeMonsterPhase, checkCombatEnd, endCombat, awardLoot } = await import('./combat-manager.js')

    // ── A. 纯移动 ──
    if (msg.action === 'grid_move' && msg.target) {
      const reachable = grid.getReachable('player')
      const key = `${msg.target.x},${msg.target.y}`
      if (!reachable.has(key)) {
        yield { type: 'dm_error', message: '无法到达该位置。' }
        return
      }
      const path = grid.moveUnit('player', msg.target)
      if (combat.playerGridStats) combat.playerGridStats.pos = { ...msg.target }
      yield { type: 'combat_grid_move', unitId: 'player', path }
      yield { type: 'system_message', text: '你移动到了新的位置。' }
    }

    // ── B. 移动+攻击（火纹式） ──
    else if (msg.action === 'grid_attack' && msg.targetId) {
      const targets = grid.getAttackableTargets('player')
      const opt = targets.find(t => t.targetId === msg.targetId)
      if (!opt) {
        yield { type: 'dm_error', message: '目标不在攻击范围内。' }
        return
      }
      // 先移动到攻击位
      if (!posEqual(playerUnit.pos, opt.attackFrom)) {
        const path = grid.moveUnit('player', opt.attackFrom)
        if (combat.playerGridStats) combat.playerGridStats.pos = { ...opt.attackFrom }
        yield { type: 'combat_grid_move', unitId: 'player', path }
      }
      // 执行攻击（复用现有伤害逻辑）
      const turnResult = executePlayerTurn(session, msg.targetId, 'weapon')
      // 发送攻击结果
      for (const line of turnResult.roundLog) {
        yield { type: 'combat_status', text: line, ended: false }
      }
      // 目标死亡 → 移除网格单位
      if (turnResult.killed) {
        grid.removeUnit(msg.targetId)
        yield { type: 'combat_grid_death', unitId: msg.targetId }
      }
      // executePlayerTurn 内部可能已调用 endCombat → 直接处理结束
      if (turnResult.ended) {
        yield { type: 'combat_grid_end', result: turnResult.result as any, loot: turnResult.loot }
        const endAudio = resolveAudio(session.worldState.currentLocation, session.worldState.currentSubLocation, session.worldState.timeOfDay, false)
        yield { type: 'audio', bgm: endAudio.bgm, ambient: endAudio.ambient }
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        if (session.player.hp <= 0) yield* this.handleDeath()
        return
      }
    }

    // ── C. 防御 ──
    else if (msg.action === 'grid_defend') {
      combat.playerDefending = true
      yield { type: 'system_message', text: '你举起武器防御。（AC+2 本轮）' }
    }

    // ── D. 逃跑 ──
    else if (msg.action === 'grid_flee') {
      const { attemptFlee } = await import('./combat-manager.js')
      const fleeResult = await attemptFlee(session)
      for (const line of fleeResult.log) {
        yield { type: 'combat_status', text: line, ended: false }
      }
      if (fleeResult.success) {
        // endCombat already called inside attemptFlee
        const fleeAudio = resolveAudio(session.worldState.currentLocation, session.worldState.currentSubLocation, session.worldState.timeOfDay, false)
        yield { type: 'audio', bgm: fleeAudio.bgm, ambient: fleeAudio.ambient }
        yield { type: 'combat_grid_end', result: 'defeat' }
        yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
        return
      }
    }

    // ── E. 施法（原地） ──
    else if (msg.action === 'grid_spell' && msg.spellName) {
      // 校验法术射程（仅对有 gridRange 且有指定目标的法术）
      const spell = player.spells.find(s => s.name === msg.spellName || s.name.toLowerCase() === msg.spellName!.toLowerCase())
      if (spell?.gridRange !== undefined && spell.gridRange > 0 && msg.targetId) {
        const targetUnit = grid.getUnit(msg.targetId)
        if (targetUnit) {
          const dist = manhattan(playerUnit.pos, targetUnit.pos)
          if (dist > spell.gridRange) {
            yield { type: 'dm_error', message: `${msg.spellName} 射程 ${spell.gridRange}，目标距离 ${dist}——目标太远了。` }
            return
          }
          // 远程阻挡检查（射程 > 1 的法术）
          if (spell.gridRange > 1 && grid.isRangeBlocked(playerUnit.pos, targetUnit.pos)) {
            yield { type: 'dm_error', message: `视线被障碍物阻挡，无法施法。` }
            return
          }
        }
      }
      // 死亡前快照，供 spell 后对比（找出本次 spell 导致的所有死亡）
      const aliveBefore = new Set(combat.monsters.filter(m => m.hp > 0).map(m => m.id))
      // 施法走现有 processCombatAction 逻辑（不移动）
      yield* this.processCombatAction({ action: 'spell', spellId: msg.spellName, targetId: msg.targetId })
      // 扫描所有现在死亡但仍在网格上的单位 → 发 death 事件
      if (combat.grid) {
        for (const m of combat.monsters) {
          if (m.hp <= 0 && aliveBefore.has(m.id) && combat.grid.getUnit(m.id)) {
            combat.grid.removeUnit(m.id)
            yield { type: 'combat_grid_death', unitId: m.id }
          }
        }
        for (const a of combat.allies) {
          if (a.hp <= 0 && combat.grid.getUnit(a.id)) {
            combat.grid.removeUnit(a.id)
            yield { type: 'combat_grid_death', unitId: a.id }
          }
        }
      }
      return // processCombatAction 已经处理了怪物回合
    }

    // ── E2. 使用物品（原地） ──
    else if (msg.action === 'grid_item' && msg.itemName) {
      yield* this.processCombatAction({ action: 'item', itemId: msg.itemName })
      return
    }

    // ── 检查战斗结束 ──
    const endCheck = checkCombatEnd(session)
    if (endCheck.ended) {
      const lootInfo = endCheck.result === 'victory' ? awardLoot(session) : undefined
      yield { type: 'combat_grid_end', result: endCheck.result as any, loot: lootInfo }
      endCombat(session)
      // 恢复探索BGM
      const audio = resolveAudio(
        session.worldState.currentLocation,
        session.worldState.currentSubLocation,
        session.worldState.timeOfDay,
        false,
      )
      yield { type: 'audio', bgm: audio.bgm, ambient: audio.ambient }
      yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }
      return
    }

    // ── 怪物回合 ──
    combat.pendingMonsterTurn = true
    const monsterResult = executeMonsterPhase(session)
    if (monsterResult.log.length > 0) {
      // 发送 Boss 召唤（在移动动画之前，这样玩家先看到"新怪物出现"）
      for (const sp of monsterResult.gridSpawns) {
        yield { type: 'combat_grid_spawn', unit: {
          id: sp.unitId, side: 'enemy', name: sp.name,
          hp: sp.hp, maxHp: sp.maxHp, pos: sp.pos,
          moveSpeed: sp.moveSpeed, attackRange: sp.attackRange,
          portrait: '',
        }}
      }
      // 发送怪物移动动画
      for (const gm of monsterResult.gridMoves) {
        yield { type: 'combat_grid_move', unitId: gm.unitId, path: gm.path }
      }
      yield { type: 'combat_monster', text: monsterResult.log.join('\n'), playerHp: player.hp, playerMaxHp: player.maxHp, allies: (combat.allies ?? []).map(a => ({ id: a.id, name: a.name, hp: a.hp, maxHp: a.maxHp })) }
    }

    // 怪物击杀检查
    for (const m of combat.monsters) {
      if (m.hp <= 0 && grid.getUnit(m.id)) {
        grid.removeUnit(m.id)
        yield { type: 'combat_grid_death', unitId: m.id }
      }
    }
    // 盟友倒下检查
    for (const a of combat.allies) {
      if (a.hp <= 0 && grid.getUnit(a.id)) {
        grid.removeUnit(a.id)
        yield { type: 'combat_grid_death', unitId: a.id }
      }
    }

    // 再次检查战斗结束（怪物回合后）
    const endCheck2 = checkCombatEnd(session)
    if (endCheck2.ended) {
      const lootInfo2 = endCheck2.result === 'victory' ? awardLoot(session) : undefined
      yield { type: 'combat_grid_end', result: endCheck2.result as any, loot: lootInfo2 }
      endCombat(session)
      const audio2 = resolveAudio(
        session.worldState.currentLocation,
        session.worldState.currentSubLocation,
        session.worldState.timeOfDay,
        false,
      )
      yield { type: 'audio', bgm: audio2.bgm, ambient: audio2.ambient }
    }

    // 发送 combat_action_req（解锁下一轮玩家输入）+ 更新立绘血量
    if (combat.active) {
      yield* this.emitCombatActionReq()
    }
    yield { type: 'sync', session, dossier: this.dossier.toJSON(), questHint: getQuestHint(session) }

    // 死亡检查
    if (player.hp <= 0) {
      yield* this.handleDeath()
    }
  }

  /** 恢复时的完整视觉状态快照 */
  getStateSnapshot(): Record<string, any> {
    const session = this.session
    const audio = resolveAudio(
      session.worldState.currentLocation,
      session.worldState.currentSubLocation,
      session.worldState.timeOfDay,
      !!session.combat?.active,
    )

    const snapshot: Record<string, any> = {
      audio,
      session,
      combat: null as any,
      questHint: getQuestHint(session),
      // resume 时附带当前章节的 fresh fallback actions，避免前端 fallback 到陈旧的
      // localStorage 缓存（可能来自前一章甚至前一局）。战斗中由 combat 字段接管 UI。
      actions: session.combat?.active ? null : buildFallbackActions(session),
      // 标记：resumeGame 中清除了过期战斗状态 → 前端应该提示玩家
      combatRewound: !!(session as any).__combatRewound,
    }
    // 一次性消费，避免后续读档提示
    delete (session as any).__combatRewound

    // 如果在战斗中，发送战斗状态供前端重建 UI
    if (session.combat?.active) {
      const alive = session.combat.monsters.filter(m => m.hp > 0)
      snapshot.combat = {
        round: session.combat.round,
        monsters: alive.map(m => ({
          id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp,
          portrait: MONSTER_PORTRAITS[m.name] ?? NPC_PORTRAITS[m.name] ?? '',
        })),
        spells: session.player.spells.filter(s => s.remaining > 0 || s.usesPerRest === 0),
        items: session.player.inventory.filter(i => i.type === 'potion'),
        playerHp: session.player.hp,
        playerMaxHp: session.player.maxHp,
      }
    }

    return snapshot
  }
}
