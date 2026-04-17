// 单测：锁定信任系统的核心行为 + 数值阈值（防止回归）
// 依据 CLAUDE.md §4 数值平衡规范 —— 这些测试保护当前平衡，不改代码/不调参数

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { changeTrust, evaluateResponse } from './trust-system.js'
import type { GameSession, NPC } from './types.js'

function makeNpc(overrides: Partial<NPC> = {}): NPC {
  return {
    name: '格雷格',
    trust: 0,
    knownFacts: [],
    playerPromises: [],
    interactionLog: [],
    location: '破晓镇',
    mood: '中立',
    ...overrides,
  } as NPC
}

function makeSession(npcs: NPC[], chapter = 'ch1'): GameSession {
  return {
    npcs,
    chapter: { currentChapter: chapter } as any,
  } as unknown as GameSession
}

describe('changeTrust · 基础路径', () => {
  it('正向变化应用并 clamp 到 [−10,10] 上限', () => {
    const npc = makeNpc({ trust: 9 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'quest', delta: 5, reason: '任务完成', turn: 1,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, 10, '应被 clamp 到 10')
  })

  it('负向变化 clamp 到 −10 下限', () => {
    const npc = makeNpc({ trust: -8 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'reputation', delta: -8, reason: '暴力', turn: 1,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, -10)
  })

  it('NPC 不存在 → applied=false', () => {
    const session = makeSession([makeNpc()])
    const r = changeTrust(session, {
      npcName: '不存在的人', channel: 'dialogue', delta: 1, reason: '', turn: 1,
    })
    assert.equal(r.applied, false)
    assert.match(r.reason!, /不存在/)
  })
})

describe('changeTrust · Dialogue 冷却（3 轮锁）', () => {
  it('首次 dialogue +1 成功并记录 turn', () => {
    const npc = makeNpc({ trust: 2 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'dialogue', delta: 1, reason: '真诚对话', turn: 5,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, 3)
    assert.equal(npc.lastDialogueTrustTurn, 5)
  })

  it('冷却内（< 3 轮后）再调 dialogue +1 被拒绝', () => {
    const npc = makeNpc({ trust: 3, lastDialogueTrustTurn: 5 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'dialogue', delta: 1, reason: '', turn: 6,
    })
    assert.equal(r.applied, false)
    assert.equal(npc.trust, 3, '信任未变')
    assert.match(r.reason!, /冷却/)
  })

  it('冷却后（≥ 3 轮）再调 dialogue +1 成功', () => {
    const npc = makeNpc({ trust: 3, lastDialogueTrustTurn: 5 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'dialogue', delta: 1, reason: '', turn: 8,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, 4)
  })

  it('dialogue 冷却不影响负向变化', () => {
    const npc = makeNpc({ trust: 3, lastDialogueTrustTurn: 5 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'dialogue', delta: -1, reason: '', turn: 6,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, 2)
  })

  it('dialogue 冷却不影响其他通道（quest/gift 等）', () => {
    const npc = makeNpc({ trust: 3, lastDialogueTrustTurn: 5 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'quest', delta: 2, reason: '任务', turn: 6,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, 5)
  })
})

describe('changeTrust · 章节信任上限软衰减', () => {
  it('ch1 格雷格 trust=4（上限）+1 → 衰减为 floor(1/3)=0，信任不变', () => {
    const npc = makeNpc({ trust: 4 })
    const session = makeSession([npc], 'ch1')
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'quest', delta: 1, reason: '', turn: 1,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, 4, '上限后 +1 衰减为 0')
  })

  it('ch1 格雷格 trust=4 +3 → 衰减为 floor(3/3)=1', () => {
    const npc = makeNpc({ trust: 4 })
    const session = makeSession([npc], 'ch1')
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'quest', delta: 3, reason: '', turn: 1,
    })
    assert.equal(npc.trust, 5)
  })

  it('ch2 格雷格上限 6，trust=5 < 上限 +3 → 不衰减', () => {
    const npc = makeNpc({ trust: 5 })
    const session = makeSession([npc], 'ch2')
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'quest', delta: 3, reason: '', turn: 1,
    })
    assert.equal(npc.trust, 8)
  })

  it('ch4 上限 10：大幅正向变化正常应用（ceiling 未触发）', () => {
    const npc = makeNpc({ trust: 8 })
    const session = makeSession([npc], 'ch4')
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'quest', delta: 2, reason: '', turn: 1,
    })
    assert.equal(npc.trust, 10)
  })
})

describe('changeTrust · 永久仇恨', () => {
  it('触发 grudgeTag（attack_小莉）→ trust 钉死 -10 + permanentGrudge=true', () => {
    const npc = makeNpc({ trust: 3 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'reputation', delta: -5,
      reason: '打了小莉', turn: 1, grudgeTag: 'attack_小莉',
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, -10)
    assert.equal(npc.permanentGrudge, true)
  })

  it('已 permanentGrudge 的 NPC 正向 delta 被拒绝', () => {
    const npc = makeNpc({ trust: -10, permanentGrudge: true })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'gift', delta: 3, reason: '送礼', turn: 1,
    })
    assert.equal(r.applied, false)
    assert.match(r.reason!, /永远不会原谅/)
    assert.equal(npc.trust, -10)
  })

  it('已 permanentGrudge 的 NPC 负向 delta 仍能应用', () => {
    const npc = makeNpc({ trust: -10, permanentGrudge: true })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'reputation', delta: -2, reason: '', turn: 1,
    })
    assert.equal(r.applied, true)
    // 已在下限 clamp 保持 -10
    assert.equal(npc.trust, -10)
  })
})

describe('changeTrust · 反垃圾恢复（负信任小恩小惠）', () => {
  it('trust=-5 时 gift +1 被拒绝（小恩小惠）', () => {
    const npc = makeNpc({ trust: -5 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'gift', delta: 1, reason: '送糖果', turn: 1,
    })
    assert.equal(r.applied, false)
    assert.match(r.reason!, /小恩小惠/)
  })

  it('trust=-5 时 gift +2（有价值礼物）应用', () => {
    const npc = makeNpc({ trust: -5 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'gift', delta: 2, reason: '送金币', turn: 1,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, -3)
  })

  it('trust=-5 时 quest +3 不受限制（quest 通道例外）', () => {
    const npc = makeNpc({ trust: -5 })
    const session = makeSession([npc])
    const r = changeTrust(session, {
      npcName: '格雷格', channel: 'quest', delta: 3, reason: '完成了任务', turn: 1,
    })
    assert.equal(r.applied, true)
    assert.equal(npc.trust, -2)
  })
})

describe('evaluateResponse · 梯度响应阈值', () => {
  // 格雷格 thresholds (DEFAULT_THRESHOLDS)：
  // { curt: -2, hostile: -5, avoidance: -6, combat: -8 } + canFight: true
  // 战斗型 NPC 不回避 —— avoidance 阈值下实际走 hostile_dialogue
  it('trust ≥ 0 → normal', () => {
    assert.equal(evaluateResponse(makeNpc({ trust: 0 })).type, 'normal')
    assert.equal(evaluateResponse(makeNpc({ trust: 5 })).type, 'normal')
  })
  it('格雷格 trust = -2 → curt', () => {
    assert.equal(evaluateResponse(makeNpc({ trust: -2 })).type, 'curt')
  })
  it('格雷格 trust = -4 → 仍 curt（未到 hostile=-5）', () => {
    assert.equal(evaluateResponse(makeNpc({ trust: -4 })).type, 'curt')
  })
  it('格雷格 trust = -5 → hostile_dialogue', () => {
    assert.equal(evaluateResponse(makeNpc({ trust: -5 })).type, 'hostile_dialogue')
  })
  it('格雷格 trust = -7 → hostile_dialogue（canFight 不回避）', () => {
    assert.equal(evaluateResponse(makeNpc({ trust: -7 })).type, 'hostile_dialogue')
  })
  it('格雷格 trust = -8 → combat_trigger', () => {
    assert.equal(evaluateResponse(makeNpc({ trust: -8 })).type, 'combat_trigger')
  })
  it('小莉 trust = -6 → avoidance（canFight=false，走回避分支）', () => {
    assert.equal(evaluateResponse(makeNpc({ name: '小莉', trust: -6 })).type, 'avoidance')
  })
})
