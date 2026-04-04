/**
 * 🧪 使用物品工具
 *
 * 使用、装备、或交换背包中的物品。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession, getFacts } from '../game-state.js'
import { rollDice } from '../rules-engine.js'
import { executeMonsterTurns, checkCombatEnd, endCombat, getCombatSummary } from '../combat-manager.js'

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
          // Healing potion: roll healing
          const healAmount = item!.bonus
            ? rollDice(`${item!.bonus}d4+2`).total
            : 0
          if (healAmount > 0) {
            const oldHp = player.hp
            player.hp = Math.min(player.maxHp, player.hp + healAmount)
            player.inventory.splice(itemIdx, 1)
            facts.addEvent(`使用${item!.name}，恢复${player.hp - oldHp}HP`)
            result = { output: `使用${item!.name}：恢复${player.hp - oldHp}HP(${oldHp}→${player.hp}/${player.maxHp})。物品已消耗。` }
            break
          }
          // Non-healing potion (antidote, shadow ward, etc.)
          player.inventory.splice(itemIdx, 1)
          facts.addEvent(`使用${item!.name}`)
          result = { output: `使用${item!.name}：${item!.description}。物品已消耗。` }
          break
        }
        if (item!.type === 'quest') {
          facts.addEvent(`使用任务物品${item!.name}`, 'critical')
          result = { output: `使用任务物品${item!.name}：${item!.description}。` }
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
        if (itemId === player.equipped.weapon?.name) {
          player.inventory.push(player.equipped.weapon)
          const name = player.equipped.weapon.name
          player.equipped.weapon = undefined
          result = { output: `卸下武器${name}，放入背包。` }
          break
        }
        if (itemId === player.equipped.armor?.name) {
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
        result!.output += '\n\n[怪物回合]\n' + monsterResult.log.join('\n')
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
