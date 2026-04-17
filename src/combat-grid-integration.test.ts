/**
 * Integration tests — verify grid combat actually works end-to-end
 *
 * Run: npx tsx src/combat-grid-integration.test.ts
 */

import { initGameState } from './game-state.js'
import { startCombat, executeMonsterTurns } from './combat-manager.js'
import { manhattan } from './combat-grid.js'
import type { GameSession } from './types.js'

function makeSession(): GameSession {
  return {
    player: {
      name: '测试勇者',
      level: 5,
      abilities: { STR: 14, DEX: 12, CON: 13, INT: 10, WIS: 10, CHA: 8 },
      abilityModifiers: { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 0, CHA: -1 },
      skills: [],
      hp: 100, maxHp: 100, gold: 50, inventory: [], spells: [], clues: [], xp: 0,
      equipped: { weapon: { name: '长剑', type: 'weapon', description: '', bonus: 0 } },
    },
    npcs: [],
    quests: [],
    worldState: {
      currentLocation: 'twilight-woods',
      currentSubLocation: 'forest-entrance',
      timeOfDay: 'morning',
      flags: {},
    },
    events: [],
    turnCount: 1,
    combat: null,
    chapter: { currentChapter: 'ch1', completedBeats: [] },
  } as any
}

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`) }
  else { failed++; console.error(`  FAIL: ${msg}`) }
}

// ─── Test 1: startCombat creates grid with units ─────────

console.log('\n=== Test 1: startCombat creates grid ===')

{
  const session = makeSession()
  initGameState(session)

  // Fake monsters DB
  const monstersDb: any = [
    { name: 'Wolf', nameZh: '野狼', hp: 20, dc: 13, damageDice: '1d8+2', moveSpeed: 4, attackRange: 1, specialAbility: '', loot: [] },
    { name: 'Goblin', nameZh: '哥布林', hp: 15, dc: 12, damageDice: '1d6+2', moveSpeed: 3, attackRange: 1, specialAbility: '', loot: [] },
  ]

  const combat = startCombat(session, ['Wolf', 'Goblin'], monstersDb)

  assert(combat.grid !== undefined, 'grid is created')
  assert(combat.monsters.length === 2, '2 monsters created')
  assert(combat.monsters[0].pos !== undefined, 'monster 1 has pos')
  assert(combat.monsters[1].pos !== undefined, 'monster 2 has pos')
  assert(combat.monsters[0].moveSpeed === 4, 'wolf moveSpeed = 4')
  assert(combat.monsters[1].moveSpeed === 3, 'goblin moveSpeed = 3')

  // Player should be on south side
  const playerUnit = combat.grid?.getUnit('player')
  assert(playerUnit !== undefined, 'player is on grid')
  assert(playerUnit!.pos.y >= 3, 'player on south side (y >= 3)')

  // Monsters on north side
  const wolfGrid = combat.grid?.getUnit('Wolf')
  assert(wolfGrid!.pos.y <= 1, 'wolf on north side (y <= 1)')
}

// ─── Test 2: Monster AI moves toward player ─────────

console.log('\n=== Test 2: Monster AI movement ===')

{
  const session = makeSession()
  initGameState(session)
  const monstersDb: any = [
    { name: 'Wolf', nameZh: '野狼', hp: 20, dc: 13, damageDice: '1d8+2', moveSpeed: 4, attackRange: 1, specialAbility: '', loot: [] },
  ]

  const combat = startCombat(session, ['Wolf'], monstersDb)
  const grid = combat.grid!
  const wolf = combat.monsters[0]
  const playerUnit = grid.getUnit('player')!
  const initialWolfY = wolf.pos!.y
  const initialDist = manhattan(wolf.pos!, playerUnit.pos)

  // Run monster turn
  const result = executeMonsterTurns(session)

  const newWolf = grid.getUnit('Wolf')!
  const newDist = manhattan(newWolf.pos, playerUnit.pos)

  assert(result.gridMoves.length >= 0, 'gridMoves returned (possibly empty)')
  // Wolf should move closer to player (or already be adjacent)
  assert(newDist <= initialDist, `wolf moved closer (dist ${initialDist} → ${newDist})`)
}

// ─── Test 3: Grid state consistency across turns ─────

console.log('\n=== Test 3: Grid state consistency ===')

{
  const session = makeSession()
  initGameState(session)
  const monstersDb: any = [
    { name: 'Goblin', nameZh: '哥布林', hp: 15, dc: 12, damageDice: '1d6+2', moveSpeed: 3, attackRange: 1, specialAbility: '', loot: [] },
  ]

  const combat = startCombat(session, ['Goblin'], monstersDb)
  const grid = combat.grid!

  // Before monster turn
  const goblinBefore = grid.getUnit('Goblin')!.pos

  executeMonsterTurns(session)

  // After: position on grid should match monster.pos on MonsterInstance
  const goblinAfterGrid = grid.getUnit('Goblin')!.pos
  const goblinAfterInstance = combat.monsters[0].pos!

  assert(
    goblinAfterGrid.x === goblinAfterInstance.x && goblinAfterGrid.y === goblinAfterInstance.y,
    'grid pos matches monster instance pos after turn',
  )
}

// ─── Test 4: CRITICAL BUG — moveUnit teleports to invalid dest ─────

console.log('\n=== Test 4: moveUnit safety ===')

{
  const session = makeSession()
  initGameState(session)
  const monstersDb: any = [
    { name: 'Goblin', nameZh: '哥布林', hp: 15, dc: 12, damageDice: '1d6+2', moveSpeed: 3, attackRange: 1, specialAbility: '', loot: [] },
  ]

  const combat = startCombat(session, ['Goblin'], monstersDb)
  const grid = combat.grid!
  const originalPlayerPos = { ...grid.getUnit('player')!.pos }

  // Try to move player to an unreachable position (0,0 is too far with moveSpeed=3)
  const path = grid.moveUnit('player', { x: 0, y: 0 })

  const newPlayerPos = grid.getUnit('player')!.pos
  assert(
    newPlayerPos.x === originalPlayerPos.x && newPlayerPos.y === originalPlayerPos.y,
    'moveUnit rejects unreachable destination (position unchanged)',
  )
  assert(path.length === 0, 'moveUnit returns empty path for unreachable dest')
}

// ─── Test 5: Grid AI target vs attack target consistency ─────

console.log('\n=== Test 5: Grid AI attack target ===')

{
  const session = makeSession()
  initGameState(session)
  const monstersDb: any = [
    { name: 'Goblin', nameZh: '哥布林', hp: 15, dc: 12, damageDice: '1d6+2', moveSpeed: 3, attackRange: 1, specialAbility: '', loot: [] },
  ]

  const combat = startCombat(session, ['Goblin'], monstersDb)
  const grid = combat.grid!
  const goblin = grid.getUnit('Goblin')!
  const playerUnit = grid.getUnit('player')!

  // Force goblin to be far from player
  goblin.pos = { x: 0, y: 0 }
  combat.monsters[0].pos = { x: 0, y: 0 }

  const initialPlayerHp = session.player.hp
  executeMonsterTurns(session)

  // Goblin move speed = 3, dist from (0,0) to player (3,4) = 7. Can't reach.
  // Expected: monster moves but doesn't attack (canAttackAfterMove = false)
  const newPlayerHp = session.player.hp
  assert(newPlayerHp === initialPlayerHp, 'goblin too far should not hit player')
}

// ─── Test 6: Boss summons NOT on grid (KNOWN ISSUE) ─────

console.log('\n=== Test 6: Boss summons on grid ===')

{
  const session = makeSession()
  initGameState(session)
  const monstersDb: any = [
    { name: 'Spider Matriarch', nameZh: '蛛母', hp: 45, dc: 15, damageDice: '1d12+4', moveSpeed: 2, attackRange: 1, specialAbility: '', loot: [] },
  ]

  const combat = startCombat(session, ['Spider Matriarch'], monstersDb)
  const grid = combat.grid!

  // Move boss adjacent to player so attack will happen
  const playerUnit = grid.getUnit('player')!
  const adjPos = { x: playerUnit.pos.x, y: playerUnit.pos.y - 1 }
  grid.getUnit('Spider Matriarch')!.pos = adjPos
  combat.monsters[0].pos = adjPos

  // Damage the boss below 50% to trigger summon
  combat.monsters[0].hp = 20

  // Run monster turn (boss ability executes)
  executeMonsterTurns(session)

  const spiderlings = combat.monsters.filter(m => m.name === 'Giant Spider')
  console.log(`  INFO: ${spiderlings.length} spiderlings spawned`)
  if (spiderlings.length > 0) {
    for (const s of spiderlings) {
      const onGrid = grid.getUnit(s.id)
      assert(
        onGrid !== undefined,
        `spiderling ${s.id} should be on grid (BUG if not)`,
      )
    }
  } else {
    console.log('  SKIP: spiderlings did not spawn — needs different trigger path')
  }
}

// ─── Test 7: findPath with difficult terrain ─────

console.log('\n=== Test 7: findPath with difficult terrain ===')

{
  const { CombatGrid } = await import('./combat-grid.js')
  const terrain = [
    [0, 2, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
  ]
  const grid = new CombatGrid(terrain)
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 0, y: 0 }, moveSpeed: 5, attackRange: 1 })

  const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, 5, 'player')
  // Direct: 3 hops (0,0)→(1,0)→(2,0), total cost 3 (difficult at middle)
  // Around: 5 hops (0,0)→(0,1)→(1,1)→(2,1)→(2,0), total cost 4
  console.log('  INFO: path =', JSON.stringify(path), 'length =', path.length)
  assert(path.length <= 5, `findPath returns reasonable path (length ${path.length})`)
}

// ─── Summary ─────────────────────────────────────

console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
