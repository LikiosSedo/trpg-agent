// 单测：getKnownCombatTraits —— 锁定"已发现弱点/抗性/免疫注入战斗叙事"逻辑
// 设计目标：玩家前期探索得到的怪物知识必须在战斗叙事 DM prompt 里可见，
//          让叙事自然 callback（"你记得哥布林怕火"）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getKnownCombatTraits } from './bestiary.js'
import type { GameSession, BestiaryEntry, Monster } from './types.js'

function makeSession(bestiary: Record<string, Partial<BestiaryEntry>> = {}): GameSession {
  return {
    player: {
      bestiary: Object.fromEntries(
        Object.entries(bestiary).map(([k, v]) => [k, {
          encountered: false,
          weaknessKnown: false,
          resistanceKnown: false,
          immunityKnown: false,
          notes: [],
          ...v,
        }]),
      ),
    } as any,
  } as unknown as GameSession
}

const GOBLIN: Monster = {
  name: 'Goblin', nameZh: '哥布林',
  vulnerability: ['fire'], resistance: ['poison'], immunity: ['charm'],
} as any

const WOLF: Monster = {
  name: 'Wolf', nameZh: '灰狼',
  vulnerability: [], resistance: [], immunity: [],
} as any

const DB = [GOBLIN, WOLF]

describe('getKnownCombatTraits · 基础行为', () => {
  it('未遭遇的怪物 → 空字符串', () => {
    const s = makeSession()
    assert.equal(getKnownCombatTraits(s, 'Goblin', DB), '')
  })

  it('遭遇但无已知特性 → 空字符串（避免注入空标签）', () => {
    const s = makeSession({ Goblin: { encountered: true } })
    assert.equal(getKnownCombatTraits(s, 'Goblin', DB), '')
  })

  it('仅知弱点 → "怕fire"', () => {
    const s = makeSession({ Goblin: { encountered: true, weaknessKnown: true } })
    assert.equal(getKnownCombatTraits(s, 'Goblin', DB), '怕fire')
  })

  it('仅知抗性 → "抗poison"', () => {
    const s = makeSession({ Goblin: { encountered: true, resistanceKnown: true } })
    assert.equal(getKnownCombatTraits(s, 'Goblin', DB), '抗poison')
  })

  it('仅知免疫 → "免疫charm"', () => {
    const s = makeSession({ Goblin: { encountered: true, immunityKnown: true } })
    assert.equal(getKnownCombatTraits(s, 'Goblin', DB), '免疫charm')
  })

  it('全部已知 → 按顺序拼接（弱点/抗性/免疫）', () => {
    const s = makeSession({ Goblin: {
      encountered: true, weaknessKnown: true, resistanceKnown: true, immunityKnown: true,
    } })
    assert.equal(getKnownCombatTraits(s, 'Goblin', DB), '怕fire，抗poison，免疫charm')
  })

  it('knownFlag=true 但 template 没有对应字段 → 不输出该项', () => {
    // Wolf 全空，即使 weaknessKnown=true 也没东西显示
    const s = makeSession({ Wolf: { encountered: true, weaknessKnown: true } })
    assert.equal(getKnownCombatTraits(s, 'Wolf', DB), '')
  })

  it('怪物不在 DB 里 → 空字符串（降级保护）', () => {
    const s = makeSession({ Unknown: { encountered: true, weaknessKnown: true } })
    assert.equal(getKnownCombatTraits(s, 'Unknown', DB), '')
  })

  it('session.player.bestiary 未初始化 → 空字符串（懒初始化保护）', () => {
    const s = { player: {} } as unknown as GameSession
    assert.equal(getKnownCombatTraits(s, 'Goblin', DB), '')
  })

  it('多个弱点值用 / 连接（单标签内）', () => {
    const multi: Monster = { name: 'X', vulnerability: ['fire', 'radiant'] } as any
    const s = makeSession({ X: { encountered: true, weaknessKnown: true } })
    assert.equal(getKnownCombatTraits(s, 'X', [multi]), '怕fire/radiant')
  })
})

describe('getKnownCombatTraits · 防泄漏（只透露已知的）', () => {
  it('未解锁 weaknessKnown 时，不泄漏 vulnerability 字段', () => {
    const s = makeSession({ Goblin: { encountered: true } })
    const out = getKnownCombatTraits(s, 'Goblin', DB)
    assert.equal(out, '', '即使 template 有弱点，未解锁就不能泄漏')
  })

  it('只解锁抗性时，不泄漏弱点', () => {
    const s = makeSession({ Goblin: { encountered: true, resistanceKnown: true } })
    const out = getKnownCombatTraits(s, 'Goblin', DB)
    assert.equal(out.includes('fire'), false, '弱点 fire 不能出现')
    assert.equal(out, '抗poison')
  })
})
