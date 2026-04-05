# 架构文档映射完成总结

## 完成的工作

### 1. 战斗后选项生成机制完整调用链路

**问题场景**：战斗叙事时使用 `muteDMTools()` 全部清空了工具，导致 `SetActionsTool` 也被禁用。

**完整调用链路**（已文档化）：
```
engine.ts:combatDMNarrative()
  ├─ muteDMTools(['SetActions'])     // 🔇 只保留 SetActions
  ├─ dmRespond(战斗叙事请求)          // DM 生成叙事 + 调用 SetActions
  ├─ consumeActions()                // 🎯 读取选项
  ├─ yield combat_narrative_actions  // 发送到前端
  └─ unmuteDMTools()                 // 🔊 恢复所有工具
```

**关键文件定位**：
- `src/tools/set-actions.ts:26-58` - SetActionsTool 定义
- `src/dm-agent.ts:101-131` - muteDMTools/unmuteDMTools 实现
- `src/engine.ts:2135-2167` - combatDMNarrative 流程
- `src/engine.ts:1675, 2074, 2157, 2165, 2539` - consumeActions 调用点
- `public/index.html:2635-2661` - 前端 dm_end 处理
- `public/index.html:3174-3230` - showSceneActions 渲染

---

### 2. 系统性扫描所有底层复用组件

#### 消费者模式组件（6个）

| 组件 | 文件 | 消费函数 | 用途 |
|------|------|---------|------|
| SetActions | `tools/set-actions.ts` | `consumeActions()` | 场景选项（details + suggestions） |
| ChangeTrust | `tools/change-trust.ts` | `consumeTrustChanges()` | 信任变化（批量处理） |
| SpeakingNPCs | `tools/talk.ts` | `consumeSpeakingNPCs()` | NPC 对话（更新 interactionNpc） |
| TradeProposal | `tools/propose-trade.ts` | `consumeTradeProposal()` | 交易提案（弹出卡片） |
| AmbianceOverride | `tools/set-ambiance.ts` | `consumeAmbianceOverride()` | 音频覆盖（关键剧情） |
| GameOver | `tools/game-over.ts` | `consumeGameOver()` | 游戏终局（重新开始/继续） |

#### 工具静音机制

- **文件**：`src/dm-agent.ts:101-131`
- **用途**：战斗叙事、战斗开场、逃跑成功等场景临时禁用大部分工具
- **陷阱**：忘记 unmute、空白名单、重复 mute

#### 事件系统

- **类型定义**：`src/engine.ts:252-262` (TurnEvent)
- **关键事件**：dm_end, combat_init, combat_action_req, sync, audio, trade_proposal, game_over
- **流转路径**：GameEngine → server.ts → WebSocket → index.html

#### 核心管理器

- GameEngine (`engine.ts`) - 游戏主循环
- GameFactStore (`game-facts.ts`) - 状态管理
- CombatManager (`combat-manager.ts`) - 战斗逻辑
- TrustSystem (`trust-system.ts`) - 信任系统
- ChapterManager (`chapter-manager.ts`) - 章节剧本
- DossierManager (`dossier.ts`) - NPC 档案

---

### 3. 常见陷阱与检查清单

已文档化 7 个常见陷阱：

1. **工具静音后忘记恢复** - 后续 DM 调用会缺失工具
2. **消费者函数未调用导致状态泄漏** - 上一轮状态影响下一轮
3. **战斗叙事时传入空白名单** - 禁用所有工具包括 SetActions
4. **前端 actions 渲染时机错误** - 战斗/场景状态混乱
5. **工具注册顺序问题** - 工具在 DM prompt 中不可见
6. **战斗后选项生成失败** - 完整调用链路检查
7. **新工具开发检查清单** - 3 步骤 11 个检查点

---

### 4. 文档输出

#### 主文档：`docs/ARCHITECTURE.md`

**内容结构**：
1. 核心架构（三层管道设计）
2. 消费者模式组件（6 个组件详解）
3. 工具静音机制（实现原理 + 使用场景）
4. 事件系统（TurnEvent 类型 + 流转路径）
5. 关键组件映射（核心流程 + 工具系统 + 前端组件）
6. 常见陷阱与检查清单（7 个陷阱 + 修复方案）

**特点**：
- 完整的调用链路图
- 精确的文件行号定位
- 代码示例（正确 vs 错误）
- 检查清单（可直接使用）

#### 项目配置：`CLAUDE.md`

已将关键内容加入项目 CLAUDE.md：
- 三层管道设计原则
- 消费者模式组件表格
- 工具静音机制使用方法
- 常见陷阱检查清单（4 个最关键的）
- 新工具开发检查清单
- 关键文件定位表格

**效果**：后续所有 AI 开发都会自动加载这些规则，避免重复踩坑。

---

## 设计亮点

### 1. 消费者模式的统一抽象

所有副作用组件都遵循相同的模式：
```typescript
let pending*: Type | null = null

export function consume*(): Type | null {
  const data = pending*
  pending* = null
  return data
}
```

**优点**：
- 代码一致性高，易于理解和维护
- 避免状态泄漏（消费后自动清空）
- 工具和 engine 解耦（工具只负责写入）

### 2. 工具静音的白名单机制

通过 `muteDMTools(keep: string[])` 实现精细控制：
- 默认保留 SetActions（确保能生成选项）
- 支持自定义白名单（灵活性）
- 暂存被移除的工具（unmute 时恢复）

### 3. 三层管道的职责分离

- **规则层**：数值正确性（HP、金币、战斗判定）
- **叙事层**：沉浸感（文本质量、NPC 对话）
- **副作用层**：状态一致性（消费后清空）

每层职责清晰，互不干扰。

---

## 后续维护建议

### 1. 新增消费者模式组件时

- [ ] 在 `docs/ARCHITECTURE.md` 的"消费者模式组件"章节添加条目
- [ ] 在 `CLAUDE.md` 的表格中添加一行
- [ ] 更新"关键文件定位"表格

### 2. 修改工具静音机制时

- [ ] 更新 `docs/ARCHITECTURE.md` 的"工具静音机制"章节
- [ ] 检查所有 `muteDMTools()` 调用点是否需要调整
- [ ] 更新"常见陷阱"中的相关内容

### 3. 发现新陷阱时

- [ ] 在 `docs/ARCHITECTURE.md` 的"常见陷阱"章节添加
- [ ] 如果是高频陷阱，同步到 `CLAUDE.md`
- [ ] 提供检查清单和修复方案

### 4. 新增事件类型时

- [ ] 更新 `docs/ARCHITECTURE.md` 的"事件系统"章节
- [ ] 在"关键事件说明"表格中添加一行
- [ ] 说明前端如何处理该事件

---

## 验证方法

### 1. 检查消费者模式是否完整

```bash
# 搜索所有 consume 函数
grep -r "export function consume" src/

# 检查每个 consume 函数是否在 engine.ts 中被调用
grep -n "consume" src/engine.ts
```

### 2. 检查工具静音是否配对

```bash
# 搜索所有 muteDMTools 调用
grep -n "muteDMTools" src/engine.ts

# 检查每个调用是否有对应的 unmuteDMTools
# 应该在 try-finally 块中
```

### 3. 检查工具注册是否完整

```bash
# 列出所有工具文件
ls src/tools/*.ts

# 检查是否都在 dm-agent.ts 中注册
grep "tools: \[" src/dm-agent.ts -A 10
```

---

## 总结

✅ **已完成**：
1. 战斗后选项生成机制的完整调用链路分析
2. 系统性扫描所有底层复用组件（消费者模式、工具静音、事件系统、管理器）
3. 整理 7 个常见陷阱和检查清单
4. 创建完整的架构文档（`docs/ARCHITECTURE.md`）
5. 将关键内容加入项目配置（`CLAUDE.md`）

✅ **效果**：
- 后续 AI 开发会自动加载这些规则
- 避免重复踩坑（工具静音、消费者模式、状态泄漏）
- 新工具开发有清晰的检查清单
- 问题定位有精确的文件行号

✅ **可维护性**：
- 文档结构清晰，易于更新
- 提供了维护建议和验证方法
- 代码示例丰富（正确 vs 错误）
