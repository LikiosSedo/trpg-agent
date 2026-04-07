/**
 * 动作执行器 — 将 Rules Agent 分类映射到工具调用
 *
 * 接收 PlayerAction，调用对应工具，返回结构化结果。
 * 工具调用和现有系统完全复用——同一个 Attack/Move/TransferItem。
 */

import type { PlayerAction, ActionResult } from './rules-agent.js'
import type { GameSession } from './types.js'
import { getSession } from './game-state.js'

// 工具的 execute 函数直接导入
import { AttackTool } from './tools/attack.js'
import { MoveTool } from './tools/move.js'
import { LookTool } from './tools/look.js'
import { SearchTool } from './tools/search.js'
import { UseItemTool } from './tools/use-item.js'
import { RestTool } from './tools/rest.js'
import { TransferItemTool } from './tools/transfer-item.js'
import { TalkTool } from './tools/talk.js'

/**
 * 执行已分类的玩家动作，返回工具结果
 */
export async function executeAction(action: PlayerAction, session: GameSession): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'ATTACK': {
        const result = await AttackTool.execute({
          targetId: action.target,
          method: action.method ?? 'weapon',
          spellId: action.spellId,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Attack'],
          firstInnocentKill: result.firstInnocentKill,
        }
      }

      case 'FLEE': {
        const result = await AttackTool.execute({
          targetId: '', method: 'flee',
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Attack'],
        }
      }

      case 'MOVE': {
        const result = await MoveTool.execute({
          destination: action.destination, mode: 'explore',
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Move'],
          unknownDestination: result.unknownDestination,
        }
      }

      case 'LOOK': {
        const result = await LookTool.execute({
          target: action.target,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Look'],
          notFound: result.notFound,
        }
      }

      case 'SEARCH': {
        const result = await SearchTool.execute({
          type: 'area', target: action.target,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Search'],
          discoveredPoi: result.discoveredPoi,
          lootGranted: result.lootGranted,
        }
      }

      case 'USE': {
        const result = await UseItemTool.execute({
          itemId: action.item,
          action: 'use',
          targetId: action.target,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['UseItem'],
        }
      }

      case 'REST': {
        const result = await RestTool.execute({
          type: action.restType,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Rest'],
        }
      }

      case 'GIVE': {
        // 目标 NPC 必须存在且在同一区域，否则交给 DM 叙事
        const giveTarget = session.npcs.find(n => n.name === action.target)
        if (!giveTarget || giveTarget.location !== session.worldState.currentLocation) {
          return { action: { type: 'NARRATIVE' }, success: true, output: '', toolsCalled: [] }
        }
        const result = await TransferItemTool.execute({
          transferType: 'player_to_npc',
          itemName: action.item,
          sourceId: action.target,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['TransferItem'],
        }
      }

      case 'BUY': {
        // NPC 优先级：有效的 Rules Agent 识别 > 当前交互对象 > 同位置商店
        let shopNpc = action.npc && session.npcs.some(n => n.name === action.npc) ? action.npc : ''
        if (!shopNpc && session.interactionNpc) {
          const interNpc = session.npcs.find(n => n.name === session.interactionNpc && n.shopPricing)
          if (interNpc) shopNpc = interNpc.name
        }
        if (!shopNpc) {
          const loc = session.worldState.currentLocation
          const shop = session.npcs.find(n =>
            n.shopPricing && (n.inventory ?? []).length > 0 && n.location === loc
          )
          shopNpc = shop?.name ?? ''
        }
        const result = await TransferItemTool.execute({
          transferType: 'buy',
          itemName: action.item,
          sourceId: shopNpc,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['TransferItem'],
        }
      }

      case 'SELL': {
        let sellNpc = action.npc && session.npcs.some(n => n.name === action.npc) ? action.npc : ''
        if (!sellNpc && session.interactionNpc) {
          const interNpc = session.npcs.find(n => n.name === session.interactionNpc && n.shopPricing)
          if (interNpc) sellNpc = interNpc.name
        }
        if (!sellNpc) {
          const loc = session.worldState.currentLocation
          const shop = session.npcs.find(n =>
            n.shopPricing && n.location === loc
          )
          sellNpc = shop?.name ?? ''
        }
        const result = await TransferItemTool.execute({
          transferType: 'sell',
          itemName: action.item,
          sourceId: sellNpc,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['TransferItem'],
        }
      }

      case 'TALK': {
        // 验证 npc 名是否是真实 NPC，否则 fallback 到 interactionNpc
        const validNpc = action.npc && session.npcs.some(n => n.name === action.npc)
        const npcId = (validNpc ? action.npc : session.interactionNpc) || ''
        const result = await TalkTool.execute({
          npcId,
          message: action.message || '',
          approach: action.approach,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Talk'],
        }
      }

      default:
        return {
          action, success: true,
          output: '', toolsCalled: [],
        }
    }
  } catch (err) {
    return {
      action, success: false,
      output: `执行失败: ${(err as Error).message}`,
      toolsCalled: [],
    }
  }
}
