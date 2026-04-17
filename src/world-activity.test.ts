// 单测：scripts/world-activity.ts 的 analyze() 函数
// 构造 mock session 快照，验证各项统计/洞察/信任分段逻辑

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from '../scripts/world-activity.js'

function makeSave(session: any) {
  return { session }
}

describe('world-activity · 基础统计', () => {
  it('空 session → 合理默认值', () => {
    const r = analyze(makeSave({}), 'test.json')
    assert.equal(r.turn, 0)
    assert.equal(r.npc.total, 0)
    assert.equal(r.memory.totalInteractions, 0)
    assert.equal(r.bestiary.encountered, 0)
    assert.match(r.insights.join(' '), /turn=0/)
  })

  it('turn>0 无 turn=0 警告', () => {
    const r = analyze(makeSave({ turnCount: 5 }), 'x.json')
    assert.equal(r.insights.some((i: string) => i.includes('turn=0')), false)
  })
})

describe('world-activity · 信任分布分段', () => {
  const mk = (trusts: number[]) => makeSave({
    npcs: trusts.map((t, i) => ({ name: `N${i}`, trust: t })),
  })

  it('-10~-4 → hostile', () => {
    const r = analyze(mk([-10, -8, -5, -4]), 'x.json')
    assert.equal(r.npc.trustDistribution.hostile, 4)
  })

  it('-3~-1 → curt', () => {
    const r = analyze(mk([-3, -2, -1]), 'x.json')
    assert.equal(r.npc.trustDistribution.curt, 3)
  })

  it('0~2 → neutral', () => {
    const r = analyze(mk([0, 1, 2]), 'x.json')
    assert.equal(r.npc.trustDistribution.neutral, 3)
  })

  it('3~5 → friendly', () => {
    const r = analyze(mk([3, 4, 5]), 'x.json')
    assert.equal(r.npc.trustDistribution.friendly, 3)
  })

  it('6~10 → close', () => {
    const r = analyze(mk([6, 8, 10]), 'x.json')
    assert.equal(r.npc.trustDistribution.close, 3)
  })
})

describe('world-activity · 永久仇恨计数', () => {
  it('多个 permanentGrudge 正确计数', () => {
    const r = analyze(makeSave({
      turnCount: 5,
      npcs: [
        { name: 'A', trust: -10, permanentGrudge: true },
        { name: 'B', trust: -10, permanentGrudge: true },
        { name: 'C', trust: 0 },
      ],
    }), 'x.json')
    assert.equal(r.npc.permanentGrudges, 2)
    assert.match(r.insights.join(' '), /永久仇恨/)
  })
})

describe('world-activity · NPC 记忆统计', () => {
  it('聚合 interactions / impressions / promises', () => {
    const r = analyze(makeSave({
      npcMemories: {
        A: {
          impressions: ['热情', '健谈'],
          interactions: [
            { turn: 1, type: 'talk', summary: 'x' },
            { turn: 2, type: 'gift', summary: 'y' },
          ],
          unfulfilledPromises: ['答应找药'],
        },
        B: {
          impressions: ['冷漠'],
          interactions: [{ turn: 3, type: 'witness', summary: 'z' }],
          unfulfilledPromises: [],
        },
      },
    }), 'x.json')
    assert.equal(r.memory.npcsWithMemory, 2)
    assert.equal(r.memory.totalInteractions, 3)
    assert.equal(r.memory.totalImpressions, 3)
    assert.equal(r.memory.totalUnfulfilledPromises, 1)
    assert.deepEqual(r.memory.byType, { talk: 1, gift: 1, witness: 1 })
  })

  it('空 memory 条目不计入 npcsWithMemory', () => {
    const r = analyze(makeSave({
      npcMemories: {
        A: { impressions: [], interactions: [], unfulfilledPromises: [] },
      },
    }), 'x.json')
    assert.equal(r.memory.npcsWithMemory, 0)
  })
})

describe('world-activity · 图鉴统计', () => {
  it('遭遇/弱点/抗性/免疫独立计数', () => {
    const r = analyze(makeSave({
      player: {
        bestiary: {
          Goblin: { encountered: true, weaknessKnown: true, notes: ['n1', 'n2'] },
          Wolf: { encountered: true, resistanceKnown: true },
          Dragon: { encountered: true, weaknessKnown: true, resistanceKnown: true, immunityKnown: true },
        },
      },
    }), 'x.json')
    assert.equal(r.bestiary.encountered, 3)
    assert.equal(r.bestiary.weaknessKnown, 2)
    assert.equal(r.bestiary.resistanceKnown, 2)
    assert.equal(r.bestiary.immunityKnown, 1)
    assert.equal(r.bestiary.notesTotal, 2)
  })
})

describe('world-activity · Idle event 统计', () => {
  it('从 flags 里识别 idle_event_* 键', () => {
    const r = analyze(makeSave({
      turnCount: 20,
      worldState: {
        flags: {
          idle_event_格雷格: 5,
          idle_event_小莉: 10,
          'other_flag': 'x',
          trust_cascade_艾琳娜: 15,
        },
      },
    }), 'x.json')
    assert.equal(r.idleEvents.triggered, 2)
    assert.equal(r.idleEvents.uniqueNpcs, 2)
  })

  it('10 轮后无 idle event → 警告', () => {
    const r = analyze(makeSave({ turnCount: 15, worldState: { flags: {} } }), 'x.json')
    assert.match(r.insights.join(' '), /无 idle event/)
  })
})

describe('world-activity · 任务统计', () => {
  it('按 status 分类 + objectivesCompleted 聚合', () => {
    const r = analyze(makeSave({
      quests: [
        { status: 'active', objectivesCompleted: [true, false, true] },
        { status: 'completed', objectivesCompleted: [true, true] },
        { status: 'failed', objectivesCompleted: [true] },
      ],
    }), 'x.json')
    assert.equal(r.quests.active, 1)
    assert.equal(r.quests.completed, 1)
    assert.equal(r.quests.failed, 1)
    assert.equal(r.quests.objectivesCompleted, 5) // 2 + 2 + 1
  })
})

describe('world-activity · 承诺追踪', () => {
  it('聚合多个 NPC 的 trackedPromises', () => {
    const r = analyze(makeSave({
      npcs: [
        { name: 'A', trackedPromises: [{ content: '1', fulfilled: true }, { content: '2', fulfilled: false }] },
        { name: 'B', trackedPromises: [{ content: '3', fulfilled: false }] },
      ],
    }), 'x.json')
    assert.equal(r.trackedPromises.total, 3)
    assert.equal(r.trackedPromises.fulfilled, 1)
    assert.equal(r.trackedPromises.pending, 2)
  })
})

describe('world-activity · 衍生洞察', () => {
  it('玩了 >10 轮但无记忆 interactions → red flag', () => {
    const r = analyze(makeSave({ turnCount: 12, npcMemories: {} }), 'x.json')
    assert.match(r.insights.join(' '), /提取器可能失败/)
  })

  it('遭遇怪物但无弱点 → yellow flag', () => {
    const r = analyze(makeSave({
      turnCount: 5,
      player: { bestiary: { Goblin: { encountered: true } } },
    }), 'x.json')
    assert.match(r.insights.join(' '), /一个弱点都没发现/)
  })

  it('弱点 > 0 → positive 洞察', () => {
    const r = analyze(makeSave({
      turnCount: 5,
      player: { bestiary: { Goblin: { encountered: true, weaknessKnown: true } } },
    }), 'x.json')
    assert.match(r.insights.join(' '), /callback 生效/)
  })

  it('任务卡住检测：活跃任务 5 轮无进度', () => {
    const r = analyze(makeSave({
      turnCount: 8,
      quests: [{ status: 'active', objectivesCompleted: [false, false, false] }],
    }), 'x.json')
    assert.match(r.insights.join(' '), /卡住/)
  })
})
