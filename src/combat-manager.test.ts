/**
 * Tests for combat-manager
 *
 * Run: npx tsx src/combat-manager.test.ts
 */

import { initGameState, getSession, getFacts } from './game-state.js'
import { rollInitiative, calculatePlayerAC, parseAttackMod } from './rules-engine.js'
import {
  startCombat, executePlayerAttack, executeMonsterTurns,
  executePlayerTurn, executeMonsterPhase, checkCombatEnd, awardLoot, endCombat,
  getCombatSummary,
} from './combat-manager.js'
import type { GameSession, PlayerCharacter, Monster } from './types.js'

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

function makeTestSession(): GameSession {
  return {
    player: {
      name: '测试勇者',
      level: 1,
      abilities: { STR: 14, DEX: 12, CON: 13, INT: 16, WIS: 10, CHA: 8 },
      abilityModifiers: { STR: 2, DEX: 1, CON: 1, INT: 3, WIS: 0, CHA: -1 },
      skills: ['athletics', 'arcana', 'perception', 'investigation', 'persuasion'],
      hp: 20,
      maxHp: 20,
      gold: 50,
      inventory: [],
      spells: [
        { name: 'Fire Bolt', description: '', effect: 'Deal 1d10 fire damage.', usesPerRest: 0, remaining: 0 },
        { name: 'Magic Missile', description: '', effect: 'Deal 3d4+3 force damage.', usesPerRest: 3, remaining: 3 },
      ],
      clues: [],
      xp: 0,
      equipped: {
        weapon: { name: '长剑', type: 'weapon', description: '造成1d8劈砍伤害。', bonus: 0 },
        armor: { name: '皮甲', type: 'armor', description: 'AC 11 + 敏捷调整值。', bonus: 1 },
      },
    },
    npcs: [],
    quests: [],
    worldState: {
      currentLocation: 'twilight-woods',
      timeOfDay: 'morning',
      flags: {},
    },
    events: [],
    turnCount: 1,
    combat: null,
  }
}

const monstersDb: Monster[] = [
  {
    name: 'Goblin',
    hp: 7,
    dc: 12,
    damageDice: '1d6+2',
    specialAbility: 'Nimble Escape',
    description: 'A small cunning humanoid.',
    loot: ['锈蚀匕首', '3 gold'],
  },
  {
    name: 'Skeleton',
    hp: 13,
    dc: 13,
    damageDice: '1d6+2',
    specialAbility: 'Undead Fortitude',
    description: 'Animated bones.',
    loot: ['骨骼碎片', '5 gold'],
  },
]

// ──── Rules Engine - New Functions ────

console.log('\n=== Rules Engine - Combat Functions ===')

const init = rollInitiative(2)
assert(init.roll >= 1 && init.roll <= 20, `rollInitiative roll in [1,20]: ${init.roll}`)
assert(init.total === init.roll + 2, `rollInitiative total = roll + mod: ${init.total}`)
console.log(`  rollInitiative(+2): roll=${init.roll}, total=${init.total}`)

assert(parseAttackMod('1d6+2') === 2, 'parseAttackMod("1d6+2") = 2')
assert(parseAttackMod('2d8') === 0, 'parseAttackMod("2d8") = 0')
assert(parseAttackMod('2d8+4') === 4, 'parseAttackMod("2d8+4") = 4')
assert(parseAttackMod('1d4-1') === -1, 'parseAttackMod("1d4-1") = -1')
console.log('  parseAttackMod: all correct')

const testP = makeTestSession().player
assert(calculatePlayerAC(testP) === 12, `calculatePlayerAC with armor = 12: got ${calculatePlayerAC(testP)}`)
testP.equipped.armor = undefined
assert(calculatePlayerAC(testP) === 11, `calculatePlayerAC no armor = 11: got ${calculatePlayerAC(testP)}`)
console.log('  calculatePlayerAC: all correct')

// ──── Combat Manager ────

console.log('\n=== Combat Manager Tests ===')

// Test: startCombat
initGameState(makeTestSession())
let session = getSession()
const combat = startCombat(session, ['Goblin'], monstersDb)

assert(combat.active === true, 'combat is active')
assert(combat.round === 1, 'combat round = 1')
assert(combat.monsters.length === 1, 'one monster in combat')
assert(combat.monsters[0].id === 'Goblin', `monster id = "Goblin": got "${combat.monsters[0].id}"`)
assert(combat.monsters[0].hp === 7, 'monster hp = 7')
assert(combat.monsters[0].maxHp === 7, 'monster maxHp = 7')
assert(combat.monsters[0].ac === 12, 'monster ac = 12')
assert(combat.monsters[0].attackMod === 4, `monster attackMod = 4: got ${combat.monsters[0].attackMod}`)
assert(combat.initiativeOrder.length === 2, 'initiative order has 2 entries')
assert(combat.log.length > 0, 'combat log not empty')
console.log(`  startCombat: ${combat.log.join('; ')}`)

// Test: getCombatSummary
const summary = getCombatSummary(session)
assert(summary !== null, 'combat summary not null')
assert(summary!.includes('战斗进行中'), 'summary includes header')
console.log(`  getCombatSummary: ok`)

// Test: multiple monsters
initGameState(makeTestSession())
session = getSession()
const combat2 = startCombat(session, ['Goblin', 'Goblin', 'Skeleton'], monstersDb)
assert(combat2.monsters.length === 3, `3 monsters: got ${combat2.monsters.length}`)
assert(combat2.monsters[0].id === 'Goblin', 'first goblin id = "Goblin"')
assert(combat2.monsters[1].id === 'Goblin_2', 'second goblin id = "Goblin_2"')
assert(combat2.monsters[2].id === 'Skeleton', 'skeleton id = "Skeleton"')
assert(combat2.initiativeOrder.length === 4, '4 entries in initiative order')
console.log('  startCombat(multiple): 2 Goblins + 1 Skeleton, initiative order has 4 entries')

// Test: executePlayerTurn + executeMonsterPhase (run multiple rounds until combat ends)
initGameState(makeTestSession())
session = getSession()
session.player.hp = 100
session.player.maxHp = 100 // make player very tanky to ensure they survive
startCombat(session, ['Goblin'], monstersDb)

let rounds = 0
let ended = false
let result = 'ongoing'
while (!ended && rounds < 20) {
  rounds++
  const playerTurn = executePlayerTurn(session, 'Goblin', 'weapon')
  if (playerTurn.ended) {
    ended = true
    result = playerTurn.result
    break
  }
  // Execute monster phase
  const monsterPhase = executeMonsterPhase(session)
  if (monsterPhase.ended) {
    ended = true
    result = monsterPhase.result
  }
}

assert(ended, `combat ended within 20 rounds: ended=${ended}`)
if (result === 'victory') {
  assert(session.combat === null, 'combat state cleared after victory')
  // Check loot was awarded
  assert(session.player.gold > 50, `gold increased from 50: got ${session.player.gold}`)
  const hasLoot = session.player.inventory.some(i => i.name === '锈蚀匕首')
  assert(hasLoot, '锈蚀匕首 in inventory')
  console.log(`  executePlayerTurn: victory in ${rounds} rounds, gold=${session.player.gold}, inventory has 锈蚀匕首`)
} else {
  console.log(`  executePlayerTurn: ${result} in ${rounds} rounds (player tanky, shouldn't lose to goblin)`)
}

// Test: pendingMonsterTurn flag
initGameState(makeTestSession())
session = getSession()
session.player.hp = 100
session.player.maxHp = 100
startCombat(session, ['Goblin'], monstersDb)
// Make goblin very tanky so it survives
session.combat!.monsters[0].hp = 999
session.combat!.monsters[0].maxHp = 999
const ptResult = executePlayerTurn(session, 'Goblin', 'weapon')
assert(!ptResult.ended, 'combat not ended after player turn (tanky goblin)')
assert(session.combat!.pendingMonsterTurn === true, 'pendingMonsterTurn set after player turn')
const mpResult = executeMonsterPhase(session)
assert(session.combat?.pendingMonsterTurn === false, 'pendingMonsterTurn cleared after monster phase')
console.log('  pendingMonsterTurn flag: set and cleared correctly')
endCombat(session)

// Test: combat with spell
initGameState(makeTestSession())
session = getSession()
session.player.hp = 100
session.player.maxHp = 100
startCombat(session, ['Goblin'], monstersDb)

const spellRound = executePlayerTurn(session, 'Goblin', 'spell', 'Fire Bolt')
assert(spellRound.roundLog.length > 0, 'spell round has log entries')
assert(spellRound.roundLog.some(l => l.includes('Fire Bolt')), 'spell round mentions Fire Bolt')
console.log(`  executePlayerTurn(spell): ${spellRound.roundLog.find(l => l.includes('Fire Bolt'))}`)

// Test: player defeat via monster phase
initGameState(makeTestSession())
session = getSession()
session.player.hp = 1 // extremely low HP
startCombat(session, ['Goblin', 'Goblin', 'Goblin'], monstersDb) // outnumbered

rounds = 0
ended = false
result = 'ongoing'
while (!ended && rounds < 20) {
  rounds++
  const pt = executePlayerTurn(session, 'Goblin', 'weapon')
  if (pt.ended) { ended = true; result = pt.result; break }
  const mp = executeMonsterPhase(session)
  if (mp.ended) { ended = true; result = mp.result; break }
}
// Either victory or defeat, but should end
assert(ended, 'combat ended')
console.log(`  executePlayerTurn+MonsterPhase(low hp): ${result} in ${rounds} rounds, player HP=${session.player.hp}`)

// Test: checkCombatEnd
initGameState(makeTestSession())
session = getSession()
const c = startCombat(session, ['Goblin'], monstersDb)
assert(checkCombatEnd(session).result === 'ongoing', 'combat ongoing initially')
c.monsters[0].hp = 0
assert(checkCombatEnd(session).result === 'victory', 'victory when all monsters dead')
c.monsters[0].hp = 5
session.player.hp = 0
assert(checkCombatEnd(session).result === 'defeat', 'defeat when player HP = 0')
console.log('  checkCombatEnd: all conditions correct')

// Test: awardLoot
initGameState(makeTestSession())
session = getSession()
startCombat(session, ['Goblin'], monstersDb)
const loot = awardLoot(session)
assert(loot.gold === 3, `loot gold = 3: got ${loot.gold}`)
assert(loot.items.includes('锈蚀匕首'), 'loot includes 锈蚀匕首')
assert(session.player.gold === 53, `player gold = 53: got ${session.player.gold}`)
console.log(`  awardLoot: gold=${loot.gold}, items=${loot.items.join(', ')}`)

// Test: endCombat
endCombat(session)
assert(session.combat === null, 'combat state null after endCombat')
console.log('  endCombat: state cleared')

// Test: error on attack without combat
initGameState(makeTestSession())
session = getSession()
let threw = false
try {
  executePlayerAttack(session, 'Goblin', 'weapon')
} catch (e: any) {
  threw = true
  assert(e.message.includes('没有进行中的战斗'), `correct error message: ${e.message}`)
}
assert(threw, 'throws when no active combat')
console.log('  error handling: attack without combat throws')

// Test: error on invalid monster in startCombat
initGameState(makeTestSession())
session = getSession()
threw = false
try {
  startCombat(session, ['NonexistentMonster'], monstersDb)
} catch (e: any) {
  threw = true
}
assert(threw, 'throws when no valid monsters')
console.log('  error handling: invalid monster throws')

// ──── Summary ────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
