/**
 * 战斗管理器
 *
 * 管理完整战斗生命周期：先攻 → 回合 → 伤害 → 怪物反击 → 战利品。
 * 所有战斗结果由此模块确定性计算，DM 只负责叙事描写。
 */

import type { GameSession, Monster, MonsterInstance, AllyInstance, CombatState, InitiativeEntry, DamageType } from './types.js'
import { initCombatGrid, manhattan, posEqual, parseKey } from './combat-grid.js'
import { COMBAT_TERRAINS } from './data/maps.js'
import {
  rollInitiative, attackRoll, rollDamage, rollDice,
  calculatePlayerAC, parseAttackMod, castSpell,
} from './rules-engine.js'
import { getFacts } from './game-state.js'
import { getEffectBonus, hasEffect, tickEffects, applyEffect } from './effect-manager.js'
import { changeTrust } from './trust-system.js'
import { markEncountered, discoverImmunity, discoverWeakness, discoverResistance, getBestiaryBonuses } from './bestiary.js'

const PROFICIENCY = 2

// ─── 伤害类型解析 & 弱点/抗性/免疫乘数 ────────────

/**
 * 解析攻击的伤害类型
 * 优先使用武器/涂层的 damageType，未指定时根据武器描述推断
 */
function resolveAttackDamageType(
  weapon?: { damageType?: DamageType; bonusDamageType?: DamageType },
  activeEffects?: Array<{ type: string; damageType?: string }>
): DamageType[] {
  const types: DamageType[] = []
  if (weapon?.damageType) types.push(weapon.damageType)
  if (weapon?.bonusDamageType) types.push(weapon.bonusDamageType)
  // 涂层效果：activeEffects 中 type='damage_bonus' 且有 damageType 的
  if (activeEffects) {
    for (const e of activeEffects) {
      if (e.type === 'damage_bonus' && e.damageType) {
        types.push(e.damageType as DamageType)
      }
    }
  }
  return types.length > 0 ? types : ['slashing'] // 默认斩击
}

/**
 * 计算弱点/抗性/免疫乘数
 * 如果攻击有多个伤害类型，取最有利的乘数
 */
function getWeaknessMultiplier(
  attackTypes: DamageType[],
  target: { vulnerability?: DamageType[]; resistance?: DamageType[]; immunity?: DamageType[] }
): { multiplier: number; effectType: 'vulnerable' | 'resistant' | 'immune' | 'normal'; matchedType?: DamageType } {
  let bestResult: { multiplier: number; effectType: 'vulnerable' | 'resistant' | 'immune' | 'normal'; matchedType?: DamageType } =
    { multiplier: 1, effectType: 'normal' }

  for (const atkType of attackTypes) {
    if (target.vulnerability?.includes(atkType)) {
      if (bestResult.multiplier < 2) {
        bestResult = { multiplier: 2, effectType: 'vulnerable', matchedType: atkType }
      }
    } else if (target.immunity?.includes(atkType)) {
      // 只在没有更好选项时标记免疫
      if (bestResult.multiplier === 1 && bestResult.effectType === 'normal') {
        bestResult = { multiplier: 0, effectType: 'immune', matchedType: atkType }
      }
    } else if (target.resistance?.includes(atkType)) {
      if (bestResult.multiplier === 1 && bestResult.effectType !== 'immune') {
        bestResult = { multiplier: 0.5, effectType: 'resistant', matchedType: atkType }
      }
    } else {
      // 普通伤害类型，至少不是免疫
      if (bestResult.effectType === 'immune') {
        bestResult = { multiplier: 1, effectType: 'normal' }
      }
    }
  }

  return bestResult
}

/** 从法术名推断伤害类型 */
function inferSpellDamageType(spellName: string): DamageType[] {
  const name = spellName.toLowerCase()
  if (name.includes('fire') || name === '火球术' || name === 'fireball') return ['fire']
  if (name.includes('radiant') || name === 'guiding bolt' || name === '引导之光') return ['radiant']
  if (name.includes('necrotic')) return ['necrotic']
  if (name.includes('cold') || name.includes('ice') || name.includes('frost')) return ['cold']
  if (name.includes('lightning') || name.includes('thunder')) return ['lightning']
  return ['fire'] // 大多数攻击法术默认火焰
}

// ─── 开始战斗 ───────────────────────────────────

export function startCombat(
  session: GameSession,
  monsterNames: string[],
  monstersDb: Monster[],
): CombatState {
  const player = session.player
  const log: string[] = []

  // 玩家先攻（Lv8 ranger_quick_reflexes: +3 / 图鉴先攻加值）
  const initBonus = session.worldState.flags['passive_ranger_quick_reflexes'] ? 3 : 0
  const bestiaryInitBonus = getBestiaryBonuses(session).initiativeBonus
  const totalInitBonus = initBonus + bestiaryInitBonus
  const playerInit = rollInitiative(player.abilityModifiers.DEX)
  const playerInitTotal = playerInit.total + totalInitBonus
  const initBonusParts: string[] = []
  if (initBonus > 0) initBonusParts.push(`+${initBonus}(快速反应)`)
  if (bestiaryInitBonus > 0) initBonusParts.push(`+${bestiaryInitBonus}(怪物图鉴)`)
  const initBonusStr = initBonusParts.join('')
  log.push(`${player.name} 先攻: d20(${playerInit.roll})+${player.abilityModifiers.DEX}${initBonusStr}=${playerInitTotal}`)

  const initiativeOrder: InitiativeEntry[] = [{
    id: 'player',
    name: player.name,
    initiative: playerInitTotal,
    isPlayer: true,
  }]

  // 创建怪物实例并掷先攻
  const monsters: MonsterInstance[] = []
  const nameCounts: Record<string, number> = {}

  for (const mName of monsterNames) {
    const template = monstersDb.find(m => m.name.toLowerCase() === mName.toLowerCase())
    if (!template) {
      log.push(`警告: 未找到怪物模板 "${mName}"，跳过`)
      continue
    }

    nameCounts[template.name] = (nameCounts[template.name] ?? 0) + 1
    const count = nameCounts[template.name]
    const id = count > 1 ? `${template.name}_${count}` : template.name

    const abilityMod = parseAttackMod(template.damageDice)
    const monsterInit = rollInitiative(abilityMod)

    monsters.push({
      id,
      name: template.name,
      hp: template.hp,
      maxHp: template.hp,
      ac: template.dc,
      attackMod: abilityMod + PROFICIENCY,
      damageDice: template.damageDice,
      specialAbility: template.specialAbility,
      loot: [...template.loot],
      conditions: [],
      vulnerability: template.vulnerability,
      resistance: template.resistance,
      immunity: template.immunity,
    })

    // 图鉴：标记遭遇此怪物
    markEncountered(session, template.name)

    initiativeOrder.push({
      id,
      name: id,
      initiative: monsterInit.total,
      isPlayer: false,
    })

    log.push(`${id} 先攻: d20(${monsterInit.roll})+${abilityMod}=${monsterInit.total}`)
  }

  if (monsters.length === 0) {
    throw new Error('没有有效的怪物加入战斗')
  }

  // 图鉴被动：autoIdentify — 自动识别已知怪物的弱点/抗性/免疫
  const bestiaryBonuses = getBestiaryBonuses(session)
  if (bestiaryBonuses.autoIdentify) {
    for (const m of monsters) {
      const template = monstersDb.find(t => t.name === m.name)
      if (template) {
        if (template.vulnerability?.length) discoverWeakness(session, m.name, '怪物猎人的知识')
        if (template.resistance?.length) discoverResistance(session, m.name, '怪物猎人的知识')
        if (template.immunity?.length) discoverImmunity(session, m.name, '怪物猎人的知识')
      }
    }
    log.push('📖 怪物猎人的知识自动识别了敌人的特性')
  }

  // 创建同伴实例��从 session.party 读取）
  const allies: AllyInstance[] = []
  const partyNames = (session.party ?? []).filter(pn => {
    // 叛变：如果 party 成员同时是敌方，自动移出队伍
    if (monsterNames.some(mn => mn.toLowerCase() === pn.toLowerCase())) {
      session.party = (session.party ?? []).filter(n => n !== pn)
      log.push(`${pn} 背叛�����伍！`)
      return false
    }
    return true
  })

  for (const allyName of partyNames) {
    const npc = session.npcs.find(n => n.name === allyName)
    if (!npc || npc.condition === 'unconscious' || npc.condition === 'recovering') continue
    if (npc.location !== session.worldState.currentLocation) continue

    const template = monstersDb.find(m => m.name.toLowerCase() === allyName.toLowerCase())
    if (!template) continue

    const abilityMod = parseAttackMod(template.damageDice)
    const allyInit = rollInitiative(abilityMod)

    const tmpl = template as any
    allies.push({
      id: allyName,
      name: allyName,
      hp: template.hp,
      maxHp: template.hp,
      ac: template.dc,
      attackMod: abilityMod + PROFICIENCY,
      damageDice: template.damageDice,
      specialAbility: template.specialAbility,
      combatBehavior: tmpl.combatBehavior ?? 'fight',
      allyRole: tmpl.allyRole,
      allyAbility: tmpl.allyAbility,
      damageType: tmpl.damageType,
    })

    initiativeOrder.push({
      id: allyName,
      name: allyName,
      initiative: allyInit.total,
      isPlayer: false,
      isAlly: true,
    })

    log.push(`同伴 ${allyName} 先攻: d20(${allyInit.roll})+${abilityMod}=${allyInit.total}`)
  }

  // 按先攻降序排列，同值玩家优先
  initiativeOrder.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative
    return a.isPlayer ? -1 : 1
  })

  log.push(`行动顺序: ${initiativeOrder.map(c => `${c.name}(${c.initiative})`).join(' → ')}`)

  const combat: CombatState = {
    active: true,
    round: 1,
    initiativeOrder,
    monsters,
    allies,
    log,
  }

  // ── 战棋网格初始化 ──
  // 从武器推断玩家射程：ranged 武器用 gridRange，melee 默认 1
  const playerWeapon = player.equipped?.weapon as any
  const playerAttackRange: number = playerWeapon?.gridRange ?? (playerWeapon?.weaponType === 'ranged' ? 4 : 1)
  // 职业默认移动力：法师 2，其他 3
  const playerMoveSpeed = player.abilityModifiers.INT > player.abilityModifiers.STR &&
    player.abilityModifiers.INT > player.abilityModifiers.DEX ? 2 : 3

  const grid = initCombatGrid({
    areaId: session.worldState.currentLocation,
    terrainTemplates: COMBAT_TERRAINS,
    monsters: monsters.map(m => {
      const tmpl = monstersDb.find(t => t.name.toLowerCase() === m.name.toLowerCase()) as any
      return { id: m.id, moveSpeed: tmpl?.moveSpeed ?? 3, attackRange: tmpl?.attackRange ?? 1 }
    }),
    allies: allies.map(a => {
      const tmpl = monstersDb.find(t => t.name.toLowerCase() === a.name.toLowerCase()) as any
      return { id: a.id, moveSpeed: tmpl?.moveSpeed ?? 3, attackRange: tmpl?.attackRange ?? 1 }
    }),
    player: { id: 'player', moveSpeed: playerMoveSpeed, attackRange: playerAttackRange },
  })

  // 同步网格位置到各单位实例
  for (const m of monsters) {
    const gu = grid.getUnit(m.id)
    if (gu) { m.pos = { ...gu.pos }; m.moveSpeed = gu.moveSpeed; m.attackRange = gu.attackRange }
  }
  for (const a of allies) {
    const gu = grid.getUnit(a.id)
    if (gu) { a.pos = { ...gu.pos }; a.moveSpeed = gu.moveSpeed; a.attackRange = gu.attackRange }
  }
  const playerGridUnit = grid.getUnit('player')
  combat.grid = grid
  combat.playerGridStats = playerGridUnit
    ? { moveSpeed: playerGridUnit.moveSpeed, attackRange: playerGridUnit.attackRange, pos: { ...playerGridUnit.pos } }
    : undefined

  log.push(`⚔ 战棋网格已就绪 (${grid.width}×${grid.height})`)

  session.combat = combat
  const allyInfo = allies.length > 0 ? ` | 同伴: ${allies.map(a => a.name).join(', ')}` : ''
  getFacts().addEvent('战斗开始: ' + monsters.map(m => m.id).join(', ') + allyInfo, 'critical')

  return combat
}

// ─── Buff 法术注册表 ────────────────────────────

interface BuffSpellDef {
  type: import('./types.js').EffectType
  value: number
  turns: number
  description: string
}

const BUFF_SPELLS: Record<string, BuffSpellDef> = {
  'Shield':          { type: 'ac_bonus',     value: 5, turns: 1, description: '魔力屏障闪现，AC+5持续1轮' },
  'Shield of Faith': { type: 'ac_bonus',     value: 2, turns: 3, description: '信仰之盾环绕全身，AC+2持续3轮' },
  "Hunter's Mark":   { type: 'damage_bonus', value: 1, turns: 3, description: '猎人印记锁定目标，攻击额外+1d6伤害持续3轮' },
}

/** 检查法术是否是 buff 类型 */
export function isBuffSpell(spellName: string): boolean {
  return spellName in BUFF_SPELLS
}

/** 施放 buff 法术，返回日志。不消耗攻击行动（但消耗法术位）。 */
export function castBuffSpell(session: GameSession, spellName: string): { log: string[]; success: boolean } {
  const player = session.player
  const def = BUFF_SPELLS[spellName]
  if (!def) return { log: [`${spellName}不是增益法术`], success: false }

  const cast = castSpell(player, spellName)
  if (!cast.success) return { log: [`施法失败: ${cast.reason}`], success: false }

  applyEffect(player, {
    name: spellName,
    type: def.type,
    value: def.value,
    turns: def.turns,
    source: 'spell' as const,
  })

  return {
    log: [`${player.name} 施放 ${spellName}：${def.description}`],
    success: true,
  }
}

// ─── 玩家攻击 ───────────────────────────────────

export function executePlayerAttack(
  session: GameSession,
  targetId: string,
  method: 'weapon' | 'spell',
  spellId?: string,
): { log: string[]; killed: boolean; hit: boolean; isCritical: boolean } {
  const combat = session.combat
  if (!combat?.active) throw new Error('当前没有进行中的战斗')

  const player = session.player
  const log: string[] = []

  // 匹配目标怪物（支持模糊匹配）
  const monster = combat.monsters.find(m =>
    m.id === targetId ||
    m.id.toLowerCase() === targetId.toLowerCase() ||
    m.name.toLowerCase() === targetId.toLowerCase(),
  )
  if (!monster) throw new Error(`目标 "${targetId}" 不在战斗中`)
  if (monster.hp <= 0) throw new Error(`${monster.id} 已经倒下了`)

  if (method === 'spell') {
    if (!spellId) throw new Error('法术攻击需指定 spellId')
    const cast = castSpell(player, spellId)
    if (!cast.success) throw new Error(`施法失败: ${cast.reason}`)

    const spell = player.spells.find(s => s.name === spellId)!
    // 暗影幕布效果：命中-2
    const spellShadowVeilPenalty = session.worldState.flags['boss_shadow_veil'] ? -2 : 0
    const atkMod = player.abilityModifiers.INT + PROFICIENCY + spellShadowVeilPenalty
    if (spellShadowVeilPenalty) log.push(`🌑 暗影幕布笼罩战场，命中-2`)
    const atk = attackRoll(atkMod, monster.ac)

    // Lv8 fighter_crit_range: 暴击范围扩展到 19-20
    const spellCritRange = session.worldState.flags['passive_fighter_crit_range'] ? 19 : 20
    const spellIsCritical = atk.roll >= spellCritRange
    // 扩展暴击范围也让 19 命中（即使 total < AC）
    const spellHits = atk.hits || spellIsCritical

    if (!spellHits) {
      log.push(`${player.name} 施放${spellId}: d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → 未命中`)
      return { log, killed: false, hit: false, isCritical: false }
    }

    const dmgMatch = spell.effect.match(/(\d+d\d+(?:[+-]\d+)?)/i)
    const dmgDice = dmgMatch ? dmgMatch[1] : '1d6'
    let damage = rollDamage(dmgDice)
    if (spellIsCritical) damage += rollDamage(dmgDice)

    // Lv8 mage_spell_power: 法术伤害+2
    if (session.worldState.flags['passive_mage_spell_power']) {
      damage += 2
      log.push('📖 奥术增幅：法术伤害+2')
    }

    // 弱点/抗性/免疫乘数（法术）
    const spellDmgTypes = inferSpellDamageType(spellId)
    const spellWeakness = getWeaknessMultiplier(spellDmgTypes, monster)
    damage = Math.max(1, Math.floor(damage * spellWeakness.multiplier))
    if (spellWeakness.effectType === 'immune') {
      damage = 0
      // 图鉴：战斗试错自动发现免疫
      discoverImmunity(session, monster.name, '战斗试错')
    }

    // 图鉴增强弱点：×2 → ×2.5
    if (spellWeakness.effectType === 'vulnerable') {
      const bonuses = getBestiaryBonuses(session)
      if (bonuses.enhancedVulnerability) {
        damage = Math.floor(damage * 1.25)
        log.push('📖 怪物图鉴精通：弱点伤害增强至×2.5')
      }
    }

    monster.hp = Math.max(0, monster.hp - damage)
    const killed = monster.hp <= 0

    log.push(
      `${player.name} 施放${spellId}: d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → ${spellIsCritical ? '暴击！' : '命中'}`,
      `伤害: ${dmgDice}=${damage}${spellIsCritical ? '(暴击翻倍)' : ''} → ${monster.id} HP: ${monster.hp}/${monster.maxHp}`,
    )
    if (spellWeakness.effectType === 'vulnerable') {
      log.push(`💥 弱点命中！伤害翻倍！`)
      // 累计 radiant 伤害（用于中断暗影编织者自愈，需 ≥10）
      if (spellWeakness.matchedType === 'radiant') {
        const prevRadiant = (session.worldState.flags['boss_radiant_dmg_this_round'] as number) || 0
        session.worldState.flags['boss_radiant_dmg_this_round'] = prevRadiant + damage
      }
    } else if (spellWeakness.effectType === 'resistant') {
      log.push(`🛡️ 目标对该伤害类型有抗性，伤害减半`)
    } else if (spellWeakness.effectType === 'immune') {
      log.push(`❌ 目标对该伤害类型免疫！`)
    }
    if (killed) {
      const isNpc = session.npcs.some(n => n.name === monster.name)
      log.push(isNpc ? `💫 ${monster.id} 失去了意识！` : `☠ ${monster.id} 被击杀！`)
      getFacts().addEvent(isNpc ? `${monster.id}被击倒` : `${monster.id}被击杀`, 'critical')
      const killKey = `kills_${monster.name}`
      session.worldState.flags[killKey] = (Number(session.worldState.flags[killKey] ?? 0)) + 1
    }
    return { log, killed, hit: true, isCritical: spellIsCritical }
  }

  // 武器攻击
  const weapon = player.equipped.weapon
  if (!weapon) throw new Error('未装备武器，无法进行武器攻击')

  const effectAtkBonus = getEffectBonus(player, 'attack_bonus')
  // 暗影幕布效果：命中-2
  const weaponShadowVeilPenalty = session.worldState.flags['boss_shadow_veil'] ? -2 : 0
  // 远程武器用 DEX，近战武器用 STR
  const isRanged = (weapon as any).weaponType === 'ranged'
  const weaponAbilityMod = isRanged ? player.abilityModifiers.DEX : player.abilityModifiers.STR
  const atkMod = weaponAbilityMod + PROFICIENCY + (weapon.bonus ?? 0) + effectAtkBonus + weaponShadowVeilPenalty
  if (weaponShadowVeilPenalty) log.push(`🌑 暗影幕布笼罩战场，命中-2`)
  const atk = attackRoll(atkMod, monster.ac)

  // Lv8 fighter_crit_range: 暴击范围扩展到 19-20
  const weaponCritRange = session.worldState.flags['passive_fighter_crit_range'] ? 19 : 20
  const weaponIsCritical = atk.roll >= weaponCritRange
  // 扩展暴击范围也让 19 命中（即使 total < AC）
  const weaponHits = atk.hits || weaponIsCritical

  if (!weaponHits) {
    log.push(`${player.name} 攻击(${weapon.name}): d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → 未命中`)
    return { log, killed: false, hit: false, isCritical: false }
  }

  const dmgMatch = weapon.description.match(/(\d+d\d+)/i)
  const dmgDice = dmgMatch ? dmgMatch[1] : '1d6'
  let damage = rollDamage(dmgDice) + weaponAbilityMod
  // damage_bonus 效果（如 Hunter's Mark）
  const effectDmgBonus = getEffectBonus(player, 'damage_bonus')
  if (effectDmgBonus > 0) damage += rollDamage(`${effectDmgBonus}d6`)
  if (weaponIsCritical) damage += rollDamage(dmgDice)
  damage = Math.max(1, damage)

  // 弱点/抗性/免疫乘数（武器）
  const attackTypes = resolveAttackDamageType(player.equipped.weapon as any, player.activeEffects)
  const weakness = getWeaknessMultiplier(attackTypes, monster)
  damage = Math.max(1, Math.floor(damage * weakness.multiplier))
  if (weakness.effectType === 'immune') {
    damage = 0
    // 图鉴：战斗试错自动发现免疫
    discoverImmunity(session, monster.name, '战斗试错')
  }

  // 图鉴增强弱点：×2 → ×2.5
  if (weakness.effectType === 'vulnerable') {
    const bonuses = getBestiaryBonuses(session)
    if (bonuses.enhancedVulnerability) {
      damage = Math.floor(damage * 1.25)
      log.push('📖 怪物图鉴精通：弱点伤害增强至×2.5')
    }
  }

  monster.hp = Math.max(0, monster.hp - damage)
  const killed = monster.hp <= 0

  log.push(
    `${player.name} 攻击(${weapon.name}): d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → ${weaponIsCritical ? '暴击！' : '命中'}`,
    `伤害: ${dmgDice}+${player.abilityModifiers.STR}=${damage}${weaponIsCritical ? '(暴击翻倍)' : ''} → ${monster.id} HP: ${monster.hp}/${monster.maxHp}`,
  )
  if (weakness.effectType === 'vulnerable') {
    log.push(`💥 弱点命中！伤害翻倍！`)
    // 累计 radiant 伤害（用于中断暗影编织者自愈，需 ≥10）
    if (weakness.matchedType === 'radiant') {
      const prevRadiant = (session.worldState.flags['boss_radiant_dmg_this_round'] as number) || 0
      session.worldState.flags['boss_radiant_dmg_this_round'] = prevRadiant + damage
    }
  } else if (weakness.effectType === 'resistant') {
    log.push(`🛡️ 目标对该伤害类型有抗性，伤害减半`)
  } else if (weakness.effectType === 'immune') {
    log.push(`❌ 目标对该伤害类型免疫！`)
  }
  if (killed) {
    const isNpc = session.npcs.some(n => n.name === monster.name)
    log.push(isNpc ? `💫 ${monster.id} 失去了意识！` : `☠ ${monster.id} 被击杀！`)
    getFacts().addEvent(isNpc ? `${monster.id}被击倒` : `${monster.id}被击杀`, 'critical')
    const killKey = `kills_${monster.name}`
    session.worldState.flags[killKey] = (Number(session.worldState.flags[killKey] ?? 0)) + 1
  }
  return { log, killed, hit: true, isCritical: weaponIsCritical }
}

// ─── Boss 特殊技能 ──────────────────────────────

/**
 * Boss 特殊技能 — 在怪物普通攻击之后执行
 * 返回额外日志
 */
function executeBossAbility(
  session: GameSession,
  monster: MonsterInstance,
  combat: CombatState,
): string[] {
  const round = combat.round
  const log: string[] = []
  const player = session.player

  // ─── 蛛母·织暗者 ───
  if (monster.name === 'Spider Matriarch') {
    // 吐丝束缚：每 2 回合，束缚一个目标
    if (round % 2 === 0) {
      // 选择目标：玩家或盟友
      const aliveAllies = (combat.allies ?? []).filter(a => a.hp > 0)
      const targets = [{ id: 'player', name: player.name }, ...aliveAllies.map(a => ({ id: a.id, name: a.name }))]
      const webTarget = targets[Math.floor(Math.random() * targets.length)]
      // DC 12 STR 检定
      const strMod = webTarget.id === 'player' ? player.abilityModifiers.STR : 0
      const roll = Math.floor(Math.random() * 20) + 1
      const total = roll + strMod
      if (total < 12) {
        log.push(`🕸️ 蛛母吐出暗紫色蛛丝缠住了${webTarget.name}！(STR检定 d20(${roll})+${strMod}=${total} < DC12，束缚1回合)`)
        // 束缚效果：下回合命中-2（简化处理，不用 condition 系统）
        if (webTarget.id === 'player') {
          combat.playerDefending = false // 取消防御
          // 用 flag 标记被缠
          session.worldState.flags['boss_web_player'] = 1
        }
      } else {
        log.push(`🕸️ 蛛母吐出蛛丝，但${webTarget.name}挣脱了！(STR检定 d20(${roll})+${strMod}=${total} ≥ DC12)`)
      }
    }

    // Phase 2：HP ≤ 50% 时召唤小蜘蛛（只触发一次）
    if (monster.hp <= monster.maxHp * 0.5 && !monster.conditions.includes('phase2')) {
      monster.conditions.push('phase2')
      log.push(`⚠️ 蛛母发出刺耳的尖啸！两只巨型蜘蛛从暗处冲出！`)
      // 创建 2 只小蜘蛛（半血版 Giant Spider）
      for (let i = 1; i <= 2; i++) {
        const spiderling: MonsterInstance = {
          id: `Spiderling_${i}`,
          name: 'Giant Spider',
          hp: 15,  // 半血
          maxHp: 15,
          ac: 13,
          attackMod: 4,
          damageDice: '1d8+2',
          specialAbility: 'Web',
          loot: ['蜘蛛丝'],
          conditions: [],
          vulnerability: ['fire'],
        }
        combat.monsters.push(spiderling)
        combat.initiativeOrder.push({
          id: spiderling.id,
          name: spiderling.id,
          initiative: Math.floor(Math.random() * 20) + 1 + 2,
          isPlayer: false,
        })
      }
    }
  }

  // ─── 暗影编织者 ───
  if (monster.name === 'Shadow Weaver') {
    // 暗影治愈：每回合恢复 3 HP（除非本回合累计 radiant 伤害 ≥ 10）
    const radiantDmgThisRound = (session.worldState.flags['boss_radiant_dmg_this_round'] as number) || 0
    if (radiantDmgThisRound < 10) {
      const healed = Math.min(3, monster.maxHp - monster.hp)
      if (healed > 0) {
        monster.hp += healed
        log.push(`💀 暗影编织者吸收周围的黑暗修复自身(+${healed}HP → ${monster.hp}/${monster.maxHp})`)
      }
      if (radiantDmgThisRound > 0) {
        log.push(`✨ 光辉伤害不足以中断自愈（${radiantDmgThisRound}/10）`)
      }
    } else {
      log.push(`✨ 强烈的光辉之力中断了暗影编织者的自愈！(本回合光辉伤害: ${radiantDmgThisRound})`)
    }
    delete session.worldState.flags['boss_radiant_dmg_this_round']

    // 暗影幕布：每 3 回合，全体命中 -2（持续 1 回合）
    if (round % 3 === 0) {
      log.push(`🌑 暗影编织者释放暗影幕布！浓厚的黑暗笼罩了整个战场！(全体命中-2，持续1回合)`)
      session.worldState.flags['boss_shadow_veil'] = 1
    }

    // Phase 2：HP ≤ 40% 时分裂出暗影（只触发一次）
    if (monster.hp <= monster.maxHp * 0.4 && !monster.conditions.includes('phase2')) {
      monster.conditions.push('phase2')
      log.push(`⚠️ 暗影编织者的身体撕裂，一团暗影从它体内分离出来！`)
      const shadow: MonsterInstance = {
        id: 'Shadow_clone',
        name: 'Shadow',
        hp: 24,
        maxHp: 24,
        ac: 13,
        attackMod: 4,
        damageDice: '1d8+3',
        specialAbility: 'Strength Drain',
        loot: ['暗影精华'],
        conditions: [],
        vulnerability: ['radiant'],
        resistance: ['cold'],
        immunity: ['necrotic'],
      }
      combat.monsters.push(shadow)
      combat.initiativeOrder.push({
        id: shadow.id,
        name: shadow.id,
        initiative: Math.floor(Math.random() * 20) + 1 + 2,
        isPlayer: false,
      })
    }
  }

  // ─── 蚀日兽 ───
  if (monster.name === 'Eclipsed Beast') {
    // 虚空脉冲：每 3 回合，对所有非怪物目标造成 2d6 necrotic
    if (round % 3 === 0) {
      const pulseDmg1 = rollDamage('2d6')
      log.push(`💜 蚀日兽释放虚空脉冲！一波暗蚀能量冲击所有人！`)

      // 对玩家造成伤害
      let playerDmg = pulseDmg1
      if (hasEffect(player, 'resistance', 'necrotic')) {
        playerDmg = Math.floor(playerDmg * 0.5)
        log.push(`🛡️ 暗影防护减免了部分伤害`)
      }
      player.hp = Math.max(0, player.hp - playerDmg)
      log.push(`${player.name} 受到 ${playerDmg} 点暗蚀伤害 (HP: ${player.hp}/${player.maxHp})`)

      // 对盟友造成伤害
      for (const ally of (combat.allies ?? []).filter(a => a.hp > 0)) {
        const allyDmg = rollDamage('2d6')
        ally.hp = Math.max(0, ally.hp - allyDmg)
        log.push(`${ally.name} 受到 ${allyDmg} 点暗蚀伤害 (HP: ${ally.hp}/${ally.maxHp})`)
        if (ally.hp <= 0) {
          log.push(`${ally.name} 倒下了！`)
        }
      }
    }

    // Phase 2：HP ≤ 40% 虚空狂暴（只触发一次）
    if (monster.hp <= monster.maxHp * 0.4 && !monster.conditions.includes('phase2')) {
      monster.conditions.push('phase2')
      monster.damageDice = '2d10+5'
      monster.ac = 13  // AC 从 15 降到 13（暴露弱点）
      // Phase 2: 暗影护甲碎裂，暴露虚空本体
      // 虚空本体对光辉有适应性（radiant 从弱点变为抗性）
      // 但对极寒脆弱（cold 成为唯一弱点）
      monster.vulnerability = ['cold']       // cold 变成唯一弱点
      monster.resistance = ['radiant']       // radiant 从弱点变成抗性！
      monster.immunity = ['necrotic']        // 保持不变
      log.push(`⚠️ 蚀日兽的暗影护甲碎裂，暴露出虚空本体！它对光辉的反应似乎变了……而周围的温度骤然下降。`)
    }
  }

  return log
}

// ─── 怪物回合 ───────────────────────────────────

export type MonsterHitRecord = {
  monsterName: string
  targetName: string      // 被攻击目标名
  targetIsAlly: boolean   // true = 攻击的是同伴
  hit: boolean
  isCritical: boolean
  damage: number
  playerKilled: boolean
  allyKilled: boolean
}

/** 怪物移动记录（供前端播放动画） */
export interface GridMoveRecord {
  unitId: string
  path: Array<{ x: number; y: number }>
}

export function executeMonsterTurns(session: GameSession, onlyIds?: string[]): {
  log: string[]
  hits: MonsterHitRecord[]
  gridMoves: GridMoveRecord[]
} {
  const combat = session.combat
  if (!combat?.active) return { log: [], hits: [], gridMoves: [] }

  const player = session.player
  let playerAC = calculatePlayerAC(player)
  if (combat.playerDefending) playerAC += 2
  const log: string[] = []
  const hits: MonsterHitRecord[] = []
  const gridMoves: GridMoveRecord[] = []
  const grid = combat.grid

  for (const entry of combat.initiativeOrder) {
    if (entry.isPlayer || entry.isAlly) continue  // 跳过玩家和同伴
    if (onlyIds && !onlyIds.includes(entry.id)) continue

    const monster = combat.monsters.find(m => m.id === entry.id)
    if (!monster || monster.hp <= 0) continue

    // 被擒拿的怪物跳过行动，并在回合结束后解除
    if (monster.conditions.includes('grappled')) {
      log.push(`${monster.id} 被擒拿，无法行动！`)
      monster.conditions = monster.conditions.filter(c => c !== 'grappled')
      hits.push({ monsterName: monster.name, targetName: '', targetIsAlly: false, hit: false, isCritical: false, damage: 0, playerKilled: false, allyKilled: false })
      continue
    }

    // ── 战棋移动 AI ──
    // 当网格存在时，怪物先移动再攻击
    let canAttackAfterMove = true
    if (grid && monster.pos) {
      const gridUnit = grid.getUnit(monster.id)
      if (gridUnit) {
        const attackable = grid.getAttackableTargets(monster.id)
        if (attackable.length > 0) {
          // 能打到目标 → 选权重最高的（先找玩家，再找嘲讽盟友）
          const aliveAlliesForAI = (combat.allies ?? []).filter(a => a.hp > 0)
          let bestTarget = attackable[0]
          let bestWeight = 0
          for (const opt of attackable) {
            let w = 1
            if (opt.targetId === 'player') w = 2
            else {
              const ally = aliveAlliesForAI.find(a => a.id === opt.targetId)
              if (ally?.allyAbility?.effect === 'taunt') w = 3
            }
            if (w > bestWeight) { bestWeight = w; bestTarget = opt }
          }
          // 移动到攻击位
          if (!posEqual(gridUnit.pos, bestTarget.attackFrom)) {
            const path = grid.moveUnit(monster.id, bestTarget.attackFrom)
            if (path.length > 1) {
              monster.pos = { ...bestTarget.attackFrom }
              gridMoves.push({ unitId: monster.id, path })
            }
          }
        } else {
          // 够不到任何目标 → 朝最近的敌方单位移动
          canAttackAfterMove = false
          const playerUnit = grid.getUnit('player')
          if (playerUnit) {
            const reachable = grid.getReachable(monster.id)
            // 找可达格中离玩家最近的
            let bestPos = gridUnit.pos
            let bestDist = manhattan(gridUnit.pos, playerUnit.pos)
            for (const [key] of reachable) {
              const p = parseKey(key)
              const d = manhattan(p, playerUnit.pos)
              if (d < bestDist) { bestDist = d; bestPos = p }
            }
            if (!posEqual(bestPos, gridUnit.pos)) {
              const path = grid.moveUnit(monster.id, bestPos)
              if (path.length > 1) {
                monster.pos = { ...bestPos }
                gridMoves.push({ unitId: monster.id, path })
              }
            }
          }
        }
      }
    }

    if (grid && !canAttackAfterMove) {
      // 移动了但够不到 → 这回合只移动不攻击
      hits.push({ monsterName: monster.name, targetName: '', targetIsAlly: false, hit: false, isCritical: false, damage: 0, playerKilled: false, allyKilled: false })
      continue
    }

    // 选择攻击目标：玩家(权重2) vs 存活同伴(各权重1)（每次重新过滤，同伴可能在本轮被击倒）
    const aliveAllies = (combat.allies ?? []).filter(a => a.hp > 0)
    type Target = { id: string; name: string; ac: number; isPlayer: boolean; isAlly: boolean }
    const targets: Target[] = [
      { id: 'player', name: player.name, ac: playerAC, isPlayer: true, isAlly: false },
      ...aliveAllies.map(a => ({ id: a.id, name: a.name, ac: a.ac, isPlayer: false, isAlly: true })),
    ]
    const weights = targets.map(t => {
      if (t.isPlayer) return 2
      // 嘲讽：格雷格在场时权重 ×3
      const allyObj = aliveAllies.find(a => a.id === t.id)
      if (allyObj?.allyAbility?.effect === 'taunt') return 3
      return 1
    })
    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let roll = Math.random() * totalWeight
    let target = targets[0]
    for (let i = 0; i < targets.length; i++) {
      roll -= weights[i]
      if (roll <= 0) { target = targets[i]; break }
    }

    const targetAC = target.ac
    const atk = attackRoll(monster.attackMod, targetAC)

    if (!atk.hits) {
      log.push(`${monster.id} 攻击${target.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${targetAC} → 未命中`)
      hits.push({ monsterName: monster.name, targetName: target.name, targetIsAlly: target.isAlly, hit: false, isCritical: false, damage: 0, playerKilled: false, allyKilled: false })
      // Boss 特殊技能（即使普通攻击未命中也执行）
      const bossMissLog = executeBossAbility(session, monster, combat)
      if (bossMissLog.length > 0) log.push(...bossMissLog)
      continue
    }

    let damage = rollDamage(monster.damageDice)
    if (atk.isCritical) {
      const diceOnly = monster.damageDice.replace(/[+-]\d+$/, '')
      damage += rollDamage(diceOnly)
    }
    damage = Math.max(1, damage)

    // 玩家独有的抗性效果（根据怪物名推断伤害类型）
    if (target.isPlayer) {
      const monsterNameLower = monster.name.toLowerCase()
      const isNecrotic = monsterNameLower.includes('shadow') || monsterNameLower.includes('暗影')
        || monsterNameLower.includes('幽灵') || monsterNameLower.includes('亡灵')
        || monsterNameLower.includes('eclipsed') || monsterNameLower.includes('蚀')
      if (isNecrotic && hasEffect(player, 'resistance', 'necrotic')) {
        damage = Math.max(1, Math.floor(damage * 0.5))
        log.push(`🛡️ 暗影防护减免了部分黯蚀伤害`)
      }
      const isPoisonDmg = monsterNameLower.includes('spider') || monsterNameLower.includes('蜘蛛')
        || monsterNameLower.includes('蛇') || monsterNameLower.includes('毒')
      if (isPoisonDmg && hasEffect(player, 'poison_immunity', 'poison')) {
        damage = 0
        log.push(`🛡️ 毒素免疫完全抵消了毒素伤害`)
      }
    }

    let playerKilled = false
    let allyKilled = false

    if (target.isPlayer) {
      player.hp = Math.max(0, player.hp - damage)
      playerKilled = player.hp <= 0
    } else {
      const ally = aliveAllies.find(a => a.id === target.id)!
      ally.hp = Math.max(0, ally.hp - damage)
      allyKilled = ally.hp <= 0
    }

    const victimHpStr = target.isPlayer
      ? `${player.name} HP: ${player.hp}/${player.maxHp}`
      : `${target.name} HP: ${aliveAllies.find(a => a.id === target.id)!.hp}/${aliveAllies.find(a => a.id === target.id)!.maxHp}`

    log.push(
      `${monster.id} 攻击${target.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${targetAC} → ${atk.isCritical ? '暴击！' : '命中'}`,
      `伤害: ${monster.damageDice}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${victimHpStr}`,
    )
    hits.push({ monsterName: monster.name, targetName: target.name, targetIsAlly: target.isAlly, hit: true, isCritical: atk.isCritical, damage, playerKilled, allyKilled })

    // 蛛母 Phase 2 毒牙：额外 1d4 poison 伤害
    if (monster.name === 'Spider Matriarch' && monster.conditions.includes('phase2')) {
      const poisonDmg = rollDamage('1d4')
      if (target.isPlayer) {
        if (!hasEffect(player, 'poison_immunity', 'poison')) {
          player.hp = Math.max(0, player.hp - poisonDmg)
          playerKilled = player.hp <= 0
          log.push(`🕷️ 蛛母的毒牙注入毒液！额外 ${poisonDmg} 点毒素伤害 (HP: ${player.hp}/${player.maxHp})`)
        } else {
          log.push(`🛡️ 毒素免疫抵消了蛛母的毒液！`)
        }
      } else {
        const allyTarget = aliveAllies.find(a => a.id === target.id)
        if (allyTarget) {
          allyTarget.hp = Math.max(0, allyTarget.hp - poisonDmg)
          if (allyTarget.hp <= 0 && !allyKilled) allyKilled = true
          log.push(`🕷️ 蛛母的毒牙注入毒液！${target.name}受到额外 ${poisonDmg} 点毒素伤害 (HP: ${allyTarget.hp}/${allyTarget.maxHp})`)
        }
      }
    }

    // Boss 特殊技能
    const bossLog = executeBossAbility(session, monster, combat)
    if (bossLog.length > 0) {
      log.push(...bossLog)
    }

    if (allyKilled) {
      log.push(`${target.name} 倒下了！`)
      getFacts().addEvent(`同伴${target.name}在战斗中倒下`, 'critical')
    }
    if (playerKilled) {
      log.push(`${player.name} 倒下了！`)
      getFacts().addEvent(`${player.name}在战斗中倒下`, 'critical')
      break
    }
  }

  return { log, hits, gridMoves }
}

// ─── 同伴回合（全自动）─────────────────────────────

export type AllyHitRecord = {
  allyName: string
  targetName: string
  hit: boolean
  isCritical: boolean
  damage: number
  targetKilled: boolean
}

/**
 * 同伴目标选择 AI — 根据 combatBehavior 决定策略
 *   - fight  (默认)：随机选活着的敌人，不倾向补刀也不回避
 *   - kill   (格罗姆)：贪心补刀，优先解决低血敌人
 *   - subdue (格雷格/韩猛/镇长府卫兵)：避免补刀，优先打满血/中血敌人；
 *                                     全场都低血时 fallback 到正常打（不卡战斗）
 */
function selectAllyTarget(ally: AllyInstance, aliveMonsters: MonsterInstance[]): MonsterInstance {
  const behavior = ally.combatBehavior

  if (behavior === 'subdue') {
    const healthy = aliveMonsters.filter(m => m.hp / m.maxHp >= 0.3)
    const pool = healthy.length > 0 ? healthy : aliveMonsters
    return pool.reduce((best, m) => m.hp > best.hp ? m : best, pool[0])
  }

  if (behavior === 'kill') {
    const lowHp = aliveMonsters.find(m => m.hp / m.maxHp < 0.25)
    return lowHp ?? aliveMonsters.reduce((best, m) => m.hp > best.hp ? m : best, aliveMonsters[0])
  }

  // fight (默认): 随机
  return aliveMonsters[Math.floor(Math.random() * aliveMonsters.length)]
}

export function executeAllyTurns(session: GameSession, onlyIds?: string[]): {
  log: string[]
  hits: AllyHitRecord[]
} {
  const combat = session.combat
  if (!combat?.active) return { log: [], hits: [] }

  const log: string[] = []
  const hits: AllyHitRecord[] = []
  const allies = combat.allies ?? []

  for (const entry of combat.initiativeOrder) {
    if (!entry.isAlly) continue
    if (onlyIds && !onlyIds.includes(entry.id)) continue

    const ally = allies.find(a => a.id === entry.id)
    if (!ally || ally.hp <= 0) continue

    const aliveMonsters = combat.monsters.filter(m => m.hp > 0)
    if (aliveMonsters.length === 0) break

    const target = selectAllyTarget(ally, aliveMonsters)

    const atk = attackRoll(ally.attackMod, target.ac)

    if (!atk.hits) {
      log.push(`${ally.name} 攻击${target.id}: d20(${atk.roll})+${ally.attackMod}=${atk.total} vs AC${target.ac} → 未命中`)
      hits.push({ allyName: ally.name, targetName: target.id, hit: false, isCritical: false, damage: 0, targetKilled: false })
      continue
    }

    let damage = rollDamage(ally.damageDice)
    if (atk.isCritical) {
      const diceOnly = ally.damageDice.replace(/[+-]\d+$/, '')
      damage += rollDamage(diceOnly)
    }
    damage = Math.max(1, damage)

    // 盟友伤害类型 → 弱点/抗性/免疫乘数
    const allyAttackTypes: DamageType[] = ally.damageType ? [ally.damageType] : ['slashing']
    const allyWeakness = getWeaknessMultiplier(allyAttackTypes, target)
    damage = Math.max(1, Math.floor(damage * allyWeakness.multiplier))
    if (allyWeakness.effectType === 'immune') {
      damage = 0
      // 图鉴：同伴攻击也能发现免疫
      discoverImmunity(session, target.name, '战斗试错')
    }

    // 图鉴增强弱点：×2 → ×2.5
    if (allyWeakness.effectType === 'vulnerable') {
      const bonuses = getBestiaryBonuses(session)
      if (bonuses.enhancedVulnerability) {
        damage = Math.floor(damage * 1.25)
        log.push('📖 怪物图鉴精通：弱点伤害增强至×2.5')
      }
    }

    target.hp = Math.max(0, target.hp - damage)
    const targetKilled = target.hp <= 0

    // 破甲重击：命中后目标 AC-1，最多叠加 3 次
    if (ally.allyAbility?.effect === 'armor_break' && atk.hits) {
      const currentStacks = (target as any).__armorBreak ?? 0
      if (currentStacks < 3) {
        target.ac = Math.max(5, target.ac - 1)
        ;(target as any).__armorBreak = currentStacks + 1
        log.push(`🔨 ${ally.name}的破甲重击削弱了${target.id}的护甲！(AC${target.ac + 1}→${target.ac}，叠加${currentStacks + 1}/3)`)
      }
    }

    log.push(
      `${ally.name} 攻击${target.id}: d20(${atk.roll})+${ally.attackMod}=${atk.total} vs AC${target.ac} → ${atk.isCritical ? '暴击！' : '命中'}`,
      `伤害: ${ally.damageDice}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${target.id} HP: ${target.hp}/${target.maxHp}`,
    )
    if (allyWeakness.effectType === 'vulnerable') {
      log.push(`💥 ${ally.name}击中了弱点！`)
      // 累计 radiant 伤害（用于中断暗影编织者自愈，需 ≥10）
      if (allyWeakness.matchedType === 'radiant') {
        const prevRadiant = (session.worldState.flags['boss_radiant_dmg_this_round'] as number) || 0
        session.worldState.flags['boss_radiant_dmg_this_round'] = prevRadiant + damage
      }
    } else if (allyWeakness.effectType === 'resistant') {
      log.push(`🛡️ 目标对${ally.name}的攻击有抗性`)
    } else if (allyWeakness.effectType === 'immune') {
      log.push(`❌ 目标对${ally.name}的攻击免疫！`)
    }
    hits.push({ allyName: ally.name, targetName: target.id, hit: true, isCritical: atk.isCritical, damage, targetKilled })

    if (targetKilled) {
      log.push(`${target.id} 被${ally.name}击杀！`)
    }

    // 铁臂擒拿：50% 概率束缚一个未被束缚的目标
    if (ally.allyAbility?.effect === 'grapple') {
      const ungrappled = aliveMonsters.filter(m => m.hp > 0 && !m.conditions.includes('grappled'))
      if (ungrappled.length > 0) {
        const grappleTarget = ungrappled[Math.floor(Math.random() * ungrappled.length)]
        if (Math.random() < 0.5) {
          grappleTarget.conditions.push('grappled')
          log.push(`💪 ${ally.name}用铁臂擒住了${grappleTarget.id}！(下回合无法行动)`)
        } else {
          log.push(`💪 ${ally.name}试图擒拿${grappleTarget.id}，但没抓住`)
        }
      }
    }
  }

  return { log, hits }
}

// ─── 逃跑 ─────────────────────────────────────────

export async function attemptFlee(session: GameSession): Promise<{
  success: boolean
  log: string[]
  ended: boolean
  result: CombatResult
}> {
  const combat = session.combat
  if (!combat?.active) throw new Error('当前没有进行中的战斗')

  const player = session.player
  const log: string[] = []

  // DEX check: 逃跑DC取决于对手强度
  // 从 npc-combatants.json 读取 fleeDC，普通怪物回退到 AC
  const aliveMonsters = combat.monsters.filter(m => m.hp > 0)
  const npcCombatData = (await import('../data/npc-combatants.json', { with: { type: 'json' } })).default as any[]
  const dc = Math.max(...aliveMonsters.map(m => {
    const npcEntry = npcCombatData.find((n: any) => n.name === m.name)
    return npcEntry?.fleeDC ?? m.ac ?? 10
  }))
  const roll = rollDice('1d20').total
  const total = roll + player.abilityModifiers.DEX
  const success = total >= dc

  log.push(`逃跑检定：d20(${roll})+${player.abilityModifiers.DEX}=${total} vs DC${dc}`)

  if (success) {
    log.push('逃跑成功！脱离了战斗。')
    getFacts().addEvent('逃跑成功，脱离战斗', 'normal')
    endCombat(session)
    return { success, log, ended: true, result: 'ongoing' }
  }

  log.push('逃跑失败！你浪费了这个回合。')
  // 逃跑失败 = 浪费一个行动回合，不触发怪物额外反击
  // 怪物的正常回合由 processCombatAction 的 monster phase 处理
  return { success, log, ended: false, result: 'ongoing' }
}

// ─── 战斗结束检查 ────────────────────────────────

export type CombatResult = 'victory' | 'defeat' | 'ongoing'

export function checkCombatEnd(session: GameSession): { ended: boolean; result: CombatResult } {
  const combat = session.combat
  if (!combat?.active) return { ended: true, result: 'ongoing' }

  const allMonstersDead = combat.monsters.every(m => m.hp <= 0)
  if (allMonstersDead) return { ended: true, result: 'victory' }

  if (session.player.hp <= 0) return { ended: true, result: 'defeat' }

  return { ended: false, result: 'ongoing' }
}

// ─── 战利品发放 ──────────────────────────────────

export function awardLoot(session: GameSession): { items: string[]; gold: number } {
  const combat = session.combat
  if (!combat) return { items: [], gold: 0 }

  const items: string[] = []
  let gold = 0

  for (const monster of combat.monsters) {
    for (const lootStr of monster.loot) {
      const goldMatch = lootStr.match(/^(\d+)\s*gold$/i)
      if (goldMatch) {
        gold += Number(goldMatch[1])
      } else {
        items.push(lootStr)
        session.player.inventory.push({
          name: lootStr,
          type: 'misc',
          description: `从${monster.name}身上获得的战利品`,
        })
      }
    }
  }

  session.player.gold += gold
  return { items, gold }
}

// ─── 结束战斗 ────────────────────────────────────

export function endCombat(session: GameSession): void {
  if (session.combat) {
    session.combat.active = false
    session.combat = null
  }
}

// ─── 玩家回合执行 ────────────────────────────────

/**
 * 只执行玩家的攻击回合。
 * 怪物回合由 executeMonsterPhase 单独执行，实现分段发送。
 */
export function executePlayerTurn(
  session: GameSession,
  targetId: string,
  method: 'weapon' | 'spell',
  spellId?: string,
): {
  roundLog: string[]
  ended: boolean
  result: CombatResult
  loot?: { items: string[]; gold: number }
  hit?: boolean
  isCritical?: boolean
  killed?: boolean
  targetName?: string
  firstInnocentKill?: boolean
} {
  const combat = session.combat!
  const roundLog: string[] = []

  roundLog.push(`--- 第${combat.round}轮 ---`)
  roundLog.push(`[${session.player.name} 的回合]`)

  const attackResult = executePlayerAttack(session, targetId, method, spellId)
  roundLog.push(...attackResult.log)

  // 检查是否所有怪物已死
  const check = checkCombatEnd(session)
  if (check.ended && check.result === 'victory') {
    const loot = awardLoot(session)
    roundLog.push('\n=== 战斗胜利 ===')
    if (loot.items.length) roundLog.push(`战利品: ${loot.items.join(', ')}`)
    if (loot.gold > 0) roundLog.push(`获得金币: ${loot.gold}`)
    getFacts().addEvent('战斗胜利，获得战利品', 'critical')
    session.worldState.flags['combat_victories'] = (Number(session.worldState.flags['combat_victories'] ?? 0)) + 1

    // 降低被击败NPC本人的信任度到-10
    // 用 reputation channel 避免触发 cascadeReputation 连坐
    // 全镇传播由 violence_alert 延迟后的 propagateViolenceTrust 统一处理
    for (const monster of combat.monsters) {
      if (monster.hp <= 0) {
        const npc = session.npcs.find(n => n.name === monster.name)
        if (npc) {
          changeTrust(session, {
            npcName: monster.name,
            channel: 'reputation',
            delta: -10 - npc.trust,
            reason: '被你击败',
            turn: session.turnCount,
          })
        }
      }
    }

    // 检查是否首次击败无辜NPC（NPC = 镇上居民，不是怪物）
    let firstInnocentKill = false
    if (!session.worldState.flags['first_innocent_kill']) {
      const target = session.combat?.monsters.find(m => m.id === targetId)
      const isNPC = target && session.npcs.some(n => n.name === target.name)
      if (isNPC) {
        session.worldState.flags['first_innocent_kill'] = true
        firstInnocentKill = true
      }
    }

    endCombat(session)
    return {
      roundLog, ended: true, result: 'victory', loot,
      hit: attackResult.hit, isCritical: attackResult.isCritical,
      killed: attackResult.killed, targetName: targetId,
      firstInnocentKill,
    }
  }

  // 怪物仍存活 → 标记待执行怪物回合
  if (!check.ended) {
    combat.pendingMonsterTurn = true
  }

  return {
    roundLog, ended: check.ended, result: check.result,
    hit: attackResult.hit, isCritical: attackResult.isCritical,
    killed: attackResult.killed, targetName: targetId,
  }
}

// ─── 怪物回合阶段 ────────────────────────────────

/**
 * 执行所有怪物的攻击回合，处理战斗结束和回合递增。
 * 由 server.ts 在 DM 叙事完成后调用，实现分段发送。
 */
/**
 * 执行怪物阶段。
 * @param onlyIds  只让这些怪物行动（undefined = 全部）
 * @param endRound 是否执行回合结算（效果递减、清除防御、回合+1），默认 true
 */
export function executeMonsterPhase(
  session: GameSession,
  onlyIds?: string[],
  endRound = true,
): {
  log: string[]
  hits: MonsterHitRecord[]
  ended: boolean
  result: CombatResult
} {
  const combat = session.combat
  if (!combat?.active) return { log: [], hits: [], ended: true, result: 'ongoing' }

  combat.pendingMonsterTurn = false
  const monsterResult = executeMonsterTurns(session, onlyIds)
  const log = monsterResult.log

  const check = checkCombatEnd(session)
  if (check.ended && check.result === 'defeat') {
    log.push('\n=== 战斗失败 ===')
    endCombat(session)
  } else if (!check.ended && endRound) {
    // 回合结束：递减效果持续时间
    const expired = tickEffects(session.player)
    if (expired.length > 0) {
      log.push(`[效果消散] ${expired.join('、')}`)
    }
    // 清除防御姿态
    combat.playerDefending = false
    // 清除 Boss 回合效果 flag
    delete session.worldState.flags['boss_shadow_veil']
    delete session.worldState.flags['boss_web_player']
    // 准备下一轮
    combat.round++
  }

  return { log, hits: monsterResult.hits, ...check }
}

// ─── 战斗状态摘要 ────────────────────────────────

export function getCombatSummary(session: GameSession): string | null {
  const combat = session.combat
  if (!combat?.active) return null

  const lines: string[] = [
    `=== 战斗进行中（第${combat.round}轮） ===`,
    `行动顺序: ${combat.initiativeOrder.map(c => `${c.name}(${c.initiative})`).join(' → ')}`,
    '',
  ]

  for (const m of combat.monsters) {
    const status = m.hp <= 0 ? '已倒下' : `HP ${m.hp}/${m.maxHp}`
    lines.push(`  ${m.id}: ${status}${m.conditions.length ? ' [' + m.conditions.join(',') + ']' : ''}`)
  }

  const p = session.player
  lines.push(`  ${p.name}: HP ${p.hp}/${p.maxHp}`)

  return lines.join('\n')
}
