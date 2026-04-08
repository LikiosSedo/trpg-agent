/**
 * 🤝 队伍管理工具 — DM 招募/解散战斗型 NPC 同伴
 */
import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { getSession, getFacts } from '../game-state.js'
import { recruitAlly, dismissAlly } from '../party-manager.js'

export const ManagePartyTool: Tool = {
  name: 'ManageParty',
  description: `招募或解散战斗型NPC同伴。同伴会在战斗中自动战斗，保护玩家。

招募条件：NPC信任度≥5、具备战斗能力、在同一地点、状态正常。队伍最多2名同伴。
解散：随时可以解散同伴，NPC回归自由行动。

仅在以下场景使用：
- 招募：NPC主动提出加入、玩家请求NPC同行且NPC信任足够
- 解散：NPC因剧情离开、玩家主动让NPC留下、NPC信任下降`,
  inputSchema: z.object({
    action: z.enum(['recruit', 'dismiss']).describe('招募或解散'),
    npcName: z.string().describe('NPC名字'),
    reason: z.string().describe('叙事原因'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const { action, npcName, reason } = input

    if (action === 'recruit') {
      const result = recruitAlly(session, npcName)
      if (!result.ok) return { output: `招募失败：${result.reason}`, isError: true }
      getFacts().addEvent(`${npcName}加入了队伍：${reason}`)
      return { output: `${npcName}加入了队伍。${reason}` }
    }

    const removed = dismissAlly(session, npcName)
    if (!removed) return { output: `${npcName}不在队伍中。`, isError: true }
    getFacts().addEvent(`${npcName}离开了队伍：${reason}`)
    return { output: `${npcName}离开了队伍。${reason}` }
  },
}
