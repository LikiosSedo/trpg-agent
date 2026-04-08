/**
 * 💰 交易提案工具 — DM 在 NPC 同意价格后调用，弹出交易卡片
 *
 * DM 控制"什么时候提出交易、什么价格"
 * 代码控制"交易是否执行"
 * 玩家控制"确认或取消"
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'

export interface TradeProposal {
  npc: string
  items: Array<{ name: string; type: string; price: number; quantity: number; description?: string; bonus?: number }>
  totalPrice: number
  canBargain: boolean
}

let pendingTrade: TradeProposal | null = null

export function consumeTradeProposal(): TradeProposal | null {
  const t = pendingTrade
  pendingTrade = null
  return t
}

export const ProposeTradeActionTool: Tool = {
  name: 'ProposeTradeAction',
  description: `当NPC同意了一个交易报价时调用。弹出交易卡片让玩家确认。

使用时机：NPC和玩家谈好了价格，准备成交时。
不要在叙事中直接完成交易——必须通过此工具让玩家确认。

示例：玩家和叶绿谈好以5金币买2瓶治疗药水
ProposeTradeAction({
  npc: "叶绿",
  items: [{ name: "治疗药水", type: "potion", price: 5, quantity: 2 }],
  totalPrice: 10,
  canBargain: true
})`,
  inputSchema: z.object({
    npc: z.string().describe('商人NPC名称'),
    items: z.array(z.object({
      name: z.string().describe('物品名称'),
      type: z.enum(['weapon', 'armor', 'potion', 'quest', 'misc']).describe('物品类型'),
      price: z.number().describe('单价（金币）'),
      quantity: z.number().optional().describe('数量，默认1'),
      description: z.string().optional().describe('物品描述'),
      bonus: z.number().optional().describe('物品加值'),
    })).describe('交易物品列表'),
    totalPrice: z.number().describe('总价（金币）'),
    canBargain: z.boolean().optional().describe('是否允许继续砍价'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    const { npc, items, totalPrice, canBargain } = input
    pendingTrade = {
      npc,
      items: (items || []).map((i: any) => ({
        name: i.name,
        type: i.type ?? 'misc',
        price: i.price ?? 0,
        quantity: i.quantity ?? 1,
        description: i.description,
        bonus: i.bonus,
      })),
      totalPrice: totalPrice ?? 0,
      canBargain: canBargain ?? false,
    }
    return { output: `交易提案已创建：${npc}，总价${totalPrice}金币，${items.length}件物品。等待玩家确认。` }
  },
}
