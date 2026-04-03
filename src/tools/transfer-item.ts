/**
 * 物品转移工具
 *
 * 所有物品获取/交换的唯一入口。禁止在叙事中凭空给予物品。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import type { Item, GameSession } from '../types.js'
import { getSession, getFacts, getRegistry } from '../game-state.js'
import { validateTransfer, type TransferRequest } from '../item-validator.js'
import type { ItemRegistry } from '../item-registry.js'
import type { GameFactStore } from '../game-facts.js'
import { changeTrust } from '../trust-system.js'

export const TransferItemTool: Tool = {
  name: 'TransferItem',
  description: `物品转移工具。所有物品获取/交换必须通过此工具，禁止在叙事中凭空给予物品。

操作类型:
- npc_to_player: NPC给予玩家（礼物/任务奖励）
- buy: 玩家购买（扣金币）
- sell: 玩家出售（得金币）
- loot: 战利品（战斗系统自动调用，DM不需要手动调）
- found: 搜索/环境中发现
- player_to_npc: 玩家交出物品

如果物品不在NPC库存中但叙事合理，提供完整的物品信息（类型、描述、加值），系统会验证合理性。`,
  inputSchema: z.object({
    transferType: z.enum(['npc_to_player', 'buy', 'sell', 'loot', 'found', 'player_to_npc'])
      .describe('转移类型'),
    itemName: z.string().describe('物品名称'),
    itemType: z.enum(['weapon', 'armor', 'potion', 'quest', 'misc']).optional()
      .describe('物品类型（新物品必填）'),
    itemDescription: z.string().optional()
      .describe('物品描述（新物品必填）'),
    itemBonus: z.number().optional()
      .describe('加值（武器攻击/护甲AC/药水治疗量）'),
    sourceId: z.string().optional()
      .describe('来源NPC名称（npc_to_player/buy时必填）'),
    goldAmount: z.number().optional()
      .describe('交易金额（buy/sell时）'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const registry = getRegistry()
    const { transferType, itemName, itemType, itemDescription, itemBonus, sourceId, goldAmount } = input

    // 从注册表解析物品，或构建动态物品
    let item: Item
    let isDynamic = false
    const registered = registry.get(itemName)
    if (registered) {
      item = { name: registered.name, type: registered.type, description: registered.description, bonus: registered.bonus }
    } else if (itemType && itemDescription) {
      item = { name: itemName, type: itemType, description: itemDescription, bonus: itemBonus }
      isDynamic = true
    } else {
      return { output: `物品"${itemName}"不在注册表中。新物品需要提供 itemType 和 itemDescription。`, isError: true }
    }

    // 深夜商店关门检查
    if ((transferType === 'buy' || transferType === 'sell') && session.worldState.timeOfDay === 'night') {
      const shopNpc = sourceId ? session.npcs.find(n => n.name === sourceId) : null
      if (shopNpc?.shopPricing) {
        return { output: `${shopNpc.name}的商店已经打烊了，深夜不营业。白天再来吧。`, isError: true }
      }
    }

    // 构建转移请求
    const request: TransferRequest = {
      item,
      fromType: ['npc_to_player', 'buy'].includes(transferType) ? 'npc'
        : transferType === 'sell' || transferType === 'player_to_npc' ? 'player'
        : transferType === 'loot' ? 'monster_loot' : 'environment',
      fromId: sourceId,
      toType: ['sell', 'player_to_npc'].includes(transferType) ? 'npc' : 'player',
      toId: ['sell', 'player_to_npc'].includes(transferType) ? sourceId : undefined,
      transferType: transferType === 'npc_to_player' ? 'gift' : transferType,
      goldAmount,
      isDynamic,
    }

    // 验证
    const result = validateTransfer(request, session, registry)
    if (!result.valid) {
      return { output: `物品转移失败：${result.reason}`, isError: true }
    }

    // 执行转移
    return { output: executeTransferAction(session, registry, request, result, facts) }
  },
}

/** 执行物品转移的核心逻辑，facts 为 null 时跳过事件日志 */
function executeTransferAction(
  session: GameSession,
  registry: ItemRegistry,
  request: TransferRequest,
  validation: { autoPrice?: number; warnings?: string[] },
  facts: GameFactStore | null,
): string {
  const { item, fromType, fromId, transferType, goldAmount } = request
  const lines: string[] = []

  // 从来源移除
  if (fromType === 'npc' && fromId) {
    const npc = session.npcs.find(n => n.name === fromId)
    if (npc) {
      if (request.isDynamic) {
        // 动态物品：先加入NPC库存（守恒原则），再移除
        if (!npc.inventory) npc.inventory = []
        npc.inventory.push({ ...item })
      }
      const idx = (npc.inventory ?? []).findIndex(i => i.name === item.name)
      if (idx >= 0) npc.inventory!.splice(idx, 1)
    }
  } else if (fromType === 'player') {
    const idx = session.player.inventory.findIndex(i => i.name === item.name)
    if (idx >= 0) session.player.inventory.splice(idx, 1)
  }

  // 添加到目标
  if (request.toType === 'player') {
    session.player.inventory.push({ ...item })
    lines.push(`获得物品：${item.name}（${item.description}）`)
  } else if (request.toType === 'npc' && request.toId) {
    const npc = session.npcs.find(n => n.name === request.toId)
    if (npc) {
      if (!npc.inventory) npc.inventory = []
      npc.inventory.push({ ...item })
      lines.push(`将"${item.name}"交给了${npc.name}`)
    }
  }

  // 送礼信任提升
  if (request.transferType === 'player_to_npc' && request.toId) {
    const giftValue = validation.autoPrice ?? 5
    const trustDelta = giftValue >= 25 ? 2 : 1
    changeTrust(session, {
      npcName: request.toId,
      channel: 'gift',
      delta: trustDelta,
      reason: `收到礼物: ${item.name}`,
      turn: session.turnCount,
    })
  }

  // 金币交换
  if (transferType === 'buy' && goldAmount != null) {
    session.player.gold -= goldAmount
    lines.push(`支付${goldAmount}金币（剩余${session.player.gold}）`)
  } else if (transferType === 'sell' && goldAmount != null) {
    session.player.gold += goldAmount
    lines.push(`获得${goldAmount}金币（现有${session.player.gold}）`)
  }

  // 注册动态物品
  if (request.isDynamic) {
    registry.register({
      name: item.name,
      type: item.type,
      description: item.description,
      bonus: item.bonus,
      basePrice: validation.autoPrice ?? 5,
    })
  }

  // 记录事件
  if (facts) {
    const eventDesc = transferType === 'buy' ? `购买了${item.name}`
      : transferType === 'sell' ? `出售了${item.name}`
      : `获得${item.name}${fromId ? `（来自${fromId}）` : ''}`
    facts.addEvent(eventDesc)
  }

  if (validation.warnings?.length) {
    lines.push(`[注意: ${validation.warnings.join('; ')}]`)
  }

  return lines.join('\n')
}

/** 程序化 API，供战斗系统/任务系统直接调用 */
export function executeTransfer(
  session: GameSession,
  registry: ItemRegistry,
  request: TransferRequest,
): { success: boolean; output: string } {
  const result = validateTransfer(request, session, registry)
  if (!result.valid) return { success: false, output: result.reason ?? 'validation failed' }
  const output = executeTransferAction(session, registry, request, result, null)
  return { success: true, output }
}
