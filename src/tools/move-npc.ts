/**
 * 🚶 NPC 移动工具 — DM 调度 NPC 在合理范围内移动
 */
import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession, getFacts } from '../game-state.js'
import { canNPCMoveTo, moveNPC, getSubLocationName } from '../npc-mobility.js'

export const MoveNPCTool: Tool = {
  name: 'MoveNPC',
  description: `移动NPC到指定子地点。受NPC移动能力约束：
- stationary: 不能移动（如小莉）
- local: 只能在当前区域内移动（如格雷格可以从酒馆到广场）
- roaming: 可以跨区域移动（如卡恩）
用于让NPC自然地出现在合理的地方，而不是永远钉在原位。`,
  inputSchema: z.object({
    npcName: z.string().describe('NPC名字'),
    destination: z.string().describe('目标子地点 POI id（如 town-square, adventurer-guild）'),
    reason: z.string().optional().describe('移动原因（供叙事参考）'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const { npcName, destination, reason } = input

    const npc = session.npcs.find(n => n.name === npcName)
    if (!npc) return { output: `NPC "${npcName}" 不存在。`, isError: true }

    const result = moveNPC(npc, destination, session)
    if (!result.success) {
      return { output: `NPC移动失败：${result.reason}`, isError: true }
    }

    const destName = getSubLocationName(destination)
    facts.addEvent(`${npcName}移动到了${destName}`)

    return {
      output: `${npcName}已移动到${destName}。${reason ? `原因：${reason}` : ''}`,
    }
  },
}
