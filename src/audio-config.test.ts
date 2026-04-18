/**
 * 战斗 BGM 分流逻辑测试 (2026-04-18)
 * - 普通遭遇 → battle
 * - 多怪物(≥3) → danger
 * - boss → boss-battle
 * - 区域 ambient 战斗中保留(沉浸感)
 */

import { describe, it, expect } from 'vitest'
import { resolveAudio } from './audio-config.js'

describe('resolveAudio · 战斗 BGM 分流', () => {
  it('1-2 个普通怪物 → battle', () => {
    const a = resolveAudio('twilight-woods', undefined, 'morning', true, { monsterCount: 2 })
    expect(a.bgm).toBe('battle')
    // 森林场景战斗保留鸟鸣 ambient(沉浸感)
    expect(a.ambient).toBe('birds')
  })

  it('3+ 怪物 → danger', () => {
    const a = resolveAudio('twilight-woods', undefined, 'evening', true, { monsterCount: 3 })
    expect(a.bgm).toBe('danger')
    // evening 算 isNight → crickets
    expect(a.ambient).toBe('crickets')
  })

  it('hasBoss → boss-battle (覆盖 monsterCount)', () => {
    const a = resolveAudio('twilight-woods', undefined, 'morning', true,
      { hasBoss: true, monsterCount: 1 })
    expect(a.bgm).toBe('boss-battle')
  })

  it('hasBoss + 5 个杂兵 → boss-battle (boss 优先)', () => {
    const a = resolveAudio('shatterstone-wastes', undefined, 'noon', true,
      { hasBoss: true, monsterCount: 5 })
    expect(a.bgm).toBe('boss-battle')
    expect(a.ambient).toBe('wind')  // 荒原风声保留
  })

  it('矿洞战斗 → drip ambient', () => {
    const a = resolveAudio('greyspine-mines', undefined, 'morning', true, { monsterCount: 1 })
    expect(a.bgm).toBe('battle')
    expect(a.ambient).toBe('drip')
  })

  it('未知区域战斗 → battle + silence', () => {
    const a = resolveAudio('unknown-place', undefined, 'morning', true, { monsterCount: 2 })
    expect(a.bgm).toBe('battle')
    expect(a.ambient).toBe('silence')
  })

  it('combatCtx 不传 → 默认 battle (向后兼容老调用方)', () => {
    const a = resolveAudio('twilight-woods', undefined, 'morning', true)
    expect(a.bgm).toBe('battle')
  })

  it('非战斗 → combatCtx 被忽略', () => {
    const a = resolveAudio('twilight-woods', undefined, 'morning', false,
      { hasBoss: true, monsterCount: 10 })
    expect(a.bgm).toBe('forest')  // 暮色森林白天
  })
})
