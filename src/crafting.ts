/**
 * crafting.ts — 格罗姆铸造系统
 *
 * Boss 材料 + 金币 → 职业专属武器
 * 铸造需要：格罗姆信任度 ≥ minTrust，材料在背包中，足够金币
 */

import type { GameSession, Item } from './types.js'

export interface CraftingRecipe {
  material: string        // 需要的材料名
  goldCost: number        // 金币花费
  minTrust: number        // 格罗姆最低信任度
  results: Record<string, Item>  // classId → 铸造出的武器
  description: string     // 铸造描述（给 DM 叙事用）
}

/** 铸造配方表 */
export const CRAFTING_RECIPES: CraftingRecipe[] = [
  {
    material: '蛛母毒腺',
    goldCost: 30,
    minTrust: 2,
    description: '格罗姆接过蛛母毒腺，翻来覆去端详了半天。"好东西，"他嘟囔着，"这毒腺里还残留着火焰般的能量……给我点时间。"',
    results: {
      fighter: { name: '蛛毒刺剑', type: 'weapon', weaponType: 'melee', description: '格罗姆用蛛母毒腺淬炼的刺剑，剑身泛着紫黑色的光泽。每次命中有概率注入毒素。造成1d8+1穿刺伤害。', bonus: 1, damageType: 'piercing', bonusDamageType: 'fire' },
      ranger:  { name: '蛛丝长弓', type: 'weapon', weaponType: 'ranged', description: '以蛛母的暗紫色蛛丝为弦的长弓，箭矢射出时带着灼热的气息。造成1d8+1穿刺伤害，附带火焰伤害。', bonus: 1, damageType: 'piercing', bonusDamageType: 'fire' },
      mage:    { name: '蛛丝法杖', type: 'weapon', weaponType: 'melee', description: '缠绕蛛母暗紫丝线的法杖，杖端凝聚着灼热的魔力。提升法术伤害+1。造成1d6穿刺伤害。', bonus: 1, damageType: 'piercing', bonusDamageType: 'fire' },
      cleric:  { name: '蛛骨圣锤', type: 'weapon', weaponType: 'melee', description: '以蛛母甲壳加固的战锤，锤头散发微弱的火光。造成1d8+1钝击伤害，附带火焰伤害。', bonus: 1, damageType: 'bludgeoning', bonusDamageType: 'fire' },
    },
  },
  {
    material: '暗影核心',
    goldCost: 60,
    minTrust: 3,
    description: '格罗姆盯着暗影核心，黑色的结晶在他掌心微微搏动。"这东西……我需要灵银才能驯化它。"他走向炉火，眼中燃起了锻造师特有的执着。',
    results: {
      fighter: { name: '暗影斩', type: 'weapon', weaponType: 'melee', description: '格罗姆将暗影核心镶嵌在灵银剑身中，光与暗的力量在剑刃上交织。造成1d10+2劈砍伤害，附带光辉伤害。', bonus: 2, damageType: 'slashing', bonusDamageType: 'radiant' },
      ranger:  { name: '暗影猎弓', type: 'weapon', weaponType: 'ranged', description: '弓身嵌入暗影核心碎片，每支箭矢射出时都裹着银白色的光辉。造成1d8+2穿刺伤害，附带光辉伤害。', bonus: 2, damageType: 'piercing', bonusDamageType: 'radiant' },
      mage:    { name: '暗影法杖', type: 'weapon', weaponType: 'melee', description: '以暗影核心为杖芯，灵银丝缠绕的法杖。暗影的力量被光辉驯化，提升法术伤害+2。造成1d6钝击伤害。', bonus: 1, damageType: 'bludgeoning', bonusDamageType: 'radiant' },
      cleric:  { name: '光铸战锤', type: 'weapon', weaponType: 'melee', description: '暗影核心被净化后嵌入锤头，每次挥击都释放出圣洁的光芒。造成1d10+2钝击伤害，附带光辉伤害。', bonus: 2, damageType: 'bludgeoning', bonusDamageType: 'radiant' },
    },
  },
  {
    material: '虚空碎片',
    goldCost: 100,
    minTrust: 5,
    description: '格罗姆接过虚空碎片，双手微微颤抖——不是恐惧，是兴奋。"我等这一天等了一辈子，"他低声说，"这是锻造师毕生只能遇到一次的材料。"他点燃了从未使用过的远古熔炉。',
    results: {
      fighter: { name: '破虚之刃', type: 'weapon', weaponType: 'melee', description: '格罗姆的毕生杰作。虚空碎片被锻入灵银剑身，剑刃在光暗之间闪烁。能同时造成光辉和冰冻伤害。造成1d12+3劈砍伤害。', bonus: 3, damageType: 'slashing', bonusDamageType: 'radiant' },
      ranger:  { name: '虚空长弓', type: 'weapon', weaponType: 'ranged', description: '弓臂由虚空碎片与灵银合金铸成，箭矢命中时在目标身上绽放光辉裂痕。造成1d10+3穿刺伤害，附带光辉伤害。', bonus: 3, damageType: 'piercing', bonusDamageType: 'radiant' },
      mage:    { name: '虚空法杖', type: 'weapon', weaponType: 'melee', description: '虚空碎片悬浮在杖端的灵银笼中，散发着令人敬畏的光芒。法术伤害+3，施法时虚空能量与法术交融。造成1d6钝击伤害。', bonus: 1, damageType: 'bludgeoning', bonusDamageType: 'radiant' },
      cleric:  { name: '曙光圣锤', type: 'weapon', weaponType: 'melee', description: '虚空碎片被神圣之力彻底净化，化为锤头的核心。这是破晓镇三千年来最强的圣器。造成1d12+3钝击伤害，附带光辉伤害。', bonus: 3, damageType: 'bludgeoning', bonusDamageType: 'radiant' },
    },
  },
]

/** 检测玩家职业（通过技能组合推断） */
function detectClassId(session: GameSession): string {
  const skills = session.player.skills
  if (skills.includes('arcana')) return 'mage'
  if (skills.includes('stealth') && skills.includes('perception')) return 'ranger'
  if (skills.includes('medicine')) return 'cleric'
  return 'fighter'
}

/**
 * 检查玩家是否可以铸造某个配方
 * 返回 null 表示可以铸造，否则返回失败原因
 */
export function checkCanCraft(session: GameSession, recipe: CraftingRecipe): string | null {
  // 检查材料
  const hasMaterial = session.player.inventory.some(i => i.name === recipe.material)
  if (!hasMaterial) return `你没有${recipe.material}。`

  // 检查金币
  if (session.player.gold < recipe.goldCost) {
    return `铸造需要 ${recipe.goldCost} 金币，你只有 ${session.player.gold} 金币。`
  }

  // 检查格罗姆信任度
  const grom = session.npcs.find(n => n.name === '格罗姆')
  if (!grom || grom.trust < recipe.minTrust) {
    return `格罗姆对你还不够信任（需要信任度 ${recipe.minTrust}）。`
  }

  return null // 可以铸造
}

/**
 * 执行铸造
 * 消耗材料 + 金币 → 返回铸造出的武器
 */
export function executeCraft(session: GameSession, recipe: CraftingRecipe): {
  success: boolean
  weapon?: Item
  error?: string
  description: string
} {
  const canCraft = checkCanCraft(session, recipe)
  if (canCraft) {
    return { success: false, error: canCraft, description: '' }
  }

  const classId = detectClassId(session)
  const weapon = recipe.results[classId]
  if (!weapon) {
    return { success: false, error: '无法为你的职业铸造武器。', description: '' }
  }

  // 消耗材料
  const matIdx = session.player.inventory.findIndex(i => i.name === recipe.material)
  session.player.inventory.splice(matIdx, 1)

  // 消耗金币
  session.player.gold -= recipe.goldCost

  // 给予武器
  session.player.inventory.push({ ...weapon })

  return {
    success: true,
    weapon,
    description: recipe.description,
  }
}

/**
 * 检查玩家背包中是否有可铸造的材料
 * 返回所有可用的铸造配方
 */
export function getAvailableRecipes(session: GameSession): CraftingRecipe[] {
  return CRAFTING_RECIPES.filter(r =>
    session.player.inventory.some(i => i.name === r.material)
  )
}

/**
 * 根据材料名找到配方
 */
export function findRecipeByMaterial(materialName: string): CraftingRecipe | undefined {
  return CRAFTING_RECIPES.find(r => r.material === materialName)
}
