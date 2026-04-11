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
  id: string            // 唯一标识（用于追踪是否已显示）
  npc: string           // NPC 名
  monster: string       // 怪物名
  minTrust: number      // 信任度阈值
  minChapter: number    // 章节门控
  hintText: string      // 氛围暗示文本（玩家看到的）
}

/** 暗示定义——每条都是一段沉浸式的环境观察，暗示某个 NPC 了解某种怪物 */
export const BESTIARY_HINTS: BestiaryHint[] = [
  // ─── Ch2 蛛母 ───
  {
    id: 'hint_yelu_spider',
    npc: '叶绿', monster: 'Spider Matriarch', minTrust: 2, minChapter: 2,
    hintText: '你注意到叶绿在调配药剂时，手边多了几瓶橙红色的油脂。她低头自语："蛛丝的颜色不对……完全不对……"',
  },
  {
    id: 'hint_greg_spider',
    npc: '格雷格', monster: 'Spider Matriarch', minTrust: 1, minChapter: 2,
    hintText: '格雷格把一把旧战锤放在吧台上擦拭，看着窗外暮色森林的方向叹了口气。"那些蜘蛛越来越不对劲了，"他嘟囔着。',
  },
  {
    id: 'hint_hanmeng_spider',
    npc: '韩猛', monster: 'Spider Matriarch', minTrust: 2, minChapter: 2,
    hintText: '韩猛在公会任务板前皱着眉，独臂在一份报告上重重画了个圈。"这个月去暮色森林的三支队伍都折了人，不正常。"',
  },
  {
    id: 'hint_xiaoli_spider',
    npc: '小莉', monster: 'Spider Matriarch', minTrust: 0, minChapter: 2,
    hintText: '小莉突然抓住你的衣角，眼神空洞地望向远方："紫色的丝线……好多好多……连着地底下什么很可怕的东西……"',
  },

  // ─── Ch3 暗影编织者 ───
  {
    id: 'hint_grom_shadow',
    npc: '格罗姆', monster: 'Shadow Weaver', minTrust: 3, minChapter: 3,
    hintText: '格罗姆在工作台上反复打磨一块泛着银光的矿石，神色凝重。"矿道下面有些东西……"他低声自语，"不是铁能对付的。"',
  },
  {
    id: 'hint_elena_shadow',
    npc: '艾琳娜', monster: 'Shadow Weaver', minTrust: 4, minChapter: 3,
    hintText: '你经过公会书房时，看到艾琳娜在翻阅一本古旧的典籍，书页上绘有光芒刺穿黑暗的图案。她翻页的手微微颤抖。',
  },
  {
    id: 'hint_xiaoli_shadow',
    npc: '小莉', monster: 'Shadow Weaver', minTrust: 0, minChapter: 3,
    hintText: '小莉蹲在墙角画着什么，走近看是一团漆黑中浮着两个微弱的光点。"它在矿道下面等着呢，"她平静地说，"吃了好多人的灵魂。"',
  },

  // ─── Ch4 蚀日兽 ───
  {
    id: 'hint_elena_eclipsed',
    npc: '艾琳娜', monster: 'Eclipsed Beast', minTrust: 6, minChapter: 4,
    hintText: '艾琳娜独自站在公会大厅的窗前，望向碎石荒原的方向。你从未见过她眼中有这样的神色——像是三百年前某段记忆被唤醒的痛楚。"它醒了，"她轻声说，"那个不该存在的东西。"',
  },
  {
    id: 'hint_xiaoli_eclipsed',
    npc: '小莉', monster: 'Eclipsed Beast', minTrust: 4, minChapter: 4,
    hintText: '小莉面色苍白地望着远方，紧紧抱着自己。"那个东西……不是活的……是虚空在呼吸……但我看到了光……一把发光的锤子……"',
  },
  {
    id: 'hint_hanmeng_eclipsed',
    npc: '韩猛', monster: 'Eclipsed Beast', minTrust: 3, minChapter: 4,
    hintText: '韩猛把一份侦察报告拍在桌上，脸色铁青。"碎石荒原的最后一支侦察队——五个人去，两个回来。那两个到现在还不敢开口说话。"',
  },
]

/**
 * 检查当前回合是否有新的暗示可以触发
 * 返回本回合应该显示的暗示列表（已过滤掉已显示的）
 */
export function checkAvailableHints(session: GameSession): BestiaryHint[] {
  const currentChapter = parseInt(session.chapter?.currentChapter?.replace('ch', '') ?? '1')
  const shownHints: string[] = (session.worldState.flags['shown_bestiary_hints'] as string || '').split(',').filter(Boolean)

  const available: BestiaryHint[] = []

  for (const hint of BESTIARY_HINTS) {
    // 已显示过
    if (shownHints.includes(hint.id)) continue
    // 章节门控
    if (currentChapter < hint.minChapter) continue
    // 信任度门控
    const npc = session.npcs.find(n => n.name === hint.npc)
    if (!npc || npc.trust < hint.minTrust) continue
    // 如果这个怪物的弱点已经完全已知，不再暗示
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
