# 物品基础类型系统 + 交易闭环设计

## 一、物品基础类型系统

### 问题
DM 动态创建的物品只有名字和描述，没有底层机械效果。
"治疗药水（叶绿的信任）"在战斗中恢复多少 HP？代码不知道。

### 设计：上层创意 + 底层模板

```
DM 创建物品时提供 itemType
    ↓
系统按 type 自动赋予基础模板属性
    ↓
物品在游戏中按模板属性生效
```

### 基础模板（硬编码）

```typescript
const ITEM_BASE_TEMPLATES: Record<string, { effect: string; defaultBonus: number }> = {
  // 武器
  weapon_basic:  { effect: 'deal 1d6+bonus slashing/piercing', defaultBonus: 0 },
  weapon_good:   { effect: 'deal 1d8+bonus slashing/piercing', defaultBonus: 1 },
  weapon_silver: { effect: 'deal 1d8+bonus+2d6 vs shadow', defaultBonus: 1 },

  // 药水  
  potion_heal:     { effect: 'restore 2d4+bonus HP', defaultBonus: 2 },
  potion_greater:  { effect: 'restore 4d4+bonus HP', defaultBonus: 4 },
  potion_antidote: { effect: 'cure poison', defaultBonus: 0 },
  potion_shadow:   { effect: 'shadow damage resistance 1 hour', defaultBonus: 0 },

  // 护甲
  armor_light:  { effect: 'AC+1', defaultBonus: 1 },
  armor_medium: { effect: 'AC+2', defaultBonus: 2 },
  armor_heavy:  { effect: 'AC+3', defaultBonus: 3 },

  // 任务物品
  quest: { effect: 'no combat use, story item', defaultBonus: 0 },
  
  // 杂物
  misc: { effect: 'no combat use', defaultBonus: 0 },
}
```

### 动态物品映射逻辑

当 TransferItem 创建动态物品（isDynamic=true）时：

```
1. item.type = 'potion' → 按 potion_heal 模板
   → bonus 自动设为 2（如果 DM 没指定）
   → 战斗中使用 → 恢复 2d4+2 HP

2. item.type = 'weapon' → 按 weapon_basic 或 weapon_good
   → bonus 由 DM 指定或默认 0
   → 装备后伤害按模板计算

3. item.type = 'quest' → 无战斗效果
   → 纯剧情物品
```

### 实现要点
- TransferItem 创建动态物品时，如果 bonus 为空，按模板默认值填充
- UseItem 使用药水时，按 bonus 值恢复 HP（已有逻辑）
- 不需要新建文件——只在 item-validator.ts 的动态物品验证中加模板映射

---

## 二、交易闭环系统

### 核心流程

```
探索中玩家表达购买意愿
    ↓
DM 叙事砍价对话
    ↓
DM 调 ProposeTradeAction 工具（指定物品+价格+NPC）
    ↓
前端弹出交易卡片（闭环开始）
    ↓
卡片内只能：砍价 / 确认 / 取消
    ↓
确认 → 代码执行 TransferItem → 交易完成
取消 → 关闭卡片 → 回到探索
```

### ProposeTradeAction 工具（DM 调用）

```typescript
{
  name: 'ProposeTradeAction',
  description: '当NPC同意交易时调用。弹出交易卡片让玩家确认。',
  inputSchema: z.object({
    npc: z.string().describe('商人NPC名称'),
    items: z.array(z.object({
      name: z.string(),
      type: z.string(),
      price: z.number(),
      quantity: z.number().optional(),
    })).describe('交易物品列表'),
    totalPrice: z.number().describe('总价（金币）'),
    canBargain: z.boolean().optional().describe('是否允许砍价'),
  }),
}
```

### 前端交易卡片

```
┌─ 交易 ── 叶绿的草药堂 ──────────────┐
│                                       │
│  📦 治疗药水 x2         10金 → 5金    │
│  📦 解毒剂 x1                  8金    │
│  ────────────────────────────────    │
│  总计：13 金币                         │
│  你的余额：20 金币 → 7 金币            │
│                                       │
│  [💰 砍价]  [✅ 确认交易]  [❌ 取消]   │
└───────────────────────────────────────┘
```

### 砍价机制

点"砍价"→ 发送 `{ type: 'trade_bargain' }` → DM 收到上下文 → DM 叙事砍价结果 → DM 再调 ProposeTradeAction（更新价格或拒绝）

```
砍价流程（最多3次）：
  第1次砍价 → DM叙事 → 可能降价 10-20%
  第2次砍价 → DM叙事 → 可能再降 5-10%
  第3次砍价 → DM拒绝 → "这已经是最低价了"
```

### 确认交易

点"确认"→ 前端发送 `{ type: 'trade_execute', items, totalPrice, npc }` 
→ 服务端对每个物品调 TransferItem
→ 返回结果
→ DM 收到 "[交易完成：2x治疗药水+1x解毒剂，支付13金币]"

### 取消交易

点"取消"→ 关闭卡片 → DM 收到 "[玩家取消了交易]" → DM 叙事NPC反应

### 交易状态机

```
EXPLORING → (DM 调 ProposeTradeAction) → TRADING
    ↑                                        ↓
    ↑        (确认) → 代码执行 → 完成 ────→ EXPLORING
    ↑        (取消) → 关闭 ───────────────→ EXPLORING  
    ↑        (砍价) → DM叙事 → 新报价 ──→ TRADING
    └─────────────────────────────────────────┘
```

### 与战斗系统的对比

| 维度 | 战斗 | 交易 |
|------|------|------|
| 入口 | 代码触发（Rules Agent/区域遭遇） | DM 调 ProposeTradeAction |
| 闭环 | 按钮操作（攻击/法术/逃跑） | 按钮操作（砍价/确认/取消） |
| 文本输入 | 禁止 | 可以砍价（通过按钮触发DM） |
| 机制执行 | 代码掷骰计算 | 代码执行 TransferItem |
| DM 角色 | 叙事结果 | 叙事砍价过程 |
| 退出 | 胜利/失败/逃跑 | 确认/取消 |

### 关键：DM 什么时候该调 ProposeTradeAction？

在 DM prompt 中明确：
```
当NPC同意了一个具体的交易报价时（玩家和NPC谈好了价格），
调用 ProposeTradeAction 让系统弹出交易卡片。
不要在叙事中直接完成交易——必须通过卡片让玩家确认。
```

---

## 实现顺序

1. 物品模板系统（item-validator.ts 加默认 bonus 映射）
2. ProposeTradeAction 工具（新工具文件）
3. 前端交易卡片 UI
4. 砍价流程（trade_bargain 消息类型）
5. DM prompt 更新
