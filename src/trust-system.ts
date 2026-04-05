/**
 * 信任系统 — 所有信任变化的中央管理
 *
 * 多通道信任变化 + 关系网连坐 + 梯度响应 + 承诺追踪
 */

import type { NPC, GameSession, TrustThresholds, NPCFact } from './types.js'
import { getPersonality, type NPCPersonality } from './npc-relationships.js'

/** 从 session.chapter.currentChapter（如 'ch2'）提取章节数字，默认1 */
function getChapterNum(session: GameSession): number {
  const id = session.chapter?.currentChapter ?? 'ch1'
  return parseInt(id.replace(/\D/g, ''), 10) || 1
}

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

  // 章节信任软上限：超过上限后增长衰减为 1/3（向下取整，可能为0）
  let effectiveDelta = event.delta
  if (event.delta > 0) {
    const chapterNum = getChapterNum(session)
    const ceiling = personality.trustCeiling[chapterNum] ?? 10
    if (npc.trust >= ceiling) {
      // 已在天花板以上：大幅衰减
      effectiveDelta = Math.floor(event.delta / 3)
    }
  }

  // 应用变化
  const oldTrust = npc.trust
  npc.trust = Math.max(-10, Math.min(10, npc.trust + effectiveDelta))

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
  const t = npc.trust

  // 负面态度（从重到轻）
  if (response.type === 'avoidance') {
    return `[NPC态度：回避（trust ${t}）。${npc.name}看到你立刻转身离开，不愿有任何接触。如果被拦住，会惊恐或愤怒地要求你离开。]`
  }
  if (response.type === 'hostile_dialogue') {
    return `[NPC态度：敌对（trust ${t}）。${npc.name}充满恶意，可能威胁、嘲讽或驱赶你。不会透露有用信息，但仍会对话——玩家可尝试社交检定改善关系。]`
  }
  if (response.type === 'curt') {
    return `[NPC态度：冷淡（trust ${t}）。${npc.name}只给最简短回答，不主动提供信息。语气生硬，明显不想多说。]`
  }

  // 正面态度（根据信任度细分）
  if (t >= 7) {
    return `[NPC态度：深厚信任（trust ${t}）。${npc.name}视你为密友或家人，愿意分享核心秘密、提供无条件帮助。会主动关心你的安危，在危机时刻挺身而出。]`
  }
  if (t >= 5) {
    return `[NPC态度：信任（trust ${t}）。${npc.name}认可你的人品，愿意透露重要信息、提供实质帮助。会为你说好话，但不会冒生命危险。]`
  }
  if (t >= 3) {
    return `[NPC态度：友好（trust ${t}）。${npc.name}对你有好感，愿意深入交流、提供一般帮助。会给你优惠或方便，但不会违反原则。]`
  }
  if (t >= 1) {
    return `[NPC态度：礼貌（trust ${t}）。${npc.name}对你有基本好感，愿意正常交流。会按职业规范提供服务，但不会特别照顾。]`
  }

  // 中立（trust = 0）
  return `[NPC态度：中立（trust ${t}）。${npc.name}保持礼貌但有距离，按职业规范行事。不会主动提供额外信息或帮助。]`
}

// ─── 信息门控 ──────────────────────────────

/** 双重门控：章节 + 信任度
 *
 * 第一层：章节门控 — NPC 只"知道"当前章节已解锁的情报
 *   每条 NPCFact 有 minChapter，章节 < minChapter 时 NPC 还不知道这件事。
 *
 * 第二层：信任度门控 — NPC 愿意透露多少已知情报（五档）
 *   负值:   不透露任何情报
 *   0:      第1档 — 基本印象（前2条）
 *   1~2:    第2档 — 表面了解（前4条）
 *   3~4:    第3档 — 深入了解（前6条）
 *   5~6:    第4档 — 核心秘密（前8条）
 *   7~10:   第5档 — 全部情报
 *
 * 返回纯文本数组，供 DM prompt 直接使用。
 */
export function getGatedFacts(npc: NPC, session?: GameSession): string[] {
  const chapterNum = session ? getChapterNum(session) : 4  // 无 session 时不限制章节
  const t = npc.trust

  // 第一层：章节门控 — 过滤掉 NPC 还不知道的情报
  const knownThisChapter = npc.knownFacts.filter(f =>
    typeof f === 'string' ? true : f.minChapter <= chapterNum
  )

  // 提取纯文本
  const texts = knownThisChapter.map(f => typeof f === 'string' ? f : f.text)

  // 第二层：信任度门控
  if (t >= 7) return texts
  if (t >= 5) return texts.slice(0, Math.min(8, texts.length))
  if (t >= 3) return texts.slice(0, Math.min(6, texts.length))
  if (t >= 1) return texts.slice(0, Math.min(4, texts.length))
  if (t >= 0) return texts.slice(0, Math.min(2, texts.length))
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
  // Bond 连坐只传播负面信任（惩罚机制）
  // 正面信任不传播：和叶绿关系好不代表格雷格自动喜欢你
  if (event.delta >= 0) return

  const personality = getPersonality(sourceNpc)
  for (const bond of personality.bonds) {
    const cascadeDelta = Math.round(event.delta * bond.weight)
    if (cascadeDelta === 0) continue
    changeTrust(session, {
      npcName: bond.npcName,
      channel: 'reputation',
      delta: cascadeDelta,
      reason: `${sourceNpc}对你不满`,
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

// ─── 暴力后果信任度传播 ──────────────────────────────

export interface ViolenceTrustCascadeResult {
  changes: Array<{ npcName: string; delta: number; reason: string }>
  summary: string
}

/**
 * 暴力后果的全镇信任度传播
 *
 * 触发时机：violence_alert 延迟轮次到达，响应者到达现场时
 *
 * 传播规则：
 * - 受害者的亲近 NPC（bond weight >= 0.5）：-8 到 -10
 * - 响应者的亲近 NPC（bond weight >= 0.5）：-5 到 -7
 * - 目击者（在场但未参与的 NPC）：-5 到 -7
 * - 其他镇民（不在场，通过流言传播）：-3 到 -5
 *
 * @param session 游戏会话
 * @param victim 受害者名称
 * @param responder 响应者名称（可选，如果有的话）
 * @param witnesses 目击者名称列表
 * @param reason 暴力原因描述（用于日志）
 */
export function propagateViolenceTrust(
  session: GameSession,
  victim: string,
  responder: string | null,
  witnesses: string[],
  reason: string
): ViolenceTrustCascadeResult {
  const changes: Array<{ npcName: string; delta: number; reason: string }> = []
  const processed = new Set<string>([victim])  // 避免重复处理
  if (responder) processed.add(responder)

  // 1. 受害者的亲近 NPC
  const victimPersonality = getPersonality(victim)
  for (const bond of victimPersonality.bonds) {
    if (bond.weight >= 0.5 && !processed.has(bond.npcName)) {
      const delta = bond.weight >= 0.8 ? -10 : -8
      const result = changeTrust(session, {
        npcName: bond.npcName,
        channel: 'reputation',
        delta,
        reason: `${victim}被你伤害`,
        turn: session.turnCount,
      })
      if (result.applied) {
        changes.push({ npcName: bond.npcName, delta, reason: `${victim}的亲近关系` })
      }
      processed.add(bond.npcName)
    }
  }

  // 2. 响应者的亲近 NPC（如果有响应者）
  if (responder) {
    const responderPersonality = getPersonality(responder)
    for (const bond of responderPersonality.bonds) {
      if (bond.weight >= 0.5 && !processed.has(bond.npcName)) {
        // 响应者的亲近NPC也可能触发战斗（-8到-9）
        const delta = bond.weight >= 0.8 ? -9 : -8
        const result = changeTrust(session, {
          npcName: bond.npcName,
          channel: 'reputation',
          delta,
          reason: `${responder}因你而卷入暴力`,
          turn: session.turnCount,
        })
        if (result.applied) {
          changes.push({ npcName: bond.npcName, delta, reason: `${responder}的亲近关系` })
        }
        processed.add(bond.npcName)
      }
    }
  }

  // 3. 目击者
  for (const witness of witnesses) {
    if (!processed.has(witness)) {
      const delta = -6
      const result = changeTrust(session, {
        npcName: witness,
        channel: 'witness',
        delta,
        reason: `目击你伤害${victim}`,
        turn: session.turnCount,
      })
      if (result.applied) {
        changes.push({ npcName: witness, delta, reason: '目击暴力' })
      }
      processed.add(witness)
    }
  }

  // 4. 其他镇民（流言传播）
  for (const npc of session.npcs) {
    if (!processed.has(npc.name)) {
      const delta = -4
      const result = changeTrust(session, {
        npcName: npc.name,
        channel: 'reputation',
        delta,
        reason: `听说你伤害了${victim}`,
        turn: session.turnCount,
      })
      if (result.applied) {
        changes.push({ npcName: npc.name, delta, reason: '流言传播' })
      }
    }
  }

  // 生成摘要
  const summary = `暴力后果传播：${changes.length} 名 NPC 的信任度下降。` +
    `受害者亲近关系 ${changes.filter(c => c.reason.includes('亲近关系') && c.reason.includes(victim)).length} 人，` +
    (responder ? `响应者亲近关系 ${changes.filter(c => c.reason.includes('亲近关系') && c.reason.includes(responder)).length} 人，` : '') +
    `目击者 ${changes.filter(c => c.reason === '目击暴力').length} 人，` +
    `流言传播 ${changes.filter(c => c.reason === '流言传播').length} 人。`

  return { changes, summary }
}
