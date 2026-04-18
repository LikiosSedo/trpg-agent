/**
 * 2026-04-18 验证 POI discovery 不再污染 module-level data
 *
 * Bug 历史:
 *   tools/search.ts:178 直接 mutate `loc.pointsOfInterest[i].discovered = true`
 *   → JavaScript ESM 模块导入是 by-reference 的,这个改动持续到 server 重启
 *   → "开新游戏后地图仍显示上一局发现的隐藏 POI"
 *
 * 修复:
 *   1. POI_INITIAL_DISCOVERED 在模块加载时 snapshot 一次,作为 immutable 真理源
 *   2. markPoiDiscovered 写入 session.worldState.flags
 *   3. isPoiDiscovered(session, poi) 综合 snapshot + flag
 */

import { describe, it, expect } from 'vitest'
import { locations, isPoiDiscovered, markPoiDiscovered } from './data/maps.js'

describe('POI discovery · session-scoped, 不污染 module', () => {
  // 找一个默认 discovered=false 的 POI 来测
  const woods = locations['twilight-woods']
  const hiddenPoi = woods?.pointsOfInterest.find(p => p.discovered === false)
  if (!hiddenPoi) throw new Error('需要一个 default-hidden POI 来跑测试')

  it('新 session: hidden POI 默认未发现', () => {
    const sessionA = { worldState: { flags: {} as Record<string, any> } }
    expect(isPoiDiscovered(sessionA, hiddenPoi)).toBe(false)
  })

  it('markPoiDiscovered 只影响调用的 session', () => {
    const sessionA = { worldState: { flags: {} as Record<string, any> } }
    const sessionB = { worldState: { flags: {} as Record<string, any> } }

    // session A 发现该 POI
    markPoiDiscovered(sessionA, hiddenPoi.id)
    expect(isPoiDiscovered(sessionA, hiddenPoi)).toBe(true)

    // session B 应该仍然未发现 (无跨 session 污染)
    expect(isPoiDiscovered(sessionB, hiddenPoi)).toBe(false)
  })

  it('module data 不被 mark 修改', () => {
    const sessionA = { worldState: { flags: {} as Record<string, any> } }
    const beforeDiscovered = hiddenPoi.discovered
    markPoiDiscovered(sessionA, hiddenPoi.id)
    // module-level POI.discovered 字段不应被改
    expect(hiddenPoi.discovered).toBe(beforeDiscovered)
    expect(hiddenPoi.discovered).toBe(false)
  })

  it('默认 discovered=true 的 POI: 任何 session 都返回 true', () => {
    const visiblePoi = woods?.pointsOfInterest.find(p => p.discovered === true)
    if (!visiblePoi) return
    const session = { worldState: { flags: {} } }
    expect(isPoiDiscovered(session, visiblePoi)).toBe(true)
  })

  it('防回归: 即使有人 hack 改了 module-level discovered, 新 session 仍按 snapshot 判断', () => {
    // 模拟历史 bug 行为
    const oldVal = hiddenPoi.discovered
    ;(hiddenPoi as any).discovered = true  // 模拟被污染
    try {
      const freshSession = { worldState: { flags: {} as Record<string, any> } }
      // helper 应该忽略 module mutation, 只看 snapshot + flag
      // hiddenPoi 在 snapshot 时 discovered=false → 不在 POI_INITIAL_DISCOVERED 中
      // session flag 为空 → 应该返回 false
      expect(isPoiDiscovered(freshSession, hiddenPoi)).toBe(false)
    } finally {
      ;(hiddenPoi as any).discovered = oldVal  // 恢复
    }
  })
})
