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

// ─── 玩家攻击 ───────────────────────────────────

export function executePlayerAttack(
  session: GameSession,
  targetId: string,
  method: 'weapon' | 'spell',
  spellId?: string,
): { log: string[]; killed: boolean } {
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
  if (monster.hp <= 0) throw new Error(`${monster.id} 已经被击杀`)

  if (method === 'spell') {
    if (!spellId) throw new Error('法术攻击需指定 spellId')
    const cast = castSpell(player, spellId)
    if (!cast.success) throw new Error(`施法失败: ${cast.reason}`)

    const spell = player.spells.find(s => s.name === spellId)!
    const atkMod = player.abilityModifiers.INT + PROFICIENCY
    const atk = attackRoll(atkMod, monster.ac)

    if (!atk.hits) {
      log.push(`${player.name} 施放${spellId}: d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → 未命中`)
      return { log, killed: false }
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
      log.push(`☠ ${monster.id} 被击杀！`)
      getFacts().addEvent(`${monster.id}被击杀`, 'critical')
      const killKey = `kills_${monster.name}`
      session.worldState.flags[killKey] = (Number(session.worldState.flags[killKey] ?? 0)) + 1
    }
    return { log, killed }
  }

  // 武器攻击
  const weapon = player.equipped.weapon
  if (!weapon) throw new Error('未装备武器，无法进行武器攻击')

  const atkMod = player.abilityModifiers.STR + PROFICIENCY + (weapon.bonus ?? 0)
  const atk = attackRoll(atkMod, monster.ac)

  if (!atk.hits) {
    log.push(`${player.name} 攻击(${weapon.name}): d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → 未命中`)
    return { log, killed: false }
  }

  const dmgMatch = weapon.description.match(/(\d+d\d+)/i)
  const dmgDice = dmgMatch ? dmgMatch[1] : '1d6'
  let damage = rollDamage(dmgDice) + player.abilityModifiers.STR
  if (atk.isCritical) damage += rollDamage(dmgDice)
  damage = Math.max(1, damage)

  monster.hp = Math.max(0, monster.hp - damage)
  const killed = monster.hp <= 0

  log.push(
    `${player.name} 攻击(${weapon.name}): d20(${atk.roll})+${atkMod}=${atk.total} vs AC${monster.ac} → ${atk.isCritical ? '暴击！' : '命中'}`,
    `伤害: ${dmgDice}+${player.abilityModifiers.STR}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${monster.id} HP: ${monster.hp}/${monster.maxHp}`,
  )
  if (killed) {
    log.push(`☠ ${monster.id} 被击杀！`)
    getFacts().addEvent(`${monster.id}被击杀`, 'critical')
    const killKey = `kills_${monster.name}`
    session.worldState.flags[killKey] = (Number(session.worldState.flags[killKey] ?? 0)) + 1
  }
  return { log, killed }
}

// ─── 怪物回合 ───────────────────────────────────

export function executeMonsterTurns(session: GameSession): string[] {
  const combat = session.combat
  if (!combat?.active) return []

  const player = session.player
  const playerAC = calculatePlayerAC(player)
  const log: string[] = []

  for (const entry of combat.initiativeOrder) {
    if (entry.isPlayer) continue

    const monster = combat.monsters.find(m => m.id === entry.id)
    if (!monster || monster.hp <= 0) continue

    const atk = attackRoll(monster.attackMod, playerAC)

    if (!atk.hits) {
      log.push(`${monster.id} 攻击${player.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${playerAC} → 未命中`)
      continue
    }

    let damage = rollDamage(monster.damageDice)
    if (atk.isCritical) {
      // 暴击：额外掷骰子部分（不含修正值）
      const diceOnly = monster.damageDice.replace(/[+-]\d+$/, '')
      damage += rollDamage(diceOnly)
    }
    damage = Math.max(1, damage)

    player.hp = Math.max(0, player.hp - damage)

    log.push(
      `${monster.id} 攻击${player.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${playerAC} → ${atk.isCritical ? '暴击！' : '命中'}`,
      `伤害: ${monster.damageDice}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${player.name} HP: ${player.hp}/${player.maxHp}`,
    )

    if (player.hp <= 0) {
      log.push(`${player.name} 倒下了！`)
      getFacts().addEvent(`${player.name}在战斗中倒下`, 'critical')
      break
    }
  }

  return log
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

  log.push('逃跑失败！怪物趁机攻击！')
  const monsterLog = executeMonsterTurns(session)
  log.push(...monsterLog)

  const check = checkCombatEnd(session)
  if (check.ended && check.result === 'defeat') {
    log.push('\n=== 战斗失败 ===')
    endCombat(session)
  }

  return { success, log, ended: check.ended, result: check.result }
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

// ─── 完整回合执行 ────────────────────────────────

/**
 * 按先攻顺序执行完整一回合。
 * 返回该回合所有行动的日志。
 */
export function executeFullRound(
  session: GameSession,
  targetId: string,
  method: 'weapon' | 'spell',
  spellId?: string,
): {
  roundLog: string[]
  ended: boolean
  result: CombatResult
  loot?: { items: string[]; gold: number }
} {
  const combat = session.combat!
  const roundLog: string[] = []

  roundLog.push(`--- 第${combat.round}轮 ---`)

  // 按先攻顺序执行所有回合
  let playerActed = false

  for (const entry of combat.initiativeOrder) {
    if (entry.isPlayer) {
      // 玩家回合
      roundLog.push(`[${entry.name} 的回合]`)
      const result = executePlayerAttack(session, targetId, method, spellId)
      roundLog.push(...result.log)
      playerActed = true

      // 检查是否所有怪物已死
      const check = checkCombatEnd(session)
      if (check.ended) {
        const loot = check.result === 'victory' ? awardLoot(session) : undefined
        if (loot) {
          roundLog.push(`\n=== 战斗胜利 ===`)
          if (loot.items.length) roundLog.push(`战利品: ${loot.items.join(', ')}`)
          if (loot.gold > 0) roundLog.push(`获得金币: ${loot.gold}`)
          getFacts().addEvent('战斗胜利，获得战利品', 'critical')
          const victories = (Number(session.worldState.flags['combat_victories'] ?? 0)) + 1
          session.worldState.flags['combat_victories'] = victories
        }
        endCombat(session)
        return { roundLog, ended: true, result: check.result, loot }
      }
    } else {
      // 怪物回合
      const monster = combat.monsters.find(m => m.id === entry.id)
      if (!monster || monster.hp <= 0) continue

      roundLog.push(`[${monster.id} 的回合]`)
      const playerAC = calculatePlayerAC(session.player)
      const atk = attackRoll(monster.attackMod, playerAC)

      if (!atk.hits) {
        roundLog.push(`${monster.id} 攻击${session.player.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${playerAC} → 未命中`)
      } else {
        let damage = rollDamage(monster.damageDice)
        if (atk.isCritical) {
          const diceOnly = monster.damageDice.replace(/[+-]\d+$/, '')
          damage += rollDamage(diceOnly)
        }
        damage = Math.max(1, damage)
        session.player.hp = Math.max(0, session.player.hp - damage)

        roundLog.push(
          `${monster.id} 攻击${session.player.name}: d20(${atk.roll})+${monster.attackMod}=${atk.total} vs AC${playerAC} → ${atk.isCritical ? '暴击！' : '命中'}`,
          `伤害: ${monster.damageDice}=${damage}${atk.isCritical ? '(暴击翻倍)' : ''} → ${session.player.name} HP: ${session.player.hp}/${session.player.maxHp}`,
        )

        if (session.player.hp <= 0) {
          roundLog.push(`${session.player.name} 倒下了！`)
          roundLog.push(`\n=== 战斗失败 ===`)
          getFacts().addEvent(`${session.player.name}在战斗中倒下`, 'critical')
          endCombat(session)
          return { roundLog, ended: true, result: 'defeat' }
        }
      }
    }
  }

  // 回合结束，准备下一轮
  combat.round++

  return { roundLog, ended: false, result: 'ongoing' }
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
    const status = m.hp <= 0 ? '已击杀' : `HP ${m.hp}/${m.maxHp}`
    lines.push(`  ${m.id}: ${status}${m.conditions.length ? ' [' + m.conditions.join(',') + ']' : ''}`)
  }

  const p = session.player
  lines.push(`  ${p.name}: HP ${p.hp}/${p.maxHp}`)

  return lines.join('\n')
}
