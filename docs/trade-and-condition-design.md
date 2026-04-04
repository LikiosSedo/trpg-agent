# 交易系统 + NPC 状态系统设计

## 一、交易确认卡片

### 流程
```
玩家砍价 → DM叙事"好吧10金币给你" → 验证器检测到交易关键词
  → 前端弹出交易确认卡片
  → 玩家点确认 → 代码执行 TransferItem
  → 玩家点取消 → 不执行
```

### 触发条件（叙事验证器检测）
- DM 文本包含：`卖给你|成交|XX金币|买下|购买|以X金`
- 且当前轮有 NPC 对话（Talk 工具被调用）
- 提取：物品名、价格、NPC名

### 前端卡片
```
┌─ 交易确认 ────────────────┐
│ 📦 治愈药水               │
│ 卖家: 叶绿  价格: 10金币   │
│ 余额: 20 → 10             │
│ [✅ 确认]     [❌ 取消]    │
└───────────────────────────┘
```

### 消息流
- 引擎检测到交易意图 → yield `trade_confirm` 事件
- 前端显示卡片
- 玩家点确认 → 发送 `{ type: 'trade_confirm', item, npc, gold }`
- 服务端执行 TransferItem
- 玩家点取消 → 发送 `{ type: 'trade_cancel' }`

---

## 二、NPC 状态系统

### 状态流转
```
normal → wounded(HP<50%) → unconscious(HP=0) → recovering → wounded → normal
                                                ↑
                                          recoveryTurns 后
```

### per-NPC 恢复速度（npc-combatants.json 新增字段）
| NPC | 等级 | recoveryTurns | 原因 |
|-----|------|---------------|------|
| 格雷格 | 8 | 5 | 老兵体质 |
| 艾琳娜 | 12 | 4 | 精灵恢复力 |
| 韩猛 | 6 | 6 | 战士韧性 |
| 格罗姆 | 5 | 7 | 矮人坚韧 |
| 卡恩 | 10 | 5 | 暗影恢复 |
| 叶绿 | 3 | 10 | 半精灵药师 |
| 维克多 | 1 | 15 | 年老体弱 |
| 陈妈 | 1 | 15 | 平民 |
| 小莉 | 1 | 20 | 孩子 |

### 状态对交互的影响
| 状态 | Talk | TransferItem | 出现在场景 |
|------|------|-------------|-----------|
| normal | ✅ | ✅ | ✅ |
| wounded | ✅(虚弱语气) | ✅ | ✅ |
| unconscious | ❌(代码拒绝) | ❌ | ❌(不描写) |
| recovering | ✅(受限) | ❌(商店关闭) | ✅ |

### 数据结构
```typescript
// NPC 新增字段
condition?: 'normal' | 'wounded' | 'unconscious' | 'recovering'
conditionTurn?: number  // 进入当前状态的 turnCount
```

---

## 三、状态对 DM 叙事的影响

toPromptContext() 注入：
```
NPC状态：
- 叶绿（重伤昏迷，在草药堂，约10轮后恢复）
- 格雷格（正常，但因叶绿受伤情绪焦虑）

玩家状态：
- HP 28/38（负伤）
```

DM 自然会基于这些信息调整叙事。
