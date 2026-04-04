import type { GameSession, Item, NPCRole } from './types.js'
import type { ItemRegistry } from './item-registry.js'

export interface TransferRequest {
  item: Item
  fromType: 'npc' | 'monster_loot' | 'environment' | 'player'
  fromId?: string
  toType: 'player' | 'npc'
  toId?: string
  transferType: 'gift' | 'quest_reward' | 'buy' | 'sell' | 'loot' | 'found' | 'give'
  goldAmount?: number
  isDynamic?: boolean
}

export interface ValidationResult {
  valid: boolean
  reason?: string
  warnings?: string[]
  autoPrice?: number // suggested price for dynamic items
}

// Role -> allowed item types mapping
const ROLE_ITEM_RULES: Record<NPCRole, string[]> = {
  blacksmith: ['weapon', 'armor', 'misc'],
  herbalist: ['potion', 'misc'],
  guild_leader: ['quest', 'misc'],
  guild_officer: ['quest', 'misc'],
  innkeeper: ['misc'],
  mayor: ['quest', 'misc'],
  bard: ['misc'],
  child: ['misc'],
  general: ['misc', 'quest'],
  guard: ['weapon', 'armor', 'misc'],
}

// Max item bonus by player level
const MAX_BONUS_BY_LEVEL: Record<number, number> = { 1: 1, 2: 2, 3: 3 }

export function validateTransfer(
  request: TransferRequest,
  session: GameSession,
  registry: ItemRegistry,
): ValidationResult {
  const warnings: string[] = []

  // 1. Loot and environment transfers are always valid (already code-controlled)
  if (request.transferType === 'loot' || request.transferType === 'found') {
    return { valid: true, warnings }
  }

  // 2. Player giving items — just check they have it
  if (request.fromType === 'player') {
    const has = session.player.inventory.some(i => i.name === request.item.name)
    if (!has) return { valid: false, reason: `玩家背包中没有"${request.item.name}"` }
    return { valid: true, warnings }
  }

  // 3. NPC source checks
  if (request.fromType === 'npc' && request.fromId) {
    const npc = session.npcs.find(n => n.name === request.fromId)
    if (!npc) return { valid: false, reason: `NPC "${request.fromId}" 不存在` }

    // Location check
    if (npc.location !== session.worldState.currentLocation) {
      return { valid: false, reason: `${npc.name}不在当前位置` }
    }

    // Check if NPC has the item
    const npcHas = (npc.inventory ?? []).some(i => i.name === request.item.name)

    if (!npcHas && !request.isDynamic) {
      return { valid: false, reason: `${npc.name}没有"${request.item.name}"` }
    }

    // Dynamic item validation
    if (request.isDynamic) {
      const role = npc.role ?? 'general'
      const allowedTypes = ROLE_ITEM_RULES[role] ?? ['misc']

      // Role-type check
      if (!allowedTypes.includes(request.item.type)) {
        return {
          valid: false,
          reason: `${npc.name}(${role})不能提供${request.item.type}类物品`,
        }
      }

      // Power level check
      if (request.item.bonus != null) {
        const maxBonus = MAX_BONUS_BY_LEVEL[session.player.level] ?? 3
        if (request.item.bonus > maxBonus) {
          return {
            valid: false,
            reason: `物品加值+${request.item.bonus}超过当前等级上限+${maxBonus}`,
          }
        }
      }

      // Quest item: check knownFacts correlation
      if (request.item.type === 'quest') {
        const itemWords = `${request.item.name}${request.item.description}`.split('')
        const factsText = npc.knownFacts.map(f => typeof f === 'string' ? f : f.text).join('')
        const hasCorrelation = itemWords.some(w => w.length > 1 && factsText.includes(w))
        if (!hasCorrelation) {
          warnings.push(`${npc.name}的已知信息与"${request.item.name}"关联较弱`)
        }
      }

      // Estimate price
      const basePrice = { weapon: 15, armor: 20, potion: 25, quest: 0, misc: 5 }
      const autoPrice = (basePrice[request.item.type as keyof typeof basePrice] ?? 5)
        + (request.item.bonus ?? 0) * 10

      return { valid: true, warnings, autoPrice }
    }

    // Buy: check gold
    if (request.transferType === 'buy' && request.goldAmount != null) {
      if (session.player.gold < request.goldAmount) {
        return { valid: false, reason: `金币不足（需要${request.goldAmount}，拥有${session.player.gold}）` }
      }
    }
  }

  return { valid: true, warnings }
}
