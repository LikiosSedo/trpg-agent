/**
 * 效果管理器
 *
 * 统一管理玩家的 activeEffects（buff/debuff）。
 * 法术、药水、装备、环境都通过这个模块写入和查询效果。
 */

import type { PlayerCharacter, ActiveEffect, EffectType } from './types.js'

// ─── 初始化 ─────────────────────────────────────

/** 确保 activeEffects 数组存在（兼容旧存档） */
function ensureEffects(player: PlayerCharacter): ActiveEffect[] {
  if (!player.activeEffects) player.activeEffects = []
  return player.activeEffects
}

// ─── 添加效果 ─────────────────────────────────────

/** 添加一个效果。同名效果会被覆盖（刷新持续时间），不叠加。 */
export function addEffect(player: PlayerCharacter, effect: ActiveEffect): void {
  const effects = ensureEffects(player)
  // 同名覆盖：移除旧的同名效果
  const idx = effects.findIndex(e => e.name === effect.name)
  if (idx !== -1) effects.splice(idx, 1)
  effects.push(effect)
}

/** 快捷创建并添加效果 */
export function applyEffect(
  player: PlayerCharacter,
  opts: {
    name: string
    type: EffectType
    value: number
    turns: number       // >0: 持续回合数, -1: 永久
    source: ActiveEffect['source']
    damageType?: string
  },
): ActiveEffect {
  const effect: ActiveEffect = {
    id: `${opts.name.replace(/\s+/g, '_')}_${Date.now()}`,
    name: opts.name,
    type: opts.type,
    value: opts.value,
    remainingTurns: opts.turns,
    source: opts.source,
    damageType: opts.damageType,
  }
  addEffect(player, effect)
  return effect
}

// ─── 移除效果 ─────────────────────────────────────

/** 移除指定名称的效果 */
export function removeEffect(player: PlayerCharacter, name: string): boolean {
  const effects = ensureEffects(player)
  const idx = effects.findIndex(e => e.name === name)
  if (idx === -1) return false
  effects.splice(idx, 1)
  return true
}

/** 移除所有来自特定来源的效果 */
export function removeEffectsBySource(player: PlayerCharacter, source: ActiveEffect['source']): number {
  const effects = ensureEffects(player)
  const before = effects.length
  player.activeEffects = effects.filter(e => e.source !== source)
  return before - player.activeEffects.length
}

// ─── 每轮递减 ─────────────────────────────────────

/** 每轮结束时调用：所有效果 remainingTurns-1，到 0 的自动移除。返回过期效果名称列表。 */
export function tickEffects(player: PlayerCharacter): string[] {
  const effects = ensureEffects(player)
  const expired: string[] = []

  player.activeEffects = effects.filter(e => {
    if (e.remainingTurns === -1) return true // 永久效果不递减
    e.remainingTurns--
    if (e.remainingTurns <= 0) {
      expired.push(e.name)
      return false
    }
    return true
  })

  return expired
}

// ─── 查询效果 ─────────────────────────────────────

/** 获取某种类型的效果总值 */
export function getEffectBonus(player: PlayerCharacter, type: EffectType, damageType?: string): number {
  const effects = ensureEffects(player)
  return effects
    .filter(e => e.type === type && (!damageType || !e.damageType || e.damageType === damageType))
    .reduce((sum, e) => sum + e.value, 0)
}

/** 检查是否有某种类型的效果 */
export function hasEffect(player: PlayerCharacter, type: EffectType, damageType?: string): boolean {
  const effects = ensureEffects(player)
  return effects.some(e => e.type === type && (!damageType || !e.damageType || e.damageType === damageType))
}

/** 检查是否有指定名称的效果 */
export function hasEffectByName(player: PlayerCharacter, name: string): boolean {
  const effects = ensureEffects(player)
  return effects.some(e => e.name === name)
}

/** 获取所有活跃效果（用于状态面板显示） */
export function getActiveEffectsSummary(player: PlayerCharacter): string[] {
  const effects = ensureEffects(player)
  return effects.map(e => {
    const duration = e.remainingTurns === -1 ? '持续' : `${e.remainingTurns}轮`
    const sign = e.value > 0 ? '+' : ''
    return `${e.name}(${sign}${e.value} ${e.type}, ${duration})`
  })
}

// ─── 休息时清理 ─────────────────────────────────────

/** 长休息清除所有非永久效果 */
export function clearTemporaryEffects(player: PlayerCharacter): void {
  const effects = ensureEffects(player)
  player.activeEffects = effects.filter(e => e.remainingTurns === -1)
}
