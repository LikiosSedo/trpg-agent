/**
 * 队伍管理 — 战斗型 NPC 同伴招募/解散/校验
 */

import type { GameSession } from './types.js'
import { getPersonality } from './npc-relationships.js'

const MAX_PARTY_SIZE = 2
const RECRUIT_TRUST_THRESHOLD = 5

// ─── 校验是否可招募 ──────────────────────────────

export function canRecruit(
  session: GameSession,
  npcName: string,
): { ok: boolean; reason?: string } {
  const npc = session.npcs.find(n => n.name === npcName)
  if (!npc) return { ok: false, reason: `${npcName} 不存在` }

  const personality = getPersonality(npcName)
  if (!personality.canFight) return { ok: false, reason: `${npcName} 不具备战斗能力` }

  if (npc.trust < RECRUIT_TRUST_THRESHOLD) {
    return { ok: false, reason: `${npcName} 的信任度不够（需要 ${RECRUIT_TRUST_THRESHOLD}+，当前 ${npc.trust}）` }
  }

  if (npc.location !== session.worldState.currentLocation) {
    return { ok: false, reason: `${npcName} 不在当前地点` }
  }

  if (npc.condition === 'unconscious' || npc.condition === 'recovering') {
    return { ok: false, reason: `${npcName} 当前状态无法战斗（${npc.condition}）` }
  }

  if (npc.permanentGrudge) {
    return { ok: false, reason: `${npcName} 对玩家怀有不可挽回的敌意` }
  }

  const party = session.party ?? []
  if (party.includes(npcName)) return { ok: false, reason: `${npcName} 已在队伍中` }
  if (party.length >= MAX_PARTY_SIZE) return { ok: false, reason: `队伍已满（最多 ${MAX_PARTY_SIZE} 人）` }

  return { ok: true }
}

// ─── 招募 ────────────────────────────────────────

export function recruitAlly(
  session: GameSession,
  npcName: string,
): { ok: boolean; reason?: string } {
  const check = canRecruit(session, npcName)
  if (!check.ok) return check

  if (!session.party) session.party = []
  session.party.push(npcName)
  return { ok: true }
}

// ─── 解散 ────────────────────────────────────────

export function dismissAlly(session: GameSession, npcName: string): boolean {
  if (!session.party) return false
  const idx = session.party.indexOf(npcName)
  if (idx === -1) return false
  session.party.splice(idx, 1)
  return true
}

// ─── 队伍校验（每轮清理不合格成员）─────────────────

export function validateParty(session: GameSession): string[] {
  if (!session.party || session.party.length === 0) return []
  const removed: string[] = []

  session.party = session.party.filter(name => {
    const npc = session.npcs.find(n => n.name === name)
    if (!npc) { removed.push(name); return false }
    if (npc.condition === 'unconscious' || npc.condition === 'recovering') { removed.push(name); return false }
    if (npc.trust < RECRUIT_TRUST_THRESHOLD) { removed.push(name); return false }
    if (npc.permanentGrudge) { removed.push(name); return false }
    return true
  })

  return removed
}

// ─── 查询 ────────────────────────────────────────

export function isInParty(session: GameSession, npcName: string): boolean {
  return (session.party ?? []).includes(npcName)
}
