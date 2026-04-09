/**
 * 📖 ReadLore — 读取某个剧本条目的完整正文
 *
 * DM 使用场景:
 *   - 玩家问某个 NPC 的过去 → ReadLore(query='格雷格')
 *   - DM 自己准备叙事某个事件,先查一下官方设定,避免信口开河
 *
 * 支持 id / 名称 / 别名匹配。章节门控,战斗禁用,每 turn 5 次上限。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { getSession } from '../game-state.js'
import { getLoreStore, parseChapterNumber } from '../lore/index.js'

export const ReadLoreTool: Tool = {
  name: 'ReadLore',
  description: `读取某个剧本条目的完整内容(角色背景/地点详情/事件始末等)。

用途:玩家问"他的过去是什么样"、"那件事是怎么回事",或你准备叙事某个背景信息之前核对设定。
- query: 条目 id 或 名字 或 别名 (例 'greg' / '格雷格' / '铁匠格雷格')
- 精确不命中会尝试模糊匹配(包含关系)

返回:条目 frontmatter 元信息 + 完整 markdown 正文。
注意:不是所有条目都能立刻看到 —— 设定中有的背景需要剧情推进到某一章才解锁。
限制:战斗中禁用,每回合最多 5 次(与 ListLore/GrepLore 共享)。`,
  inputSchema: z.object({
    query: z.string().describe('条目 id / 名字 / 别名'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    const session = getSession()
    if (session.combat?.active) {
      return { output: '[ReadLore] 战斗中无法查询剧本资料。' }
    }

    const store = getLoreStore()
    const gate = store.checkAndIncrementCall()
    if (!gate.allowed) {
      return {
        output: '[ReadLore] 本回合 lore 查询次数已用完(上限 5 次),请基于已有信息推进剧情。',
      }
    }

    const chapterNum = parseChapterNumber(session.chapter?.currentChapter)
    const entry = store.read({
      query: input.query,
      currentChapter: chapterNum,
    })

    if (!entry) {
      return {
        output: `[ReadLore] 未找到 "${input.query}"。剧本里可能还没这个条目,或当前章节尚未解锁。请基于已知信息叙事,避免编造设定。(剩余 ${gate.remaining} 次查询)`,
      }
    }

    const fm = entry.frontmatter
    const header = [
      `# ${fm.name} (${entry.id})`,
      `类型: ${fm.type}${fm.location ? ` · 相关地点: ${fm.location}` : ''}`,
      fm.aliases?.length ? `别名: ${fm.aliases.join(' / ')}` : '',
      fm.tags?.length ? `标签: ${fm.tags.join(', ')}` : '',
      fm.related?.length ? `相关条目: ${fm.related.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    return {
      output: `[ReadLore · 剩余 ${gate.remaining} 次]\n${header}\n\n${entry.body}`,
    }
  },
}
