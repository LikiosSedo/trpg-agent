/**
 * 💬 对话工具
 *
 * 与 NPC 进行对话交互。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession, getFacts } from '../game-state.js'
import { skillCheck } from '../rules-engine.js'

export const TalkTool: Tool = {
  name: 'Talk',
  description: `与 NPC 对话。DM Agent 用此工具将对话请求转发给对应的 NPC Agent。
NPC Agent 会根据自己的性格、记忆和对玩家的态度生成回应。
特殊对话行为 (说服/欺骗/威吓) 可能触发对抗检定。`,
  inputSchema: z.object({
    npcId: z.string().describe('目标 NPC 的 ID'),
    message: z.string().describe('玩家对 NPC 说的话'),
    approach: z.enum(['normal', 'persuade', 'deceive', 'intimidate']).optional()
      .describe('对话策略。非 normal 时触发对应的技能对抗检定'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const { npcId, message, approach } = input

    const npc = session.npcs.find(n => n.name === npcId)
    if (!npc) return { output: `NPC"${npcId}"不存在。`, isError: true }

    const npcContext = facts.getNPCContext(npcId)

    // Social skill check if non-normal approach
    if (approach && approach !== 'normal') {
      const skillMap = { persuade: 'CHA', deceive: 'CHA', intimidate: 'CHA' } as const
      const mod = session.player.abilityModifiers[skillMap[approach as keyof typeof skillMap]]
      const proficient = (approach === 'persuade' && session.player.skills.includes('persuasion'))
        || (approach === 'deceive' && session.player.skills.includes('deception'))
        || (approach === 'intimidate' && session.player.skills.includes('intimidation'))
      const totalMod = mod + (proficient ? 2 : 0)
      const dc = 10 + Math.max(0, -npc.trust) // Higher DC if NPC distrusts player
      const result = skillCheck(totalMod, dc)

      const approachZh = { persuade: '说服', deceive: '欺骗', intimidate: '威吓' }
      return {
        output: [
          `对话(${approachZh[approach as keyof typeof approachZh]})：玩家对${npc.name}说"${message}"。`,
          `${approachZh[approach as keyof typeof approachZh]}检定：d20=${result.roll}, 修正+${totalMod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。`,
          `NPC上下文：${npcContext}`,
        ].join('\n'),
      }
    }

    return {
      output: `对话：玩家对${npc.name}说"${message}"。\nNPC上下文：${npcContext}`,
    }
  },
}
