/**
 * 📚 ListLore — 浏览当前可查的剧本条目
 *
 * DM 使用场景:
 *   - 玩家问"这镇上都有谁?" → ListLore(type='character', location='dawnbreak-town')
 *   - DM 自己想回顾一下本章出场的角色/地点/事件,避免叙事跑偏
 *
 * 章节门控:chapter_visible > 当前章节号的条目会被静默过滤。
 * 战斗中禁用,每 turn 最多 5 次(和 Read/Grep 共享计数)。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { getSession } from '../game-state.js'
import { getLoreStore, parseChapterNumber } from '../lore/index.js'

export const ListLoreTool: Tool = {
  name: 'ListLore',
  description: `浏览当前章节可以查到的剧本条目(角色/地点/事件等)。

用途:玩家问"这里都有谁"/"你知道哪些地方"时,或你想确认本章有哪些已知元素再叙事。
- type: 按类型过滤 (character / place / event / faction / world)
- tag:  按标签过滤 (如 'combat-capable', 'merchant')
- 不传参数则列出全部可见条目

返回:id + 名字 + 类型 + 标签,不含正文。要读正文请用 ReadLore。
限制:战斗中禁用,每回合最多查 5 次(与 ReadLore/GrepLore 共享)。`,
  inputSchema: z.object({
    type: z
      .enum(['character', 'place', 'event', 'faction', 'world'])
      .optional()
      .describe('按类型过滤,省略则返回全部类型'),
    tag: z.string().optional().describe('按标签过滤'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    const session = getSession()
    if (session.combat?.active) {
      return { output: '[ListLore] 战斗中无法查询剧本资料。' }
    }

    const store = getLoreStore()
    const gate = store.checkAndIncrementCall()
    if (!gate.allowed) {
      return {
        output: '[ListLore] 本回合 lore 查询次数已用完(上限 5 次),请基于已有信息推进剧情。',
      }
    }

    const chapterNum = parseChapterNumber(session.chapter?.currentChapter)
    const summaries = store.list({
      currentChapter: chapterNum,
      type: input.type,
      tag: input.tag,
    })

    if (summaries.length === 0) {
      const filter = [input.type && `type=${input.type}`, input.tag && `tag=${input.tag}`]
        .filter(Boolean)
        .join(', ')
      return {
        output: filter
          ? `[ListLore] 没有匹配 (${filter}) 的条目。`
          : '[ListLore] 当前章节无可查条目。',
      }
    }

    const lines = summaries.map(s => {
      const loc = s.location ? ` @${s.location}` : ''
      const tags = s.tags?.length ? ` [${s.tags.join(',')}]` : ''
      return `- ${s.id} (${s.type}): ${s.name}${loc}${tags}`
    })

    return {
      output: `[ListLore] 找到 ${summaries.length} 个条目 (剩余 ${gate.remaining} 次查询):\n${lines.join('\n')}`,
    }
  },
}
