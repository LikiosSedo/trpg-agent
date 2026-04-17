// 战棋场景积木 —— 每个导出函数返回一个可以喂给 window.initCombatGrid() 的 gridData
// 场景覆盖：初始、带墙、boss、远程、低血、多单位

export interface GridPos { x: number; y: number }
export interface GridUnit {
  id: string
  side: 'player' | 'ally' | 'enemy'
  pos: GridPos
  moveSpeed: number
  attackRange: number
  name?: string
  hp?: number
  maxHp?: number
  portrait?: string
}
export interface GridScenario {
  width: number
  height: number
  terrain: number[][] // 0=floor 1=wall 2=difficult
  units: GridUnit[]
}

const F = 0, W = 1, D = 2

function emptyTerrain(w = 7, h = 5): number[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => F))
}

// ── 1. 基础场：玩家 + 1 敌，纯地板 ──────────────
export function baseScenario(): GridScenario {
  return {
    width: 7, height: 5,
    terrain: emptyTerrain(),
    units: [
      { id: 'player', side: 'player', pos: { x: 1, y: 2 }, moveSpeed: 3, attackRange: 1, name: '你', hp: 20, maxHp: 20 },
      { id: 'Goblin_1', side: 'enemy', pos: { x: 5, y: 2 }, moveSpeed: 3, attackRange: 1, name: '哥布林', hp: 8, maxHp: 8 },
    ],
  }
}

// ── 2. 墙阻挡场：直线路径被墙挡住 ──────────────
export function wallScenario(): GridScenario {
  const t = emptyTerrain()
  t[2][3] = W; t[2][4] = W // 中间一堵墙
  return {
    width: 7, height: 5,
    terrain: t,
    units: [
      { id: 'player', side: 'player', pos: { x: 1, y: 2 }, moveSpeed: 4, attackRange: 1, name: '你', hp: 20, maxHp: 20 },
      { id: 'Skeleton_1', side: 'enemy', pos: { x: 5, y: 2 }, moveSpeed: 2, attackRange: 1, name: '骷髅', hp: 10, maxHp: 10 },
    ],
  }
}

// ── 3. Boss 场：HP≥40 触发 boss 脉冲 ──────────────
export function bossScenario(): GridScenario {
  return {
    width: 7, height: 5,
    terrain: emptyTerrain(),
    units: [
      { id: 'player', side: 'player', pos: { x: 1, y: 2 }, moveSpeed: 3, attackRange: 1, name: '你', hp: 22, maxHp: 22 },
      { id: 'ally_greg', side: 'ally', pos: { x: 1, y: 3 }, moveSpeed: 3, attackRange: 1, name: '格雷格', hp: 14, maxHp: 14 },
      { id: 'Spiderqueen', side: 'enemy', pos: { x: 5, y: 2 }, moveSpeed: 2, attackRange: 1, name: '蛛母', hp: 45, maxHp: 45 },
    ],
  }
}

// ── 4. 远程场：玩家带 4 格射程 ──────────────
export function rangedScenario(): GridScenario {
  const t = emptyTerrain()
  t[2][3] = D // 困难地形
  return {
    width: 7, height: 5,
    terrain: t,
    units: [
      { id: 'player', side: 'player', pos: { x: 1, y: 2 }, moveSpeed: 4, attackRange: 3, name: '游侠', hp: 18, maxHp: 18 },
      { id: 'Wolf_1', side: 'enemy', pos: { x: 5, y: 2 }, moveSpeed: 4, attackRange: 1, name: '狼', hp: 11, maxHp: 11 },
      { id: 'Wolf_2', side: 'enemy', pos: { x: 5, y: 4 }, moveSpeed: 4, attackRange: 1, name: '狼', hp: 11, maxHp: 11 },
    ],
  }
}

// ── 5. 低 HP 场：血条 critical 视觉 ──────────────
export function lowHpScenario(): GridScenario {
  const s = baseScenario()
  s.units[0].hp = 4; s.units[0].maxHp = 20 // critical (<25%)
  s.units[1].hp = 3; s.units[1].maxHp = 8  // low  (<50%)
  return s
}

// ── 6. 移动端场：同 base 但会在 mobile viewport 下测布局 ──────────────
export function mobileScenario(): GridScenario {
  return baseScenario()
}

// ── 7. 挤满场：验证多单位渲染 + 死亡动画堆叠 ──────────────
export function crowdedScenario(): GridScenario {
  return {
    width: 7, height: 5,
    terrain: emptyTerrain(),
    units: [
      { id: 'player', side: 'player', pos: { x: 0, y: 2 }, moveSpeed: 3, attackRange: 1, name: '你', hp: 20, maxHp: 20 },
      { id: 'ally_1', side: 'ally', pos: { x: 1, y: 2 }, moveSpeed: 3, attackRange: 1, name: '盟友A', hp: 14, maxHp: 14 },
      { id: 'ally_2', side: 'ally', pos: { x: 0, y: 1 }, moveSpeed: 3, attackRange: 4, name: '弓手', hp: 10, maxHp: 12 },
      { id: 'enemy_1', side: 'enemy', pos: { x: 5, y: 1 }, moveSpeed: 3, attackRange: 1, name: '敌人1', hp: 8, maxHp: 8 },
      { id: 'enemy_2', side: 'enemy', pos: { x: 5, y: 2 }, moveSpeed: 3, attackRange: 1, name: '敌人2', hp: 8, maxHp: 8 },
      { id: 'enemy_3', side: 'enemy', pos: { x: 6, y: 3 }, moveSpeed: 3, attackRange: 1, name: '敌人3', hp: 8, maxHp: 8 },
    ],
  }
}
