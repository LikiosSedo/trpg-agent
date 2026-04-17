# 战棋系统深度代码审查报告

> 审查日期：2026-04-17
> 范围：P1 战棋系统（combat-grid.ts / combat-manager.ts / engine.ts / server.ts / types.ts / public/index.html）
> 覆盖：3447 行新增代码

## 审查方式

- **逐文件阅读**核心实现代码
- **编写集成测试**（18 个新增测试）暴露隐藏 bug
- **运行实际代码**验证发现的问题

## 已修复的严重问题（本次提交）

### 🔴 Critical #1: `moveUnit` 瞬移到不可达位置

**位置**: `src/combat-grid.ts:157-163`（原始版本）

**问题**：`moveUnit` 不做任何合法性校验，直接将单位 `pos` 设为 `to`。如果调用方因 bug 传入不可达坐标（超出移动力、被墙挡住、被敌方占据），单位会瞬移过去。

**暴露测试**：
```
Test 4: 玩家在 (3,4) 移动力 3，尝试移到 (0,0)（曼哈顿距离 7）
原行为: 玩家瞬移到 (0,0) ← BUG
修复后: 位置不变，返回空路径
```

**修复**：加入 BFS reachable 校验：
```typescript
const reachable = this.getReachable(unitId)
if (!reachable.has(posKey(to))) return []
```

**影响范围**：前端虽然用本地 BFS 做了交互校验，但后端自己调用 `moveUnit`（AI、spawn 后的初始化）时没有校验。修复前，一旦调用方逻辑出错就是瞬移。

---

### 🔴 Critical #2: Boss 召唤物没放到网格

**位置**: `src/combat-manager.ts:574-597` (蛛母), `:624-650` (暗影编织者)

**问题**：Phase 2 触发时，代码 push 新 `MonsterInstance` 到 `combat.monsters` 和 `initiativeOrder`，但：
- 没有设置 `pos` / `moveSpeed` / `attackRange`
- 没有调用 `grid.placeUnit()`
- 没有发射 `combat_grid_spawn` 事件

**暴露测试**：
```
Test 6: 蛛母 HP=20 触发 Phase 2
spawned: 2 spiderlings
grid.getUnit('Spiderling_1'): undefined ← BUG
grid.getUnit('Spiderling_2'): undefined ← BUG
```

**后果**：召唤物能正常攻击（走旧 target selection 路径），但**前端网格看不到**。玩家体验是"幽灵单位"——看不到但会打你。

**修复**：
1. 新增 `findNearbyEmptyGridCell()` 辅助函数（BFS 找 Boss 周围空格）
2. 召唤时调用 `grid.placeUnit()` 并设置 pos/moveSpeed/attackRange
3. 新增 `GridSpawnRecord` 类型 + `gridSpawns` 返回字段
4. `executeBossAbility` 接受 `spawns` 参数并记录
5. Engine 收到 `gridSpawns` 后发射 `combat_grid_spawn` 事件（前端已有处理器）

---

### 🔴 Critical #3: 网格 AI 目标 vs 攻击目标不一致

**位置**: `src/combat-manager.ts:748-829`

**问题**：两段代码职责重叠导致分裂：
1. **第一段（lines 748-801）**：网格 AI 调用 `getAttackableTargets` 选一个目标 A，计算攻击位，移动怪物到那里
2. **第二段（lines 810-829）**：旧的权重随机 target selection，从**所有**可能目标（玩家+所有盟友）中再随机选一个

结果：怪物移到玩家身边，但随机到了盟友 B，然后"攻击" B —— **目标 B 可能根本不在当前射程内**。攻击判定不做距离校验，直接用 `attackRoll(attackMod, targetAC)`，所以这次攻击在逻辑上生效，但空间上错乱。

**后果**：
- 怪物视觉上走到 A 身边，但伤害落在 B 身上
- 近战怪在网格两端之间"超距打击"
- 玩家直观感受：不合理

**修复**：引入 `gridLockedTargetId`。网格 AI 选定目标后记住 id，攻击阶段优先使用，跳过权重随机。如果没有锁定（没有网格时），走旧逻辑。

---

## 🟡 Important（未修复，需要后续规划）

### 4. `grid_spell` 路径丢失网格事件

**位置**: `src/engine.ts:3903-3914`

`processGridAction` 的 `grid_spell` 分支把逻辑委托给旧的 `processCombatAction`，但后者**完全不感知网格**：
- 怪物回合移动 → 不发 `combat_grid_move`
- 多目标法术（Fireball）其他怪物死亡 → 不发 `combat_grid_death`
- 盟友击杀的怪物 → 同样丢失

**后果**：施法回合结束后，网格上可能留下已死亡单位的视觉，动画缺失。

**缓解**：当前代码在 `grid_spell` 返回后只检查**目标** 是否死亡，调用 `grid.removeUnit` + 发死亡事件。其他死亡仍然会保留到战斗结束（combat_status ended=true 触发完整清理）。

### 5. Spell.gridRange / gridRadius 定义但未使用

**位置**: `src/types.ts:72-73`, `src/game-data.ts`

数据里给每个法术都加了 `gridRange`（Fire Bolt=4, Fireball=3+radius=2, etc.），但网格施法路径完全没校验。理论上玩家可以在任何位置对任何敌人施放 Fire Bolt。

### 6. 盟友在网格上不会移动

**位置**: `src/combat-manager.ts:executeAllyTurns`

盟友 AI 只选择目标然后攻击，**完全不调用网格**。在网格上：
- 盟友初始化时有 pos，之后永远不动
- 盟友攻击的目标可能在棋盘另一端
- 格雷格的"嘲讽"没有位置维度（无法物理挡路）

### 7. 存档恢复丢失网格状态

**位置**: `src/engine.ts:getStateSnapshot`, `src/types.ts:CombatState`

`CombatGrid` 是 class 实例，`units` 是 `Map<string, GridUnit>`。JSON 序列化：
- Map 变成 `{}`（空对象）
- 类方法丢失
- 恢复时 `combat.grid` 是断裂的对象
- `processGridAction` 会报 "当前没有战棋战斗"

**当前行为**：resume 时战斗降级为旧文字模式（实际上根本没测过——grid.toJSON 存进 session 后是什么状态？）

### 8. `findPath` BFS 正确性（学术问题）

**位置**: `src/combat-grid.ts:228-269`

用 FIFO 队列 + 可变边权重（1 或 2）做最短路 —— 理论上应该用 Dijkstra（优先队列）。
在 `break` 时可能返回次优路径。实测在 7×5 小棋盘上没遇到失败案例，但理论上不是完全正确的。

### 9. 前后端 BFS 代码重复

`public/index.html:6963-6998` 重写了一份本地 BFS 用于交互高亮。任何规则变更都需要同步两边。风险：未来加新地形类型时忘记同步。

### 10. `processGridAction` 中 `pickNarrative` 未使用

`src/engine.ts:3826` 动态导入 `pickNarrative` 但从未调用。死代码。

### 11. `combat_grid_attack` 事件定义但从未触发

`types.ts:423`, `server.ts:347`, `public/index.html` 都有对应位置，但 `engine.ts` 从不发射。原本是规划给"攻击特效"用的，目前攻击结果走 `combat_status` 文本。

### 12. 前端老战斗按钮在网格激活时仍可见

`initCombatGrid` 隐藏了 `#messages`，但 `#combat-panel`（旧的攻击/法术/防御按钮栏）仍然存在并且可能被点击。**已修复**（10月15日 commit 0bd5269 通过隐藏 combat-panel）。

---

## 🟢 Minor（可接受，低优先级）

### 13. `getUnitAt` O(n) 线性扫描
7×5 网格 × 10 单位 = 最多 70 ops per call。BFS 每次扩展都调用。总运算量仍在微秒级，不是问题。

### 14. 没有怪物 AI 移动的单元测试
`executeMonsterTurns` 的网格 AI 分支只有集成测试覆盖，没有针对性单测。未来修改 AI 逻辑容易回归。

### 15. `findPath` 在 from==to 时返回单点路径
调用方靠 `path.length > 1` 判断是否移动，工作但 API 设计粗糙。

### 16. 玩家头像恒为空字符串
`engine.ts:3243`：`(gu as any).portrait = ''`。前端 fallback 显示 ⚔ 图标。未来要加玩家头像需要改。

---

## 测试覆盖统计

| 测试文件 | 测试数 | 状态 |
|---------|-------|------|
| `combat-grid.test.ts` (单测) | 39 | ✅ 全绿 |
| `combat-grid-integration.test.ts` (新增集成) | 18 | ✅ 全绿 |
| `combat-ally-ai.test.ts` (回归) | 15 | ✅ 全绿 |
| `combat-manager.test.ts` (回归) | ? | 未跑 |
| `rules-engine.test.ts` (回归) | ? | 未跑 |

## 架构评估

### 好的部分 ✅

1. **清晰的职责分离**：`combat-grid.ts` 是纯计算模块，无副作用，易测试
2. **向后兼容设计**：新字段都是 optional，`combat.grid === undefined` 时走旧流程
3. **事件驱动架构**：前后端通过 `combat_grid_*` 事件解耦，前端可以独立迭代
4. **前端本地 BFS**：交互响应性好，不需要每次高亮都 round-trip 后端
5. **模板叙事保留**：`pickNarrative` 机制不依赖 LLM，战斗节奏可控

### 风险点 ⚠️

1. **双路径维护**：`processCombatAction`（旧）和 `processGridAction`（新）并存，两条路径对战斗流程的理解存在偏差（见 Important #4）
2. **状态双重记录**：同一个单位的位置存在于 `MonsterInstance.pos` 和 `grid.units[id].pos` 两处，有同步 bug 风险
3. **序列化设计缺陷**：`CombatGrid` 是 class，不支持直接 JSON 往返（见 Important #7）

---

## 推荐后续工作

按优先级：

1. **P0**：修复 `grid_spell` 路径的网格事件丢失（Important #4）
2. **P0**：实现盟友网格 AI（Important #6）——不然盟友视觉上"不动"很突兀
3. **P1**：实现 Spell.gridRange 校验（Important #5）——不然玩家可以全图施法
4. **P1**：存档/恢复支持网格（Important #7）
5. **P2**：消除双路径（Risk #1），统一走 processGridAction
6. **P2**：整理 processCombatAction 中的死代码路径（`combat_grid_attack` 事件、未用 imports 等）
7. **P3**：添加怪物 AI 移动的单测（Minor #14）
8. **P3**：用 Dijkstra 替换 BFS 在 `findPath`（Minor #8）——仅在发现实际 bug 后再改

---

## 总体评分

| 维度 | 评分 | 说明 |
|-----|-----|------|
| 功能完整度 | 7/10 | 核心玩法闭环，但盟友 AI 和法术路径有缺口 |
| 代码质量 | 7/10 | 结构清晰，但有双路径维护风险 |
| 测试覆盖 | 6/10 | 单测扎实，集成测试本次新增，尚无 e2e |
| 文档质量 | 9/10 | 设计文档 + 实施规划 + 本审查都齐全 |
| 向后兼容 | 9/10 | 旧存档、旧战斗流程完全不受影响 |

**整体可以 ship 用于测试**，但上线前建议至少修复 Important #4（grid_spell 丢事件）和 Important #6（盟友 AI）—— 这两个影响玩家体感明显的"不合理"感。
