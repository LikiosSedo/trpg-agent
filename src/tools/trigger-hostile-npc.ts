/**
 * 🎯 触发敌对 NPC 工具
 *
 * 允许 DM 根据叙事需要，触发已达到敌对阈值（信任度 ≤ -8）的 NPC 攻击。
 *
 * 设计原则：
 * - 必须基于信任度机制（不能凭空触发）
 * - 响应类型由 NPC 配置决定（DM 不能覆盖）
 * - 有冷却机制（3 轮内不能重复触发）
 * - 与 violence_alert 互补（立即触发 vs 延迟触发）
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import type { Monster } from '../types.js'
import { getSession } from '../game-state.js'
import { evaluateResponse } from '../trust-system.js'
import { getPersonality } from '../npc-relationships.js'
import { startCombat } from '../combat-manager.js'

export const TriggerHostileNPCTool: Tool = {
  name: 'TriggerHostileNPC',
  description: `触发已达到敌对阈值的 NPC 攻击。

**使用条件**：
- NPC 信任度必须 ≤ combat 阈值（通常为 -8）
- NPC 必须在同一位置
- NPC 状态正常（非昏迷/恢复中）
- 冷却时间已过（3 轮）

**响应类型**（由 NPC 配置决定）：
- fight: 直接战斗（格雷格、韩猛、格罗姆）
- call_guards: 召唤守卫（艾琳娜、陈妈）
- flee: 逃跑到安全位置（小莉、叶绿、维克多）
- plot_revenge: 设置复仇标记，不立即战斗（卡恩）

**与 violence_alert 的区别**：
- TriggerHostileNPC: 立即触发，用于叙事需要
- violence_alert: 延迟触发，给玩家逃跑时间

**使用场景**：
- 格雷格发现玩家身上的血迹（检定失败）
- 陈妈目击草药堂的异常
- NPC 在对话中突然翻脸`,
  inputSchema: z.object({
    npcName: z.string().describe('要触发的 NPC 名称'),
    reason: z.string().describe('叙事原因（如"发现血迹"、"目击战斗"）'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const { npcName, reason } = input

    // 1. 检查 NPC 是否存在
    const npc = session.npcs.find(n => n.name === npcName)
    if (!npc) {
      return { output: `NPC "${npcName}" 不存在。`, isError: true }
    }

    // 2. 检查位置
    const playerLoc = session.worldState.currentLocation
    const playerSub = session.worldState.currentSubLocation
    if (npc.location !== playerLoc) {
      return { output: `${npcName}不在这里（当前位置：${npc.location}）。`, isError: true }
    }
    const npcSub = npc.subLocation ?? npc.homeBase
    if (npcSub !== playerSub) {
      return { output: `${npcName}不在这个子区域（当前子区域：${npcSub}）。`, isError: true }
    }

    // 3. 检查状态
    if (npc.condition === 'unconscious') {
      return { output: `${npcName}已经昏迷倒地，无法行动。`, isError: true }
    }
    if (npc.condition === 'recovering') {
      return { output: `${npcName}正在恢复中，处于虚弱状态。`, isError: true }
    }

    // 4. 检查是否已在战斗中
    if (session.combat?.active) {
      return { output: `当前已在战斗中，无法触发新的战斗。`, isError: true }
    }

    // 5. 检查信任度是否达到敌对阈值
    const response = evaluateResponse(npc)
    if (response.type !== 'combat_trigger') {
      const personality = getPersonality(npcName)
      return {
        output: `${npcName}尚未达到敌对阈值（当前信任度：${npc.trust}，敌对阈值：${personality.thresholds.combat}）。无法触发攻击。`,
        isError: true,
      }
    }

    // 6. 检查冷却时间
    if (!session.npcHostileCooldowns) {
      session.npcHostileCooldowns = new Map()
    }
    const lastTrigger = session.npcHostileCooldowns.get(npcName)
    if (lastTrigger !== undefined) {
      const cooldownRemaining = 3 - (session.turnCount - lastTrigger)
      if (cooldownRemaining > 0) {
        return {
          output: `${npcName}的响应冷却中，${cooldownRemaining} 轮后可再次触发。`,
          isError: true,
        }
      }
    }

    // 7. 获取 NPC 的 combatResponse 配置
    const personality = getPersonality(npcName)
    const combatResponse = response.combatResponse ?? personality.combatResponse

    // 8. 记录冷却时间
    session.npcHostileCooldowns.set(npcName, session.turnCount)

    // 9. 根据响应类型执行
    const log: string[] = []

    switch (combatResponse) {
      case 'fight': {
        // 直接战斗
        log.push(`⚔️ ${npcName}对玩家发起攻击！（原因：${reason}）`)

        // 加载战斗数据
        const monstersJson = await import('../../data/monsters.json', { with: { type: 'json' } })
        const npcCombatJson = await import('../../data/npc-combatants.json', { with: { type: 'json' } })
        const allDb = [...monstersJson.default, ...npcCombatJson.default] as Monster[]

        // 触发战斗
        try {
          const combat = startCombat(session, [npcName], allDb)
          log.push(...combat.log)
        } catch (e: any) {
          return { output: e.message, isError: true }
        }
        break
      }

      case 'call_guards': {
        // 召唤守卫
        log.push(`🚨 ${npcName}大声呼救！（原因：${reason}）`)

        // 从 bonds 中查找守卫
        const guards = personality.bonds
          .map(b => session.npcs.find(n => n.name === b.npcName))
          .filter(n => n && getPersonality(n.name).canFight)

        if (guards.length === 0) {
          log.push(`${npcName}呼救了，但附近没有能战斗的 NPC。`)
        } else {
          const guard = guards[0]!
          log.push(`${guard.name}将在 2 轮后赶到。`)

          // 收集目击者（当前位置所有其他 NPC）
          const witnesses = session.npcs
            .filter(n =>
              n.name !== npcName &&
              n.location === playerLoc &&
              (!playerSub || n.subLocation === playerSub)
            )
            .map(n => n.name)

          // 创建 violence_alert（使用旧系统的 JSON 格式）
          session.worldState.flags['violence_alert'] = JSON.stringify({
            triggerTurn: session.turnCount,
            victimName: npcName,
            location: playerLoc,
            subLocation: playerSub,
            delay: 2,
            responded: false,
            forceResponder: guard.name,
            witnesses,
          })
        }
        break
      }

      case 'flee': {
        // 逃跑
        log.push(`💨 ${npcName}惊恐地逃离了！（原因：${reason}）`)

        // 移动到安全位置（回到 homeBase）
        const safeLocation = npc.homeBase
        if (safeLocation !== playerSub) {
          npc.subLocation = safeLocation
          log.push(`${npcName}逃到了${safeLocation}。`)
        } else {
          // 如果已经在 homeBase，逃到其他子区域
          npc.subLocation = playerSub === 'tavern-main' ? 'tavern-kitchen' : 'tavern-main'
          log.push(`${npcName}躲到了角落里。`)
        }
        break
      }

      case 'plot_revenge': {
        // 事后报复
        log.push(`😈 ${npcName}冷冷地看着你，眼中闪过一丝杀意...（原因：${reason}）`)
        log.push(`${npcName}没有立即动手，但你感觉到危险正在酝酿。`)

        // 设置复仇标记
        session.worldState.flags[`${npcName}_revenge`] = true
        break
      }

      case 'ban_from_location': {
        // 禁入
        log.push(`🚫 ${npcName}愤怒地驱赶你！（原因：${reason}）`)
        log.push(`"滚出去！你不再受欢迎！"`)

        // 设置禁入标记
        session.worldState.flags[`${npcName}_banned`] = true
        break
      }

      default:
        return {
          output: `未知的响应类型：${combatResponse}`,
          isError: true,
        }
    }

    return { output: log.join('\n') }
  },
}
