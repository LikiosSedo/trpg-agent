/**
 * 🎯 场景选项工具 — DM 每轮结束时调用，设置可交互选项
 *
 * 两类选项：
 * 1. details: 细节展开（点击直接显示预写内容，无需新一轮推理）
 * 2. suggestions: 推荐操作（点击作为玩家输入发送，触发新一轮）
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'

export interface SceneActions {
  details: Array<{ label: string; content: string }>
  suggestions: string[]
}

// 当前轮次的 actions（工具写入，server 读取后清空）
let pendingActions: SceneActions | null = null

export function consumeActions(): SceneActions | null {
  const a = pendingActions
  pendingActions = null
  return a
}

export const SetActionsTool: Tool = {
  name: 'SetActions',
  description: `设置当前场景的可交互选项。每次回应最后调用一次。

提供两类选项：
1. details（1-2个）：细节描写。玩家点击后直接展示预写内容，不触发新一轮。
   适合：看看四周、打量NPC、检查某个物品等感官描写。每个 2-3 句即可。
2. suggestions（2-3个）：推荐的下一步操作。玩家点击后作为输入发送，触发新一轮推理。
   适合：对话选项、移动目的地、调查线索等推进剧情的行为。

注意：suggestions 应该是当前场景下最有价值的操作，而非泛泛的"看看四周"。`,
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
