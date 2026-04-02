import type { PlayerCharacter } from './types.js'

export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1
}

export function rollDice(notation: string): { rolls: number[]; total: number } {
  // Parse "2d6+3", "d20", "1d8", "3d4+3"
  const m = notation.match(/^(\d*)d(\d+)([+-]\d+)?$/)
  if (!m) throw new Error(`Invalid dice notation: ${notation}`)
  const count = m[1] ? Number(m[1]) : 1
  const sides = Number(m[2])
  const modifier = m[3] ? Number(m[3]) : 0
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1)
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + modifier }
}

export function skillCheck(
  mod: number,
  dc: number,
  advantage?: boolean,
): { roll: number; total: number; success: boolean; isCritical: boolean; isCritFail: boolean } {
  let roll = rollD20()
  if (advantage) {
    const second = rollD20()
    roll = Math.max(roll, second)
  }
  const total = roll + mod
  return {
    roll,
    total,
    success: roll === 20 || (roll !== 1 && total >= dc),
    isCritical: roll === 20,
    isCritFail: roll === 1,
  }
}

export function attackRoll(
  attackMod: number,
  targetDC: number,
): { roll: number; total: number; hits: boolean; isCritical: boolean } {
  const roll = rollD20()
  const total = roll + attackMod
  const isCritical = roll === 20
  return {
    roll,
    total,
    hits: isCritical || (roll !== 1 && total >= targetDC),
    isCritical,
  }
}

export function rollDamage(dice: string): number {
  return rollDice(dice).total
}

export function castSpell(
  player: PlayerCharacter,
  spellName: string,
): { success: boolean; reason?: string } {
  const spell = player.spells.find(s => s.name === spellName)
  if (!spell) return { success: false, reason: `Unknown spell: ${spellName}` }
  if (spell.usesPerRest > 0 && spell.remaining <= 0) {
    return { success: false, reason: `${spellName} has no uses remaining` }
  }
  if (spell.usesPerRest > 0) spell.remaining--
  return { success: true }
}

// ─── 战斗相关 ──────────────────────────────────

export function rollInitiative(dexMod: number): { roll: number; total: number } {
  const roll = rollD20()
  return { roll, total: roll + dexMod }
}

export function calculatePlayerAC(player: PlayerCharacter): number {
  const dexMod = player.abilityModifiers.DEX
  const armorBonus = player.equipped.armor?.bonus ?? 0
  return 10 + dexMod + armorBonus
}

/** 从伤害骰表达式中提取能力修正值，如 "1d6+2" → 2，"2d8-1" → -1，"2d8" → 0 */
export function parseAttackMod(damageDice: string): number {
  const m = damageDice.match(/([+-]\d+)$/)
  return m ? Number(m[1]) : 0
}

// ─── 休息 ───────────────────────────────────────

export function shortRest(player: PlayerCharacter): void {
  // Restore HP: roll 1d8 + CON mod
  const heal = rollDice('1d8').total + player.abilityModifiers.CON
  player.hp = Math.min(player.maxHp, player.hp + Math.max(1, heal))
}

export function longRest(player: PlayerCharacter): void {
  player.hp = player.maxHp
  for (const spell of player.spells) {
    spell.remaining = spell.usesPerRest
  }
}
