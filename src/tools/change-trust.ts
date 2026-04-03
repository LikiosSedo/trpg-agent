import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession } from '../game-state.js'
import { changeTrust } from '../trust-system.js'

const trustChangesThisTurn: Array<{ npcName: string; delta: number }> = []

export function consumeTrustChanges(): Array<{ npcName: string; delta: number }> {
  const result = [...trustChangesThisTurn]
  trustChangesThisTurn.length = 0
  return result
}

export const ChangeTrustTool: Tool = {
  name: 'ChangeTrust',
  description: `修改NPC信任度。每次有意义的NPC对话后调用。

使用时机：玩家做了让NPC高兴/生气的事、对话中表现关心/冷漠、帮助/拒绝帮助NPC。
delta 限制 -3 到 +3（日常对话通常 ±1，显著事件 ±2~3）。
不需要调用的情况：Talk社交检定已自动处理、TransferItem送礼已自动处理。`,
  inputSchema: z.object({
    npc: z.string().describe('NPC名称'),
    delta: z.number().describe('信任变化量（-3到+3）'),
    reason: z.string().describe('变化原因'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const { npc: npcName, delta, reason } = input

    const clampedDelta = Math.max(-3, Math.min(3, delta))
    if (clampedDelta === 0) return { output: '信任未变化。', isError: true }

    // 每轮每个 NPC 最多变化一次（防止 DM 连调刷信任）
    if (trustChangesThisTurn.some(t => t.npcName === npcName)) {
      return { output: `本轮已对${npcName}修改过信任，不能重复调用。`, isError: true }
    }

    const npc = session.npcs.find(n => n.name === npcName)
    if (!npc) return { output: `NPC"${npcName}"不存在。`, isError: true }
    if (npc.location !== session.worldState.currentLocation) {
      return { output: `${npcName}不在当前位置。`, isError: true }
    }

    const result = changeTrust(session, {
      npcName, channel: 'dialogue', delta: clampedDelta, reason, turn: session.turnCount,
    })
    if (!result.applied) return { output: `信任变化未执行：${result.reason}`, isError: true }

    trustChangesThisTurn.push({ npcName, delta: clampedDelta })
    return { output: `${npcName}信任：${result.oldTrust}→${result.newTrust}（${reason}）` }
  },
}
