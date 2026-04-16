# P1 实施规划：战棋骨架 + 战斗闭环

> 目标：战斗完全由代码驱动，棋盘上完成移动+攻击+怪物AI，LLM 仅异步装饰。

## 0. 架构变更：去 LLM 阻塞

### 0.1 现状

战斗中有 **8 个 LLM 阻塞点**，全走 `combatDMNarrative()` → `dmRespond()` → 等待 LLM 返回（最多 120 秒）：

| 触发点 | 行号 | 场景 |
|--------|------|------|
| 区域遭遇开始 | 2625 | 怪物出现的描写 |
| 暴力追击战斗 | 2504 | NPC 追上来打你 |
| 玩家击杀结束 | 3468 | 最后一击描写 |
| 盟友击杀结束 | 3376 | 同伴击败敌人 |
| 回合结束检查 | 3495 | 自然结束 |
| 盟友二阶段胜利 | 3523 | 低先攻盟友收尾 |
| 怪物阶段胜利 | 3555 | 怪物被反杀 |
| 玩家死亡 | 3134 | 死亡结语 |

### 0.2 改造方案

**原则**：所有阻塞的 `yield* combatDMNarrative()` 替换为**模板叙事 + 可选异步 LLM**。

```
现在：
  攻击 → 伤害计算 → [等 LLM 2-10s] → 显示叙事 → 下一步
                     ^^^^^^^^^^^^
                     阻塞！

改后：
  攻击 → 伤害计算 → 模板叙事（立即） → 下一步
                              ↘ [可选] 异步请求 LLM
                                       ↓ 2-10s 后
                              前端追加一段氛围文字（不阻塞）
```

**具体拆分**：

| 原阻塞点 | 替换方案 |
|---------|---------|
| 战斗开始描写 | `combat_grid_init` 事件 + 模板开场文本。异步 LLM 请求氛围描写，完成后追加到日志。 |
| 每回合攻击叙事 | 已有 `pickNarrative()` 模板，不需要 LLM。扩展模板加入位置描写。 |
| 战斗结束描写 | 模板胜利/败北文本（"最后一击落下，{target} 倒地。你赢了！"）。异步 LLM 生成战后总结。 |
| 玩家死亡结语 | 模板死亡文本。异步 LLM 生成文学性死亡独白（追加显示，不阻塞 Game Over UI）。 |

### 0.3 异步 LLM 叙事机制

新增一个不阻塞的叙事请求函数：

```typescript
// 不是 generator，不 yield，不阻塞
private requestAsyncNarrative(prompt: string, tag: string): void {
  // 在后台发起 LLM 请求
  // 完成后通过 emitter 发出 { type: 'combat_async_narrative', tag, text }
  // 前端收到后追加到战斗日志（淡入动画，不打断操作）
}
```

**触发时机（仅限关键回合）**：
- 战斗开始（Boss 战特别描写）
- Boss 进入 Phase 2
- 战斗结束（胜利/败北总结）
- 玩家死亡（死亡独白）

普通回合不请求 LLM — 模板叙事 + 伤害数字已经够用。

---

## 1. 新建 `src/combat-grid.ts`

棋盘核心逻辑，纯计算，不依赖任何 I/O。

### 1.1 数据结构

```typescript
// 地形类型
export const TERRAIN = { FLOOR: 0, WALL: 1, DIFFICULT: 2 } as const
export type TerrainType = typeof TERRAIN[keyof typeof TERRAIN]

// 坐标
export interface GridPos { x: number; y: number }

// 棋盘上的单位
export interface GridUnit {
  id: string
  side: 'player' | 'ally' | 'enemy'
  pos: GridPos
  moveSpeed: number
  attackRange: number
}

// 棋盘状态
export class CombatGrid {
  readonly width = 7
  readonly height = 5
  terrain: TerrainType[][]         // [y][x]
  units: Map<string, GridUnit>     // id → unit

  constructor(terrainTemplate: TerrainType[][]) { ... }

  // ── 查询 ──
  getUnit(id: string): GridUnit | undefined
  getUnitAt(pos: GridPos): GridUnit | undefined
  isWall(pos: GridPos): boolean
  isDifficult(pos: GridPos): boolean
  isInBounds(pos: GridPos): boolean
  isEmpty(pos: GridPos): boolean   // 无单位且非墙

  // ── 移动计算 ──
  getReachable(unitId: string): Map<string, number>  // "x,y" → cost
  getPath(from: GridPos, to: GridPos, moveSpeed: number, side: 'player'|'ally'|'enemy'): GridPos[]

  // ── 攻击计算 ──
  getAttackableTargets(unitId: string): Array<{
    targetId: string
    attackFrom: GridPos  // 移动到这里攻击
  }>
  isRangeBlocked(from: GridPos, to: GridPos): boolean  // 障碍物阻挡远程

  // ── 状态变更 ──
  placeUnit(unit: GridUnit): void
  moveUnit(unitId: string, to: GridPos): GridPos[]  // 返回路径
  removeUnit(unitId: string): void
}
```

### 1.2 BFS 可达计算

```typescript
getReachable(unitId: string): Map<string, number> {
  const unit = this.units.get(unitId)
  if (!unit) return new Map()
  
  const queue: Array<[GridPos, number]> = [[unit.pos, 0]]
  const visited = new Map<string, number>()
  visited.set(posKey(unit.pos), 0)

  while (queue.length > 0) {
    const [pos, cost] = queue.shift()!
    for (const nb of neighbors(pos)) {
      if (!this.isInBounds(nb)) continue
      if (this.isWall(nb)) continue
      // 敌方单位阻挡通行（不可穿过）
      const occupant = this.getUnitAt(nb)
      if (occupant && occupant.side !== unit.side) continue
      // 困难地形 cost=2，普通 cost=1
      const moveCost = this.isDifficult(nb) ? 2 : 1
      const newCost = cost + moveCost
      if (newCost > unit.moveSpeed) continue
      const key = posKey(nb)
      if (visited.has(key) && visited.get(key)! <= newCost) continue
      // 友方单位可穿过但不可停留
      if (occupant && occupant.side === unit.side) {
        // 可以继续搜索，但不能作为终点
        visited.set(key, newCost)
        queue.push([nb, newCost])
        continue
      }
      visited.set(key, newCost)
      queue.push([nb, newCost])
    }
  }
  // 过滤掉被友方占据的格子（可穿过但不可停留）
  for (const [key] of visited) {
    const p = parseKey(key)
    const occ = this.getUnitAt(p)
    if (occ && occ.id !== unitId) visited.delete(key)
  }
  return visited
}
```

### 1.3 火纹式攻击目标计算

```typescript
getAttackableTargets(unitId: string): Array<{ targetId: string; attackFrom: GridPos }> {
  const unit = this.units.get(unitId)
  if (!unit) return []
  
  const reachable = this.getReachable(unitId)
  const results: Map<string, GridPos> = new Map()  // targetId → best attackFrom

  for (const [key] of reachable) {
    const from = parseKey(key)
    // 从这个可达位置，检查攻击范围内的敌人
    for (const [, target] of this.units) {
      if (target.side === unit.side) continue  // 不打友方
      const dist = manhattan(from, target.pos)
      if (dist < 1 || dist > unit.attackRange) continue
      // 远程检查障碍物阻挡
      if (unit.attackRange > 1 && this.isRangeBlocked(from, target.pos)) continue
      // 选择离目标最优的攻击位
      // 近战：最近的可达位（尽量贴脸）
      // 远程：最远的可达位（保持距离）
      if (!results.has(target.id)) {
        results.set(target.id, from)
      } else {
        const existing = results.get(target.id)!
        const existDist = manhattan(existing, target.pos)
        const newDist = manhattan(from, target.pos)
        if (unit.attackRange === 1) {
          // 近战：越近越好
          if (newDist < existDist) results.set(target.id, from)
        } else {
          // 远程：越远越好（在射程内）
          if (newDist > existDist) results.set(target.id, from)
        }
      }
    }
  }

  return Array.from(results.entries()).map(([targetId, attackFrom]) => ({
    targetId, attackFrom,
  }))
}
```

### 1.4 远程阻挡判定

简化版：Bresenham 直线上是否有墙。

```typescript
isRangeBlocked(from: GridPos, to: GridPos): boolean {
  // 遍历 from→to 直线上的格子（不含起点和终点）
  // 任一格是 WALL → 返回 true
  const points = bresenhamLine(from, to)
  for (const p of points) {
    if (posEqual(p, from) || posEqual(p, to)) continue
    if (this.isWall(p)) return true
  }
  return false
}
```

---

## 2. 修改 `src/combat-manager.ts`

### 2.1 单位扩展

`MonsterInstance` 和 `AllyInstance` 添加网格字段：

```typescript
interface MonsterInstance {
  // ...existing fields...
  pos: GridPos          // 新增
  moveSpeed: number     // 新增
  attackRange: number   // 新增
}
```

### 2.2 startCombat 改造

```typescript
export function startCombat(session, monsterNames, monstersDb): CombatState {
  // ...existing initiative/monster creation logic...
  
  // 新增：创建棋盘
  const areaId = session.worldState.currentLocation
  const grid = initCombatGrid(areaId, monsters, allies, session.player)
  session.combat.grid = grid  // 存到 session 中
  
  return combatState
}
```

### 2.3 怪物 AI 移动+攻击

```typescript
// 修改 executeMonsterTurns：每只怪先移动再攻击
function executeMonsterTurn(monster, grid, targets): MonsterTurnResult {
  const unit = grid.getUnit(monster.id)
  
  // 1. 选择目标（沿用现有权重系统）
  const target = selectTarget(monster, targets, weights)
  
  // 2. 检查是否能直接攻击（已在射程内）
  const dist = manhattan(unit.pos, targetUnit.pos)
  if (dist <= unit.attackRange && !grid.isRangeBlocked(unit.pos, targetUnit.pos)) {
    // 不移动，直接攻击
    return { moved: false, attack: executeAttack(monster, target) }
  }
  
  // 3. 需要移动：计算目标位置
  let moveTo: GridPos
  if (unit.attackRange === 1) {
    // 近战：移向目标相邻格
    moveTo = findClosestAdjacentTo(grid, unit, targetUnit.pos)
  } else {
    // 远程：移到射程边缘（保持距离）
    moveTo = findOptimalRangePos(grid, unit, targetUnit.pos)
  }
  
  // 4. 移动
  const path = grid.moveUnit(unit.id, moveTo)
  
  // 5. 移动后检查能否攻击
  const newDist = manhattan(moveTo, targetUnit.pos)
  if (newDist <= unit.attackRange) {
    return { moved: true, path, attack: executeAttack(monster, target) }
  }
  
  // 6. 够不到就只移动
  return { moved: true, path, attack: null }
}
```

---

## 3. 修改 `src/engine.ts`

### 3.1 新增事件类型

在 `TurnEvent` union 中新增：

```typescript
| { type: 'combat_grid_init'; grid: GridInitData }
| { type: 'combat_grid_move'; unitId: string; path: GridPos[] }
| { type: 'combat_grid_attack'; attackerId: string; targetId: string; attackFrom: GridPos }
| { type: 'combat_grid_spawn'; unit: GridUnitData }
| { type: 'combat_grid_death'; unitId: string }
| { type: 'combat_async_narrative'; tag: string; text: string }
```

### 3.2 战斗开始流程改造

```
现在：
  startCombat() → emitCombatStart() → combatDMNarrative() [阻塞]

改后：
  startCombat() → initGrid() → emit combat_grid_init
                              → emit combat_init (保留现有 UI 兼容)
                              → emit combat_action_req
                              → requestAsyncNarrative() [不阻塞]
```

### 3.3 玩家行动处理

新增 `grid_move` 和 `grid_attack` 输入类型：

```typescript
// 前端发来的消息
{ type: 'grid_move', target: { x, y } }
{ type: 'grid_attack', targetId: string }

// engine 处理
case 'grid_move':
  validate → grid.moveUnit() → yield combat_grid_move → 回合结束
  
case 'grid_attack':
  validate → 自动移动到攻击位 → yield combat_grid_move
           → 执行攻击(现有 executePlayerAttack) → yield 伤害事件
           → 检查战斗结束 → 如果继续: 怪物回合
```

### 3.4 怪物回合改造

```
现在：
  executeMonsterPhase() → 每只怪攻击 → combatDMNarrative() [阻塞]

改后：
  executeMonsterPhase() → 每只怪:
    AI 选择目标 → 移动(yield combat_grid_move) → 攻击 → 模板叙事
    → 短延迟（前端动画时间）
  → 检查战斗结束
```

前端侧：收到 `combat_grid_move` 后播放 300ms 滑动动画，然后收到攻击结果。怪物一只一只依次行动，玩家看到的是"怪物滑过去 → 砍一刀 → 下一只怪"。

### 3.5 消除 combatDMNarrative 的 8 个调用点

| 原调用 | 替换 |
|--------|------|
| 遭遇开始叙事 | `yield { type: 'combat_grid_init', ... }` + 模板开场 |
| 暴力追击叙事 | 模板："{npc}冲上来了！" + `combat_grid_init` |
| 玩家击杀结束 | 模板胜利文本 + `requestAsyncNarrative()` |
| 盟友击杀结束 | 模板："{ally}击败了最后的敌人！" |
| 回合结束检查 | 模板胜利/败北文本 |
| 盟友二阶段胜利 | 模板 |
| 怪物阶段胜利 | 模板（怪物被反杀的情况很少） |
| 玩家死亡 | 模板死亡文本 + `requestAsyncNarrative()` 生成死亡独白 |

---

## 4. 修改 `public/index.html`

### 4.1 新增 DOM 结构

```html
<!-- 战棋盘（战斗时替代 messages 区域） -->
<div class="combat-grid-container" id="combat-grid-container" style="display:none">
  <div class="combat-grid" id="combat-grid">
    <!-- 7×5 = 35 个 grid-cell，JS 动态生成 -->
  </div>
  <div class="combat-log" id="combat-log">
    <!-- 2-3 行滚动战斗日志 -->
  </div>
</div>
```

### 4.2 渲染逻辑

```javascript
// 前端维护一份 grid 状态（用于本地 BFS 高亮计算）
let clientGrid = null  // { width, height, terrain[][], units[] }

function handleCombatGridInit(data) {
  clientGrid = data.grid
  renderGrid()
  // 切换 UI：隐藏 messages，显示 grid container
  document.getElementById('messages').style.display = 'none'
  document.getElementById('combat-grid-container').style.display = ''
}

function renderGrid() {
  const el = document.getElementById('combat-grid')
  el.innerHTML = ''
  el.style.gridTemplateColumns = `repeat(${clientGrid.width}, 48px)`
  
  for (let y = 0; y < clientGrid.height; y++) {
    for (let x = 0; x < clientGrid.width; x++) {
      const cell = document.createElement('div')
      cell.className = 'grid-cell'
      cell.dataset.x = x
      cell.dataset.y = y
      
      // 地形
      const t = clientGrid.terrain[y][x]
      if (t === 1) cell.classList.add('wall')
      else if (t === 2) cell.classList.add('difficult')
      else cell.classList.add('floor')
      
      // 单位
      const unit = clientGrid.units.find(u => u.pos.x === x && u.pos.y === y)
      if (unit) {
        const icon = document.createElement('div')
        icon.className = `grid-unit ${unit.side}`
        icon.dataset.unitId = unit.id
        // 小头像或图标
        if (unit.portrait) {
          icon.style.backgroundImage = `url(${unit.portrait})`
        } else {
          icon.textContent = unit.side === 'player' ? '⚔' : unit.side === 'ally' ? '🛡' : '👹'
        }
        // 血条
        const hpBar = document.createElement('div')
        hpBar.className = 'grid-hp'
        hpBar.style.width = `${(unit.hp / unit.maxHp) * 100}%`
        icon.appendChild(hpBar)
        cell.appendChild(icon)
      }
      
      cell.onclick = () => onGridCellClick(x, y)
      el.appendChild(cell)
    }
  }
}
```

### 4.3 交互状态机

```javascript
let gridInteractionMode = 'idle'  // idle | move | attack | spell

function onGridCellClick(x, y) {
  switch (gridInteractionMode) {
    case 'move':
      if (isHighlighted(x, y, 'reachable')) {
        ws.send(JSON.stringify({ type: 'grid_move', target: { x, y } }))
        clearHighlights()
        gridInteractionMode = 'idle'
      }
      break
      
    case 'attack':
      const targetUnit = getUnitAt(x, y)
      if (targetUnit && isHighlighted(x, y, 'attackable')) {
        ws.send(JSON.stringify({ type: 'grid_attack', targetId: targetUnit.id }))
        clearHighlights()
        gridInteractionMode = 'idle'
      }
      break
  }
}

// 点击"攻击"按钮
function onAttackButton() {
  gridInteractionMode = 'attack'
  // 本地 BFS 计算可攻击目标
  const targets = localGetAttackableTargets(playerUnit)
  highlightAttackable(targets)
}

// 点击"移动"按钮
function onMoveButton() {
  gridInteractionMode = 'move'
  const reachable = localGetReachable(playerUnit)
  highlightReachable(reachable)
}
```

### 4.4 动画

```javascript
function handleCombatGridMove(data) {
  const { unitId, path } = data
  // 更新 clientGrid 中的单位位置
  updateUnitPos(unitId, path[path.length - 1])
  // 逐格滑动动画（每格 150ms）
  animateUnitMove(unitId, path)
}

async function animateUnitMove(unitId, path) {
  const el = document.querySelector(`[data-unit-id="${unitId}"]`)
  for (let i = 1; i < path.length; i++) {
    const cell = getCellElement(path[i].x, path[i].y)
    // CSS transition 滑动
    el.style.transform = `translate(${dx}px, ${dy}px)`
    await sleep(150)
  }
  // 动画结束，重新渲染（把单位放到新格子的 DOM 中）
  renderGrid()
}
```

### 4.5 战斗结束

```javascript
function handleCombatEnd() {
  // 隐藏棋盘，恢复 messages 区域
  document.getElementById('combat-grid-container').style.display = 'none'
  document.getElementById('messages').style.display = ''
  clientGrid = null
}
```

---

## 5. 数据迁移

### 5.1 `data/monsters.json` 新增字段

每个怪物添加 `moveSpeed` 和 `attackRange`：

```json
{
  "name": "Wolf",
  "nameZh": "野狼",
  "moveSpeed": 4,
  "attackRange": 1,
  // ...existing fields...
}
```

完整映射见 `docs/combat-grid-design.md` §3.5

### 5.2 `data/equipment.json` 新增字段

每把武器添加 `gridRange`：

```json
{
  "nameZh": "短弓 +1",
  "gridRange": 4,
  "weaponType": "ranged",
  // ...existing fields...
}
```

近战武器不需要加（默认 1）。

### 5.3 `src/game-data.ts` 法术射程

每个法术添加 `gridRange` 和可选的 `gridRadius`：

```typescript
{ name: 'Fire Bolt', gridRange: 4, ... }
{ name: 'Fireball', gridRange: 3, gridRadius: 2, ... }
{ name: 'Cure Wounds', gridRange: 1, ... }  // 触摸
{ name: 'Shield', gridRange: 0, ... }        // 自身
```

### 5.4 `data/npc-combatants.json` 新增字段

```json
{
  "name": "格雷格",
  "moveSpeed": 3,
  "attackRange": 1,
  // ...existing fields...
}
```

### 5.5 `src/data/maps.ts` 地形模板

```typescript
export const COMBAT_TERRAINS: Record<string, TerrainType[][][]> = {
  'twilight-woods': [
    // 模板 A：蛛巢（5行×7列）
    [
      [0,0,0,0,0,0,0],
      [0,1,0,2,0,1,0],
      [0,0,0,0,0,0,0],
      [0,2,0,0,0,2,0],
      [0,0,0,0,0,0,0],
    ],
    // 模板 B：...
  ],
  // ...
}
```

---

## 6. 服务器 WebSocket 协议

### 6.1 新增消息类型（server → client）

| type | 字段 | 说明 |
|------|------|------|
| `combat_grid_init` | `grid: { width, height, terrain[][], units[] }` | 战斗开始，初始化棋盘 |
| `combat_grid_move` | `unitId, path: Pos[]` | 单位移动（含路径动画） |
| `combat_grid_attack` | `attackerId, targetId, damage, narrative` | 攻击结果 |
| `combat_grid_spawn` | `unit: GridUnitData` | 召唤/分裂新单位 |
| `combat_grid_death` | `unitId` | 单位死亡 |
| `combat_grid_end` | `result: 'victory'|'defeat', loot` | 战斗结束 |
| `combat_async_narrative` | `tag, text` | 异步 LLM 叙事（追加显示） |

### 6.2 新增消息类型（client → server）

| type | 字段 | 说明 |
|------|------|------|
| `grid_move` | `target: { x, y }` | 玩家纯移动 |
| `grid_attack` | `targetId` | 玩家移动+攻击 |
| `grid_spell` | `spellName, targetId?` | 玩家施法 |
| `grid_item` | `itemName, targetId?` | 玩家使用物品 |
| `grid_defend` | (无) | 玩家防御 |
| `grid_flee` | (无) | 玩家逃跑 |

---

## 7. 实施顺序

严格按依赖关系排序，每步可独立测试：

### Step 1：数据层

1. `data/monsters.json` — 加 moveSpeed, attackRange
2. `data/npc-combatants.json` — 加 moveSpeed, attackRange
3. `data/equipment.json` — 加 gridRange
4. `src/game-data.ts` — 法术加 gridRange
5. `src/data/maps.ts` — 加地形模板 COMBAT_TERRAINS
6. `src/types.ts` — 更新接口（可选，combat-grid.ts 自带类型）

**验证**：tsc 通过，现有战斗不受影响（新字段是可选的）

### Step 2：棋盘引擎

7. 新建 `src/combat-grid.ts` — 完整的 CombatGrid 类
8. 新建 `src/combat-grid.test.ts` — 单测 BFS、攻击判定、远程阻挡

**验证**：测试全绿，纯逻辑无副作用

### Step 3：战斗管理器整合

9. `src/combat-manager.ts` — startCombat 中创建 grid，单位带 pos
10. `src/combat-manager.ts` — 怪物回合加入移动逻辑
11. `src/combat-manager.ts` — 攻击前距离校验

**验证**：tsc 通过，现有战斗流程仍可工作（grid 是 optional 的）

### Step 4：事件和引擎层

12. `src/engine.ts` — TurnEvent 新增类型
13. `src/engine.ts` — 战斗开始 emit combat_grid_init
14. `src/engine.ts` — 处理 grid_move / grid_attack 输入
15. `src/engine.ts` — 怪物回合 emit combat_grid_move
16. `src/engine.ts` — 替换 combatDMNarrative 为模板 + 异步
17. `src/server.ts` — 转发新事件 + 接收新输入类型

**验证**：后端完整战斗闭环，WebSocket 协议工作

### Step 5：前端

18. `public/index.html` — CSS 棋盘样式
19. `public/index.html` — combat_grid_init 渲染棋盘
20. `public/index.html` — 本地 BFS（移动/攻击高亮）
21. `public/index.html` — 点击交互（移动 + 攻击）
22. `public/index.html` — 动画（滑动 + 攻击闪光）
23. `public/index.html` — 动作按钮改造（攻击/移动/法术/防御/逃跑）
24. `public/index.html` — 战斗结束：棋盘退场，恢复叙事界面

**验证**：浏览器中完整玩一场战斗

### Step 6：打磨

25. 异步 LLM 叙事接入（Boss 战开场 + 结束）
26. 模板叙事扩展（加入位置描写："从左翼包抄"）
27. 手机触控优化
28. 战斗日志压缩 + 滚动

---

## 8. 向后兼容

### 8.1 渐进式启用

新增 flag：`session.combat.gridEnabled`

- `gridEnabled = true`（默认开启）：走棋盘战斗流程
- `gridEnabled = false`：走现有文字战斗流程

这样可以：
- 逐步迁移，不需要一次改完
- 某些特殊战斗（如 NPC 对峙）可以继续用文字模式
- 出 bug 时有回退路径

### 8.2 保存/读档兼容

存档中 `combat.grid` 是新增字段。老存档没有 grid → `gridEnabled = false` → 走旧流程。

---

## 9. 延迟预估

| 操作 | 现在延迟 | 改后延迟 |
|------|---------|---------|
| 战斗开始 | 2-10s（等 LLM） | < 100ms（模板+棋盘渲染） |
| 玩家攻击 | 2-10s（等 LLM） | < 200ms（计算+动画） |
| 怪物回合（3只怪） | 2-10s（等 LLM） | ~1s（3×300ms 动画） |
| 战斗结束 | 2-10s（等 LLM） | < 100ms + 异步叙事 |
| 总战斗时间（5回合3怪） | 30-60s+ | 10-15s（玩家思考时间为主） |

---

## 修订历史

- 2026-04-16：v0.1 P1 详细实施规划
