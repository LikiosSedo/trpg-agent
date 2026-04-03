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
        }
      }

      case 'LOOK': {
        const result = await LookTool.execute({
          target: action.target,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Look'],
        }
      }

      case 'SEARCH': {
        const result = await SearchTool.execute({
          type: 'area', target: action.target,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['Search'],
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
        const result = await TransferItemTool.execute({
          transferType: 'buy',
          itemName: action.item,
          sourceId: action.npc,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['TransferItem'],
        }
      }

      case 'SELL': {
        const result = await TransferItemTool.execute({
          transferType: 'sell',
          itemName: action.item,
          sourceId: action.npc,
        })
        return {
          action, success: !result.isError,
          output: result.output, toolsCalled: ['TransferItem'],
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
