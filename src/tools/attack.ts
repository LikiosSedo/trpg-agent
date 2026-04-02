/**
 * ⚔️ 攻击工具
 *
 * 执行战斗中的攻击动作。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession, getFacts } from '../game-state.js'
import { attackRoll, rollDamage, castSpell, rollDice } from '../rules-engine.js'

export const AttackTool: Tool = {
  name: 'Attack',
  description: `对目标发动攻击。自动处理:
1. 攻击掷骰 (d20 + 修正) vs 目标 AC
2. 命中则掷伤害骰
3. 自然20暴击 (伤害骰翻倍)，自然1必失
4. 更新目标 HP，检查是否倒下
仅在战斗中可用。武器攻击使用装备武器，法术攻击需指定法术。`,
  inputSchema: z.object({
    targetId: z.string().describe('攻击目标的 ID'),
    method: z.enum(['weapon', 'spell']).describe('"weapon" 使用装备武器, "spell" 使用法术'),
    spellId: z.string().optional().describe('使用的法术 ID (method 为 "spell" 时必填)'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const { targetId, method, spellId } = input
    const player = session.player

    // Find target monster from worldState flags (stored as JSON in a convention)
    // For now, monsters are tracked in events/flags — DM passes monster name
    // We'll look up from the static data
    const monstersJson = await import('../../data/monsters.json', { with: { type: 'json' } })
    const monsters: any[] = monstersJson.default
    const monster = monsters.find(m => m.name === targetId || m.name.toLowerCase() === targetId.toLowerCase())
    if (!monster) return { output: `未找到目标：${targetId}`, isError: true }

    // Get current monster HP from flags, or use base HP
    const hpKey = `monster_hp_${targetId}`
    const currentHp = session.worldState.flags[hpKey] !== undefined
      ? Number(session.worldState.flags[hpKey])
      : monster.hp

    if (currentHp <= 0) return { output: `${targetId}已经被击杀。` }

    if (method === 'spell') {
      if (!spellId) return { output: '法术攻击需指定spellId。', isError: true }
      const cast = castSpell(player, spellId)
      if (!cast.success) return { output: `施法失败：${cast.reason}`, isError: true }

      const spell = player.spells.find(s => s.name === spellId)!
      // Spell attack roll
      const atkMod = player.abilityModifiers.INT + 2 // proficiency
      const atk = attackRoll(atkMod, monster.dc)

      if (!atk.hits) {
        return { output: `法术攻击(${spellId})：d20=${atk.roll}+${atkMod}=${atk.total} vs 难度${monster.dc} → 未命中。${spellId}剩余${spell.remaining}/${spell.usesPerRest}次。` }
      }

      // Extract damage dice from spell effect text, fallback to 1d6
      const dmgMatch = spell.effect.match(/(\d+d\d+(?:[+-]\d+)?)/i)
      const dmgDice = dmgMatch ? dmgMatch[1] : '1d6'
      let damage = rollDamage(dmgDice)
      if (atk.isCritical) damage += rollDamage(dmgDice)

      const newHp = Math.max(0, currentHp - damage)
      session.worldState.flags[hpKey] = newHp as any

      const killed = newHp <= 0
      if (killed) facts.addEvent(`${targetId}被击杀`, 'critical')

      return {
        output: [
          `法术攻击(${spellId})：d20=${atk.roll}+${atkMod}=${atk.total} vs 难度${monster.dc} → ${atk.isCritical ? '暴击！' : '命中'}。`,
          `伤害：${dmgDice}=${damage}点${atk.isCritical ? '(暴击翻倍)' : ''}。${targetId}剩余HP：${newHp}/${monster.hp}。`,
          killed ? `${targetId}被击杀。掉落：${monster.loot.join('、')}。` : '',
        ].filter(Boolean).join(''),
      }
    }

    // Weapon attack
    const weapon = player.equipped.weapon
    if (!weapon) return { output: '未装备武器，无法进行武器攻击。', isError: true }

    const atkMod = player.abilityModifiers.STR + 2 + (weapon.bonus ?? 0) // STR + proficiency + weapon bonus
    const atk = attackRoll(atkMod, monster.dc)

    if (!atk.hits) {
      return { output: `攻击(${weapon.name})：d20=${atk.roll}+${atkMod}=${atk.total} vs 难度${monster.dc} → 未命中。` }
    }

    // Weapon damage from description (extract dice), fallback to 1d6
    const dmgMatch = weapon.description.match(/(\d+d\d+)/i)
    const dmgDice = dmgMatch ? dmgMatch[1] : '1d6'
    let damage = rollDamage(dmgDice) + player.abilityModifiers.STR
    if (atk.isCritical) damage += rollDamage(dmgDice)
    damage = Math.max(1, damage)

    const newHp = Math.max(0, currentHp - damage)
    session.worldState.flags[hpKey] = newHp as any

    const killed = newHp <= 0
    if (killed) facts.addEvent(`${targetId}被击杀`, 'critical')

    return {
      output: [
        `攻击(${weapon.name})：d20=${atk.roll}+${atkMod}=${atk.total} vs 难度${monster.dc} → ${atk.isCritical ? '暴击！' : '命中'}。`,
        `伤害：${dmgDice}+${player.abilityModifiers.STR}=${damage}点${atk.isCritical ? '(暴击翻倍)' : ''}。${targetId}剩余HP：${newHp}/${monster.hp}。`,
        killed ? `${targetId}被击杀。掉落：${monster.loot.join('、')}。` : '',
      ].filter(Boolean).join(''),
    }
  },
}
