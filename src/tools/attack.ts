/**
 * ⚔️ 攻击工具
 *
 * 执行完整战斗回合：先攻 → 玩家攻击 → 怪物反击 → 战利品。
 * 战斗结果由 rules-engine / combat-manager 确定性计算，DM 只负责叙事描写。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import type { Monster } from '../types.js'
import { getSession } from '../game-state.js'
import { startCombat, executePlayerTurn, getCombatSummary, attemptFlee } from '../combat-manager.js'

export const AttackTool: Tool = {
  name: 'Attack',
  description: `对目标发动攻击，自动处理完整战斗回合。

首次攻击时自动开始战斗：
1. 为所有参战者掷先攻 (d20 + DEX修正)，排出行动顺序
2. 按先攻顺序依次执行每个参战者的回合

每个回合自动处理：
- 玩家回合：攻击掷骰 (d20 + 修正 vs 目标AC)，命中则掷伤害，暴击(自然20)伤害翻倍
- 怪物回合：怪物自动反击玩家，伤害由系统计算
- 战斗结束：所有怪物死亡 → 自动发放战利品；玩家倒下 → 战斗失败

首次调用时通过 encounterMonsters 指定所有参战怪物（可包含多个同类怪物）。
后续回合只需指定 targetId 和 method。`,
  inputSchema: z.object({
    targetId: z.string().describe('攻击目标的名称或ID'),
    method: z.enum(['weapon', 'spell', 'flee']).describe('"weapon" 使用装备武器, "spell" 使用法术, "flee" 尝试逃跑'),
    spellId: z.string().optional().describe('使用的法术名 (method 为 "spell" 时必填)'),
    encounterMonsters: z.array(z.string()).optional().describe(
      '首次攻击时，参战的所有怪物名称列表（如 ["Goblin", "Goblin"]）。不提供则默认只有 targetId 对应的怪物。',
    ),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const { targetId, method, spellId, encounterMonsters } = input

    // 逃跑处理
    if (method === 'flee') {
      if (!session.combat?.active) {
        return { output: '当前没有进行中的战斗，无需逃跑。', isError: true }
      }
      try {
        const fleeResult = attemptFlee(session)
        const combatStatus = !fleeResult.ended ? getCombatSummary(session) : null
        return {
          output: [
            ...fleeResult.log,
            '',
            combatStatus ?? '',
          ].filter(Boolean).join('\n'),
        }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    // 位置检查：战斗只能在当前位置发生
    const locationMonsters: Record<string, string[]> = {
      'twilight-woods': ['Wolf', 'Giant Spider', 'Goblin', 'Cockatrice'],
      'greyspine-mines': ['Skeleton', 'Shadow', 'Ghoul', 'Mimic'],
      'shatterstone-wastes': ['Orc Warrior', 'Ghoul', 'Eclipsed Beast'],
      'dawnbreak-town': [],  // 镇上一般不战斗
    }
    const allowedHere = locationMonsters[session.worldState.currentLocation] ?? []
    const targetName = targetId.toLowerCase()
    if (!session.combat?.active && !allowedHere.some(m => m.toLowerCase().includes(targetName))) {
      return { output: `这里没有${targetId}。当前位置不太可能遇到这种敌人。`, isError: true }
    }

    // 加载怪物数据库
    const monstersJson = await import('../../data/monsters.json', { with: { type: 'json' } })
    const monstersDb: Monster[] = monstersJson.default

    // 如果没有进行中的战斗，开始新战斗
    if (!session.combat?.active) {
      const monsterNames: string[] = encounterMonsters ?? [targetId]
      try {
        const combat = startCombat(session, monsterNames, monstersDb)
        // 输出先攻结果
        const initLog = combat.log.join('\n')

        // 执行玩家回合（怪物回合由 server 分段发送）
        const round = executePlayerTurn(session, targetId, method, spellId)

        return {
          output: [
            '=== 战斗开始 ===',
            initLog,
            '',
            ...round.roundLog,
          ].filter(Boolean).join('\n'),
        }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    // 战斗已在进行中，执行玩家回合
    try {
      const round = executePlayerTurn(session, targetId, method, spellId)

      return {
        output: [
          ...round.roundLog,
        ].filter(Boolean).join('\n'),
      }
    } catch (e: any) {
      return { output: e.message, isError: true }
    }
  },
}
