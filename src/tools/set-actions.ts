/**
 * 🎯 场景选项工具 — DM 每轮结束时调用，设置可交互选项
 *
 * 两类选项：
 * 1. details: 细节展开（点击直接显示预写内容，无需新一轮推理）
 * 2. suggestions: 推荐操作（点击作为玩家输入发送，触发新一轮）
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'

export interface ClassifiedSuggestion {
  text: string
  actionType: string
  icon: string       // RPG Awesome class, e.g. 'ra-sword'
}

export interface SceneActions {
  details: Array<{ label: string; content: string }>
  suggestions: string[]
}

export interface ClassifiedSceneActions {
  details: Array<{ label: string; content: string }>
  suggestions: ClassifiedSuggestion[]
}

// 当前轮次的 actions（工具写入，server 读取后清空）
let pendingActions: SceneActions | null = null

export function consumeActions(): SceneActions | null {
  const a = pendingActions
  pendingActions = null
  return a
}

/**
 * 合成一条 SetActions —— 用于从 DM 的 inline text 块解析出的 fallback 路径。
 *
 * 背景: 有时候 LLM 会在文本里写 `<setactions>{...}</setactions>` 伪 XML 而
 * 不是真正调用工具。engine 层的流式过滤器会把这种块剥离出来,尝试 JSON
 * parse 并通过本函数注入为 pendingActions,让玩家仍然能拿到选项。
 *
 * 如果输入非法(不是合法的 details/suggestions 结构),静默返回 false。
 */
export function injectPendingActions(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false
  const details = Array.isArray(raw.details) ? raw.details : []
  const suggestions = Array.isArray(raw.suggestions) ? raw.suggestions : []
  if (details.length === 0 && suggestions.length === 0) return false
  // 标准化 details 结构
  const normDetails = details
    .filter((d: any) => d && typeof d === 'object' && d.label && d.content)
    .map((d: any) => ({ label: String(d.label), content: String(d.content) }))
    .slice(0, 3)
  // suggestions 可能是 string[] 或 { text }[] — 两种都接受
  const normSuggestions = suggestions
    .map((s: any) => typeof s === 'string' ? s : (s?.text ?? ''))
    .filter((s: string) => s.length > 0)
    .slice(0, 4)
  if (normDetails.length === 0 && normSuggestions.length === 0) return false
  pendingActions = { details: normDetails, suggestions: normSuggestions }
  return true
}

export const SetActionsTool: Tool = {
  name: 'SetActions',
  description: `设置当前场景的可交互选项。每次回应最后调用一次。

提供两类选项：
1. details（1-2个）：细节描写。玩家点击后直接展示预写内容，不触发新一轮。
   适合：看看四周、打量NPC、检查某个物品等感官描写。每个 2-3 句即可。
2. suggestions（2-3个）：推荐的下一步操作。玩家点击后作为输入发送，触发新一轮推理。
   适合：对话选项、移动目的地、调查线索等推进剧情的行为。

注意：
- suggestions 必须紧扣当前场景和NPC刚刚说的话，不要给泛泛的"看看四周"
- 不要建议和昏迷/死亡的NPC交谈
- 如果NPC正在提出选择或问题，suggestions 应该是对这些选择的具体回应
- 优先给出推进当前对话/剧情的选项，而非离开或切换话题`,
  inputSchema: z.object({
    details: z.array(z.object({
      label: z.string().describe('按钮文字，如"打量格雷格"、"看看四周"'),
      content: z.string().describe('预写的细节描写（2-3句）'),
    })).describe('可展开的细节描写'),
    suggestions: z.array(z.string()).describe('推荐操作文字'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    const { details, suggestions } = input
    pendingActions = {
      details: (details ?? []).slice(0, 3),
      suggestions: (suggestions ?? []).slice(0, 4),
    }
    return { output: `已设置${pendingActions.details.length}个细节展开 + ${pendingActions.suggestions.length}个推荐操作。` }
  },
}
