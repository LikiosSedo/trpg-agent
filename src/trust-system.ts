/**
 * 信任系统 — 所有信任变化的中央管理
 *
 * 多通道信任变化 + 关系网连坐 + 梯度响应 + 承诺追踪
 */

import type { NPC, GameSession, TrustThresholds } from './types.js'
import { getPersonality, type NPCPersonality } from './npc-relationships.js'

// ─── 事件类型 ──────────────────────────────

export type TrustChannel =
  | 'dialogue' | 'action' | 'promise' | 'witness'
  | 'reputation' | 'quest' | 'gift' | 'combat'

export interface TrustChangeEvent {
  npcName: string
  channel: TrustChannel
  delta: number
  reason: string
  turn: number
  /** 永久仇恨标签（如 'harm_小莉'） */
  grudgeTag?: string
}

export type NPCResponseType = 'normal' | 'curt' | 'hostile_dialogue' | 'avoidance' | 'combat_trigger'

export interface NPCResponse {
  type: NPCResponseType
  description: string
  combatResponse?: string
  moveAway?: boolean
}

export interface TrustChangeResult {
  applied: boolean
  reason?: string
  oldTrust?: number
  newTrust?: number
  response?: NPCResponse
}

// ─── 核心函数 ──────────────────────────────

/**
 * 修改 NPC 信任度。所有信任变化必须通过此函数。
 * 自动处理：夹紧范围、永久仇恨、关系网连坐、反垃圾恢复。
 */
export function changeTrust(session: GameSession, event: TrustChangeEvent): TrustChangeResult {
  const npc = session.npcs.find(n => n.name === event.npcName)
  if (!npc) return { applied: false, reason: `NPC "${event.npcName}" 不存在` }

  const personality = getPersonality(npc.name)

  // 永久仇恨检查
  if (event.grudgeTag && personality.permanentGrudges.includes(event.grudgeTag)) {
    npc.permanentGrudge = true
    npc.trust = -10
    // 连坐
    if (event.channel !== 'reputation') {
      cascadeReputation(session, npc.name, event)
    }
    return { applied: true, oldTrust: npc.trust, newTrust: -10, response: evaluateResponse(npc) }
  }

  // 永久仇恨后不可恢复
  if (npc.permanentGrudge && event.delta > 0) {
    return { applied: false, reason: `${npc.name}永远不会原谅你` }
  }

  // 反垃圾恢复：负信任时，3轮内最多恢复1次
  if (event.delta > 0 && npc.trust < -2 && event.channel !== 'quest') {
    const recentPositive = (npc.interactionLog ?? [])
      .filter(l => l.includes('信任+'))
    // 简单限制：gift 通道在负信任时需要有价值的礼物（由调用方判断）
    if (event.channel === 'gift' && event.delta <= 1) {
      return { applied: false, reason: `${npc.name}冷冷地推开了你的小恩小惠` }
    }
  }

  // 应用变化
  const oldTrust = npc.trust
  npc.trust = Math.max(-10, Math.min(10, npc.trust + event.delta))

  // 关系网连坐（非连坐来源才触发，避免递归）
  if (event.channel !== 'reputation') {
    cascadeReputation(session, npc.name, event)
  }

  return {
    applied: true,
    oldTrust,
    newTrust: npc.trust,
    response: evaluateResponse(npc),
  }
}

// ─── 梯度响应 ──────────────────────────────

/** 根据当前信任度评估 NPC 的反应类型 */
export function evaluateResponse(npc: NPC): NPCResponse {
  const personality = getPersonality(npc.name)
  const t = npc.trust

  if (t <= personality.thresholds.combat && personality.canFight) {
    return {
      type: 'combat_trigger',
      description: getCombatDesc(npc.name, personality.combatResponse),
      combatResponse: personality.combatResponse,
    }
  }

  if (t <= personality.thresholds.avoidance) {
    return {
      type: 'avoidance',
      description: `${npc.name}看到你立刻转身离开，不愿和你有任何接触。`,
      moveAway: true,
    }
  }

  if (t <= personality.thresholds.hostile) {
    return {
      type: 'hostile_dialogue',
      description: `${npc.name}对你充满敌意，但仍会回应——态度极其恶劣。`,
    }
  }

  if (t <= personality.thresholds.curt) {
    return {
      type: 'curt',
      description: `${npc.name}对你很冷淡，只给最简短的回答。`,
    }
  }

  return { type: 'normal', description: '' }
}

/** 获取 NPC 对话时应注入的态度指令（供 Talk 工具使用） */
export function getAttitudeDirective(npc: NPC): string {
  const response = evaluateResponse(npc)
  switch (response.type) {
    case 'curt':
      return `[NPC态度：冷淡。${npc.name}只给最简短的回答，不主动提供信息。]`
    case 'hostile_dialogue':
      return `[NPC态度：敌对。${npc.name}充满恶意地回应，可能威胁、嘲讽或驱赶玩家。不会透露有用信息。但仍会对话——玩家可以尝试社交检定改善关系。]`
    default:
      return ''
  }
}

// ─── 信息门控 ──────────────────────────────

/** 根据信任度决定 NPC 可以透露多少 knownFacts */
export function getGatedFacts(npc: NPC): string[] {
  if (npc.trust >= 5) return npc.knownFacts
  if (npc.trust >= 3) return npc.knownFacts
  if (npc.trust >= 1) return npc.knownFacts.slice(0, Math.min(3, npc.knownFacts.length))
  if (npc.trust >= 0) return npc.knownFacts.slice(0, 1)
  return []
}

// ─── 承诺追踪 ──────────────────────────────

/** 每轮检查是否有过期未兑现的承诺 */
export function checkBrokenPromises(session: GameSession): TrustChangeEvent[] {
  const events: TrustChangeEvent[] = []
  for (const npc of session.npcs) {
    if (!npc.trackedPromises) continue
    for (const p of npc.trackedPromises) {
      if (p.fulfilled) continue
      if (session.turnCount >= p.deadlineTurn) {
        p.fulfilled = true  // 标记为已检查（虽然未兑现）
        events.push({
          npcName: npc.name,
          channel: 'promise',
          delta: -2,
          reason: `未兑现承诺："${p.text}"`,
          turn: session.turnCount,
        })
      }
    }
  }
  return events
}

// ─── 内部函数 ──────────────────────────────

function cascadeReputation(session: GameSession, sourceNpc: string, event: TrustChangeEvent): void {
  const personality = getPersonality(sourceNpc)
  for (const bond of personality.bonds) {
    const cascadeDelta = Math.round(event.delta * bond.weight)
    if (cascadeDelta === 0) continue
    changeTrust(session, {
      npcName: bond.npcName,
      channel: 'reputation',
      delta: cascadeDelta,
      reason: `${sourceNpc}${event.delta < 0 ? '对你不满' : '因你好感增加'}`,
      turn: event.turn,
      grudgeTag: event.grudgeTag,
    })
  }
}

function getCombatDesc(name: string, response: string): string {
  switch (response) {
    case 'fight': return `${name}拔出武器，准备战斗！`
    case 'call_guards': return `${name}大喊："来人！把这个混蛋抓起来！"`
    case 'flee': return `${name}惊恐地逃走了。`
    case 'plot_revenge': return `${name}面无表情地看着你，眼中闪过一丝寒意。`
    case 'ban_from_location': return `${name}指着门："出去！永远别再进来！"`
    default: return `${name}变得极度敌对。`
  }
}
