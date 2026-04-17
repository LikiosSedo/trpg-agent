// 单测：验证 getIdleEvent 触发逻辑 + 实际命中率
// 背景：playtest 10 轮 0 触发，需要确认是 bug 还是仅概率问题

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getIdleEvent } from './npc-idle-events.js'
import type { GameSession } from './types.js'

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    turnCount: 5,
    worldState: {
      currentLocation: 'dawnbreak-town',
      timeOfDay: 'morning',
      flags: {},
      currentSubLocation: '',
    },
    npcs: [
      { name: '格雷格', location: 'dawnbreak-town', condition: 'normal', trust: 0, mood: '温和', knownFacts: [], playerPromises: [], interactionLog: [] },
      { name: '小莉', location: 'dawnbreak-town', condition: 'normal', trust: 0, mood: '温和', knownFacts: [], playerPromises: [], interactionLog: [] },
      { name: '格罗姆', location: 'dawnbreak-town', condition: 'normal', trust: 0, mood: '温和', knownFacts: [], playerPromises: [], interactionLog: [] },
      { name: '叶绿', location: 'dawnbreak-town', condition: 'normal', trust: 0, mood: '温和', knownFacts: [], playerPromises: [], interactionLog: [] },
    ],
    player: { hp: 10, maxHp: 10, gold: 0, clues: [] },
    ...overrides,
  } as any
}

describe('getIdleEvent · 触发条件', () => {
  it('无候选 NPC（空场）→ 空字符串', () => {
    const s = makeSession({ npcs: [] })
    // 强制触发概率为 100%（Math.random 被 mock）
    const origRandom = Math.random
    Math.random = () => 0
    try {
      assert.equal(getIdleEvent(s), '')
    } finally {
      Math.random = origRandom
    }
  })

  it('候选 NPC 都在另一个地点 → 空', () => {
    const s = makeSession({
      worldState: { ...makeSession().worldState, currentLocation: 'twilight-woods' },
    })
    const origRandom = Math.random
    Math.random = () => 0
    try {
      assert.equal(getIdleEvent(s), '')
    } finally {
      Math.random = origRandom
    }
  })

  it('interactionNpc 不会被选中', () => {
    const s = makeSession({ interactionNpc: '格雷格' })
    const origRandom = Math.random
    // 强制 rand 命中 + 让 picker 偏向第一个
    Math.random = () => 0
    try {
      const out = getIdleEvent(s)
      assert.equal(out.includes('格雷格'), false, '格雷格正在交互，不该出现在 idle 片段里')
    } finally {
      Math.random = origRandom
    }
  })

  it('条件满足 + Math.random=0 → 触发且含 [氛围] 前缀', () => {
    const s = makeSession()
    const origRandom = Math.random
    Math.random = () => 0
    try {
      const out = getIdleEvent(s)
      assert.match(out, /^\[氛围\]/)
    } finally {
      Math.random = origRandom
    }
  })

  it('条件满足但 random > 0.06 → 不触发', () => {
    const s = makeSession()
    const origRandom = Math.random
    Math.random = () => 0.5
    try {
      assert.equal(getIdleEvent(s), '')
    } finally {
      Math.random = origRandom
    }
  })

  it('同 NPC 5 轮冷却：刚触发过的 NPC 在冷却期内不再被选', () => {
    const s = makeSession({
      turnCount: 5,
      worldState: {
        currentLocation: 'dawnbreak-town',
        timeOfDay: 'morning',
        flags: { idle_event_格雷格: 5 }, // 刚在 turn 5 触发过
        currentSubLocation: '',
      },
    })
    // 强制只有格雷格可选（其他 NPC 设为昏迷）
    s.npcs = s.npcs.map((n, i) => i === 0 ? n : { ...n, condition: 'unconscious' } as any)
    const origRandom = Math.random
    Math.random = () => 0 // rand 命中 + picker 选第一个
    try {
      const out = getIdleEvent(s)
      assert.equal(out, '', '格雷格冷却中，无其他候选 → 空')
    } finally {
      Math.random = origRandom
    }
  })

  it('冷却期外（≥ 5 轮后）可再次触发', () => {
    const s = makeSession({
      turnCount: 10,
      worldState: {
        currentLocation: 'dawnbreak-town',
        timeOfDay: 'morning',
        flags: { idle_event_格雷格: 5 }, // 5 轮前触发过
        currentSubLocation: '',
      },
    })
    s.npcs = s.npcs.map((n, i) => i === 0 ? n : { ...n, condition: 'unconscious' } as any)
    const origRandom = Math.random
    Math.random = () => 0
    try {
      const out = getIdleEvent(s)
      assert.match(out, /^\[氛围\]/)
    } finally {
      Math.random = origRandom
    }
  })
})

describe('getIdleEvent · 实测命中率（1000 次抽样）', () => {
  it('6% 概率下，10 轮玩法期望触发 ≥ 0.6 次；100 轮 ≥ 6 次', () => {
    // 不 mock random — 用真 RNG，10 轮模拟 3000 次取平均
    const runs = 3000
    let total = 0
    for (let i = 0; i < runs; i++) {
      const s = makeSession({
        turnCount: 1 + (i % 20), // 散开 turn，避免冷却堆积
      })
      if (getIdleEvent(s) !== '') total++
    }
    const rate = total / runs
    // 6% ± 2% 容忍带
    assert.ok(rate >= 0.04 && rate <= 0.08, `期望 4-8%，实测 ${(rate * 100).toFixed(1)}%`)
  })

  it('10 轮单局：触发 0 次的概率 ≈ 54%（binomial P(X=0 | n=10, p=0.06)）', () => {
    // 模拟 1000 个 10-轮局，统计零触发的局数
    let zeroRuns = 0
    const total = 1000
    for (let run = 0; run < total; run++) {
      let hits = 0
      for (let t = 1; t <= 10; t++) {
        const s = makeSession({
          turnCount: t,
          worldState: {
            currentLocation: 'dawnbreak-town',
            timeOfDay: 'morning',
            flags: {},
            currentSubLocation: '',
          },
        })
        if (getIdleEvent(s) !== '') hits++
      }
      if (hits === 0) zeroRuns++
    }
    const zeroRate = zeroRuns / total
    // 理论 P(X=0|n=10,p=0.06) = 0.94^10 ≈ 0.539
    // 容忍 ±5%
    assert.ok(
      zeroRate > 0.45 && zeroRate < 0.65,
      `10 轮 0 触发概率实测 ${(zeroRate * 100).toFixed(1)}% (理论 ≈ 54%)`
    )
  })
})
