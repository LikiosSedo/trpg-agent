/**
 * Tests for rules-engine and tool execute() methods
 *
 * Run: npx tsx src/rules-engine.test.ts
 */

import { rollD20, rollDice, skillCheck, attackRoll, rollDamage, castSpell, shortRest, longRest } from './rules-engine.js'
import { initGameState, getSession, getFacts } from './game-state.js'
import type { GameSession, PlayerCharacter } from './types.js'
import { MoveTool } from './tools/move.js'
import { LookTool } from './tools/look.js'
import { SearchTool } from './tools/search.js'
import { RestTool } from './tools/rest.js'
import { DiceTool } from './tools/dice.js'
import { UseItemTool } from './tools/use-item.js'

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
      hp: 10,
      maxHp: 12,
      gold: 50,
      inventory: [
        { name: 'Healing Potion', type: 'potion', description: 'Restores 2d4+2 HP.', bonus: 2 },
        { name: 'Longsword', type: 'weapon', description: 'Deals 1d8 slashing damage.', bonus: 0 },
        { name: 'Leather Armor', type: 'armor', description: 'AC 11 + DEX modifier.', bonus: 1 },
        { name: 'Mine Key', type: 'quest', description: 'Opens sealed mine gate.' },
      ],
      spells: [
        { name: 'Fire Bolt', description: '', effect: 'Deal 1d10 fire damage.', usesPerRest: 0, remaining: 0 },
        { name: 'Magic Missile', description: '', effect: 'Deal 3d4+3 force damage.', usesPerRest: 3, remaining: 1 },
        { name: 'Shield', description: '', effect: '+5 AC reaction.', usesPerRest: 3, remaining: 0 },
      ],
      clues: [],
      equipped: {
        weapon: { name: 'Shortsword', type: 'weapon', description: 'Deals 1d6 piercing damage.', bonus: 0 },
      },
    },
    npcs: [
      { name: '陈妈', trust: 3, knownFacts: ['镇上最近失踪了两个矿工'], playerPromises: [], location: 'dawnbreak-town', mood: 'friendly' },
    ],
    quests: [
      { name: '矿洞调查', description: '调查灰脊矿道的异常', status: 'active', objectives: ['进入矿道', '找到失踪矿工'] },
    ],
    worldState: {
      currentLocation: 'dawnbreak-town',
      timeOfDay: 'morning',
      flags: {},
    },
    events: [],
    turnCount: 1,
  }
}

// ──── Rules Engine Tests ────

console.log('\n=== Rules Engine Tests ===')

// rollD20
for (let i = 0; i < 100; i++) {
  const r = rollD20()
  assert(r >= 1 && r <= 20, `rollD20 in range: got ${r}`)
}
console.log(`  rollD20: ${passed} rolls in [1,20]`)

// rollDice
const r2d6 = rollDice('2d6+3')
assert(r2d6.rolls.length === 2, `rollDice 2d6+3 rolls count = ${r2d6.rolls.length}`)
assert(r2d6.total >= 5 && r2d6.total <= 15, `rollDice 2d6+3 total = ${r2d6.total}`)
console.log(`  rollDice("2d6+3"): rolls=${r2d6.rolls}, total=${r2d6.total}`)

const r1d20 = rollDice('d20')
assert(r1d20.rolls.length === 1, `rollDice d20 rolls count`)
assert(r1d20.total >= 1 && r1d20.total <= 20, `rollDice d20 total`)
console.log(`  rollDice("d20"): total=${r1d20.total}`)

// skillCheck
const sc = skillCheck(3, 15)
assert(typeof sc.roll === 'number' && sc.roll >= 1 && sc.roll <= 20, 'skillCheck roll in range')
assert(sc.total === sc.roll + 3, `skillCheck total = roll + mod: ${sc.total}`)
assert(typeof sc.success === 'boolean', 'skillCheck success is boolean')
console.log(`  skillCheck(mod=3, dc=15): roll=${sc.roll}, total=${sc.total}, success=${sc.success}`)

// attackRoll
const ar = attackRoll(5, 13)
assert(typeof ar.hits === 'boolean', 'attackRoll hits is boolean')
assert(ar.total === ar.roll + 5, `attackRoll total = roll + mod`)
console.log(`  attackRoll(mod=5, dc=13): roll=${ar.roll}, total=${ar.total}, hits=${ar.hits}`)

// castSpell
const testPlayer = makeTestSession().player
const castOk = castSpell(testPlayer, 'Magic Missile')
assert(castOk.success === true, 'castSpell Magic Missile success')
assert(testPlayer.spells[1].remaining === 0, 'castSpell decremented remaining')
const castFail = castSpell(testPlayer, 'Magic Missile')
assert(castFail.success === false, 'castSpell no uses left')
console.log(`  castSpell: ok=${castOk.success}, fail_reason="${castFail.reason}"`)

// cantrip (unlimited)
const castCantrip = castSpell(testPlayer, 'Fire Bolt')
assert(castCantrip.success === true, 'castSpell cantrip always succeeds')
console.log(`  castSpell(cantrip): ${castCantrip.success}`)

// shortRest
const restPlayer = makeTestSession().player
restPlayer.hp = 5
shortRest(restPlayer)
assert(restPlayer.hp > 5 && restPlayer.hp <= restPlayer.maxHp, `shortRest healed: ${restPlayer.hp}`)
console.log(`  shortRest: hp 5 → ${restPlayer.hp}/${restPlayer.maxHp}`)

// longRest
const longPlayer = makeTestSession().player
longPlayer.hp = 3
longPlayer.spells[1].remaining = 0
longPlayer.spells[2].remaining = 0
longRest(longPlayer)
assert(longPlayer.hp === longPlayer.maxHp, `longRest full hp: ${longPlayer.hp}`)
assert(longPlayer.spells[1].remaining === longPlayer.spells[1].usesPerRest, 'longRest restored spells')
console.log(`  longRest: hp → ${longPlayer.hp}/${longPlayer.maxHp}, spells restored`)

// ──── Tool Tests ────

console.log('\n=== Tool Tests ===')

// Initialize game state for tool tests
initGameState(makeTestSession())

// DiceTool
const diceResult = await DiceTool.execute({ dice: '2d6', purpose: '测试', dc: undefined, advantage: undefined }, {} as any)
assert(!diceResult.isError, 'DiceTool basic roll')
assert(diceResult.output.includes('[测试]'), `DiceTool output includes purpose: ${diceResult.output}`)
console.log(`  DiceTool: ${diceResult.output}`)

// DiceTool with DC
const diceCheck = await DiceTool.execute({ dice: 'd20+2', purpose: '力量检定', dc: 15 }, {} as any)
assert(diceCheck.output.includes('DC15'), `DiceTool check output: ${diceCheck.output}`)
console.log(`  DiceTool(DC): ${diceCheck.output}`)

// LookTool - general
const lookResult = await LookTool.execute({ target: undefined, detailed: undefined }, {} as any)
assert(lookResult.output.includes('破晓镇'), `LookTool shows location: ${lookResult.output.slice(0, 60)}...`)
console.log(`  LookTool: ${lookResult.output.split('\n')[0]}`)

// LookTool - specific target
const lookNpc = await LookTool.execute({ target: '陈妈' }, {} as any)
assert(lookNpc.output.includes('陈妈'), `LookTool NPC: ${lookNpc.output}`)
console.log(`  LookTool(NPC): ${lookNpc.output}`)

// MoveTool - valid
const moveResult = await MoveTool.execute({ destination: 'twilight-woods', mode: 'explore' }, {} as any)
assert(!moveResult.isError, 'MoveTool success')
assert(moveResult.output.includes('暮色森林'), `MoveTool output: ${moveResult.output}`)
assert(getSession().worldState.currentLocation === 'twilight-woods', 'MoveTool updated location')
console.log(`  MoveTool: ${moveResult.output}`)

// MoveTool - invalid destination
const moveFail = await MoveTool.execute({ destination: 'nonexistent', mode: 'explore' }, {} as any)
assert(moveFail.isError === true, 'MoveTool invalid destination errors')
console.log(`  MoveTool(invalid): ${moveFail.output}`)

// SearchTool
const searchResult = await SearchTool.execute({ type: 'area' }, {} as any)
assert(searchResult.output.includes('察觉检定'), `SearchTool output: ${searchResult.output.slice(0, 60)}...`)
console.log(`  SearchTool: ${searchResult.output.split('\n')[0]}`)

// RestTool - short
initGameState(makeTestSession()) // reset
getSession().player.hp = 5
const restResult = await RestTool.execute({ type: 'short' }, {} as any)
assert(restResult.output.includes('短休息'), `RestTool short: ${restResult.output}`)
assert(getSession().player.hp > 5, 'RestTool healed player')
console.log(`  RestTool(short): ${restResult.output}`)

// RestTool - long
getSession().player.hp = 3
getSession().player.spells[1].remaining = 0
const longResult = await RestTool.execute({ type: 'long' }, {} as any)
assert(longResult.output.includes('完全恢复'), `RestTool long: ${longResult.output}`)
assert(getSession().player.hp === getSession().player.maxHp, 'RestTool long full HP')
console.log(`  RestTool(long): ${longResult.output}`)

// UseItemTool - equip weapon
initGameState(makeTestSession())
const equipResult = await UseItemTool.execute({ itemId: 'Longsword', action: 'equip' }, {} as any)
assert(equipResult.output.includes('装备武器'), `UseItemTool equip: ${equipResult.output}`)
assert(getSession().player.equipped.weapon?.name === 'Longsword', 'UseItemTool equipped longsword')
console.log(`  UseItemTool(equip): ${equipResult.output}`)

// UseItemTool - use potion
initGameState(makeTestSession())
getSession().player.hp = 5
const potionResult = await UseItemTool.execute({ itemId: 'Healing Potion', action: 'use' }, {} as any)
assert(potionResult.output.includes('恢复'), `UseItemTool potion: ${potionResult.output}`)
assert(getSession().player.hp > 5, 'UseItemTool healed')
console.log(`  UseItemTool(potion): ${potionResult.output}`)

// ──── Summary ────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
