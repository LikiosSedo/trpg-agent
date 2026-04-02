/**
 * 🎲 掷骰工具
 *
 * 所有随机判定的基础——技能检定、攻击掷骰、伤害掷骰。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { rollDice, skillCheck } from '../rules-engine.js'

export const DiceTool: Tool = {
  name: 'RollDice',
  description: `掷骰子并计算结果。支持标准骰子表达式。
用途:
- 技能检定: roll "d20" + modifier
- 攻击判定: roll "d20" + toHitBonus
- 伤害计算: roll "2d6" + modifier
- 先攻掷骰: roll "d20" + dexModifier
返回掷骰结果、各骰子面值、总和。`,
  inputSchema: z.object({
    dice: z.string().describe('骰子表达式，如 "d20", "2d6", "1d8+3"'),
    purpose: z.string().describe('掷骰目的，如 "攻击掷骰", "力量检定", "伤害"'),
    dc: z.number().optional().describe('目标难度等级 (仅检定时使用)'),
    advantage: z.boolean().optional().describe('是否有优势 (掷两次取高)'),
    disadvantage: z.boolean().optional().describe('是否有劣势 (掷两次取低)'),
  }),
  isConcurrencySafe: true,
  isReadOnly: false,
  async execute(input: any) {
    const { dice, purpose, dc, advantage } = input

    // If DC provided, treat as a skill check with the dice modifier
    if (dc !== undefined) {
      // Extract modifier from dice expression like "d20+3"
      const modMatch = dice.match(/d20([+-]\d+)?/)
      const mod = modMatch?.[1] ? Number(modMatch[1]) : 0
      const result = skillCheck(mod, dc, advantage)
      return {
        output: `[${purpose}] d20=${result.roll}, 修正${mod >= 0 ? '+' : ''}${mod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}`,
      }
    }

    // Generic dice roll
    const result = rollDice(dice)
    return {
      output: `[${purpose}] ${dice}=${result.rolls.join('+')}${result.total !== result.rolls.reduce((a, b) => a + b, 0) ? `, 总计=${result.total}` : `=${result.total}`}`,
    }
  },
}
