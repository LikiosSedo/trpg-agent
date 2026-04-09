/**
 * 📝 RecordJournal — 记录 DM 札记(Phase 6)
 *
 * 把本次叙事中一个"值得 10 轮后仍然记得"的叙事锚点写进存档。
 * 札记会自动出现在后续 turn 的 [游戏状态] 上下文里,也会被 Phase 4
 * 归档快照收录,所以跨压缩、跨 session 都不会丢。
 *
 * 这是"存档级记忆"的唯一写入入口。其他记忆层:
 *   - 系统级:代码 / 规则
 *   - 剧本级:Lore 文件(只读,ReadLore 等)
 *   - 存档级:札记(本工具)+ NPC trust / quest / flag 等结构化状态
 *   - 对话级:dmMessages(自动,受 Phase 4 压缩影响)
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { getSession } from '../game-state.js'
import { appendJournal, MAX_CONTENT_LENGTH, MAX_WRITES_PER_TURN } from '../dm-journal.js'

export const RecordJournalTool: Tool = {
  name: 'RecordJournal',
  description: `把一个值得长期记住的叙事锚点写进存档札记。

何时调用:
- 玩家做出了一个会影响后续剧情走向的选择(拒绝/接受/站队/立场)
- 你刚刚在叙事中透露了一个只有这个存档才知道的关键信息
- 玩家向 NPC 做出了一个承诺,但不够结构化、ChangeTrust/TransferItem 都捕捉不到
- 本次冒险中出现了一个你希望十几轮之后仍然记得的细节(玩家特别关心某个 NPC、某种反复出现的行为模式)

何时不调用:
- 移动/使用道具/攻击这类机械动作(系统已自动记录)
- 任务进度/信任变化(有专门的工具/系统)
- 纯氛围描写或即兴对话
- 你无法用一两句话概括的事情(那就不够"锚定")

内容写法:
- 用陈述句,不要写"玩家可能会…"这种猜测
- 指出关键人物/地点/选择,让未来的你(或被压缩之后的你)一眼看懂上下文
- 每条不超过 ${MAX_CONTENT_LENGTH} 字符(超出会截断)

限制:每回合最多写 ${MAX_WRITES_PER_TURN} 条。`,
  inputSchema: z.object({
    type: z
      .enum(['decision', 'revelation', 'promise', 'note'])
      .describe(
        'decision=玩家的重大选择 | revelation=透露的关键信息 | promise=未结构化的承诺 | note=叙事备忘',
      ),
    content: z
      .string()
      .describe(`札记内容(最多 ${MAX_CONTENT_LENGTH} 字符)。用陈述句,指出关键人物/地点/选择。`),
    tags: z
      .array(z.string())
      .optional()
      .describe('可选标签,方便未来检索。例 ["greg", "mine-quest"]'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const result = appendJournal(session, {
      type: input.type,
      content: input.content,
      tags: input.tags,
    })

    if (!result.ok) {
      if (result.reason === 'rate_limit') {
        return {
          output: `[RecordJournal] 本回合札记已写满(${MAX_WRITES_PER_TURN} 条上限)。把这次没记下的东西留到下一轮,或者直接通过叙事体现。`,
        }
      }
      if (result.reason === 'empty_content') {
        return {
          output: '[RecordJournal] 内容为空,未写入。',
          isError: true,
        }
      }
    }

    const entry = result.entry!
    const tagStr = entry.tags?.length ? ` #${entry.tags.join(' #')}` : ''
    return {
      output: `[RecordJournal ✓ 剩余 ${result.remaining} 条] [${entry.type}] ${entry.content}${tagStr}`,
    }
  },
}
