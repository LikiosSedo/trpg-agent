/**
 * 战斗管理器
 *
 * 管理完整战斗生命周期：先攻 → 回合 → 伤害 → 怪物反击 → 战利品。
 * 所有战斗结果由此模块确定性计算，DM 只负责叙事描写。
 */

import type { GameSession, Monster, MonsterInstance, CombatState, InitiativeEntry } from './types.js'
import {
  rollInitiative, attackRoll, rollDamage, rollDice,
  calculatePlayerAC, parseAttackMod, castSpell,
} from './rules-engine.js'
import { getFacts } from './game-state.js'
import { getEffectBonus, hasEffect, tickEffects, applyEffect } from './effect-manager.js'
import { changeTrust } from './trust-system.js'

const PROFICIENCY = 2

// ─── 开始战斗 ───────────────────────────────────

export function startCombat(
  session: GameSession,
  monsterNames: string[],
  monstersDb: Monster[],
): CombatState {
  const player = session.player
  const log: string[] = []

  // 玩家先攻
  const playerInit = rollInitiative(player.abilityModifiers.DEX)
  log.push(`${player.name} 先攻: d20(${playerInit.roll})+${player.abilityModifiers.DEX}=${playerInit.total}`)

  const initiativeOrder: InitiativeEntry[] = [{
    id: 'player',
    name: player.name,
    initiative: playerInit.total,
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
    })

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
    log,
  }

  session.combat = combat
  getFacts().addEvent('战斗开始: ' + monsters.map(m => m.id).join(', '), 'critical')

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
    const atkMod = player.abilityModifiers.INT + PROFICIENCY
    const atk = attackRoll(atkMod, monster.ac)

    if (!atk.hits) {
      log.push(`${player.name} 施放${spellId}: d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → 未命中`)
      return { log, killed: false, hit: false, isCritical: false }
    }

    const dmgMatch = spell.effect.match(/(\d+d\d+(?:[+-]\d+)?)/i)
    const dmgDice = dmgMatch ? dmgMatch[1] : '1d6'
    let damage = rollDamage(dmgDice)
    if (atk.isCritical) damage += rollDamage(dmgDice)

    monster.hp = Math.max(0, monster.hp - damage)
    const killed = monster.hp <= 0

    log.push(
      `${player.name} 施放${spellId}: d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → ${atk.isCritical ? '暴击！' : '命中'}`,
      `伤害: ${dmgDice}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${monster.id} HP: ${monster.hp}/${monster.maxHp}`,
    )
    if (killed) {
      const isNpc = session.npcs.some(n => n.name === monster.name)
      log.push(isNpc ? `💫 ${monster.id} 失去了意识！` : `☠ ${monster.id} 被击杀！`)
      getFacts().addEvent(isNpc ? `${monster.id}被击倒` : `${monster.id}被击杀`, 'critical')
      const killKey = `kills_${monster.name}`
      session.worldState.flags[killKey] = (Number(session.worldState.flags[killKey] ?? 0)) + 1
    }
    return { log, killed, hit: true, isCritical: atk.isCritical }
  }

  // 武器攻击
  const weapon = player.equipped.weapon
  if (!weapon) throw new Error('未装备武器，无法进行武器攻击')

  const effectAtkBonus = getEffectBonus(player, 'attack_bonus')
  const atkMod = player.abilityModifiers.STR + PROFICIENCY + (weapon.bonus ?? 0) + effectAtkBonus
  const atk = attackRoll(atkMod, monster.ac)

  if (!atk.hits) {
    log.push(`${player.name} 攻击(${weapon.name}): d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → 未命中`)
    return { log, killed: false, hit: false, isCritical: false }
  }

  const dmgMatch = weapon.description.match(/(\d+d\d+)/i)
  const dmgDice = dmgMatch ? dmgMatch[1] : '1d6'
  let damage = rollDamage(dmgDice) + player.abilityModifiers.STR
  // damage_bonus 效果（如 Hunter's Mark）
  const effectDmgBonus = getEffectBonus(player, 'damage_bonus')
  if (effectDmgBonus > 0) damage += rollDamage(`${effectDmgBonus}d6`)
  if (atk.isCritical) damage += rollDamage(dmgDice)
  damage = Math.max(1, damage)

  monster.hp = Math.max(0, monster.hp - damage)
  const killed = monster.hp <= 0

  log.push(
    `${player.name} 攻击(${weapon.name}): d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → ${atk.isCritical ? '暴击！' : '命中'}`,
    `伤害: ${dmgDice}+${player.abilityModifiers.STR}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${monster.id} HP: ${monster.hp}/${monster.maxHp}`,
  )
  if (killed) {
    const isNpc = session.npcs.some(n => n.name === monster.name)
    log.push(isNpc ? `💫 ${monster.id} 失去了意识！` : `☠ ${monster.id} 被击杀！`)
    getFacts().addEvent(isNpc ? `${monster.id}被击倒` : `${monster.id}被击杀`, 'critical')
    const killKey = `kills_${monster.name}`
    session.worldState.flags[killKey] = (Number(session.worldState.flags[killKey] ?? 0)) + 1
  }
  return { log, killed, hit: true, isCritical: atk.isCritical }
}

// ─── 怪物回合 ───────────────────────────────────

export type MonsterHitRecord = {
  monsterName: string
  hit: boolean
  isCritical: boolean
  damage: number
  playerKilled: boolean
}

export function executeMonsterTurns(session: GameSession): {
  log: string[]
  hits: MonsterHitRecord[]
} {
  const combat = session.combat
  if (!combat?.active) return { log: [], hits: [] }

  const player = session.player
  let playerAC = calculatePlayerAC(player)
  // 防御姿态 AC+2
  if (combat.playerDefending) playerAC += 2
  const log: string[] = []
  const hits: MonsterHitRecord[] = []

  for (const entry of combat.initiativeOrder) {
    if (entry.isPlayer) continue

    const monster = combat.monsters.find(m => m.id === entry.id)
    if (!monster || monster.hp <= 0) continue

    const atk = attackRoll(monster.attackMod, playerAC)

    if (!atk.hits) {
      log.push(`${monster.id} 攻击${player.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${playerAC} → 未命中`)
      hits.push({ monsterName: monster.name, hit: false, isCritical: false, damage: 0, playerKilled: false })
      continue
    }

    let damage = rollDamage(monster.damageDice)
    if (atk.isCritical) {
      // 暴击：额外掷骰子部分（不含修正值）
      const diceOnly = monster.damageDice.replace(/[+-]\d+$/, '')
      damage += rollDamage(diceOnly)
    }
    damage = Math.max(1, damage)

    // 应用伤害抗性效果（如暗影防护药水：死灵伤害减半）
    // 暗影系怪物的伤害视为 necrotic 类型
    const monsterNameLower = monster.name.toLowerCase()
    const isNecrotic = monsterNameLower.includes('shadow') || monsterNameLower.includes('暗影')
      || monsterNameLower.includes('幽灵') || monsterNameLower.includes('亡灵')
    if (isNecrotic && hasEffect(player, 'resistance', 'necrotic')) {
      damage = Math.max(1, Math.floor(damage * 0.5))
    }
    // 毒素免疫
    const isPoisonDmg = monsterNameLower.includes('spider') || monsterNameLower.includes('蜘蛛')
      || monsterNameLower.includes('蛇') || monsterNameLower.includes('毒')
    if (isPoisonDmg && hasEffect(player, 'poison_immunity', 'poison')) {
      damage = 0
    }

    player.hp = Math.max(0, player.hp - damage)
    const playerKilled = player.hp <= 0

    log.push(
      `${monster.id} 攻击${player.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${playerAC} → ${atk.isCritical ? '暴击！' : '命中'}`,
      `伤害: ${monster.damageDice}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${player.name} HP: ${player.hp}/${player.maxHp}`,
    )
    hits.push({ monsterName: monster.name, hit: true, isCritical: atk.isCritical, damage, playerKilled })

    if (playerKilled) {
      log.push(`${player.name} 倒下了！`)
      getFacts().addEvent(`${player.name}在战斗中倒下`, 'critical')
      break
    }
  }

  return { log, hits }
}

// ─── 逃跑 ─────────────────────────────────────────

export function attemptFlee(session: GameSession): {
  success: boolean
  log: string[]
  ended: boolean
  result: CombatResult
} {
  const combat = session.combat
  if (!combat?.active) throw new Error('当前没有进行中的战斗')

  const player = session.player
  const log: string[] = []

  // DEX check: DC 10 + alive monster count
  const aliveMonsters = combat.monsters.filter(m => m.hp > 0)
  const dc = 10 + aliveMonsters.length
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

    // 降低所有被击败NPC的信任度到-10
    for (const monster of combat.monsters) {
      if (monster.hp <= 0) {
        // 检查是否是NPC（通过session.npcs查找）
        const npc = session.npcs.find(n => n.name === monster.name)
        if (npc) {
          changeTrust(session, {
            npcName: monster.name,
            channel: 'combat',
            delta: -10 - npc.trust, // 直接设置为-10（delta = 目标值 - 当前值）
            reason: '被你击败',
            turn: session.turnCount,
          })
        }
      }
    }

    // 检查是否首次击败无辜NPC
    let firstInnocentKill = false
    if (!session.worldState.flags['first_innocent_kill']) {
      const target = session.combat?.monsters.find(m => m.id === targetId)
      if (target?.nonlethal) {
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
export function executeMonsterPhase(session: GameSession): {
  log: string[]
  hits: MonsterHitRecord[]
  ended: boolean
  result: CombatResult
} {
  const combat = session.combat
  if (!combat?.active) return { log: [], hits: [], ended: true, result: 'ongoing' }

  combat.pendingMonsterTurn = false
  const monsterResult = executeMonsterTurns(session)
  const log = monsterResult.log

  const check = checkCombatEnd(session)
  if (check.ended && check.result === 'defeat') {
    log.push('\n=== 战斗失败 ===')
    endCombat(session)
  } else if (!check.ended) {
    // 回合结束：递减效果持续时间
    const expired = tickEffects(session.player)
    if (expired.length > 0) {
      log.push(`[效果消散] ${expired.join('、')}`)
    }
    // 清除防御姿态
    combat.playerDefending = false
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
