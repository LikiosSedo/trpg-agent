/**
 * Tests for beat-driven fallback action generation.
 *
 * Specifically targets the "trustGate beats leak into ★主线引导" bug:
 *   chapter 2 had ch2_greg_darian_hint (talk:格雷格 + trustGate格雷格≥4 + optional)
 *   buildFallbackActions previously didn't filter trustGate beats, generating
 *   "★前往破晓镇找格雷格" as a quest waypoint even when player was deep into
 *   chapter 2 forest content.
 *
 * Run: npx tsx src/beat-fallback.test.ts
 */

import { buildFallbackActions, getQuestHint } from './engine.js'
import type { GameSession, NPC } from './types.js'

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  FAIL: ${msg}`)
  }
}

// ─── 测试用 NPC 工厂 ─────────────────────────────

function makeNpc(name: string, location: string, opts: Partial<NPC> = {}): NPC {
  return {
    name,
    trust: 5,
    knownFacts: [],
    playerPromises: [],
    interactionLog: [],
    location,
    mood: 'neutral',
    condition: 'normal',
    ...opts,
  }
}

// ─── 测试用 session 工厂：chapter 2 + twilight-woods 状态 ─────────────────

function makeCh2ForestSession(): GameSession {
  return {
    player: {
      name: '测试林克',
      level: 5,
      abilities: { STR: 14, DEX: 12, CON: 13, INT: 16, WIS: 10, CHA: 8 },
      abilityModifiers: { STR: 2, DEX: 1, CON: 1, INT: 3, WIS: 0, CHA: -1 },
      skills: [],
      hp: 38,
      maxHp: 38,
      gold: 20,
      inventory: [],
      spells: [],
      clues: [],
      xp: 0,
      equipped: {
        weapon: { name: '短剑 +1', type: 'weapon', description: '', bonus: 1 },
        armor: { name: '皮甲', type: 'armor', description: '', bonus: 1 },
      },
    },
    npcs: [
      // 关键：格雷格高信任，trustGate(格雷格≥4) 满足。
      // 旧 bug: 即使满足，也不该作为 ★ 引导推荐
      makeNpc('格雷格', 'dawnbreak-town', { trust: 6, subLocation: 'shattered-shield-tavern', homeBase: 'shattered-shield-tavern' }),
      makeNpc('小莉', 'dawnbreak-town', { trust: 3, subLocation: 'shattered-shield-tavern', homeBase: 'shattered-shield-tavern' }),
      makeNpc('艾琳娜', 'dawnbreak-town', { trust: 4, subLocation: 'adventurer-guild', homeBase: 'adventurer-guild' }),
      makeNpc('老林', 'twilight-woods', { trust: 0, subLocation: 'hunter-stone-house', homeBase: 'hunter-stone-house' }),
    ],
    quests: [],
    worldState: {
      currentLocation: 'twilight-woods',
      currentSubLocation: 'forest-entrance',
      timeOfDay: 'afternoon',
      flags: {},
    },
    events: [],
    turnCount: 20,
    combat: null,
    chapter: {
      currentChapter: 'ch2',
      // 玩家已完成 ch2_meet_elena 和 ch2_forest_quest，进入森林路径
      completedBeats: ['ch1_meet_greg', 'ch1_xiaoli', 'ch1_guild_direction', 'ch1_night_event', 'ch2_meet_elena', 'ch2_forest_quest'],
      discoveries: [],
      idleTurns: 0,
      nudgeIndex: 0,
    },
  } as GameSession
}

// ─── Test 1: 回归测试 — 不应再生成"前往破晓镇找格雷格" ─────────────────

console.log('\n=== Test 1: chapter 2 + twilight-woods 时不应推荐"前往破晓镇找格雷格" ===')
{
  const session = makeCh2ForestSession()
  const actions = buildFallbackActions(session)
  const allText = actions.suggestions.join(' | ')

  console.log(`  生成的 suggestions: [${actions.suggestions.join(', ')}]`)

  const hasGregBug = actions.suggestions.some(s => s.includes('格雷格') && s.includes('破晓镇'))
  assert(!hasGregBug, `不应推荐"前往破晓镇找格雷格"（格雷格相关 trustGate beat 应被过滤）— 实际: ${allText}`)
}

// ─── Test 2: 应推荐当前主线 — "前往猎人石屋找老林" ─────────────────

console.log('\n=== Test 2: chapter 2 + twilight-woods 应推荐"前往猎人石屋找老林" ===')
{
  const session = makeCh2ForestSession()
  const actions = buildFallbackActions(session)
  const hasOldLin = actions.suggestions.some(s => s.includes('老林'))
  assert(hasOldLin, `应推荐和老林相关的引导（ch2_meet_hunter 是非 trustGate 的 optional 主线 beat）— 实际: [${actions.suggestions.join(', ')}]`)
}

// ─── Test 3: getQuestHint 应跳过 trustGate beats ─────────────────

console.log('\n=== Test 3: getQuestHint 同样过滤 trustGate beats ===')
{
  const session = makeCh2ForestSession()
  const hint = getQuestHint(session)
  assert(hint !== null, 'questHint 不应为 null')
  if (hint) {
    console.log(`  hint.objective: "${hint.objective}", hint.action: "${hint.action}"`)
    // questHint 选第一个非 trustGate 的 pending beat — 应是 ch2_meet_hunter
    assert(!hint.action?.includes('破晓镇') || !hint.action.includes('格雷格'),
      `quest hint action 不应是"前往破晓镇找格雷格": "${hint.action}"`)
    assert(hint.objective?.includes('老林') ?? false,
      `quest hint objective 应该围绕老林（ch2_meet_hunter）: "${hint.objective}"`)
  }
}

// ─── Test 4: 即使格雷格信任度高也不应推荐 ─────────────────

console.log('\n=== Test 4: 格雷格 trust 拉满也不应推荐（trustGate 是过滤标志，不是阈值检查）===')
{
  const session = makeCh2ForestSession()
  const greg = session.npcs.find(n => n.name === '格雷格')!
  greg.trust = 10 // 拉满

  const actions = buildFallbackActions(session)
  const hasGregBug = actions.suggestions.some(s => s.includes('格雷格') && s.includes('破晓镇'))
  assert(!hasGregBug, `信任度 10 也不应该推荐 trust-driven beat — 这是隐藏内容不是 quest waypoint. 实际: [${actions.suggestions.join(', ')}]`)
}

// ─── Test 5: chapter 1 不受影响（无 trustGate beats）─────────────────

console.log('\n=== Test 5: chapter 1 行为不受影响（chapter 1 没有 trustGate beats）===')
{
  const session = makeCh2ForestSession()
  session.chapter!.currentChapter = 'ch1'
  session.chapter!.completedBeats = []  // 全新 ch1
  session.worldState.currentLocation = 'dawnbreak-town'
  session.worldState.currentSubLocation = 'shattered-shield-tavern'

  const actions = buildFallbackActions(session)
  console.log(`  ch1 suggestions: [${actions.suggestions.join(', ')}]`)
  // ch1_meet_greg trigger=talk:格雷格, 没有 trustGate, 应被推荐
  // 玩家已经在酒馆同 sub-location, 应推 "和格雷格交谈"
  const hasGregTalk = actions.suggestions.some(s => s.includes('格雷格'))
  assert(hasGregTalk, `chapter 1 应保持原行为：和格雷格交谈应在推荐列表 — 实际: [${actions.suggestions.join(', ')}]`)
}

// ─── Summary ────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
