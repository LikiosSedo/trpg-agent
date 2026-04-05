# TRPG Agent 系统架构文档

> 本文档记录项目的底层组件、调用链路、消费者模式、常见陷阱。  
> **目标**：为后续 AI 开发提供准确的技术参考，避免重复踩坑。

---

## 目录

1. [核心架构](#核心架构)
2. [消费者模式组件](#消费者模式组件)
3. [工具静音机制](#工具静音机制)
4. [事件系统](#事件系统)
5. [关键组件映射](#关键组件映射)
6. [常见陷阱与检查清单](#常见陷阱与检查清单)

---

## 核心架构

### 架构概览

```
┌─────────────┐
│   玩家输入   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────┐
│          GameEngine (engine.ts)          │
│  ┌────────────────────────────────────┐ │
│  │  processTurn(input)                │ │
│  │  ├─ 安全检查 (safety.ts)            │ │
│  │  ├─ 意图分类 (rules-agent.ts)      │ │
│  │  ├─ 动作执行 (action-executor.ts)  │ │
│  │  ├─ DM 叙事 (dm-agent.ts)          │ │
│  │  └─ 消费副作用 (consume*)          │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
       │
       ├─ 读写 GameSession (game-state.ts)
       ├─ 调用 DM Agent (dm-agent.ts)
       └─ 发送事件流 (TurnEvent)
```

### 三层管道设计

| 层级 | 组件 | 职责 |
|------|------|------|
| **规则层** | rules-agent.ts, action-executor.ts | 意图分类、动作预执行、数值计算 |
| **叙事层** | dm-agent.ts, DM Agent (LLM) | 生成叙事文本、调用工具、推进剧情 |
| **副作用层** | consume* 函数 | 收集工具调用的副作用（选项、信任变化、音频等） |

**关键原则**：
- 规则层保证数值正确性（HP、金币、战斗判定）
- 叙事层保证沉浸感（文本质量、NPC 对话）
- 副作用层保证状态一致性（消费后清空，避免泄漏）

---

## 消费者模式组件

项目中多个组件使用 **"写入-消费-清空"** 的单次消费模式，避免状态在多轮之间泄漏。

### 1. SetActions（场景选项）⭐

**文件**：`src/tools/set-actions.ts`

**机制**：
```typescript
let pendingActions: SceneActions | null = null

export function consumeActions(): SceneActions | null {
  const a = pendingActions
  pendingActions = null  // 消费后清空
  return a
}

export const SetActionsTool: Tool = {
  async execute(input: any) {
    pendingActions = { details: [...], suggestions: [...] }
    return { output: '已设置选项' }
  }
}
```

**消费点**（engine.ts）：
- `1675` - 普通回合结束
- `2074` - 战斗回合结束
- `2157` - 战斗叙事后（combat_narrative_actions）
- `2165` - finally 兜底清理
- `2539` - 开场叙事后

**调用链路**：
```
DM Agent 调用 SetActions
  ↓
pendingActions 写入
  ↓
engine.ts:consumeActions() 读取
  ↓
yield { type: 'dm_end', actions }
  ↓
server.ts:205 发送到前端
  ↓
index.html:2635 渲染按钮
```

**陷阱**：
- ❌ 忘记在 finally 块中消费 → 下一轮会读到旧选项
- ❌ 工具静音时禁用 SetActions → DM 无法生成选项

---

### 2. ChangeTrust（信任变化）

**文件**：`src/tools/change-trust.ts`

**机制**：
```typescript
let pendingChanges: TrustChange[] = []

export function consumeTrustChanges(): TrustChange[] {
  const changes = pendingChanges
  pendingChanges = []
  return changes
}
```

**消费点**：`engine.ts:1669` - 每回合结束后批量处理信任变化

**用途**：DM 可以在一轮中多次调用 ChangeTrust，engine 统一处理并触发级联效应（trust-system.ts）

---

### 3. SpeakingNPCs（对话 NPC）

**文件**：`src/tools/talk.ts`

**机制**：
```typescript
let speakingNPCs: Set<string> = new Set()

export function consumeSpeakingNPCs(): string[] {
  const npcs = Array.from(speakingNPCs)
  speakingNPCs.clear()
  return npcs
}
```

**消费点**：`engine.ts:1664` - 更新 `session.interactionNpc`（用于交易/对话状态绑定）

---

### 4. TradeProposal（交易提案）

**文件**：`src/tools/propose-trade.ts`

**机制**：DM 调用 ProposeTradeAction 后，engine 消费并发送 `trade_proposal` 事件到前端

**消费点**：`engine.ts:1680` - 每回合结束后检查

---

### 5. AmbianceOverride（音频覆盖）

**文件**：`src/tools/set-ambiance.ts`

**机制**：DM 在关键剧情节点（BOSS战、揭秘、牺牲）调用 SetAmbiance 覆盖默认 BGM

**消费点**：`engine.ts:1686` - 每回合结束后发送 `audio` 事件

---

### 6. GameOver（游戏终局）

**文件**：`src/tools/game-over.ts`

**机制**：DM 在剧情到达死胡同时调用，弹出"重新开始/坚持继续"选择

**消费点**：`engine.ts:1692` - 每回合结束后检查

---

### 消费者模式设计总结

**优点**：
- 工具调用和消费解耦（工具只负责写入，engine 负责消费）
- 避免状态在多轮之间泄漏
- 单一职责：工具 = 副作用声明，engine = 副作用执行

**注意事项**：
- ✅ 必须在每个可能的退出路径上消费（包括 catch/finally）
- ✅ 消费函数是幂等的（多次调用返回 null/[]/空）
- ❌ 不要在工具内部消费（会导致 engine 读不到）
- ❌ 不要在 DM prompt 中提及消费逻辑（DM 只需要知道工具的功能）

---

## 工具静音机制

### 实现原理

**文件**：`src/dm-agent.ts:101-131`

```typescript
let mutedTools: Map<string, any> | null = null

export function muteDMTools(keep: string[] = ['SetActions']): void {
  if (!agent) return
  if (mutedTools) return  // 防止重复静音
  
  const registry = (agent as any).tools
  const keepSet = new Set(keep)
  mutedTools = new Map()
  
  // 遍历所有工具，不在白名单里的移除并暂存
  for (const [name, tool] of registry.tools) {
    if (!keepSet.has(name)) {
      mutedTools.set(name, tool)
    }
  }
  for (const name of mutedTools.keys()) {
    registry.tools.delete(name)
  }
}

export function unmuteDMTools(): void {
  if (!agent || !mutedTools) return
  const registry = (agent as any).tools
  for (const [name, tool] of mutedTools) {
    registry.tools.set(name, tool)
  }
  mutedTools = null
}
```

### 使用场景

| 场景 | 保留工具 | 原因 | 调用位置 |
|------|---------|------|---------|
| 战斗叙事 | SetActions | 只需要生成文本 + 后续选项 | engine.ts:2138 |
| 战斗开场 | SetActions | 描写怪物出现 + 战斗氛围 | engine.ts:1845 |
| 逃跑成功 | SetActions | 描写逃跑过程 + 脱离危险 | engine.ts:2322 |
| 战斗胜利 | SetActions | 描写最后一击 + 战利品场景 | engine.ts:2364 |

### 陷阱与修复

**陷阱 1：忘记 unmute**
```typescript
// ❌ 错误示例
muteDMTools()
yield* dmRespond(...)
// 忘记 unmute，后续 DM 调用会失败

// ✅ 正确示例
muteDMTools()
try {
  yield* dmRespond(...)
} finally {
  unmuteDMTools()  // 确保恢复
}
```

**陷阱 2：空白名单禁用 SetActions**
```typescript
// ❌ 问题代码
muteDMTools([])  // 禁用所有工具，包括 SetActions

// ✅ 修复方案（建议在 dm-agent.ts 中强制保留）
export function muteDMTools(keep: string[] = ['SetActions']): void {
  // 强制保留 SetActions（即使调用方传入空数组）
  const keepSet = new Set([...keep, 'SetActions'])
  // ...
}
```

---

## 事件系统

### TurnEvent 类型定义

**文件**：`src/engine.ts:252-262`

```typescript
export type TurnEvent =
  | { type: 'broken_promise'; npcName: string; reason: string }
  | { type: 'safety_block'; reason: string }
  | { type: 'dm_text_delta'; text: string }
  | { type: 'dm_end'; combat: boolean; pendingMonster: boolean; actions: SceneActions | null }
  | { type: 'dm_error'; message: string }
  | { type: 'combat_monster'; text: string }
  | { type: 'combat_status'; text: string; ended: boolean; result?: string }
  | { type: 'combat_init'; monsters: any[]; round: number; initiative: any[] }
  | { type: 'combat_action_req'; targets: any[]; spells: any[]; items: any[] }
  | { type: 'quest_completed'; questName: string; text: string }
  | { type: 'sync'; session: GameSession; dossier: any; questHint: string }
  | { type: 'audio'; bgm: string; ambient: string }
  | { type: 'trade_proposal'; proposal: TradeProposal }
  | { type: 'game_over'; data: GameOverData }
  | { type: 'combat_narrative'; text: string }
  | { type: 'combat_narrative_actions'; actions: SceneActions }
  | { type: 'death' }
  // ... 更多事件类型
```

### 事件流转

```
GameEngine.processTurn(input)
  ↓
yield* 生成器函数（流式输出）
  ↓
for await (const event of engine.processTurn(...))
  ↓
server.ts:200-250 (WebSocket)
  ↓
index.html:2600-2950 (前端处理)
```

### 关键事件说明

| 事件类型 | 触发时机 | 前端处理 |
|---------|---------|---------|
| `dm_text_delta` | DM 生成文本（流式） | 逐字显示 |
| `dm_end` | DM 回合结束 | 解锁输入框 + 渲染选项 |
| `combat_init` | 战斗开始 | 显示战斗面板 + 怪物立绘 |
| `combat_action_req` | 等待玩家战斗操作 | 显示攻击/防御/逃跑按钮 |
| `combat_status` | 战斗回合结果 | 显示伤害/命中文本 |
| `sync` | 状态同步 | 更新 HUD（HP/金币/XP） |
| `audio` | 音频切换 | 切换 BGM/环境音 |
| `trade_proposal` | 交易提案 | 弹出交易卡片 |
| `game_over` | 游戏终局 | 弹出重新开始/继续选择 |

---

## 关键组件映射

### 核心流程组件

| 组件 | 文件 | 职责 | 依赖 |
|------|------|------|------|
| GameEngine | `src/engine.ts` | 游戏主循环、回合处理、事件流 | dm-agent, game-state, combat-manager |
| DM Agent | `src/dm-agent.ts` | LLM 驱动的地下城主 | open-claude-cli, tools |
| GameFactStore | `src/game-facts.ts` | 游戏状态管理 + 事实存储 | types, game-state |
| CombatManager | `src/combat-manager.ts` | 战斗逻辑（先攻、回合、结算） | types, game-state |
| TrustSystem | `src/trust-system.ts` | NPC 信任系统 + 承诺追踪 | types, game-state |
| ChapterManager | `src/chapter-manager.ts` | 章节剧本 + beat 触发 | types, game-state |
| DossierManager | `src/dossier.ts` | NPC 档案 + 画像解锁 | types |

### 工具系统

| 工具 | 文件 | 消费者模式 | 用途 |
|------|------|-----------|------|
| SetActions | `src/tools/set-actions.ts` | ✅ consumeActions() | 场景选项（details + suggestions） |
| ChangeTrust | `src/tools/change-trust.ts` | ✅ consumeTrustChanges() | 信任变化（批量处理） |
| Talk | `src/tools/talk.ts` | ✅ consumeSpeakingNPCs() | NPC 对话（更新 interactionNpc） |
| ProposeTradeAction | `src/tools/propose-trade.ts` | ✅ consumeTradeProposal() | 交易提案（弹出卡片） |
| SetAmbiance | `src/tools/set-ambiance.ts` | ✅ consumeAmbianceOverride() | 音频覆盖（关键剧情） |
| GameOver | `src/tools/game-over.ts` | ✅ consumeGameOver() | 游戏终局（重新开始/继续） |
| RenderScene | `src/tools/render-scene.ts` | ❌ | 场景渲染（已废弃，现在用流式输出） |
| Attack | `src/tools/attack.ts` | ❌ | 战斗攻击（不在 DM 工具列表） |
| Move | `src/tools/move.ts` | ❌ | 移动 |
| Search | `src/tools/search.ts` | ❌ | 搜索 |
| UseItem | `src/tools/use-item.ts` | ❌ | 使用物品 |
| Rest | `src/tools/rest.ts` | ❌ | 休息 |

### 前端组件

| 组件 | 文件 | 职责 |
|------|------|------|
| WebSocket 客户端 | `public/index.html:2600-2950` | 接收服务器事件流 |
| 场景选项渲染 | `public/index.html:3174-3230` | showSceneActions() |
| 战斗面板 | `public/index.html:3231-3350` | updateCombatPanel() |
| HUD 更新 | `public/index.html:3351-3450` | updateHUD() |
| 音频系统 | `public/index.html:3500-3650` | BGM + 环境音 + SFX |

---

## 常见陷阱与检查清单

### 1. 工具静音后忘记恢复 ⚠️

**症状**：战斗叙事后，DM 无法调用 Move/Talk/Search 等工具

**原因**：`muteDMTools()` 后没有配对调用 `unmuteDMTools()`

**检查清单**：
- [ ] 所有 `muteDMTools()` 调用都在 try-finally 块中
- [ ] finally 块中必须调用 `unmuteDMTools()`
- [ ] 不要在嵌套函数中重复 mute（代码有防护，但最好避免）

**定位**：搜索 `muteDMTools` 调用点，检查是否有配对的 `unmuteDMTools`

---

### 2. 消费者函数未调用导致状态泄漏 ⚠️

**症状**：上一轮的选项/信任变化影响下一轮

**原因**：`consumeActions()` / `consumeTrustChanges()` 未在所有退出路径上调用

**检查清单**：
- [ ] 正常流程：`engine.ts:1675` 等位置已消费
- [ ] 异常流程：catch 块中是否消费？
- [ ] 提前返回：return 前是否消费？
- [ ] finally 兜底：是否有 finally 块兜底清理？

**定位**：搜索 `consume*` 函数，检查所有调用点

---

### 3. 战斗叙事时传入空白名单 ⚠️

**症状**：DM 无法生成后续选项

**原因**：`muteDMTools([])` 禁用了所有工具，包括 SetActions

**修复**：在 `dm-agent.ts:101` 强制保留 SetActions
```typescript
export function muteDMTools(keep: string[] = ['SetActions']): void {
  const keepSet = new Set([...keep, 'SetActions'])  // 强制保留
  // ...
}
```

---

### 4. 前端 actions 渲染时机错误 ⚠️

**症状**：战斗中显示了场景选项，或场景中显示了战斗面板

**原因**：`dm_end` 事件的 `combat` 标志判断错误

**检查清单**：
- [ ] `index.html:2661` - `if (!combatMode) showSceneActions(msg.actions)`
- [ ] 确保 `combatMode` 与 `msg.combat` 同步
- [ ] 战斗开始时设置 `combatMode = true`
- [ ] 战斗结束时设置 `combatMode = false`

---

### 5. 工具注册顺序问题 ⚠️

**症状**：某些工具在 DM prompt 中不可见

**原因**：工具未在 `dm-agent.ts:69-75` 的 tools 数组中注册

**检查清单**：
- [ ] 新工具已在 `src/tools/index.ts` 中导出
- [ ] 新工具已在 `dm-agent.ts:69` 的 tools 数组中添加
- [ ] 工具名称与 Tool.name 一致

**定位**：
```typescript
// dm-agent.ts:69
tools: [
  DiceTool, MoveTool, LookTool, TalkTool,
  UseItemTool, SearchTool, RestTool,
  RenderSceneTool, TransferItemTool, MoveNPCTool, 
  SetActionsTool, SetAmbianceTool,  // ← 确保在这里
  ChangeTrustTool, ProposeTradeActionTool, 
  TriggerHostileNPCTool, TriggerTrustCascade,
],
```

---

### 6. 战斗后选项生成失败 ⚠️

**完整调用链路**：
```
1. 战斗结束触发
   └─ engine.ts:combatDMNarrative()
      ├─ muteDMTools(['SetActions'])     // 🔇 只保留 SetActions
      ├─ dmRespond(战斗叙事请求)          // DM 生成 2-3 句叙事
      │  └─ DM 调用 SetActions 生成选项
      ├─ consumeActions()                // 🎯 读取选项
      ├─ yield combat_narrative_actions  // 发送到前端
      └─ unmuteDMTools()                 // 🔊 恢复所有工具

2. 事件流转到前端
   └─ server.ts:205
      └─ send('dm_end', { actions })

3. 前端渲染
   └─ index.html:2635 (case 'dm_end')
      └─ showSceneActions(msg.actions)
```

**检查清单**：
- [ ] `muteDMTools()` 默认保留 SetActions
- [ ] DM prompt 中提示调用 SetActions
- [ ] `consumeActions()` 在 finally 块中兜底
- [ ] 前端 `!combatMode` 判断正确

---

### 7. 新工具开发检查清单 ✅

开发新工具时，按以下步骤检查：

1. **工具定义**（`src/tools/your-tool.ts`）
   - [ ] Tool.name 清晰描述功能
   - [ ] Tool.description 包含使用时机和示例
   - [ ] inputSchema 使用 zod 定义参数
   - [ ] execute() 函数实现逻辑

2. **消费者模式**（如果需要）
   - [ ] 定义 `let pending*` 变量
   - [ ] 导出 `consume*()` 函数
   - [ ] execute() 中写入 pending 变量
   - [ ] 在 engine.ts 中添加消费点

3. **工具注册**
   - [ ] 在 `src/tools/index.ts` 中导出
   - [ ] 在 `dm-agent.ts:69` 的 tools 数组中添加

4. **测试**
   - [ ] 手动测试工具调用
   - [ ] 检查消费点是否正确触发
   - [ ] 检查前端事件处理（如果需要）

---

## 扩展阅读

- [章节系统设计](./CHAPTER_SYSTEM.md)
- [战斗系统设计](./COMBAT_SYSTEM.md)
- [信任系统设计](./TRUST_SYSTEM.md)
- [工具开发指南](./TOOL_DEVELOPMENT.md)

---

## 维护说明

**本文档应在以下情况更新**：
- 新增消费者模式组件
- 修改工具静音机制
- 新增事件类型
- 发现新的陷阱或最佳实践

**维护者**：请在修改底层机制时同步更新本文档，确保后续 AI 开发有准确的参考。
