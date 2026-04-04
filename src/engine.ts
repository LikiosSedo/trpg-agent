/**
 * GameEngine — 所有游戏逻辑的唯一入口
 *
 * CLI 和 Web 是薄适配器，只负责 I/O。
 * 所有命令处理、回合管道、存档管理都在这里。
 */

import type { GameSession } from './types.js'
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
import { initDMAgent, dmRespond, getDMMessages, restoreDMMessages } from './dm-agent.js'
import { consumeActions, type SceneActions } from './tools/set-actions.js'
import { consumeTrustChanges } from './tools/change-trust.js'
import { validateNarrative, type ToolCallRecord } from './narrative-validator.js'
import { consumeSpeakingNPCs } from './tools/talk.js'
import { classifyIntent, formatActionResult, shouldPreExecute, type ActionResult } from './rules-agent.js'
import { executeAction } from './action-executor.js'
import { getActiveEffectsSummary } from './effect-manager.js'
import { isBuffSpell } from './combat-manager.js'
import {
  executeMonsterPhase, getCombatSummary, executePlayerTurn,
  attemptFlee, checkCombatEnd, awardLoot, endCombat,
} from './combat-manager.js'
import { pickNarrative } from './combat-narrative.js'
import { UseItemTool } from './tools/use-item.js'
import { renderPrologue, renderWorldGuide } from './world-guide.js'
import { WORLD_OVERVIEW, locations, connections } from './data/maps.js'
import { getDefaultSubLocation, getSubLocationName } from './npc-mobility.js'
import { resolveAudio, type AudioState } from './audio-config.js'
import { consumeAmbianceOverride } from './tools/set-ambiance.js'
import { consumeGameOver, type GameOverData } from './tools/game-over.js'
import { consumeTradeProposal } from './tools/propose-trade.js'
import { readFileSync } from 'fs'

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

// ─── 战斗结束后 NPC 状态同步 ──────────────────────

function syncNPCConditionAfterCombat(session: GameSession, combatMonsters: Array<{ name: string; hp: number; maxHp: number }>): void {
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
  | { type: 'dm_end'; combat: boolean; pendingMonster: boolean; actions: SceneActions | null }
  | { type: 'dm_error'; message: string }
  | { type: 'combat_monster'; text: string }
  | { type: 'combat_status'; text: string; ended: boolean; result?: string }
  | { type: 'combat_init'; monsters: any[]; round: number; initiative: any[]; narrative?: string }
  | { type: 'combat_action_req'; targets: any[]; spells: any[]; items: any[]; playerHp: number; playerMaxHp: number; activeEffects?: any[] }
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
  | { type: 'item_acquired'; text: string }
  | { type: 'trade_proposal'; npc: string; items: any[]; totalPrice: number; canBargain: boolean }
  | { type: 'death' }
  | { type: 'sync'; session: GameSession; dossier: any }
  | { type: 'combat_narrative'; text: string }
  | { type: 'dm_thinking'; text: string }

// ─── 默认选项 fallback ──────────────────────────

function buildFallbackActions(session: GameSession): SceneActions {
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

  // 场景优先：刚打完仗 → 搜索/离开
  if (inCombatAftermath) {
    suggestions.push('搜索周围')
    const area = locations[loc]
    if (area) {
      const otherPoi = area.pointsOfInterest.find((p: any) => p.discovered !== false && p.id !== subLoc)
      if (otherPoi) suggestions.push(`前往${(otherPoi as any).nameZh}`)
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

        const [type, target] = beat.trigger.split(':')
        if (type === 'talk' && target) {
          const npc = npcsHere.find(n => n.name === target)
          if (npc && !suggestions.includes(`★和${target}交谈`) && !suggestions.includes(`和${target}交谈`)) {
            suggestions.push(`★和${target}交谈`)
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
        if (suggestions.length >= 2) break
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
          subLocations: currentLoc?.pointsOfInterest
            ?.filter((p: any) => p.discovered !== false)
            .map((p: any) => ({
              id: p.id, nameZh: p.nameZh, description: p.description,
              isCurrent: p.id === session.worldState.currentSubLocation,
              npcs: session.npcs
                .filter(n => n.location === session.worldState.currentLocation &&
                  (n.subLocation ?? n.homeBase) === p.id)
                .map(n => n.name),
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
      const unlockedNames = new Set(this.dossier.toListData(trustMap).map(n => n.name))
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
      return {
        type: 'npc_list',
        data: {
          npcs: this.dossier.toListData(trustMap).map(n => ({
            ...n,
            condition: session.npcs.find(npc => npc.name === n.name)?.condition ?? 'normal',
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

    // NPC 状态恢复检查
    checkNPCConditionRecovery(session)

    // 暴力后果检查
    const alertJson = session.worldState.flags['violence_alert'] as string | undefined
    if (alertJson && !session.combat?.active) {
      try {
        const alert = JSON.parse(alertJson)
        if (!alert.responded) {
          const elapsed = session.turnCount - alert.triggerTurn
          console.log(`[consequence] 暴力后果检查: turn=${session.turnCount}, trigger=${alert.triggerTurn}, elapsed=${elapsed}/${alert.delay}, victim=${alert.victimName}, arrived=${alert.arrivedResponder || '无'}`)

          // Player fled the area — discovery happens but no combat
          if (session.worldState.currentLocation !== alert.location) {
            alert.responded = true
            session.worldState.flags['violence_alert'] = JSON.stringify(alert)
            yield { type: 'narrative_warning', text: `你离开了${alert.location}，但${alert.victimName}的遭遇很快会被发现...` }
          }
          // Pre-warning (1 turn before response)
          else if (elapsed === alert.delay - 1) {
            yield { type: 'narrative_warning', text: '⚠️ 远处传来急促的脚步声和喊叫声，有人正在赶来！' }
          }
          // 阶段 1：响应者到达（注入 DM 叙事上下文，不直接战斗）
          else if (elapsed === alert.delay && !alert.arrivedResponder) {
            const { getPersonality: getP } = await import('./npc-relationships.js')
            // 暴力事件：任何能战斗的 NPC 都会来响应（不需要达到敌对信任度）
            // 谋杀是公共事件，不是个人恩怨
            const candidates = session.npcs.filter(n =>
              n.name !== alert.victimName &&
              n.condition !== 'unconscious' &&
              n.condition !== 'recovering' &&
              getP(n.name).canFight
            )
            // 排序：同子地点 > 与受害者有 bond > 守卫韩猛 > 其他
            const responder = candidates.sort((a, b) => {
              let scoreA = 0, scoreB = 0
              // 同一子地点距离近
              const subLoc = alert.subLocation
              if ((a.subLocation ?? a.homeBase) === subLoc) scoreA += 10
              if ((b.subLocation ?? b.homeBase) === subLoc) scoreB += 10
              // 与受害者有 bond 关系
              const bondsA = getP(a.name).bonds ?? []
              const bondsB = getP(b.name).bonds ?? []
              if (bondsA.some((bd: any) => bd.npcName === alert.victimName)) scoreA += 5
              if (bondsB.some((bd: any) => bd.npcName === alert.victimName)) scoreB += 5
              // 守卫优先
              if (a.role === 'guard') scoreA += 3
              if (b.role === 'guard') scoreB += 3
              return scoreB - scoreA
            })[0] ?? null

            console.log(`[consequence] 阶段1: 候选响应者=${candidates.map(c => c.name).join(',') || '无'}`)
            if (responder) {
              // 移动响应者到现场
              const { moveNPC } = await import('./npc-mobility.js')
              moveNPC(responder, alert.subLocation, session)
              alert.arrivedResponder = responder.name
              session.worldState.flags['violence_alert'] = JSON.stringify(alert)
              console.log(`[consequence] ${responder.name} 到达现场，下一轮将发起战斗`)
            } else {
              alert.responded = true
              session.worldState.flags['violence_alert'] = JSON.stringify(alert)
              console.log(`[consequence] 无人响应（所有能战斗的NPC都不可用）`)
              yield { type: 'narrative_warning', text: '镇民发现了你的暴行，消息正在传开...' }
            }
          }
          // 阶段 2：下一轮自动触发战斗（DM 已经叙事了到达过程）
          else if (elapsed > alert.delay && alert.arrivedResponder && !alert.responded) {
            alert.responded = true
            alert.combatJustStarted = alert.arrivedResponder
            session.worldState.flags['violence_alert'] = JSON.stringify(alert)

            const responderNpc = session.npcs.find(n => n.name === alert.arrivedResponder)
            if (responderNpc && responderNpc.condition !== 'unconscious') {
              const monstersJson = (await import('../data/monsters.json', { with: { type: 'json' } })).default
              const npcCombatJson = (await import('../data/npc-combatants.json', { with: { type: 'json' } })).default
              const allDb = [...monstersJson, ...npcCombatJson]
              const { startCombat } = await import('./combat-manager.js')

              try {
                startCombat(session, [alert.arrivedResponder], allDb as any)
                console.log(`[consequence] ${alert.arrivedResponder} 发起战斗！`)
                yield { type: 'narrative_warning', text: `⚔️ ${alert.arrivedResponder}向你发起了攻击！` }
                yield* this.emitCombatStart(`${alert.arrivedResponder}怒声呵斥，向你冲来！`)
                yield* this.combatDMNarrative(`${alert.arrivedResponder}因为你对${alert.victimName}的暴行而冲上来与你战斗。场景在${getSubLocationName(alert.subLocation)}。请描写战斗开场的紧张氛围。`)
                // 暴力后果触发战斗——事件打断玩家行动
                yield { type: 'narrative_warning', text: `你还没来得及行动——${alert.arrivedResponder}已经冲到面前！` }
                console.log(`[consequence] 战斗已触发，玩家行动被打断: "${input}"`)
                session.dmMessages = getDMMessages()
                yield { type: 'sync', session, dossier: this.dossier.toJSON() }
                return
              } catch (err) {
                console.error(`[consequence] 战斗触发失败:`, (err as Error).message)
              }
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
        if (!alert.responded) {
          const remaining = alert.delay - (session.turnCount - alert.triggerTurn)
          if (remaining > 0 && remaining <= 3) {
            parts.push(`[世界事件：${alert.victimName}的遭遇即将被发现，约${remaining}轮后有人赶到]`)
          }
          // 阶段 1：响应者已到达但还没战斗 → 让 DM 叙事到达过程（含角色细节）
          if (alert.arrivedResponder && !alert.responded) {
            const { getPersonality: getPForDm } = await import('./npc-relationships.js')
            const victimNpc = session.npcs.find((n: any) => n.name === alert.victimName)
            const victimCondition = victimNpc?.condition ?? 'unknown'
            const responderPersonality = getPForDm(alert.arrivedResponder)
            const bondNote = responderPersonality.bonds?.some((b: any) => b.npcName === alert.victimName)
              ? `（${alert.arrivedResponder}与${alert.victimName}有亲近关系，情绪格外激动）`
              : ''
            parts.push(`[世界事件：${alert.arrivedResponder}已经赶到了${alert.victimName}所在的地方！${alert.victimName}目前状态：${victimCondition}。${bondNote}请描写${alert.arrivedResponder}到达的场景——他的愤怒、他的气势、他对玩家的质问或警告。这一轮只描写到达，不要描写攻击动作，下一轮战斗才开始。]`)
          }
        }
        // 阶段 2：战斗刚刚触发，DM 需要描写战斗开场
        if (alert.combatJustStarted) {
          const responderName = alert.combatJustStarted
          parts.push(`[战斗触发：${responderName}因你对${alert.victimName}的暴行而向你发起攻击！请用1-2句描写战斗开场——${responderName}的愤怒和第一个动作。战斗数值由系统处理，不要编造数字。]`)
          // 清除标志，只注入一次
          delete alert.combatJustStarted
          session.worldState.flags['violence_alert'] = JSON.stringify(alert)
        }
      } catch { /* ignore malformed */ }
    }

    // Adaptive tool reminder
    const reminders: string[] = []
    if (session.turnCount % 5 === 0) reminders.push('回应结束前必须调用SetActions设置选项。')
    if (session.turnCount % 3 === 0) reminders.push('NPC对话后请调用ChangeTrust更新信任（日常±1）。')
    if (session.turnCount % 5 === 0) reminders.push('伤害/物品/金币变化必须通过工具，不要在文本中编造数值。')
    if (reminders.length) parts.push(`[系统提醒] ${reminders.join(' ')}`)

    // ── 规则预处理：分级意图识别 + 机械动作预执行 ──
    const action = await classifyIntent(input, session)
    console.log(`[rules-agent] 输入: "${input}" → 分类: ${JSON.stringify(action)}`)
    let actionResult: ActionResult | null = null

    if (shouldPreExecute(action)) {
      actionResult = await executeAction(action, session)
      console.log(`[rules-agent] 预执行: ${action.type} → 成功:${actionResult.success} 工具:${actionResult.toolsCalled.join(',')}`)
      console.log(`[rules-agent] 结果: ${actionResult.output.slice(0, 200)}`)
      parts.push(formatActionResult(actionResult))
    } else {
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
          if (witnesses.length > 0) delay -= 3
          const { getPersonality } = await import('./npc-relationships.js')
          // Civilian witness reports faster
          if (witnesses.some(n => !getPersonality(n.name).canFight)) delay -= 1
          // 受害者有亲近 NPC（bond>=1.0 的战斗型 NPC）→ 更快赶来
          const hasBondedFighter = session.npcs.some(n => {
            if (n.name === action.target || n.condition === 'unconscious') return false
            const p = getPersonality(n.name)
            return p.canFight && p.bonds.some(b => b.npcName === action.target && b.weight >= 1.0)
          })
          if (hasBondedFighter) delay -= 2

          delay = Math.max(1, delay)

          session.worldState.flags['violence_alert'] = JSON.stringify({
            triggerTurn: session.turnCount,
            victimName: action.target,
            location: session.worldState.currentLocation,
            subLocation: session.worldState.currentSubLocation,
            delay,
            responded: false,
          })
          console.log(`[consequence] 暴力警报设置: ${action.target}, ${delay}轮后响应`)
        }
      }
    }

    parts.push(input)

    // Rules Agent 调完后等一下再调 DM，避免 API 限流
    if (action.type !== 'NARRATIVE') {
      console.log(`[dm] Rules Agent 用了 API，等 1.5s 再调 DM...`)
      await new Promise(r => setTimeout(r, 1500))
    }

    // DM 流式响应（带超时保护）
    console.log(`[dm] 调用 DM API...`)
    const dmStart = Date.now()
    let fullText = ''
    const toolsCalled: ToolCallRecord[] = actionResult
      ? actionResult.toolsCalled.map(t => ({ toolName: t }))
      : []
    const thinkParser = new ThinkTagParser()
    try {
      const timeoutMs = 60000 // 60 秒超时
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
          if (text.includes("'content': [") || text.includes('(Empty response:') || text.includes("'type': 'thinking'")) continue
          // <think> 标签分离：思考→dm_thinking，叙事→dm_text_delta
          const parsed = thinkParser.process(text)
          if (parsed.thinking) yield { type: 'dm_thinking', text: parsed.thinking }
          if (parsed.narrative) {
            yield { type: 'dm_text_delta', text: parsed.narrative }
            fullText += parsed.narrative
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
      if (flushed.narrative) { fullText += flushed.narrative }
      // Post-hoc 清理：streaming 分片可能绕过逐 chunk 过滤
      const emptyIdx = fullText.indexOf('(Empty response:')
      if (emptyIdx !== -1) fullText = fullText.substring(0, emptyIdx)
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
    const trade = consumeTradeProposal()
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
    yield {
      type: 'audio',
      bgm: ambianceOverride?.bgm ?? autoAudio.bgm,
      ambient: autoAudio.ambient,
    }

    // DM 结束 + 场景选项
    const dmActions = consumeActions()
    const actions = dmActions ?? buildFallbackActions(session)
    // 过滤无效选项：不能和昏迷/死亡 NPC 交互
    if (actions.suggestions) {
      const invalidNpcs = session.npcs
        .filter(n => n.condition === 'unconscious' || n.condition === 'recovering')
        .map(n => n.name)
      actions.suggestions = actions.suggestions.filter(s =>
        !invalidNpcs.some(name => s.includes(name) && (s.includes('交谈') || s.includes('对话') || s.includes('聊') || s.includes('问') || s.includes('说')))
      )
    }
    yield {
      type: 'dm_end',
      combat: !!session.combat?.active,
      pendingMonster: !!session.combat?.pendingMonsterTurn,
      actions,
    }

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
        { combatBeat: 'ch2_forest_combat', location: 'twilight-woods', triggerAfterBeat: 'ch2_meet_hunter', maxIdleTurns: 10, monsters: ['Wolf', 'Wolf'] },
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
      delete session.worldState.flags['pending_encounter']
      const monsterNames = pendingEncounter.split(',')
      try {
        const monstersJson = (await import('../data/monsters.json', { with: { type: 'json' } })).default
        const npcCombatJson = (await import('../data/npc-combatants.json', { with: { type: 'json' } })).default
        const allDb = [...monstersJson, ...npcCombatJson]
        const { startCombat: startCombatFn } = await import('./combat-manager.js')
        startCombatFn(session, monsterNames, allDb as any)
        console.log(`[combat] 区域遭遇触发：${monsterNames.join(', ')}`)
        yield { type: 'narrative_warning', text: `⚔️ 遭遇战斗！${monsterNames.join('和')}向你发起攻击！` }
        // Emit combat_init + combat_action_req for structured combat UI
        yield* this.emitCombatStart(`${monsterNames.join('和')}向你发起攻击！`)
        const loc = session.worldState.currentLocation === 'twilight-woods' ? '暮色森林' : session.worldState.currentLocation === 'greyspine-mines' ? '灰脊矿道' : '碎石荒原'
        yield* this.combatDMNarrative(`在${loc}中，${monsterNames.join('和')}突然出现并向玩家发起攻击。请描写战斗开场的紧张氛围。`)
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
        yield { type: 'combat_monster', text: monsterResult.log.join('\n') }
      }
      if (monsterResult.ended) {
        syncNPCConditionAfterCombat(session, combatMonstersSnapshot)
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

    // NPC 档案更新（只有同一位置的 NPC 被提到才解锁，避免车夫提到格雷格就解锁）
    const chapterNum = parseInt((session.chapter?.currentChapter ?? 'ch1').replace(/\D/g, ''), 10) || 1
    const spokeTo = new Set(speakers) // Talk 工具调用的 NPC 一定解锁
    for (const npc of session.npcs) {
      if (input.includes(npc.name) || fullText.includes(npc.name)) {
        // 必须同区域才解锁（Talk 工具调过的除外——那是真正见面了）
        const sameArea = npc.location === session.worldState.currentLocation
        if (sameArea || spokeTo.has(npc.name)) {
          const unlock = this.dossier.unlock(npc.name, session.turnCount, chapterNum)
          if (unlock) yield { type: 'npc_unlock', npcName: npc.name, portrait: NPC_PORTRAITS[npc.name] ?? '', firstFacts: this.dossier.getFirstFacts(npc.name) }
        }
        const update = this.dossier.onInteraction(npc.name, npc.trust, session.turnCount, chapterNum)
        if (update) yield { type: 'npc_update', text: update }
      }
    }

    // 章节推进
    if (session.chapter) {
      new ChapterManager(session).advanceTurn()
    }

    // DM 消息持久化
    session.dmMessages = getDMMessages()

    // 同步
    yield { type: 'sync', session, dossier: this.dossier.toJSON() }

    // 死亡检测
    if (session.player.hp <= 0) {
      session.dossierData = this.dossier.toJSON()
      facts.save('death-save')
      yield { type: 'death' }
      return
    }

    // Game Over 只有一个条件：HP = 0（上面已处理）
    // 全镇敌对不是 Game Over，而是持续的生存压力（NPC 会主动攻击玩家）

    // 自动存档
    this.turnsSinceLastSave++
    if (this.turnsSinceLastSave >= 5) {
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

    // DM 流式响应
    const dmStart = Date.now()
    let fullText = ''
    const toolsCalled: ToolCallRecord[] = []
    try {
      for await (const event of dmRespond(parts.join('\n\n'))) {
        if (event.type === 'thinking_delta') {
          const thinking = (event as any).thinking ?? ''
          if (thinking) yield { type: 'dm_thinking', text: thinking }
        } else if (event.type === 'text_delta') {
          const text = event.text ?? ''
          if (text.includes("'content': [") || text.includes('(Empty response:') || text.includes("'type': 'thinking'")) continue
          yield { type: 'dm_text_delta', text }
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
      const bargainEmptyIdx = fullText.indexOf('(Empty response:')
      if (bargainEmptyIdx !== -1) fullText = fullText.substring(0, bargainEmptyIdx)
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
      actions,
    }

    // 同步
    session.dmMessages = getDMMessages()
    yield { type: 'sync', session, dossier: this.dossier.toJSON() }

    this.turnsSinceLastSave++
    if (this.turnsSinceLastSave >= 5) {
      session.dossierData = this.dossier.toJSON()
      facts.save('autosave')
      this.turnsSinceLastSave = 0
      yield { type: 'auto_save' }
    }
  }

  // ─── 战斗 DM 叙事 ────────────────────────────

  /** 调用 DM 生成 2-3 句战斗场景叙事（开场/结束/逃跑） */
  private async *combatDMNarrative(scene: string): AsyncGenerator<TurnEvent> {
    let fullText = ''
    try {
      for await (const event of dmRespond(
        `[战斗叙事请求] ${scene}\n用2-3句话描写这个场景。不要调用任何工具，不要提及HP/AC/骰子等数值。只输出叙事文字。`
      )) {
        if (event.type === 'text_delta') {
          const text = event.text ?? ''
          if (text.includes('(Empty response:') || text.includes("'type': 'thinking'")) continue
          fullText += text
        }
      }
      const emptyIdx = fullText.indexOf('(Empty response:')
      if (emptyIdx !== -1) fullText = fullText.substring(0, emptyIdx)
      if (fullText.trim()) {
        yield { type: 'combat_narrative', text: fullText.trim() }
      }
    } catch (err) {
      console.error('[combat-dm] 战斗叙事失败:', (err as Error).message?.slice(0, 80))
    } finally {
      consumeActions() // 清空战斗叙事期间 DM 可能残留的 SetActions
    }
  }

  // ─── 战斗初始化事件辅助 ────────────────────

  /** 生成 combat_init + combat_action_req 事件对 */
  private *emitCombatStart(narrative?: string): Generator<TurnEvent> {
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
    yield {
      type: 'combat_init',
      monsters: aliveMonsters.map(m => ({
        id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp,
        portrait: MONSTER_PORTRAITS[m.name] ?? NPC_PORTRAITS[m.name] ?? '',
      })),
      round: combat.round,
      initiative: combat.initiativeOrder,
      narrative,
    }
    yield {
      type: 'combat_action_req',
      targets: aliveMonsters.map(m => ({ id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp })),
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
    const enemyNames = combatMonsters.map(m => m.id).join('、')

    let skipMonsterPhase = false

    // 先攻顺序：敌方先攻 > 玩家 → 每轮怪物先出手
    const playerInit = combat.initiativeOrder.find(e => e.isPlayer)?.initiative ?? 0
    const firstEnemyInit = combat.initiativeOrder.find(e => !e.isPlayer)?.initiative ?? 0
    const enemyGoesFirst = firstEnemyInit > playerInit

    if (enemyGoesFirst) {
      skipMonsterPhase = true  // 怪物已在本轮开头行动，末尾不再重复
      combat.phase = 'monster_turn'
      const monsterResult = executeMonsterPhase(session)

        // 怪物先手叙事
        for (const mhit of monsterResult.hits ?? []) {
          const isNpcAttacker = session.npcs.some(n => n.name === mhit.monsterName)
          const prefix = isNpcAttacker ? 'npc' : 'monster'
          const outcome = mhit.isCritical ? `${prefix}_critical` : mhit.hit ? `${prefix}_hit` : `${prefix}_miss`
          const mNarrative = pickNarrative(outcome as any, { monster: mhit.monsterName })
          if (mNarrative) yield { type: 'combat_narrative', text: mNarrative }
        }
        if (monsterResult.log.length > 0) {
          yield { type: 'combat_monster', text: monsterResult.log.join('\n') }
        }

        // 怪物先手打死玩家
        if (monsterResult.ended && monsterResult.result === 'defeat') {
          combat.phase = 'ended'
          syncNPCConditionAfterCombat(session, combatMonsters)
          yield { type: 'combat_status', text: '战斗失败...', ended: true, result: 'defeat' }
          yield* this.combatDMNarrative(`玩家在与${enemyNames}的战斗中倒下了。描写最后的时刻。`)
          yield { type: 'sync', session, dossier: this.dossier.toJSON() }
          if (session.player.hp <= 0) {
            session.dossierData = this.dossier.toJSON()
            getFacts().save('death-save')
            yield { type: 'death' }
          }
          return
        }
      // 怪物打完，轮到玩家——不 return，继续往下走到 player action
      combat.phase = 'player_turn'
    }

    // Execute player action
    if (action.action === 'flee') {
      const result = attemptFlee(session)
      yield {
        type: 'combat_status',
        text: result.log.join('\n'),
        ended: result.ended,
        result: result.ended ? 'fled' : undefined,
      }
      if (result.ended) {
        // 逃跑成功 → 结束战斗
        combat.phase = 'ended'
        skipMonsterPhase = true
        syncNPCConditionAfterCombat(session, combatMonsters)

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

        yield* this.combatDMNarrative(`玩家从与${enemyNames}的战斗中成功逃脱。描写逃跑的紧迫感和脱离战斗后的喘息。`)
        yield { type: 'sync', session, dossier: this.dossier.toJSON() }
        return
      }
      // 逃跑失败 → 浪费回合，怪物正常回合继续（skipMonsterPhase=false）
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
        const narrative = pickNarrative(narrativeOutcome as any, { target: turnResult.targetName ?? '敌人', weapon: weaponName })
        if (narrative) yield { type: 'combat_narrative', text: narrative }
      }

      // executePlayerTurn already handles victory (endCombat + loot)
      if (turnResult.ended) {
        syncNPCConditionAfterCombat(session, combatMonsters)
        // Combine round log + loot into a single ended message
        const lines = [...turnResult.roundLog]
        if (turnResult.result === 'victory' && turnResult.loot) {
          const { items, gold } = turnResult.loot
          if (items.length || gold) lines.push(`获得: ${items.join(', ')}${gold ? ` + ${gold}金币` : ''}`)
        }
        yield { type: 'combat_status', text: lines.join('\n'), ended: true, result: turnResult.result }
        const isNpcFight = combatMonsters.some(m => session.npcs.some(n => n.name === m.name))
        yield* this.combatDMNarrative(
          turnResult.result === 'victory'
            ? `玩家${isNpcFight ? '击倒' : '击败'}了${enemyNames}。${isNpcFight ? '对方失去意识倒在地上。' : ''}描写战斗胜利后的场景。`
            : `玩家在与${enemyNames}的战斗中倒下了。描写失败的绝望氛围。`
        )
        if (session.chapter) new ChapterManager(session).onEvent('combat_end')
        yield { type: 'sync', session, dossier: this.dossier.toJSON() }
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
      syncNPCConditionAfterCombat(session, combatMonsters)
      endCombat(session)
      yield* this.combatDMNarrative(
        endCheck.result === 'victory'
          ? `玩家击败了${enemyNames}。描写战斗胜利后的场景。`
          : `玩家在与${enemyNames}的战斗中倒下了。描写失败的绝望氛围。`
      )
      if (session.chapter) new ChapterManager(session).onEvent('combat_end')
      yield { type: 'sync', session, dossier: this.dossier.toJSON() }
      if (session.player.hp <= 0) {
        session.dossierData = this.dossier.toJSON()
        getFacts().save('death-save')
        yield { type: 'death' }
      }
      return
    }

    // Monster phase (skip if flee already handled it)
    if (!skipMonsterPhase) {
      combat.phase = 'monster_turn'
      combat.pendingMonsterTurn = false
      const monsterResult = executeMonsterPhase(session)

      // 怪物/NPC 行动叙事
      for (const mhit of monsterResult.hits ?? []) {
        const isNpcAttacker = session.npcs.some(n => n.name === mhit.monsterName)
        const prefix = isNpcAttacker ? 'npc' : 'monster'
        let monsterNarrativeOutcome: string
        if (mhit.isCritical) monsterNarrativeOutcome = `${prefix}_critical`
        else if (mhit.hit) monsterNarrativeOutcome = `${prefix}_hit`
        else monsterNarrativeOutcome = `${prefix}_miss`
        const mNarrative = pickNarrative(monsterNarrativeOutcome as any, { monster: mhit.monsterName })
        if (mNarrative) yield { type: 'combat_narrative', text: mNarrative }
      }

      if (monsterResult.log.length > 0) {
        yield { type: 'combat_monster', text: monsterResult.log.join('\n') }
      }

      // Check end after monster phase
      if (monsterResult.ended) {
        combat.phase = 'ended'
        syncNPCConditionAfterCombat(session, combatMonsters)
        yield {
          type: 'combat_status',
          text: monsterResult.result === 'victory' ? '战斗胜利！' : '战斗失败...',
          ended: true, result: monsterResult.result,
        }
        yield* this.combatDMNarrative(
          monsterResult.result === 'victory'
            ? `玩家击败了${enemyNames}。描写战斗胜利后的场景。`
            : `玩家在与${enemyNames}的战斗中倒下了。描写最后的时刻。`
        )
        if (session.chapter) new ChapterManager(session).onEvent('combat_end')
        // endCombat already called by executeMonsterPhase for defeat
        yield { type: 'sync', session, dossier: this.dossier.toJSON() }
        if (session.player.hp <= 0) {
          session.dossierData = this.dossier.toJSON()
          getFacts().save('death-save')
          yield { type: 'death' }
        }
        return
      }
    }

    // Next round — send updated state for player's next turn
    if (session.combat?.active) {
      const activeCombat = session.combat
      activeCombat.phase = 'player_turn'
      activeCombat.playerDefending = false
      const aliveMonsters = activeCombat.monsters.filter(m => m.hp > 0)
      yield {
        type: 'combat_action_req',
        targets: aliveMonsters.map(m => ({ id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp })),
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

    yield { type: 'sync', session, dossier: this.dossier.toJSON() }

    // Death check
    if (session.player.hp <= 0) {
      session.dossierData = this.dossier.toJSON()
      getFacts().save('death-save')
      yield { type: 'death' }
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
    ].join('\n')

    let fullText = ''
    try {
      for await (const event of dmRespond(prompt)) {
        if (event.type === 'thinking_delta') {
          const thinking = (event as any).thinking ?? ''
          if (thinking) yield { type: 'dm_thinking', text: thinking }
        } else if (event.type === 'text_delta') {
          const text = event.text ?? ''
          // 过滤 SDK bug：thinking-only 响应
          if (text.includes("'content': [") || text.includes('(Empty response:') || text.includes("'type': 'thinking'")) continue
          yield { type: 'dm_text_delta', text }
          fullText += text
        }
      }
      const openEmptyIdx = fullText.indexOf('(Empty response:')
      if (openEmptyIdx !== -1) fullText = fullText.substring(0, openEmptyIdx)
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

    const actions = consumeActions() ?? buildFallbackActions(session)
    yield { type: 'dm_end', combat: false, pendingMonster: false, actions }

    // 开场 NPC 解锁（只有同区域的 NPC 才解锁——车夫提到格雷格不算见面）
    const openChapterNum = parseInt((session.chapter?.currentChapter ?? 'ch1').replace(/\D/g, ''), 10) || 1
    for (const npc of session.npcs) {
      if (fullText.includes(npc.name) && npc.location === session.worldState.currentLocation) {
        const notice = this.dossier.unlock(npc.name, 0, openChapterNum)
        if (notice) yield { type: 'npc_unlock', npcName: npc.name, portrait: NPC_PORTRAITS[npc.name] ?? '', firstFacts: this.dossier.getFirstFacts(npc.name) }
      }
    }

    session.dmMessages = getDMMessages()
    yield { type: 'sync', session, dossier: this.dossier.toJSON() }
  }

  // ─── 工具方法 ────────────────────────────

  getPrologue(): string {
    return renderPrologue()
  }

  getWorldGuide(): string {
    return renderWorldGuide()
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
    }

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
