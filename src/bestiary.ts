/**
 * bestiary.ts — 怪物图鉴系统
 *
 * 追踪玩家对每种怪物的了解程度。
 * 弱点情报通过 NPC 对话、位置探索、技能检定、战斗试错 逐步解锁。
 */

import type { GameSession, BestiaryEntry, Monster, DamageType } from './types.js'

// ─── 图鉴初始化 ───────────────────────────────────

/** 确保 session.player.bestiary 存在 */
export function ensureBestiary(session: GameSession): Record<string, BestiaryEntry> {
  if (!session.player.bestiary) {
    session.player.bestiary = {}
  }
  return session.player.bestiary
}

/** 获取或创建某怪物的图鉴条目 */
function getOrCreateEntry(session: GameSession, monsterName: string): BestiaryEntry {
  const bestiary = ensureBestiary(session)
  if (!bestiary[monsterName]) {
    bestiary[monsterName] = {
      encountered: false,
      weaknessKnown: false,
      resistanceKnown: false,
      immunityKnown: false,
      notes: [],
    }
  }
  return bestiary[monsterName]
}

// ─── 图鉴更新 ───────────────────────────────────

/** 记录遭遇怪物（战斗开始时调用） */
export function markEncountered(session: GameSession, monsterName: string): void {
  const entry = getOrCreateEntry(session, monsterName)
  entry.encountered = true
}

/** 通过 NPC 情报 / 位置搜索 / 技能检定 解锁弱点知识 */
export function discoverWeakness(session: GameSession, monsterName: string, source: string): string | null {
  const entry = getOrCreateEntry(session, monsterName)
  if (entry.weaknessKnown) return null // 已知
  entry.weaknessKnown = true
  const note = `弱点情报来源: ${source}`
  if (!entry.notes.includes(note)) entry.notes.push(note)
  return note
}

/** 解锁抗性知识 */
export function discoverResistance(session: GameSession, monsterName: string, source: string): string | null {
  const entry = getOrCreateEntry(session, monsterName)
  if (entry.resistanceKnown) return null
  entry.resistanceKnown = true
  const note = `抗性情报来源: ${source}`
  if (!entry.notes.includes(note)) entry.notes.push(note)
  return note
}

/** 解锁免疫知识（战斗中打了没用时自动触发） */
export function discoverImmunity(session: GameSession, monsterName: string, source: string): string | null {
  const entry = getOrCreateEntry(session, monsterName)
  if (entry.immunityKnown) return null
  entry.immunityKnown = true
  const note = `免疫情报来源: ${source}`
  if (!entry.notes.includes(note)) entry.notes.push(note)
  return note
}

/** 添加自由情报笔记 */
export function addBestiaryNote(session: GameSession, monsterName: string, note: string): void {
  const entry = getOrCreateEntry(session, monsterName)
  if (!entry.notes.includes(note)) {
    entry.notes.push(note)
  }
}

// ─── 图鉴查询 ───────────────────────────────────

/** 获取已知的图鉴条目数 */
export function getKnownCount(session: GameSession): number {
  const bestiary = ensureBestiary(session)
  return Object.values(bestiary).filter(e => e.encountered).length
}

/** 获取弱点已知数 */
export function getWeaknessKnownCount(session: GameSession): number {
  const bestiary = ensureBestiary(session)
  return Object.values(bestiary).filter(e => e.weaknessKnown).length
}

/** 图鉴等级 → 全局被动加成 */
export function getBestiaryBonuses(session: GameSession): {
  showMonsterHpPercent: boolean    // 战斗中显示怪物 HP%
  autoIdentify: boolean            // 首回合自动识别已知怪物弱点
  enhancedVulnerability: boolean   // 弱点伤害 ×2.5（而非 ×2）
  initiativeBonus: number          // 先攻加值
} {
  const count = getWeaknessKnownCount(session)
  return {
    showMonsterHpPercent: count >= 3,
    autoIdentify: count >= 5,
    enhancedVulnerability: count >= 8,
    initiativeBonus: count >= 11 ? 3 : 0,  // 全部怪物弱点已知
  }
}

/** 生成图鉴摘要（给前端/DM 用） */
export function getBestiarySummary(session: GameSession, monstersDb: Monster[]): string[] {
  const bestiary = ensureBestiary(session)
  const lines: string[] = []

  for (const monster of monstersDb) {
    const entry = bestiary[monster.name]
    if (!entry?.encountered) continue

    const parts = [`📖 ${monster.nameZh || monster.name}`]

    if (entry.weaknessKnown && monster.vulnerability?.length) {
      parts.push(`弱点: ${monster.vulnerability.join(', ')}`)
    }
    if (entry.resistanceKnown && monster.resistance?.length) {
      parts.push(`抗性: ${monster.resistance.join(', ')}`)
    }
    if (entry.immunityKnown && monster.immunity?.length) {
      parts.push(`免疫: ${monster.immunity.join(', ')}`)
    }
    if (!entry.weaknessKnown && !entry.resistanceKnown && !entry.immunityKnown) {
      parts.push('(未知特性)')
    }

    lines.push(parts.join(' | '))
  }

  if (lines.length === 0) {
    lines.push('图鉴为空 — 尚未遭遇任何怪物')
  }

  return lines
}

/**
 * 提取玩家已发现的战斗相关特性，用于注入战斗叙事 DM prompt。
 * 只返回已解锁的信息（weaknessKnown/resistanceKnown/immunityKnown）。
 *
 * 示例：玩家通过对话得知哥布林怕火 → 战斗叙事时 DM 看到
 *   "哥布林（你记得：怕火）"
 * 并可自然地在开场描写里 callback 这个记忆。
 *
 * @returns 一段简短的中文描述，无已知信息时返回空字符串
 */
export function getKnownCombatTraits(
  session: GameSession,
  monsterName: string,
  monstersDb: Monster[],
): string {
  const bestiary = session.player.bestiary
  if (!bestiary) return ''
  const entry = bestiary[monsterName]
  if (!entry?.encountered) return ''

  const template = monstersDb.find(m => m.name === monsterName)
  if (!template) return ''

  const parts: string[] = []
  if (entry.weaknessKnown && template.vulnerability?.length) {
    parts.push(`怕${template.vulnerability.join('/')}`)
  }
  if (entry.resistanceKnown && template.resistance?.length) {
    parts.push(`抗${template.resistance.join('/')}`)
  }
  if (entry.immunityKnown && template.immunity?.length) {
    parts.push(`免疫${template.immunity.join('/')}`)
  }
  return parts.join('，')
}

/**
 * 构造战斗上下文中"对手:"一行的敌人描述。
 * 逐个活着的敌人拼接：中文名 + 受伤状态 + （已发现的）战斗特性。
 *
 * @param alive 活着的敌人（combat.monsters.filter(m => m.hp > 0)）
 * @param session 供读取 bestiary
 * @param monstersDb 战斗体数据库（monsters + npc-combatants）
 * @param localize 外部提供的名称本地化函数（engine 注入 localize）
 */
export function formatEnemyDescForPrompt(
  alive: Array<{ name: string; hp: number; maxHp: number }>,
  session: GameSession,
  monstersDb: Monster[],
  localize: (name: string) => string,
): string {
  return alive.map(m => {
    const ePct = Math.round((m.hp / m.maxHp) * 100)
    const eState = ePct > 60 ? '' : ePct > 25 ? '（已受伤）' : '（重伤）'
    const traits = getKnownCombatTraits(session, m.name, monstersDb)
    const traitsStr = traits ? `（你记得：${traits}）` : ''
    return `${localize(m.name)}${eState}${traitsStr}`
  }).join('、')
}

/**
 * 检查 NPC 是否能提供某怪物的情报
 * 返回可解锁的知识类型，或 null（NPC 不知道/信任不够）
 */
export function checkNPCCanReveal(
  monster: Monster,
  npcName: string,
  npcTrust: number,
): { canReveal: boolean; hint?: string } {
  const hints = monster.discoveryHints
  if (!hints?.npc || hints.npc !== npcName) {
    return { canReveal: false }
  }
  if (npcTrust < (hints.npcMinTrust ?? 0)) {
    return { canReveal: false, hint: `${npcName}似乎知道些什么，但还不够信任你` }
  }
  return { canReveal: true }
}

// ─── 沉浸式暗示系统 ──────────────────────────────

export interface BestiaryHint {
  id: string
  npc: string
  monster: string
  minTrust: number
  minChapter: number
  triggerLocation: string   // 进入哪个区域时触发
  hintText: string          // 回忆体文案
}

/**
 * 暗示定义 —— 回忆体：当玩家踏入相关区域时，回想起 NPC 说过的话。
 * 叙事逻辑：冒险者进入危险地带，自然会回忆之前收集到的情报。
 */
export const BESTIARY_HINTS: BestiaryHint[] = [
  // ─── 踏入暮色森林 → 回忆关于蛛母的警告 ───
  {
    id: 'hint_greg_spider',
    npc: '格雷格', monster: 'Spider Matriarch', minTrust: 1, minChapter: 2,
    triggerLocation: 'twilight-woods',
    hintText: '格雷格的话在耳边回响：「那些蜘蛛越来越不对劲了。」他擦拭旧战锤时望向森林的叹息，此刻有了分量。',
  },
  {
    id: 'hint_yelu_spider',
    npc: '叶绿', monster: 'Spider Matriarch', minTrust: 2, minChapter: 2,
    triggerLocation: 'twilight-woods',
    hintText: '你想起叶绿药架上那几瓶橙红色的油脂，和她低头时的自语——「蛛丝的颜色不对……完全不对……」也许该回去问问她。',
  },
  {
    id: 'hint_hanmeng_spider',
    npc: '韩猛', monster: 'Spider Matriarch', minTrust: 2, minChapter: 2,
    triggerLocation: 'twilight-woods',
    hintText: '韩猛的警告浮上心头：「这个月去暮色森林的三支队伍都折了人。」他在任务板上画圈时的铁青脸色，你至今记得。',
  },
  {
    id: 'hint_xiaoli_spider',
    npc: '小莉', monster: 'Spider Matriarch', minTrust: 0, minChapter: 2,
    triggerLocation: 'twilight-woods',
    hintText: '脑海中闪过小莉空洞的眼神——「紫色的丝线……好多好多……连着地底下什么很可怕的东西……」她看到了什么？',
  },

  // ─── 踏入灰脊矿道 → 回忆关于暗影编织者的线索 ───
  {
    id: 'hint_grom_shadow',
    npc: '格罗姆', monster: 'Shadow Weaver', minTrust: 3, minChapter: 3,
    triggerLocation: 'greyspine-mines',
    hintText: '踏入矿道时，格罗姆的话浮上心头：「矿道下面有些东西……不是铁能对付的。」他打磨灵银矿石时的凝重神色，此刻格外清晰。',
  },
  {
    id: 'hint_elena_shadow',
    npc: '艾琳娜', monster: 'Shadow Weaver', minTrust: 4, minChapter: 3,
    triggerLocation: 'greyspine-mines',
    hintText: '艾琳娜翻阅古籍时颤抖的手指浮现在眼前——书页上光芒刺穿黑暗的图案。她似乎知道矿道下面潜伏着什么。',
  },
  {
    id: 'hint_xiaoli_shadow',
    npc: '小莉', monster: 'Shadow Weaver', minTrust: 0, minChapter: 3,
    triggerLocation: 'greyspine-mines',
    hintText: '脑海中闪过小莉画的那幅画——漆黑中浮着两个微弱的光点。「它在矿道下面等着呢，吃了好多人的灵魂。」',
  },

  // ─── 踏入碎石荒原 → 回忆关于蚀日兽的预警 ───
  {
    id: 'hint_elena_eclipsed',
    npc: '艾琳娜', monster: 'Eclipsed Beast', minTrust: 6, minChapter: 4,
    triggerLocation: 'shatterstone-wastes',
    hintText: '艾琳娜站在窗前望向荒原的身影浮现在眼前。「它醒了，那个不该存在的东西。」三百年前的记忆被唤醒时的神色，让你不寒而栗。',
  },
  {
    id: 'hint_xiaoli_eclipsed',
    npc: '小莉', monster: 'Eclipsed Beast', minTrust: 4, minChapter: 4,
    triggerLocation: 'shatterstone-wastes',
    hintText: '小莉苍白的面容在脑海中闪过——「那个东西……不是活的……是虚空在呼吸……但我看到了光……一把发光的锤子……」',
  },
  {
    id: 'hint_hanmeng_eclipsed',
    npc: '韩猛', monster: 'Eclipsed Beast', minTrust: 3, minChapter: 4,
    triggerLocation: 'shatterstone-wastes',
    hintText: '韩猛拍桌时的铁青脸色浮上心头：「五个人去，两个回来。那两个到现在还不敢开口说话。」',
  },
]

/**
 * 检查当前回合是否有新的暗示可以触发
 * 核心逻辑：只在玩家**当前所在区域**匹配暗示的 triggerLocation 时才触发
 */
export function checkAvailableHints(session: GameSession): BestiaryHint[] {
  const currentChapter = parseInt(session.chapter?.currentChapter?.replace('ch', '') ?? '1')
  const currentLocation = session.worldState.currentLocation
  const shownHints: string[] = (session.worldState.flags['shown_bestiary_hints'] as string || '').split(',').filter(Boolean)

  const available: BestiaryHint[] = []

  for (const hint of BESTIARY_HINTS) {
    if (shownHints.includes(hint.id)) continue
    // 区域匹配：只在相关区域触发
    if (hint.triggerLocation !== currentLocation) continue
    if (currentChapter < hint.minChapter) continue
    const npc = session.npcs.find(n => n.name === hint.npc)
    if (!npc || npc.trust < hint.minTrust) continue
    const bestiary = session.player.bestiary?.[hint.monster]
    if (bestiary?.weaknessKnown && bestiary?.resistanceKnown && bestiary?.immunityKnown) continue

    available.push(hint)
  }

  return available
}

/**
 * 标记暗示已显示
 */
export function markHintShown(session: GameSession, hintId: string): void {
  const current = (session.worldState.flags['shown_bestiary_hints'] as string || '')
  const shown = current.split(',').filter(Boolean)
  if (!shown.includes(hintId)) {
    shown.push(hintId)
    session.worldState.flags['shown_bestiary_hints'] = shown.join(',')
  }
}
