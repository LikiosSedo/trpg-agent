/**
 * 🏴 游戏终局工具 — DM 在剧情自然到达终点时调用
 *
 * 不是代码强制终结，而是 DM 叙事引导到无路可走后触发。
 * 给玩家选择：重新开始 / 坚持继续。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'

export interface GameOverData {
  reason: string
  canContinue: boolean
  continueHint?: string
}

let pendingGameOver: GameOverData | null = null

export function consumeGameOver(): GameOverData | null {
  const data = pendingGameOver
  pendingGameOver = null
  return data
}

export const GameOverTool: Tool = {
  name: 'GameOver',
  description: `触发游戏终局选择。仅在以下情况调用：

1. 玩家被镇民集体审判后无法挽回
2. 玩家被永久驱逐出破晓镇
3. 玩家 HP 归零且无人救治
4. 剧情到达无法继续的死胡同（多轮尝试无果后）

不要在玩家刚犯错时立刻调用——先让后果展开几轮（被抓、审判、NPC 对话），
让玩家充分感受到后果后再给出终局选择。

canContinue=true 表示玩家如果坚持还可以继续（艰难但可能）。
canContinue=false 表示真的结束了（死亡、永久驱逐）。`,
  inputSchema: z.object({
    reason: z.string().describe('终局原因（如"被破晓镇永久驱逐"、"在地牢中绝望"）'),
    canContinue: z.boolean().describe('玩家是否还能选择继续坚持'),
    continueHint: z.string().optional().describe('如果可以继续，给玩家的提示（如"你可以尝试越狱或等待审判"）'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    pendingGameOver = {
      reason: input.reason,
      canContinue: input.canContinue ?? false,
      continueHint: input.continueHint,
    }
    return { output: `游戏终局已触发：${input.reason}` }
  },
}
