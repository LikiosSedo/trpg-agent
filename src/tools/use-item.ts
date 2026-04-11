/**
 * 🧪 使用物品工具
 *
 * 使用、装备、或交换背包中的物品。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { getSession, getFacts } from '../game-state.js'
import { rollDice } from '../rules-engine.js'
import { executeMonsterTurns, checkCombatEnd, endCombat, getCombatSummary } from '../combat-manager.js'
import { applyEffect } from '../effect-manager.js'

export const UseItemTool: Tool = {
  name: 'UseItem',
  description: `使用背包中的物品。
- "use": 使用消耗品 (药水、卷轴等)，消耗次数-1或移除
- "equip": 装备武器/护甲/盾牌，替换当前装备
- "unequip": 卸下装备放回背包
- "give": 将物品交给 NPC (交易/任务)
- "drop": 丢弃物品到当前地点`,
  inputSchema: z.object({
    itemId: z.string().describe('物品 ID'),
    action: z.enum(['use', 'equip', 'unequip', 'give', 'drop']).describe('物品操作类型'),
    targetId: z.string().optional().describe('目标 ID (give 给谁, use 对谁使用)'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const player = session.player
    const { itemId, action, targetId } = input

    const itemIdx = player.inventory.findIndex(i => i.name === itemId)
    if (itemIdx === -1 && action !== 'unequip') {
      return { output: `背包中没有"${itemId}"。当前物品：${player.inventory.map(i => i.name).join('、') || '空'}。`, isError: true }
    }

    const item = action === 'unequip' ? undefined : player.inventory[itemIdx]

    let result: { output: string; isError?: boolean }

    switch (action) {
      case 'use': {
        if (item!.type === 'potion') {
          const potionName = item!.name
          player.inventory.splice(itemIdx, 1)

          // 治疗药水：直接恢复 HP
          if (item!.bonus && item!.bonus > 0) {
            let healAmount = rollDice(`${item!.bonus}d4+2`).total
            // 牧师 Lv8 被动：治疗 +50%
            if (session.worldState.flags['passive_cleric_divine_grace']) {
              healAmount = Math.floor(healAmount * 1.5)
            }
            const oldHp = player.hp
            player.hp = Math.min(player.maxHp, player.hp + healAmount)
            facts.addEvent(`使用${potionName}，恢复${player.hp - oldHp}HP`)
            result = { output: `使用${potionName}：恢复${player.hp - oldHp}HP(${oldHp}→${player.hp}/${player.maxHp})。物品已消耗。` }
            break
          }

          // 解毒剂：清除毒素 + 毒素免疫 3 回合
          if (potionName.includes('解毒')) {
            const eff = applyEffect(player, {
              name: '解毒',
              type: 'poison_immunity',
              value: 1,
              turns: 3,
              source: 'potion',
              damageType: 'poison',
            })
            facts.addEvent(`使用${potionName}，获得毒素免疫(${eff.remainingTurns}轮)`)
            result = { output: `使用${potionName}：毒素被清除，3轮内免疫毒素伤害。物品已消耗。` }
            break
          }

          // 暗影防护药水：死灵伤害抗性 3 回合
          if (potionName.includes('暗影防护')) {
            const eff = applyEffect(player, {
              name: '暗影防护',
              type: 'resistance',
              value: 0.5,  // 减半
              turns: 3,
              source: 'potion',
              damageType: 'necrotic',
            })
            facts.addEvent(`使用${potionName}，获得死灵抗性(${eff.remainingTurns}轮)`)
            result = { output: `使用${potionName}：3轮内死灵伤害减半。物品已消耗。` }
            break
          }

          // 防火药膏：fire 抗性
          if (potionName.includes('防火')) {
            applyEffect(player, {
              name: '防火药膏',
              type: 'resistance',
              value: 0.5,
              turns: 30,
              source: 'potion',
              damageType: 'fire',
            })
            facts.addEvent(`使用防火药膏，获得火焰抗性`)
            result = { output: `使用防火药膏：接下来的战斗中火焰伤害减半。物品已消耗。` }
            break
          }

          // 抗麻痹药剂：免疫麻痹
          if (potionName.includes('抗麻痹')) {
            applyEffect(player, {
              name: '抗麻痹',
              type: 'poison_immunity', // 复用现有类型，语义扩展为"状态免疫"
              value: 1,
              turns: 30,
              source: 'potion',
              damageType: 'paralysis', // 用这个标记区分毒素免疫和麻痹免疫
            })
            facts.addEvent(`使用抗麻痹药剂，获得麻痹免疫`)
            result = { output: `使用抗麻痹药剂：接下来的战斗中免疫麻痹状态。对付食尸鬼和鸡蛇兽极为有效！物品已消耗。` }
            break
          }

          // 其他药水：通用消耗（描述效果）
          facts.addEvent(`使用${potionName}`)
          result = { output: `使用${potionName}：${item!.description}。物品已消耗。` }
          break
        }
        if (item!.type === 'quest') {
          facts.addEvent(`使用任务物品${item!.name}`, 'critical')
          result = { output: `使用任务物品${item!.name}：${item!.description}。` }
          break
        }

        // 涂层道具：武器附加伤害类型
        if (item!.type === 'misc' && (item as any).damageType) {
          const coating = item as any
          const coatingType = coating.damageType as string
          player.inventory.splice(itemIdx, 1)

          // 涂层互斥：检查并移除已有的涂层效果
          const existingCoating = (player.activeEffects || []).find(e =>
            e.type === 'damage_bonus' && e.source === 'potion' && e.value === 0
          )
          const hadOldCoating = !!existingCoating
          if (player.activeEffects && existingCoating) {
            player.activeEffects = player.activeEffects.filter(e => e !== existingCoating)
          }

          // 添加 ActiveEffect：damage_bonus 类型，带 damageType
          applyEffect(player, {
            name: coating.name,
            type: 'damage_bonus',
            value: 0,  // 不增加数值伤害，只添加伤害类型
            turns: 30, // 持续足够长（一场战斗通常不超过20回合）
            source: 'potion',
            damageType: coatingType,
          })

          const typeNames: Record<string, string> = {
            fire: '火焰', cold: '冰冻', lightning: '雷电', radiant: '光辉',
          }
          const typeName = typeNames[coatingType] || coatingType

          facts.addEvent(`使用${coating.name}，武器附加${typeName}伤害`)
          if (hadOldCoating) {
            result = { output: `使用${coating.name}：替换了之前的涂层。武器现在附加${typeName}伤害类型。物品已消耗。` }
          } else {
            result = { output: `使用${coating.name}：武器附加${typeName}伤害类型。对该类型有弱点的怪物将受到双倍伤害！物品已消耗。` }
          }
          break
        }

        // 火把：使用后获得光源效果
        if (item!.name.includes('火把')) {
          player.inventory.splice(itemIdx, 1)
          applyEffect(player, {
            name: '火把',
            type: 'light',
            value: 2,   // 搜索检定 +2
            turns: 10,   // 持续 10 轮
            source: 'equipment',
          })
          facts.addEvent('点燃火把，照亮周围')
          result = { output: `点燃火把：10轮内在黑暗区域搜索检定+2。物品已消耗。` }
          break
        }

        result = { output: `${item!.name}(${item!.type})无法直接使用。` }
        break
      }
      case 'equip': {
        if (item!.type === 'weapon') {
          if (player.equipped.weapon) player.inventory.push(player.equipped.weapon)
          player.equipped.weapon = item!
          player.inventory.splice(itemIdx, 1)
          result = { output: `装备武器：${item!.name}。${item!.description}` }
          break
        }
        if (item!.type === 'armor') {
          if (player.equipped.armor) player.inventory.push(player.equipped.armor)
          player.equipped.armor = item!
          player.inventory.splice(itemIdx, 1)
          result = { output: `装备护甲：${item!.name}。${item!.description}` }
          break
        }
        result = { output: `${item!.name}(${item!.type})无法装备。` }
        break
      }
      case 'unequip': {
        if (player.equipped.weapon && itemId === player.equipped.weapon.name) {
          player.inventory.push(player.equipped.weapon)
          const name = player.equipped.weapon.name
          player.equipped.weapon = undefined
          result = { output: `卸下武器${name}，放入背包。` }
          break
        }
        if (player.equipped.armor && itemId === player.equipped.armor.name) {
          player.inventory.push(player.equipped.armor)
          const name = player.equipped.armor.name
          player.equipped.armor = undefined
          result = { output: `卸下护甲${name}，放入背包。` }
          break
        }
        return { output: `${itemId}未被装备。`, isError: true }
      }
      case 'give': {
        if (!targetId) return { output: 'give操作需指定targetId。', isError: true }
        const npc = session.npcs.find(n => n.name === targetId)
        if (!npc) return { output: `NPC"${targetId}"不存在。`, isError: true }
        if (npc.location !== session.worldState.currentLocation) {
          return { output: `${npc.name}不在这里，无法给予物品。`, isError: true }
        }
        const givenItem = player.inventory.splice(itemIdx, 1)[0]
        if (!npc.inventory) npc.inventory = []
        npc.inventory.push(givenItem)  // 物品守恒：加入 NPC 背包
        facts.addEvent(`将${item!.name}交给${npc.name}`)
        result = { output: `将${item!.name}交给${npc.name}。` }
        break
      }
      case 'drop': {
        player.inventory.splice(itemIdx, 1)
        result = { output: `丢弃${item!.name}。` }
        break
      }
      default:
        return { output: `未知操作: ${action}`, isError: true }
    }

    // 战斗中使用物品后，怪物获得反击回合
    if (session.combat?.active && !result!.isError) {
      const monsterResult = executeMonsterTurns(session)
      if (monsterResult.log.length > 0) {
        const isNpcFight = session.combat?.monsters.some(m => session.npcs.some(n => n.name === m.name))
        result!.output += `\n\n[${isNpcFight ? '敌方回合' : '怪物回合'}]\n` + monsterResult.log.join('\n')
      }
      const check = checkCombatEnd(session)
      if (check.ended && check.result === 'defeat') {
        result!.output += '\n\n=== 战斗失败 ==='
        endCombat(session)
      } else if (session.combat?.active) {
        result!.output += '\n\n' + (getCombatSummary(session) ?? '')
      }
    }

    return result!
  },
}
