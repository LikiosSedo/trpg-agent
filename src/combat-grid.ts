/**
 * 战棋系统核心 — 7×5 网格、BFS 移动、火纹式攻击判定
 *
 * 纯计算模块，不依赖任何 I/O。
 */

// ─── 常量 ────────────────────────────────────

export const GRID_W = 7
export const GRID_H = 5

export const TERRAIN = { FLOOR: 0, WALL: 1, DIFFICULT: 2 } as const
export type TerrainType = typeof TERRAIN[keyof typeof TERRAIN]

// ─── 类型 ────────────────────────────────────

export interface GridPos { x: number; y: number }

export type UnitSide = 'player' | 'ally' | 'enemy'

export interface GridUnit {
  id: string
  side: UnitSide
  pos: GridPos
  moveSpeed: number
  attackRange: number
}

/** getAttackableTargets 的返回项 */
export interface AttackOption {
  targetId: string
  /** 移动到此位置后攻击 */
  attackFrom: GridPos
}

// ─── 工具函数 ────────────────────────────────

export function posKey(p: GridPos): string { return `${p.x},${p.y}` }

export function parseKey(k: string): GridPos {
  const [x, y] = k.split(',').map(Number)
  return { x, y }
}

export function posEqual(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y
}

export function manhattan(a: GridPos, b: GridPos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

const DIRS: GridPos[] = [
  { x: 0, y: -1 }, // 上
  { x: 0, y: 1 },  // 下
  { x: -1, y: 0 }, // 左
  { x: 1, y: 0 },  // 右
]

function neighbors(p: GridPos): GridPos[] {
  return DIRS.map(d => ({ x: p.x + d.x, y: p.y + d.y }))
}

// ─── Bresenham 直线（远程阻挡判定） ──────────

function bresenhamLine(from: GridPos, to: GridPos): GridPos[] {
  const points: GridPos[] = []
  let { x: x0, y: y0 } = from
  const { x: x1, y: y1 } = to
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy

  while (true) {
    points.push({ x: x0, y: y0 })
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x0 += sx }
    if (e2 < dx) { err += dx; y0 += sy }
  }
  return points
}

// ─── CombatGrid ──────────────────────────────

export class CombatGrid {
  readonly width = GRID_W
  readonly height = GRID_H
  /** terrain[y][x] */
  terrain: TerrainType[][]
  /** id → unit */
  units: Map<string, GridUnit> = new Map()

  constructor(terrainTemplate: number[][]) {
    // 深拷贝 + 校验尺寸
    this.terrain = []
    for (let y = 0; y < GRID_H; y++) {
      const row: TerrainType[] = []
      for (let x = 0; x < GRID_W; x++) {
        const v = terrainTemplate[y]?.[x] ?? 0
        row.push(v as TerrainType)
      }
      this.terrain.push(row)
    }
  }

  // ── 查询 ──

  isInBounds(p: GridPos): boolean {
    return p.x >= 0 && p.x < this.width && p.y >= 0 && p.y < this.height
  }

  terrainAt(p: GridPos): TerrainType {
    return this.terrain[p.y]?.[p.x] ?? TERRAIN.FLOOR
  }

  isWall(p: GridPos): boolean {
    return this.terrainAt(p) === TERRAIN.WALL
  }

  isDifficult(p: GridPos): boolean {
    return this.terrainAt(p) === TERRAIN.DIFFICULT
  }

  getUnit(id: string): GridUnit | undefined {
    return this.units.get(id)
  }

  getUnitAt(p: GridPos): GridUnit | undefined {
    for (const u of this.units.values()) {
      if (u.pos.x === p.x && u.pos.y === p.y) return u
    }
    return undefined
  }

  /** 格子是否无单位且非墙 */
  isEmpty(p: GridPos): boolean {
    return this.isInBounds(p) && !this.isWall(p) && !this.getUnitAt(p)
  }

  // ── 单位管理 ──

  placeUnit(unit: GridUnit): void {
    this.units.set(unit.id, { ...unit, pos: { ...unit.pos } })
  }

  removeUnit(id: string): void {
    this.units.delete(id)
  }

  /**
   * 移动单位到目标位置，返回 BFS 最短路径（含起终点）。
   * 不做合法性校验——调用方负责确保 `to` 在 getReachable 结果中。
   */
  moveUnit(unitId: string, to: GridPos): GridPos[] {
    const unit = this.units.get(unitId)
    if (!unit) return []
    const path = this.findPath(unit.pos, to, unit.moveSpeed, unit.side)
    unit.pos = { ...to }
    return path
  }

  // ── BFS 可达计算 ──

  /**
   * 返回从 unit 当前位置出发，在 moveSpeed 步内可到达的所有格子。
   * Map<"x,y", cost>
   *
   * 规则：
   * - 墙不可通过
   * - 敌方单位阻挡（不可穿过）
   * - 友方单位可穿过但不可停留（结果中排除被友方占据的格子）
   * - 困难地形 cost=2
   */
  getReachable(unitId: string): Map<string, number> {
    const unit = this.units.get(unitId)
    if (!unit) return new Map()
    return this._bfsReachable(unit.pos, unit.moveSpeed, unit.side, unitId)
  }

  private _bfsReachable(
    start: GridPos, moveSpeed: number, side: UnitSide, selfId: string,
  ): Map<string, number> {
    const visited = new Map<string, number>()
    visited.set(posKey(start), 0)
    const queue: Array<[GridPos, number]> = [[start, 0]]

    while (queue.length > 0) {
      const [pos, cost] = queue.shift()!
      for (const nb of neighbors(pos)) {
        if (!this.isInBounds(nb)) continue
        if (this.isWall(nb)) continue

        // 敌方阻挡
        const occupant = this.getUnitAt(nb)
        if (occupant && occupant.id !== selfId && this._isHostile(side, occupant.side)) continue

        const moveCost = this.isDifficult(nb) ? 2 : 1
        const newCost = cost + moveCost
        if (newCost > moveSpeed) continue

        const key = posKey(nb)
        if (visited.has(key) && visited.get(key)! <= newCost) continue
        visited.set(key, newCost)
        queue.push([nb, newCost])
      }
    }

    // 过滤：友方占据的格子可穿过但不可停留
    for (const [key] of visited) {
      const p = parseKey(key)
      const occ = this.getUnitAt(p)
      if (occ && occ.id !== selfId) visited.delete(key)
    }

    return visited
  }

  private _isHostile(a: UnitSide, b: UnitSide): boolean {
    if (a === 'enemy') return b !== 'enemy'
    return b === 'enemy'
  }

  // ── 寻路（BFS 最短路径） ──

  findPath(from: GridPos, to: GridPos, moveSpeed: number, side: UnitSide): GridPos[] {
    if (posEqual(from, to)) return [from]

    const prev = new Map<string, string>()
    const visited = new Map<string, number>()
    const startKey = posKey(from)
    visited.set(startKey, 0)
    const queue: Array<[GridPos, number]> = [[from, 0]]

    while (queue.length > 0) {
      const [pos, cost] = queue.shift()!
      if (posEqual(pos, to)) break
      for (const nb of neighbors(pos)) {
        if (!this.isInBounds(nb)) continue
        if (this.isWall(nb)) continue
        // 允许穿过目标格（即使有敌人——我们是在走向攻击位）
        const occupant = this.getUnitAt(nb)
        if (occupant && !posEqual(nb, to) && this._isHostile(side, occupant.side)) continue

        const moveCost = this.isDifficult(nb) ? 2 : 1
        const newCost = cost + moveCost
        if (newCost > moveSpeed) continue

        const key = posKey(nb)
        if (visited.has(key) && visited.get(key)! <= newCost) continue
        visited.set(key, newCost)
        prev.set(key, posKey(pos))
        queue.push([nb, newCost])
      }
    }

    // 回溯路径
    const toKey = posKey(to)
    if (!prev.has(toKey) && !posEqual(from, to)) return [from] // 不可达
    const path: GridPos[] = []
    let cur = toKey
    while (cur) {
      path.unshift(parseKey(cur))
      cur = prev.get(cur)!
    }
    return path
  }

  // ── 火纹式攻击判定 ──

  /**
   * 计算 unitId 本回合可攻击的所有目标。
   * 对于每个目标，返回最优攻击位置（移动到哪后攻击）。
   *
   * 近战（range=1）：选最近攻击位（冲上去）
   * 远程（range>1）：选最远攻击位（保持距离）
   */
  getAttackableTargets(unitId: string): AttackOption[] {
    const unit = this.units.get(unitId)
    if (!unit) return []

    const reachable = this.getReachable(unitId)
    // 也算当前位置（不移动直接攻击）
    reachable.set(posKey(unit.pos), 0)

    const bestAttack = new Map<string, { from: GridPos; dist: number }>()

    for (const [key] of reachable) {
      const from = parseKey(key)
      for (const [, target] of this.units) {
        if (!this._isHostile(unit.side, target.side)) continue
        const dist = manhattan(from, target.pos)
        if (dist < 1 || dist > unit.attackRange) continue
        // 远程阻挡检查
        if (unit.attackRange > 1 && this.isRangeBlocked(from, target.pos)) continue

        const existing = bestAttack.get(target.id)
        if (!existing) {
          bestAttack.set(target.id, { from, dist })
        } else {
          if (unit.attackRange === 1) {
            // 近战：选距离目标最近的可达位
            if (dist < existing.dist) bestAttack.set(target.id, { from, dist })
          } else {
            // 远程：选距离目标最远的可达位（保持安全距离）
            if (dist > existing.dist) bestAttack.set(target.id, { from, dist })
          }
        }
      }
    }

    return Array.from(bestAttack.entries()).map(([targetId, { from }]) => ({
      targetId,
      attackFrom: from,
    }))
  }

  // ── 远程阻挡判定 ──

  /**
   * 检查 from→to 的直线上是否有墙壁阻挡远程攻击。
   * 不含起点和终点本身。友方不阻挡远程。
   */
  isRangeBlocked(from: GridPos, to: GridPos): boolean {
    const points = bresenhamLine(from, to)
    for (const p of points) {
      if (posEqual(p, from) || posEqual(p, to)) continue
      if (this.isWall(p)) return true
    }
    return false
  }

  // ── 序列化（发送给前端） ──

  toJSON(): {
    width: number; height: number;
    terrain: number[][];
    units: Array<GridUnit & { hp?: number; maxHp?: number; name?: string; portrait?: string }>;
  } {
    return {
      width: this.width,
      height: this.height,
      terrain: this.terrain.map(row => [...row]),
      units: Array.from(this.units.values()).map(u => ({ ...u, pos: { ...u.pos } })),
    }
  }
}

// ─── 棋盘初始化 ──────────────────────────────

/** 在指定位置附近找一个空格子（用于初始布阵避开障碍物） */
function findNearestEmpty(grid: CombatGrid, preferred: GridPos): GridPos {
  if (grid.isEmpty(preferred)) return preferred
  // BFS 找最近空格
  const queue: GridPos[] = [preferred]
  const seen = new Set<string>([posKey(preferred)])
  while (queue.length > 0) {
    const p = queue.shift()!
    for (const nb of neighbors(p)) {
      if (!grid.isInBounds(nb)) continue
      const k = posKey(nb)
      if (seen.has(k)) continue
      seen.add(k)
      if (grid.isEmpty(nb)) return nb
      if (!grid.isWall(nb)) queue.push(nb)
    }
  }
  return preferred // fallback
}

export interface InitGridOptions {
  areaId: string
  terrainTemplates: Record<string, number[][][]>
  /** 怪物列表（id, moveSpeed, attackRange） */
  monsters: Array<{ id: string; moveSpeed?: number; attackRange?: number }>
  /** 盟友列表 */
  allies: Array<{ id: string; moveSpeed?: number; attackRange?: number }>
  /** 玩家 */
  player: { id: string; moveSpeed: number; attackRange: number }
}

/**
 * 创建并初始化战斗棋盘：选地形模板，自动布阵。
 * 玩家侧在南（y=3-4），怪物侧在北（y=0-1）。
 */
export function initCombatGrid(opts: InitGridOptions): CombatGrid {
  const templates = opts.terrainTemplates[opts.areaId]
  const template = templates
    ? templates[Math.floor(Math.random() * templates.length)]
    : emptyTerrain()

  const grid = new CombatGrid(template)

  // 玩家：正下方中央
  const playerPos = findNearestEmpty(grid, { x: 3, y: 4 })
  grid.placeUnit({
    id: opts.player.id,
    side: 'player',
    pos: playerPos,
    moveSpeed: opts.player.moveSpeed,
    attackRange: opts.player.attackRange,
  })

  // 盟友：玩家两侧
  const allySlots: GridPos[] = [{ x: 1, y: 4 }, { x: 5, y: 4 }, { x: 2, y: 3 }, { x: 4, y: 3 }]
  for (let i = 0; i < opts.allies.length && i < allySlots.length; i++) {
    const a = opts.allies[i]
    const pos = findNearestEmpty(grid, allySlots[i])
    grid.placeUnit({
      id: a.id,
      side: 'ally',
      pos,
      moveSpeed: a.moveSpeed ?? 3,
      attackRange: a.attackRange ?? 1,
    })
  }

  // 怪物：上方
  const monsterSlots: GridPos[] = [
    { x: 3, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 },
    { x: 2, y: 1 }, { x: 4, y: 1 }, { x: 0, y: 0 }, { x: 6, y: 0 },
  ]
  for (let i = 0; i < opts.monsters.length && i < monsterSlots.length; i++) {
    const m = opts.monsters[i]
    const pos = findNearestEmpty(grid, monsterSlots[i])
    grid.placeUnit({
      id: m.id,
      side: 'enemy',
      pos,
      moveSpeed: m.moveSpeed ?? 3,
      attackRange: m.attackRange ?? 1,
    })
  }

  return grid
}

function emptyTerrain(): number[][] {
  return Array.from({ length: GRID_H }, () => Array(GRID_W).fill(0))
}
