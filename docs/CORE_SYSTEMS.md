# 核心底层系统设计文档

> 本文档记录信任度、战斗、交易三个核心系统的底层机制、数据流、边界情况。
> **目标**：避免反复在同一个地方踩坑。修改这三个系统前必须先读本文档。

---

## 一、信任度系统

### 核心规则

- **范围**：-10 到 +10
- **唯一入口**：所有信任度变化必须通过 `changeTrust()` 函数（`trust-system.ts`）
- **连坐机制**：`cascadeReputation()` 会将负面信任传播给 bond NPC

### Channel 类型与传播行为

| Channel | 是否触发连坐 | 用途 | 典型调用方 |
|---------|------------|------|-----------|
| `dialogue` | **是** | NPC 对话中的信任变化 | Talk 工具、ChangeTrust 工具 |
| `action` | **是** | 玩家行动判定 | Rules Agent |
| `gift` | **是** | 物品交换 | TransferItem |
| `quest` | **是** | 任务完成奖励 | QuestManager |
| `promise` | **是** | 承诺过期惩罚 | engine.ts 承诺追踪 |
| `witness` | **是** | 目击暴力事件 | propagateViolenceTrust |
| `reputation` | **否** | 关系网传播/暴力直接后果 | cascadeReputation、attack.ts、combat-manager.ts |
| `combat` | **已废弃** | 不再使用 | — |

**关键设计决策**：

所有暴力相关的 `changeTrust` 必须使用 `reputation` channel，原因：
- 攻击 NPC 时只降低**当事人**的信任度
- **全镇传播**由 `violence_alert` 延迟后的 `propagateViolenceTrust` 统一处理
- 如果用其他 channel，会立即触发 `cascadeReputation`，跳过延迟机制

**踩坑记录**：
- 曾经 attack.ts 和 combat-manager.ts 使用 `channel: 'combat'`，导致攻击叶绿时艾琳娜信任度立即暴跌 -8
- 修复：所有暴力场景统一改为 `channel: 'reputation'`

### changeTrust 处理流程

```
输入 → 永久仇恨检查 → 反垃圾保护 → 章节上限衰减 → 应用变化 → 连坐传播
```

1. **永久仇恨**：`permanentGrudges` 数组匹配 `grudgeTag` 时，强制 trust = -10，永不可恢复
2. **反垃圾保护**：trust < -2 时，gift channel 的 delta ≤ 1 会被拒绝
3. **章节上限**：超过 `trustCeiling[chapter]` 后，增长衰减为 1/3（向下取整，可能为 0）
4. **连坐传播**：`channel !== 'reputation'` 且 `delta < 0` 时触发，传播量 = `delta * bond.weight`

### 信任度传播的两条路径

**路径 A：即时连坐（cascadeReputation）**
```
changeTrust(NPC, delta<0, channel≠reputation)
  → cascadeReputation()
    → 对每个 bond NPC: changeTrust(bond, delta*weight, channel=reputation)
```
- 适用于：对话中得罪 NPC、承诺过期等日常场景
- 传播范围：仅 bond NPC

**路径 B：延迟传播（violence_alert → propagateViolenceTrust）**
```
玩家攻击 NPC → violence_alert 设置（延迟 1-9 轮）
  → 响应者到达 → propagateViolenceTrust()
    → 受害者 bond NPC: -8 到 -10
    → 响应者 bond NPC: -8 到 -9
    → 目击者: -6
    → 其他镇民: -4
```
- 适用于：暴力事件
- 传播范围：全镇
- 防重复：`trustCascadeTriggered` 标志

### 梯度响应（evaluateResponse）

| 信任度范围 | 响应类型 | NPC 行为 |
|-----------|---------|---------|
| ≤ combat 阈值 | `combat_trigger` | 攻击/召唤守卫/逃跑/报复 |
| ≤ avoidance | `avoidance` | 转身离开 |
| ≤ hostile | `hostile_dialogue` | 充满敌意但回应 |
| ≤ curt | `curt` | 冷淡简短 |
| > curt | `normal` | 正常友好 |

**注意**：每个 NPC 的阈值不同（npc-relationships.ts），格罗姆的 combat 阈值是 -5，艾琳娜是 -9。

---

## 二、战斗系统

### 战斗触发的三种路径

| 路径 | 触发方式 | 代码位置 |
|------|---------|---------|
| 玩家主动攻击 | `attack.ts` → `startCombat()` | attack.ts L88 |
| NPC 敌对自动触发 | `checkHostileNPCs()` → `startCombat()` | engine.ts L165 |
| 暴力后果响应 | `violence_alert` → `pendingCombatInterrupt` | engine.ts L1383 |

### 攻击 NPC 的完整流程

```
玩家输入"攻击叶绿"
  → rules-agent 分类为 ATTACK
  → attack.ts 执行：
    1. 检查 NPC 存在、状态、位置
    2. changeTrust(叶绿, -5, channel=reputation)  ← 不触发连坐
    3. 检查护卫机制（NPC_GUARDS 配置）
    4. startCombat([combatNames], allDb)
    5. 设置 violence_alert（延迟 1-9 轮）
```

### 护卫机制

```typescript
NPC_GUARDS = {
  '维克多': { shields: ['镇长府卫兵', '韩猛'], canFightSelf: false },
  '艾琳娜': { shields: ['韩猛'], canFightSelf: true },
  '小莉':   { shields: ['格雷格'], canFightSelf: false },
}
```

护卫必须：同一位置 + 同一子地点 + 状态正常（非 unconscious/recovering）

### Violence Alert 延迟响应

**延迟计算**：
```
基础 5 轮
+ 夜间 4 / 傍晚 2
- 有目击者 3
- 平民目击 1
- 受害者有 bond≥1.0 的战斗型 NPC 2
- 同子地点战斗型 NPC 目击 → delay = 0（当场反应）
最少 1 轮
```

**4 阶段响应**：

| 阶段 | 时机 | 动作 |
|------|------|------|
| 预警 | delay - 1 轮 | narrative_warning（脚步声接近） |
| 响应者到达 | delay 轮 | 确定响应者、触发信任度传播、NPC 移动到现场 |
| 战斗准备 | 到达后 1 轮 | DM 描写质问场景，标记 pendingCombatInterrupt |
| 战斗开始 | 下一轮 | DM 叙事后自动 startCombat |

**响应者优先级**：
```
同一子地点: +10
受害者 bond NPC: +5 + weight*3
守卫: +3
有追踪能力: +2
```

### 逃跑机制

```
DC = 对手中最高的 fleeDC（npc-combatants.json）
    回退到 AC → 回退到 10
检定 = d20 + DEX mod ≥ DC
```

各 NPC fleeDC：小莉(5) < 维克多(6) < 陈妈(8) < 叶绿(10) < 格罗姆(12) < 卫兵(13) < 格雷格(14) < 韩猛(16) = 卡恩(16) < 艾琳娜(18)

### NPC 状态转换

```
normal → (被击败) → unconscious → (recoveryTurns轮) → recovering → (recoveryTurns轮) → wounded → (recoveryTurns轮) → normal
```

### 首次击败无辜 NPC

- 判定条件：`session.npcs.some(n => n.name === target.name)`（是镇上居民）
- 只触发一次：`session.worldState.flags['first_innocent_kill']`
- 弹出沉浸式提示（`important_warning` 事件）

**踩坑记录**：
- 曾用 `target?.nonlethal` 判断是否无辜，但叶绿等 NPC 的 nonlethal=false
- nonlethal 是"击晕 vs 击杀"的战斗行为，不等于"是否无辜"
- 修复：改为检查 session.npcs 是否包含该目标

---

## 三、交易系统

### 交易卡片生命周期

```
DM 调用 ProposeTradeAction
  → pendingTrade 写入
  → engine 消费：consumeTradeProposal()
  → yield trade_proposal 事件
  → yield dm_end（hasPendingTrade=true）
  → 前端：显示交易卡片 + 锁定输入框

玩家操作（三选一）：
  确认 → server: 执行 TransferItem + 发送 dm_end 解锁
  取消 → server: clearBargain + 发送 dm_end 解锁
  砍价 → server: 调用 engine.processBargain → DM 回应新报价
```

### 输入锁定机制

**问题**：事件顺序是 `trade_proposal`（锁定）→ `dm_end`（解锁），dm_end 会把锁打开

**解决方案**：`dm_end` 事件携带 `hasPendingTrade` 标记
```
dm_end.hasPendingTrade = true → 前端不 unlockInput()
dm_end.hasPendingTrade = false/undefined → 前端正常 unlockInput()
```

**踩坑记录**：
- 曾在 trade_proposal 事件中锁定，但 dm_end 紧随其后解锁
- 修复：dm_end 中带 hasPendingTrade 标记，前端判断后决定是否解锁

### 砍价流程

```
bargainState = { npc, items, lastPrice, round: 0 }

第 1 轮砍价：
  玩家点"砍价" → 输入框解锁 → 玩家打字 → 发送 bargain 消息
  → engine.processBargain() → DM 决定是否降价
  → DM 调用 ProposeTradeAction(newPrice, canBargain=true/false)
  → 新交易卡片弹出

第 2 轮砍价：
  同上，但 DM prompt 中提示"这是最后一轮"
  → DM 必须设 canBargain=false

超过 2 轮：
  bargainState = null，回到普通输入模式
```

### 交易确认/取消不触发 DM 叙事

**设计决策**：确认和取消是简单操作，不需要等 LLM 调用（20-50 秒）
- 确认：执行 TransferItem + 发送 item_acquired + dm_end
- 取消：clearBargain + dm_end
- 砍价：仍然需要 DM 叙事（NPC 根据性格回应）

---

## 四、暴力后果与追踪系统

### 设计原则

暴力后果是一条**时间线**，不是一个瞬时事件。玩家的暴力行为会随时间产生层层扩散的后果：

```
攻击 NPC → [延迟] → 发现 → [信任传播] → 追踪/对峙 → 战斗
```

每个环节由不同的代码模块控制，DM 只负责叙事包装。

### 数据结构：violence_alert

存储在 `session.worldState.flags['violence_alert']`（JSON 字符串）：

```typescript
{
  triggerTurn: number        // 暴力发生的回合
  victimName: string         // 受害者名字
  location: string           // 暴力发生的区域（会随追踪更新）
  subLocation: string        // 暴力发生的子地点（会随追踪更新）
  delay: number              // 延迟轮数（动态调整）
  responded: boolean         // 是否已完成响应
  forceResponder?: string    // 强制指定的响应者（call_guards 时设置）
  witnesses: string[]        // 目击者列表（用于信任度传播）
  arrivedResponder?: string  // 已到达的响应者名字
  immediateResponse?: boolean // 当场目击，无延迟
  trustCascadeTriggered?: boolean  // 防重复传播
  trackingAttempted?: boolean // 是否已尝试跨区域追踪
  trackingFailed?: boolean   // 追踪是否失败
  intraAreaChase?: boolean   // 是否已触发同区域追击
  combatJustStarted?: string // 标记战斗待触发
}
```

### 完整时间线

#### 第 0 轮：暴力发生

**触发位置**：`engine.ts` processTurn 中，ATTACK 预执行成功后

```
玩家攻击 NPC
  → changeTrust(victim, -5, channel=reputation)  ← 只影响当事人
  → startCombat()
  → 创建 violence_alert：
    基础延迟 5 轮
    + 夜间 4 / 傍晚 2
    - 有目击者 3
    - 平民目击 1
    - 受害者有 bond≥1.0 的战斗型 NPC 2
    - 同子地点战斗型 NPC 目击 → delay = 0
    最少 1 轮
```

**关键设计**：`channel: 'reputation'` 不触发 cascadeReputation，全镇传播延后处理。

#### 第 1~N 轮：玩家逃跑检测

**触发位置**：`engine.ts` processTurn 开头的暴力后果检查

每轮开始时检查玩家是否离开了暴力现场：

**同区域逃跑**（草药堂→酒馆）：
```
条件：currentLocation === alert.location 且 currentSubLocation !== alert.subLocation
行为：不需要 canTrack，追击延迟 +1 轮
标记：alert.intraAreaChase = true
叙事：narrative_warning "身后传来急促的脚步声和怒喊"
```

**跨区域逃跑**（镇→森林）：
```
条件：currentLocation !== alert.location
检查：是否有 canTrack=true 的战斗型 NPC
  有追踪者 + 区域可达 → 追踪延迟 +2 轮，更新目标位置
  有追踪者 + 区域不可达（矿道深处）→ 追踪失败
  无追踪者 → 追踪失败
标记：alert.trackingAttempted = true
```

**不可追踪区域**：`abandoned-barracks`, `abyss-altar`, `void-prism`（矿道深处）

#### 第 N 轮：预警

**条件**：`elapsed === delay - 1` 且 `delay >= 2`

```
个性化预警（如果有 arrivedResponder）：
  韩猛："站住！懦夫！"
  艾琳娜："跑不掉的。"
  格雷格：沉重脚步声 + 杀意
  卡恩：背后寒意
通用预警："远处传来急促的脚步声"
```

#### 第 N+1 轮：阶段 1 — 发现

**条件**：`elapsed >= delay` 且 `!arrivedResponder`

**响应者选择**（优先级评分）：
```
同一子地点:          +10
受害者 bond NPC:     +5 + weight*3
守卫:                +3
canTrack:            +2
```

**发现阶段只做两件事**：
1. 响应者移动到受害者处（`moveNPC`）
2. 触发信任度传播（`propagateViolenceTrust`，`trustCascadeTriggered` 防重复）

**不触发战斗** — 战斗由下一步决定。

#### 第 N+1 轮（续）：阶段 2 — 对峙或追踪

**取决于玩家是否在场**：

| 玩家位置 | 行为 | 结果 |
|---------|------|------|
| 在暴力现场 | `pendingCombatInterrupt` | DM 叙事后自动触发战斗 |
| 同区域其他子地点 | 追击（+1 轮） | 下轮触发战斗 |
| 不同区域 | 跨区域追踪（+2 轮，需 canTrack） | 追踪到达后触发战斗 |
| 不可追踪区域 | 追踪失败 | `alert.responded = true` |

#### DM 注入文本

**玩家在场**：
```
[世界事件：{响应者}赶到现场！{受害者}目前状态：{condition}。
描写{响应者}到达——脚步声、质问、愤怒。
这一轮只描写到达，不要描写攻击动作，下一轮战斗才开始。]
```

**玩家不在场**：
```
[世界事件：{受害者}的遭遇被发现了。{响应者}赶到了{受害者}身边。
消息正在镇上传开。不需要描写镇上的情景——
只需让玩家感受到远处的不安氛围（犬吠、飞鸟惊起、风中隐约的喊声）。]
```

### 追踪机制详解

#### canTrack 配置

| NPC | canTrack | 理由 |
|-----|----------|------|
| 格雷格 | true | 前佣兵，有追踪经验 |
| 艾琳娜 | true | 高等精灵，感知敏锐 |
| 韩猛 | true | 退役战士，追踪专家 |
| 卡恩 | true | 教团成员（不轻易暴露） |
| 格罗姆 | false | 矮人铁匠，不离开铺子 |
| 小莉 | false | 孩子 |
| 叶绿 | false | 草药师 |
| 维克多 | false | 文官 |
| 陈妈 | false | 普通镇民 |

#### 追踪的三种情况

```
1. 同区域追击（不需要 canTrack）
   草药堂 → 酒馆：响应者直接追过去，+1 轮

2. 跨区域追踪（需要 canTrack）
   镇 → 森林：追踪者锁定方向，+2 轮
   镇 → 荒原：同上
   
3. 追踪失败
   逃到矿道深处（不可追踪区域）
   无 canTrack 的 NPC 可用
```

#### 追踪中玩家再次移动

```
已在追踪中 + 玩家再次移动到可追踪区域
  → 追踪延迟 +2 轮（追踪者重新定位）
  → 更新目标位置

已在追踪中 + 玩家移到不可追踪区域
  → 追踪失败
```

### NPC 回避机制（avoidance）

信任度达到 avoidance 阈值时的 NPC 行为，**根据战斗能力区分**：

| NPC 类型 | canFight | avoidance 行为 |
|---------|----------|---------------|
| 战斗型 | true | `hostile_dialogue`（敌对质问，不逃跑） |
| 非战斗型 | false | `avoidance`（逃到 homeBase 或广场） |

**回避目的地**：
- 如果 homeBase ≠ 玩家当前位置 → 回到 homeBase
- 如果 homeBase = 玩家当前位置 → 逃到 town-square

### 踩坑记录

1. **channel: 'combat' 导致即时传播**
   - 攻击/击败 NPC 时用 `channel: 'combat'` 会触发 cascadeReputation
   - 导致全镇信任度瞬间崩塌，跳过延迟机制
   - **修复**：所有暴力相关统一用 `channel: 'reputation'`

2. **同区域逃跑不触发追踪**
   - 旧代码只检查 `currentLocation !== alert.location`（跨区域）
   - 草药堂→酒馆属于同区域不同子地点，追踪逻辑不运行
   - **修复**：增加 `intraAreaChase` 分支处理同区域追击

3. **跨区域追踪没检查 canTrack**
   - `canTrackAcrossLocations` 只检查路径连通性，不检查 NPC 能力
   - 即使没有追踪能力的 NPC 也能跨区域追踪
   - **修复**：在追踪前检查 `getPersonality(npc).canTrack`

4. **avoidance 逃到 homeBase 就是当前位置**
   - 艾琳娜的 homeBase 是公会，玩家到公会时 avoidance 移动到公会 = 原地不动
   - **修复**：homeBase = 当前位置时，改为逃到 town-square

5. **战斗型 NPC 不应该回避**
   - 艾琳娜（340 岁公会会长）看到攻击挚友的人"匆匆离开"不合理
   - **修复**：canFight=true 的 NPC 在 avoidance 区间改为 hostile_dialogue

6. **世界事件注入文本假设玩家在场**
   - "描写{响应者}对玩家的质问"但玩家可能已逃离
   - DM 不知道怎么处理：跳切到镇上场景？违反禁止跳切规则
   - **修复**：根据玩家是否在场注入不同文本

### 修改检查清单

- [ ] 暴力相关的 changeTrust 必须用 `reputation` channel
- [ ] 追踪逻辑是否覆盖同区域和跨区域两种情况
- [ ] 跨区域追踪是否检查了 canTrack 能力
- [ ] 世界事件注入文本是否区分了玩家在场/不在场
- [ ] avoidance 机制是否区分了战斗型/非战斗型 NPC
- [ ] violence_alert 的 JSON 字段是否完整（新字段需要兼容旧存档）

---

## 系统交互边界

### 信任度 → 战斗

```
changeTrust 降低信任 → evaluateResponse 检查阈值
  → combat_trigger → checkHostileNPCs（每轮检查）
    → startCombat（冷却 3 轮内不重复触发）
```

### 战斗 → 信任度

```
攻击 NPC → changeTrust(reputation, -5)         ← 只影响当事人
击败 NPC → changeTrust(reputation, 设为 -10)    ← 只影响当事人
violence_alert 到达 → propagateViolenceTrust    ← 全镇传播
```

### 交易 → 信任度

```
成功购买 → changeTrust(gift, +1)
```

---

## 修改检查清单

### 修改信任度系统前

- [ ] 确认使用的 channel 类型是否正确
- [ ] 暴力相关的 changeTrust 必须用 `reputation` channel
- [ ] 检查是否会意外触发 cascadeReputation
- [ ] 确认 propagateViolenceTrust 的 trustCascadeTriggered 防重复

### 修改战斗系统前

- [ ] 确认 NPC 状态检查（unconscious/recovering）
- [ ] 确认位置检查（location + subLocation）
- [ ] 确认护卫机制的级联逻辑
- [ ] 检查 violence_alert 的延迟计算是否合理

### 修改交易系统前

- [ ] 确认 hasPendingTrade 标记正确传递
- [ ] 确认 bargainState 在所有退出路径上被清理
- [ ] 确认 consumeTradeProposal 不会被重复消费

---

## 维护说明

**本文档应在以下情况更新**：
- 新增或修改 changeTrust 的 channel 类型
- 修改 violence_alert 延迟计算逻辑
- 修改交易卡片的事件流
- 发现新的边界情况或踩坑记录
