/**
 * TriggerTrustCascade 工具
 *
 * 允许 DM 手动触发信任度传播，用于处理意外情况：
 * - 玩家的暴力行为被意外发现（不是通过 violence_alert 系统）
 * - 玩家做了其他严重违反社区规范的事情
 * - 需要立即触发全镇反应的特殊情况
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession } from '../game-state.js'
import { propagateViolenceTrust } from '../trust-system.js'

export const TriggerTrustCascade: Tool = {
  name: 'TriggerTrustCascade',
  description: `手动触发全镇信任度传播。用于处理意外情况：玩家的暴力行为被意外发现，或做了其他严重违反社区规范的事情。

参数：
- victim: 受害者名称（必需）
- reason: 触发原因的简短描述（必需）
- responder: 响应者名称（可选，如果有的话）
- witnesses: 目击者名称列表（可选，逗号分隔）

示例：
- victim="小莉", reason="玩家偷窃被发现"
- victim="格雷格", reason="玩家在酒馆打人", responder="陈妈", witnesses="叶绿,老板"`,

  inputSchema: z.object({
    victim: z.string().describe('受害者名称'),
    reason: z.string().describe('触发原因的简短描述'),
    responder: z.string().optional().describe('响应者名称（可选）'),
    witnesses: z.string().optional().describe('目击者名称列表，逗号分隔（可选）'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,

  async execute(args: any) {
    const { victim, reason, responder, witnesses } = args
    const session = getSession()

    // 验证受害者存在
    const victimNpc = session.npcs.find(n => n.name === victim)
    if (!victimNpc) {
      return `错误：找不到名为"${victim}"的 NPC。`
    }

    // 验证响应者存在（如果提供）
    let responderName: string | null = null
    if (responder) {
      const responderNpc = session.npcs.find(n => n.name === responder)
      if (!responderNpc) {
        return `错误：找不到名为"${responder}"的 NPC。`
      }
      responderName = responder
    }

    // 解析目击者列表
    const witnessList: string[] = []
    if (witnesses) {
      const names = witnesses.split(',').map((n: string) => n.trim())
      for (const name of names) {
        const witnessNpc = session.npcs.find(n => n.name === name)
        if (!witnessNpc) {
          return `错误：找不到名为"${name}"的 NPC。`
        }
        witnessList.push(name)
      }
    }

    // 触发信任度传播
    const cascadeResult = propagateViolenceTrust(
      session,
      victim,
      responderName,
      witnessList,
      reason
    )

    console.log(`[trust-cascade] 手动触发: ${cascadeResult.summary}`)

    // 返回详细结果
    const lines = [
      `💔 信任度传播已触发`,
      ``,
      `原因：${reason}`,
      `受害者：${victim}`,
      responderName ? `响应者：${responderName}` : null,
      witnessList.length > 0 ? `目击者：${witnessList.join(', ')}` : null,
      ``,
      cascadeResult.summary,
      ``,
      `详细变化：`,
      ...cascadeResult.changes.map(c => `- ${c.npcName}: ${c.delta} (${c.reason})`),
    ].filter(Boolean)

    return lines.join('\n')
  },
}
