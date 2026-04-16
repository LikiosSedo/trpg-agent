/**
 * Tests for combat grid — BFS, attack range, terrain, pathfinding
 *
 * Run: npx tsx src/combat-grid.test.ts
 */

import {
  CombatGrid, TERRAIN, GRID_W, GRID_H,
  manhattan, posKey, posEqual,
  initCombatGrid,
  type GridPos, type GridUnit,
} from './combat-grid.js'

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

function makeGrid(overrides?: Array<{ pos: GridPos; terrain: number }>): CombatGrid {
  const t = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(0))
  for (const o of overrides ?? []) {
    t[o.pos.y][o.pos.x] = o.terrain
  }
  return new CombatGrid(t)
}

// ─── manhattan distance ──────────────────────

console.log('\n=== Manhattan Distance ===')

assert(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 }) === 7, 'corner to corner = 7')
assert(manhattan({ x: 3, y: 2 }, { x: 3, y: 2 }) === 0, 'same pos = 0')
assert(manhattan({ x: 1, y: 1 }, { x: 2, y: 1 }) === 1, 'adjacent = 1')

// ─── empty grid BFS ─────────────────────────

console.log('\n=== BFS — Empty Grid ===')

{
  const grid = makeGrid()
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1 })
  const reach = grid.getReachable('p')

  // 起点本身应在结果中
  assert(reach.has('3,4'), 'start pos is reachable')
  assert(reach.get('3,4') === 0, 'start cost = 0')

  // moveSpeed=3，上方 3 格可达
  assert(reach.has('3,1'), '3 steps up reachable')
  assert(!reach.has('3,0'), '4 steps up NOT reachable')

  // 水平 3 格可达
  assert(reach.has('0,4'), '3 steps left reachable')
  assert(reach.has('6,4'), '3 steps right reachable')

  // 对角：(1,2) = dist 4，不可达
  assert(!reach.has('1,2'), 'diagonal dist=4 NOT reachable with speed 3')
  // 对角：(2,3) = dist 2，可达
  assert(reach.has('2,3'), 'diagonal dist=2 reachable')
}

// ─── wall blocking ──────────────────────────

console.log('\n=== BFS — Wall Blocking ===')

{
  // 在 (3,3) 放墙，挡住从 (3,4) 直接往上
  const grid = makeGrid([{ pos: { x: 3, y: 3 }, terrain: TERRAIN.WALL }])
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1 })
  const reach = grid.getReachable('p')

  assert(!reach.has('3,3'), 'wall cell not reachable')
  // 绕路到 (3,2) 需要 4 步（左→上→上→右），speed=3 不够
  assert(!reach.has('3,2'), '(3,2) NOT reachable — 4 steps to go around wall, speed=3')
  // 但 (2,3) 和 (4,3) 只要 2 步，可达
  assert(reach.has('2,3'), '(2,3) reachable by going left then up')
  assert(reach.has('4,3'), '(4,3) reachable by going right then up')
}

// ─── difficult terrain ──────────────────────

console.log('\n=== BFS — Difficult Terrain ===')

{
  // 困难地形在 (3,3)
  const grid = makeGrid([{ pos: { x: 3, y: 3 }, terrain: TERRAIN.DIFFICULT }])
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1 })
  const reach = grid.getReachable('p')

  // (3,3) 可达，但 cost=2
  assert(reach.has('3,3'), 'difficult terrain reachable')
  assert(reach.get('3,3') === 2, 'difficult terrain cost = 2')

  // (3,2) 经过困难地形：cost = 2 + 1 = 3，可达
  assert(reach.has('3,2'), '(3,2) through difficult terrain reachable at cost 3')
  assert(reach.get('3,2') === 3, 'cost through difficult = 3')

  // (3,1) 经过困难地形：cost = 2 + 1 + 1 = 4 > 3，不可达（直线）
  // 但绕路也是 4 步，不可达
  assert(!reach.has('3,1'), '(3,1) too far through difficult terrain')
}

// ─── enemy blocking ─────────────────────────

console.log('\n=== BFS — Enemy Blocking ===')

{
  const grid = makeGrid()
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 5, attackRange: 1 })
  // 敌人在 (3,3) 挡住直线
  grid.placeUnit({ id: 'e1', side: 'enemy', pos: { x: 3, y: 3 }, moveSpeed: 3, attackRange: 1 })
  const reach = grid.getReachable('p')

  assert(!reach.has('3,3'), 'enemy cell not reachable (blocked)')
  // 但可以绕过去
  assert(reach.has('3,2'), 'can go around enemy')
}

// ─── friendly passthrough ───────────────────

console.log('\n=== BFS — Friendly Passthrough ===')

{
  const grid = makeGrid()
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1 })
  // 盟友在 (3,3)：可穿过但不可停留
  grid.placeUnit({ id: 'a1', side: 'ally', pos: { x: 3, y: 3 }, moveSpeed: 3, attackRange: 1 })
  const reach = grid.getReachable('p')

  assert(!reach.has('3,3'), 'ally cell not stoppable')
  // 但可以穿过盟友到达 (3,2)
  assert(reach.has('3,2'), 'can pass through ally to reach (3,2)')
}

// ─── attack targets — melee ─────────────────

console.log('\n=== Attack Targets — Melee ===')

{
  const grid = makeGrid()
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1 })
  grid.placeUnit({ id: 'e1', side: 'enemy', pos: { x: 3, y: 1 }, moveSpeed: 3, attackRange: 1 })
  grid.placeUnit({ id: 'e2', side: 'enemy', pos: { x: 0, y: 0 }, moveSpeed: 3, attackRange: 1 })

  const targets = grid.getAttackableTargets('p')
  const ids = targets.map(t => t.targetId)

  // e1 at (3,1): player move 3 → can reach (3,2) adjacent to e1 → attackable
  assert(ids.includes('e1'), 'e1 at dist 3 is attackable (move to adjacent)')
  // e2 at (0,0): dist=7, move 3 → can reach (0,4)(1,3)(2,2)(3,1)...
  // from (0,4) to (0,0) = dist 4, not adjacent. Can't reach adjacent to e2.
  assert(!ids.includes('e2'), 'e2 at dist 7 NOT attackable with melee+move3')
}

// ─── attack targets — ranged ────────────────

console.log('\n=== Attack Targets — Ranged ===')

{
  const grid = makeGrid()
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 2, attackRange: 4 })
  grid.placeUnit({ id: 'e1', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1 })

  const targets = grid.getAttackableTargets('p')
  const ids = targets.map(t => t.targetId)

  // e1 at (3,0): from (3,4) dist=4, range=4 → attackable without moving
  assert(ids.includes('e1'), 'ranged can hit e1 at dist 4 without moving')

  // Check that ranged prefers far attack pos
  const opt = targets.find(t => t.targetId === 'e1')!
  assert(opt.attackFrom.y >= 3, 'ranged prefers staying back (y>=3)')
}

// ─── ranged blocked by wall ─────────────────

console.log('\n=== Ranged Blocked by Wall ===')

{
  const grid = makeGrid([{ pos: { x: 3, y: 2 }, terrain: TERRAIN.WALL }])
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 1, attackRange: 4 })
  grid.placeUnit({ id: 'e1', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1 })

  // Direct line (3,4)→(3,0) passes through wall at (3,2)
  assert(grid.isRangeBlocked({ x: 3, y: 4 }, { x: 3, y: 0 }), 'direct line blocked by wall')

  const targets = grid.getAttackableTargets('p')
  // With moveSpeed=1, player can go to (2,4) or (4,4)
  // From (2,4) to (3,0): line passes through (2,1)(3,0)... check (2,4)→(3,0):
  //   Bresenham: (2,4)→(2,3)→(3,2)→(3,1)→(3,0) — passes (3,2)=wall → blocked
  // From (4,4) to (3,0): similar
  // So e1 should be hard/impossible to hit with move=1
  // Actually from (2,4): bresenham to (3,0) goes (2,4)(2,3)(3,2)(3,1)(3,0) — wall at (3,2)
  // From (4,4): bresenham to (3,0) goes (4,4)(4,3)(3,2)(3,1)(3,0) — wall at (3,2)
  const ids = targets.map(t => t.targetId)
  assert(!ids.includes('e1'), 'cannot hit e1 through wall even from adjacent cells')
}

// ─── initCombatGrid ─────────────────────────

console.log('\n=== Init Grid ===')

{
  const grid = initCombatGrid({
    areaId: 'twilight-woods',
    terrainTemplates: {
      'twilight-woods': [
        // simple template
        Array.from({ length: GRID_H }, () => Array(GRID_W).fill(0)),
      ],
    },
    monsters: [
      { id: 'm1', moveSpeed: 3, attackRange: 1 },
      { id: 'm2', moveSpeed: 4, attackRange: 1 },
    ],
    allies: [
      { id: 'a1', moveSpeed: 3, attackRange: 1 },
    ],
    player: { id: 'player', moveSpeed: 3, attackRange: 1 },
  })

  assert(grid.units.size === 4, 'all 4 units placed')

  const player = grid.getUnit('player')!
  assert(player.pos.y >= 3, 'player on south side')

  const m1 = grid.getUnit('m1')!
  assert(m1.pos.y <= 1, 'monster on north side')

  const a1 = grid.getUnit('a1')!
  assert(a1.pos.y >= 3, 'ally on south side')

  // No two units on same cell
  const positions = Array.from(grid.units.values()).map(u => posKey(u.pos))
  assert(new Set(positions).size === positions.length, 'no overlapping positions')
}

// ─── moveUnit returns path ──────────────────

console.log('\n=== Move Unit ===')

{
  const grid = makeGrid()
  grid.placeUnit({ id: 'p', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1 })

  const path = grid.moveUnit('p', { x: 3, y: 1 })
  assert(path.length === 4, 'path has 4 points (3,4)→(3,3)→(3,2)→(3,1)')
  assert(posEqual(path[0], { x: 3, y: 4 }), 'path starts at origin')
  assert(posEqual(path[path.length - 1], { x: 3, y: 1 }), 'path ends at destination')

  const p = grid.getUnit('p')!
  assert(posEqual(p.pos, { x: 3, y: 1 }), 'unit position updated after move')
}

// ─── Summary ────────────────────────────────

console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
