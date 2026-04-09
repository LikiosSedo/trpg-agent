/**
 * 🔍 GrepLore — 跨剧本条目关键词搜索
 *
 * DM 使用场景:
 *   - 玩家提到一个名字你没印象 → GrepLore(query='达里安') 看看哪些条目提过
 *   - 想找"谁和邪教有关联" → GrepLore(query='邪教')
 *
 * 只搜 body 正文(name/alias 交给 ReadLore)。章节门控,战斗禁用,每 turn 5 次上限。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { getSession } from '../game-state.js'
import { getLoreStore, parseChapterNumber } from '../lore/index.js'

export const GrepLoreTool: Tool = {
  name: 'GrepLore',
  description: `在所有剧本条目中搜索关键词,找出哪些条目提到它。

用途:玩家提到某个人/事/地点你没印象时,或者想跨条目查关联("谁和邪教有关")。
- query: 要搜的关键词
- type:  限定在某类条目里搜 (可选)
- 单个条目最多返回 3 行上下文,总共最多 5 个命中条目

和 ReadLore 的区别:ReadLore 是按名字读整条,GrepLore 是按关键词找线索。
限制:战斗中禁用,每回合最多 5 次(与 ListLore/ReadLore 共享)。`,
  inputSchema: z.object({
    query: z.string().describe('要搜索的关键词'),
    type: z
      .enum(['character', 'place', 'event', 'faction', 'world'])
      .optional()
      .describe('限定搜索的条目类型'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    const session = getSession()
    if (session.combat?.active) {
      return { output: '[GrepLore] 战斗中无法查询剧本资料。' }
    }

    const store = getLoreStore()
    const gate = store.checkAndIncrementCall()
    if (!gate.allowed) {
      return {
        output: '[GrepLore] 本回合 lore 查询次数已用完(上限 5 次),请基于已有信息推进剧情。',
      }
    }

    const chapterNum = parseChapterNumber(session.chapter?.currentChapter)
    const hits = store.grep({
      query: input.query,
      currentChapter: chapterNum,
      type: input.type,
    })

    if (hits.length === 0) {
      return {
        output: `[GrepLore] "${input.query}" 没有命中任何条目。(剩余 ${gate.remaining} 次查询)`,
      }
    }

    const blocks = hits.map(h => {
      const snippetLines = h.snippets.map(s => `    ${s}`).join('\n')
      return `  📄 ${h.id} (${h.name}):\n${snippetLines}`
    })

    return {
      output: `[GrepLore · 剩余 ${gate.remaining} 次] 找到 ${hits.length} 个命中:\n${blocks.join('\n\n')}`,
    }
  },
}
