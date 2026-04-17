/**
 * Tests for ally AI target selection (combatBehavior)
 *
 * Run: npx tsx src/combat-ally-ai.test.ts
 */

import { initGameState, getSession } from './game-state.js'
import { startCombat, executeAllyTurns } from './combat-manager.js'
import { pickNarrative } from './combat-narrative.js'
import type { GameSession, Monster, NPC } from './types.js'

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

// ─── Test session factory ─────────────────────────

function makeTestSession(): GameSession {
  return {
    player: {
      name: '测试勇者',
      level: 5,
      abilities: { STR: 14, DEX: 12, CON: 13, INT: 16, WIS: 10, CHA: 8 },
      abilityModifiers: { STR: 2, DEX: 1, CON: 1, INT: 3, WIS: 0, CHA: -1 },
      skills: [],
      hp: 100,
      maxHp: 100,
      gold: 50,
      inventory: [],
      spells: [],
      clues: [],
      xp: 0,
      equipped: {
        weapon: { name: '长剑', type: 'weapon', description: '', bonus: 0 },
        armor: { name: '皮甲', type: 'armor', description: '', bonus: 1 },
      },
    },
    npcs: [],
    quests: [],
    worldState: {
      currentLocation: 'test-area',
      timeOfDay: 'morning',
      flags: {},
    },
    events: [],
    turnCount: 1,
    combat: null,
  }
}

function makeNpc(name: string): NPC {
  return {
    name,
    trust: 10,
    knownFacts: [],
    playerPromises: [],
    interactionLog: [],
    location: 'test-area',
    mood: 'neutral',
    condition: 'normal',
  }
}

// ─── Monster DB with ally templates + test dummies ─────────────────────────

const monstersDb: Monster[] = [
  // Dummies: stationary high-HP targets that won't actually harm anyone
  {
    name: 'Dummy',
    hp: 200,
    dc: 1,  // impossible-to-miss AC so attacks always land
    damageDice: '1d1',
    specialAbility: '',
    description: 'Training dummy',
    loot: [],
  },
  // Ally templates — same structure as npc-combatants.json entries
  {
    name: '格雷格',
    hp: 65,
    dc: 15,
    damageDice: '1d8+4',
    specialAbility: '',
    description: '',
    loot: [],
    combatBehavior: 'subdue',
  } as Monster,
  {
    name: '格罗姆',
    hp: 40,
    dc: 13,
    damageDice: '1d10+3',
    specialAbility: '',
    description: '',
    loot: [],
    combatBehavior: 'kill',
  } as Monster,
  {
    name: '艾琳娜',
    hp: 80,
    dc: 17,
    damageDice: '2d6+5',
    specialAbility: '',
    description: '',
    loot: [],
    combatBehavior: 'fight',
  } as Monster,
]

// ─── Helper: setup combat with single ally + N dummies of custom HPs ───

function setupAllyVsDummies(allyName: string, dummyHps: Array<{ hp: number; maxHp: number }>) {
  initGameState(makeTestSession())
  const session = getSession()
  session.npcs.push(makeNpc(allyName))
  session.party = [allyName]

  // Create combat with N dummies
  const monsterNames = dummyHps.map(() => 'Dummy')
  startCombat(session, monsterNames, monstersDb)

  // 本测试专注验证同伴"目标选择逻辑"，不测试网格位置。
  // 删除 grid 以走非网格 AI 路径，让 selectAllyTarget 不受位置限制。
  const combat = session.combat!
  combat.grid = undefined
  combat.monsters.forEach(m => { m.pos = undefined })
  combat.allies.forEach(a => { a.pos = undefined })

  // Override dummy HPs to the test values
  combat.monsters.forEach((m, i) => {
    m.hp = dummyHps[i].hp
    m.maxHp = dummyHps[i].maxHp
  })

  return session
}

// ─── Helper: get alive ally IDs (used to force executeAllyTurns to run this round) ───

function allyIds(session: GameSession): string[] {
  return (session.combat?.allies ?? []).map(a => a.id)
}

// ─── Test 1: kill ally greedy-picks low HP target ─────────────────────────

console.log('\n=== Test 1: kill (格罗姆) should greedy-pick low HP target ===')
{
  const session = setupAllyVsDummies('格罗姆', [
    { hp: 200, maxHp: 200 },  // full HP
    { hp: 100, maxHp: 200 },  // half HP
    { hp: 20, maxHp: 200 },   // 10% HP — below 25% threshold
  ])
  const combat = session.combat!
  const targetedIds: string[] = []

  // Run 10 iterations — should consistently target the low HP one
  for (let i = 0; i < 10; i++) {
    // Reset HPs each iteration
    combat.monsters[0].hp = 200
    combat.monsters[1].hp = 100
    combat.monsters[2].hp = 20
    // Reset ally HP in case they took damage (they shouldn't — but just in case)
    combat.allies[0].hp = combat.allies[0].maxHp

    const { hits } = executeAllyTurns(session, allyIds(session))
    if (hits.length > 0) targetedIds.push(hits[0].targetName)
  }

  const lowHpTargetCount = targetedIds.filter(id => id === 'Dummy_3').length
  assert(lowHpTargetCount === 10, `kill ally targets low HP dummy 10/10 times: got ${lowHpTargetCount}/10 (picks: ${[...new Set(targetedIds)].join(',')})`)
  console.log(`  kill (格罗姆) picked: ${[...new Set(targetedIds)].join(', ')}`)
}

// ─── Test 2: subdue ally avoids low HP target ─────────────────────────

console.log('\n=== Test 2: subdue (格雷格) should avoid low HP target ===')
{
  const session = setupAllyVsDummies('格雷格', [
    { hp: 200, maxHp: 200 },  // full HP
    { hp: 100, maxHp: 200 },  // 50% HP
    { hp: 20, maxHp: 200 },   // 10% HP — should be AVOIDED
  ])
  const combat = session.combat!
  const targetedIds: string[] = []

  for (let i = 0; i < 10; i++) {
    combat.monsters[0].hp = 200
    combat.monsters[1].hp = 100
    combat.monsters[2].hp = 20
    combat.allies[0].hp = combat.allies[0].maxHp

    const { hits } = executeAllyTurns(session, allyIds(session))
    if (hits.length > 0) targetedIds.push(hits[0].targetName)
  }

  const lowHpTargetCount = targetedIds.filter(id => id === 'Dummy_3').length
  const fullHpTargetCount = targetedIds.filter(id => id === 'Dummy').length
  assert(lowHpTargetCount === 0, `subdue ally avoids low HP dummy: expected 0 picks, got ${lowHpTargetCount}`)
  assert(fullHpTargetCount === 10, `subdue ally picks highest healthy dummy 10/10 times: got ${fullHpTargetCount}/10`)
  console.log(`  subdue (格雷格) picked: ${[...new Set(targetedIds)].join(', ')}`)
}

// ─── Test 3: subdue fallback when all targets are low HP ─────────────────────

console.log('\n=== Test 3: subdue fallback — all targets are low HP, should still attack ===')
{
  const session = setupAllyVsDummies('格雷格', [
    { hp: 20, maxHp: 200 },  // 10%
    { hp: 15, maxHp: 200 },  // 7.5%
    { hp: 10, maxHp: 200 },  // 5%
  ])
  const combat = session.combat!
  const targetedIds: string[] = []

  for (let i = 0; i < 10; i++) {
    combat.monsters[0].hp = 20
    combat.monsters[1].hp = 15
    combat.monsters[2].hp = 10
    combat.allies[0].hp = combat.allies[0].maxHp

    const { hits } = executeAllyTurns(session, allyIds(session))
    if (hits.length > 0) targetedIds.push(hits[0].targetName)
  }

  assert(targetedIds.length === 10, `subdue fallback: attacks in all 10 iterations (not stalled): got ${targetedIds.length}/10`)
  // When all are low HP, subdue fallbacks to "highest HP of the low pool" = Dummy (20 HP)
  const highestLowTargetCount = targetedIds.filter(id => id === 'Dummy').length
  assert(highestLowTargetCount === 10, `subdue fallback picks highest HP from low pool: got ${highestLowTargetCount}/10`)
  console.log(`  subdue fallback picked: ${[...new Set(targetedIds)].join(', ')} (战斗不卡)`)
}

// ─── Test 4: fight ally distributes attacks randomly ─────────────────────

console.log('\n=== Test 4: fight (艾琳娜) should distribute randomly ===')
{
  const session = setupAllyVsDummies('艾琳娜', [
    { hp: 200, maxHp: 200 },
    { hp: 200, maxHp: 200 },
    { hp: 200, maxHp: 200 },
  ])
  const combat = session.combat!
  const targetCounts: Record<string, number> = {}

  // Run 100 iterations for statistical check
  for (let i = 0; i < 100; i++) {
    combat.monsters[0].hp = 200
    combat.monsters[1].hp = 200
    combat.monsters[2].hp = 200
    combat.allies[0].hp = combat.allies[0].maxHp

    const { hits } = executeAllyTurns(session, allyIds(session))
    if (hits.length > 0) {
      const t = hits[0].targetName
      targetCounts[t] = (targetCounts[t] || 0) + 1
    }
  }

  const dummy1 = targetCounts['Dummy'] || 0
  const dummy2 = targetCounts['Dummy_2'] || 0
  const dummy3 = targetCounts['Dummy_3'] || 0

  // Each should be in rough 33% range — allow 15-55% for statistical tolerance
  assert(dummy1 >= 15 && dummy1 <= 55, `fight ally spreads to dummy1: got ${dummy1}/100`)
  assert(dummy2 >= 15 && dummy2 <= 55, `fight ally spreads to dummy2: got ${dummy2}/100`)
  assert(dummy3 >= 15 && dummy3 <= 55, `fight ally spreads to dummy3: got ${dummy3}/100`)
  console.log(`  fight (艾琳娜) distribution: Dummy=${dummy1}, Dummy_2=${dummy2}, Dummy_3=${dummy3}`)
}

// ─── Test 5: subdue narrative templates exist and are picked ─────────────────────

console.log('\n=== Test 5: subdue narrative templates exist ===')
{
  // Call pickNarrative directly
  const hitText = pickNarrative('ally_subdue_hit' as any, { ally: '格雷格', target: '哥布林' })
  const critText = pickNarrative('ally_subdue_critical' as any, { ally: '格雷格', target: '哥布林' })

  assert(hitText.length > 0, `ally_subdue_hit template returns non-empty: "${hitText}"`)
  assert(hitText.includes('格雷格'), `ally_subdue_hit interpolates ally name: "${hitText}"`)
  assert(critText.length > 0, `ally_subdue_critical template returns non-empty: "${critText}"`)
  assert(critText.includes('格雷格'), `ally_subdue_critical interpolates ally name: "${critText}"`)
  console.log(`  ally_subdue_hit:      "${hitText}"`)
  console.log(`  ally_subdue_critical: "${critText}"`)
}

// ─── Test 6: combatBehavior is set from template (not default) ─────────────────────

console.log('\n=== Test 6: combatBehavior propagates from template ===')
{
  const session = setupAllyVsDummies('格雷格', [{ hp: 200, maxHp: 200 }])
  const ally = session.combat!.allies[0]
  assert(ally.combatBehavior === 'subdue', `格雷格 combatBehavior = subdue: got ${ally.combatBehavior}`)
  console.log(`  格雷格 combatBehavior = ${ally.combatBehavior}`)

  const session2 = setupAllyVsDummies('格罗姆', [{ hp: 200, maxHp: 200 }])
  const ally2 = session2.combat!.allies[0]
  assert(ally2.combatBehavior === 'kill', `格罗姆 combatBehavior = kill: got ${ally2.combatBehavior}`)
  console.log(`  格罗姆 combatBehavior = ${ally2.combatBehavior}`)

  const session3 = setupAllyVsDummies('艾琳娜', [{ hp: 200, maxHp: 200 }])
  const ally3 = session3.combat!.allies[0]
  assert(ally3.combatBehavior === 'fight', `艾琳娜 combatBehavior = fight: got ${ally3.combatBehavior}`)
  console.log(`  艾琳娜 combatBehavior = ${ally3.combatBehavior}`)
}

// ─── Summary ────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
