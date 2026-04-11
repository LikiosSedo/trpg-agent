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
