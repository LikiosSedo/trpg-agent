# 多 Agent 架构设计

> 基于 open-claude-cli SDK 的 `Agent` + `AgentGraph` 构建 TRPG 游戏引擎。

## 1. 架构总览

```
                          ┌─────────────┐
                          │   玩家 CLI   │
                          │  (readline)  │
                          └──────┬───────┘
                                 │ 玩家输入
                                 ▼
╔═══════════════════════ AgentGraph "trpg-session" ════════════════════════╗
║                                                                          ║
║  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────────┐   ║
║  │ Parse    │───▶│ DM Agent │───▶│ Resolve  │───▶│ Render + Output  │   ║
║  │ Input    │    │ (核心)    │    │ (执行)    │    │ (渲染)           │   ║
║  └──────────┘    └────┬─────┘    └──────────┘    └──────────────────┘   ║
║                       │                                    │             ║
║                       │ 需要 NPC/战斗                       │             ║
║                       ▼                                    │             ║
║              ┌────────────────┐                            │             ║
║              │ NPC Agent(s)   │                            │             ║
║              │ Battle Agent   │────────────────────────────┘             ║
║              └────────────────┘                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
                                 │
                                 ▼
                        ┌────────────────┐
                        │  GameSession   │
                        │  (共享状态)     │
                        └────────────────┘
```

## 2. Agent 角色定义

### 2.1 DM Agent (地下城主)

游戏的核心决策者。接收玩家输入，决定叙事走向，协调其他 Agent。

```typescript
const dmAgent = new Agent({
  provider: config.provider,
  tools: [
    RollDiceTool,    // 掷骰判定
    MoveTool,        // 移动玩家
    LookTool,        // 观察环境
    SearchTool,      // 搜索区域
    RestTool,        // 休息恢复
    UseItemTool,     // 物品操作
    RenderSceneTool, // 渲染输出
  ],
  systemPrompt: `你是这个 TRPG 世界的 DM (地下城主)。
你的职责:
1. 解读玩家意图，将自然语言映射到游戏动作
2. 执行规则判定 (技能检定、战斗、物品使用)
3. 推进叙事，保持世界的一致性和沉浸感
4. 在合适时机触发战斗、任务事件、NPC 交互
...完整 system prompt 在实现时填充`,
  maxTurns: 10,
})
```

**DM Agent 职责边界:**
- ✅ 叙事描写、环境描述、规则裁决、NPC 调度
- ✅ 判断何时进入/退出战斗
- ✅ 决定检定难度 (DC)
- ❌ 不直接扮演 NPC 对话 (委托给 NPC Agent)
- ❌ 不直接管理战斗回合 (委托给 Battle Agent)

### 2.2 NPC Agent (独立 NPC)

每个重要 NPC 是一个独立的 Agent 实例，拥有自己的记忆和性格。

```typescript
function createNPCAgent(npc: NPC): Agent {
  return new Agent({
    provider: config.provider,
    tools: [TalkTool, RenderSceneTool],
    systemPrompt: `你是 ${npc.name}，${npc.role}。
性格: ${npc.personality}
背景: ${npc.backstory}
你知道: ${npc.knownInfo.join('; ')}
对玩家的态度: ${npc.disposition > 0 ? '友好' : npc.disposition < 0 ? '敌对' : '中立'}

行为规则:
- 始终保持角色一致性，不要打破角色
- 根据对话内容和玩家行为动态调整态度
- 只透露你"知道"的信息
- 用 RenderScene 输出你的对话`,
    maxTurns: 4,
  })
}
```

**NPC Agent 独立记忆机制:**

每个 NPC Agent 的对话历史保留在自己的 `messages` 数组中。通过 Agent 的 session 功能实现跨对话记忆：

```typescript
const npcAgent = createNPCAgent(npc)

// 第一次对话
for await (const e of npcAgent.run('玩家: "你好，你知道北边的遗迹吗？"')) { ... }

// 第二次对话——NPC 记得之前聊过
for await (const e of npcAgent.run('玩家: "我回来了，找到了你说的符文石"')) { ... }
// NPC Agent 的 messages 中保留了之前的对话上下文
```

### 2.3 Battle Agent (战斗管理)

专门处理战斗流程的 Agent，在战斗触发时由 DM Agent 移交控制权。

```typescript
const battleAgent = new Agent({
  provider: config.provider,
  tools: [
    RollDiceTool,
    AttackTool,
    MoveTool,
    UseItemTool,
    RenderSceneTool,
  ],
  systemPrompt: `你是战斗管理器。你的职责:
1. 管理先攻顺序和回合流转
2. 执行玩家的战斗动作 (攻击、施法、使用物品、移动)
3. 控制怪物/敌对NPC的战术行动
4. 判定命中、伤害、状态效果
5. 每回合用 RenderScene("combat") 展示战场状态
6. 判断战斗结束条件

怪物AI行为模式:
- aggressive: 优先攻击最近/最弱的目标
- defensive: 保护同伴，优先控制/削弱
- ambush: 开局集火，劣势时逃跑`,
  maxTurns: 30,  // 战斗可能持续多轮
})
```

## 3. 事件系统

Agent 之间通过 **GameSession 共享状态** + **Agent Event System** 通信。

### 3.1 事件流转

```
玩家输入 "我要和铁匠说话"
        │
        ▼
  DM Agent (解析意图)
        │ 识别: NPC 交互
        │ 查找: npcs["blacksmith"]
        │ 更新: GameSession.eventLog
        ▼
  NPC Agent "blacksmith" (生成回应)
        │ 读取: npc.personality, npc.knownInfo
        │ 生成: 对话内容
        │ 更新: npc.disposition (如果态度变化)
        ▼
  DM Agent (整合结果)
        │ 检查: 是否触发任务更新
        │ 检查: 是否有新的叙事展开
        ▼
  RenderScene → 玩家看到输出
```

### 3.2 事件类型与处理

| 事件 | 触发者 | 处理者 | 状态变更 |
|------|--------|--------|----------|
| `combat_start` | DM Agent | → Battle Agent 接管 | combat.active = true |
| `combat_end` | Battle Agent | → DM Agent 恢复 | combat.active = false, 掉落处理 |
| `npc_interaction` | DM Agent | → NPC Agent | npc.disposition 可能变化 |
| `quest_update` | DM/NPC Agent | DM Agent 检查 | quest.status/objectives 更新 |
| `location_change` | DM Agent | 更新场景 | currentLocationId 变化 |
| `item_acquired` | 各 Agent | 更新背包 | player.inventory 变化 |
| `skill_check` | DM Agent | 掷骰判定 | 根据结果推进叙事 |
| `player_damaged` | Battle Agent | 更新 HP | player.hp 变化 |

### 3.3 用 Agent Event System 实现

```typescript
// DM Agent 遇到需要 NPC 对话的场景
dmAgent.on('npc_interaction', async (data, agent) => {
  const npcAgent = npcAgents[data.npcId]
  const prompt = `玩家对你说: "${data.message}"
当前态度: ${session.npcs[data.npcId].disposition}
场景: ${session.locations[session.currentLocationId].description}`

  let response = ''
  for await (const e of npcAgent.run(prompt)) {
    if (e.type === 'text_delta') response += e.text
  }
  // NPC 回应后，DM Agent 继续处理
})

// Battle Agent 结束战斗时
battleAgent.on('combat_end', async (data, agent) => {
  session.combat.active = false
  // 处理战利品、经验等
})
```

## 4. AgentGraph 游戏流程

用 `AgentGraph` 定义整个游戏的状态机：

```typescript
import { AgentGraph, agentNode, END } from 'open-claude-cli/engine'

// ─── Graph State ─────────────────────────────
interface GameGraphState {
  session: GameSession
  playerInput: string
  dmIntent: string           // DM 解析出的意图
  pendingAction: string      // 待执行的动作类型
  actionResult: string       // 动作执行结果
  narrativeOutput: string    // 最终输出文本
  shouldEndGame: boolean
  _nodeHistory: string[]
}

// ─── Node Functions ──────────────────────────

/**
 * 节点 1: 解析输入
 * 将玩家的自然语言转化为结构化意图
 */
const parseInput = agentNode(dmAgent, (state) => {
  return `玩家输入: "${state.playerInput}"
当前位置: ${state.session.currentLocationId}
战斗中: ${state.session.combat.active}
请解析玩家意图，返回动作类型: move/look/talk/attack/search/use_item/rest/other`
}, { resultKey: 'dmIntent' })

/**
 * 节点 2: DM 叙事 + 执行
 * 根据意图调用对应工具，推进游戏状态
 */
const dmNarrate = agentNode(dmAgent, (state) => {
  return `执行玩家动作。
意图: ${state.dmIntent}
原始输入: "${state.playerInput}"
游戏状态: ${JSON.stringify(state.session, null, 2)}

使用对应的工具执行动作，然后用 RenderScene 展示结果。
如果需要 NPC 对话，标记 pendingAction 为 "npc_interaction"。
如果需要进入战斗，标记 pendingAction 为 "combat"。`
}, { resultKey: 'actionResult' })

/**
 * 节点 3: NPC 对话 (条件进入)
 */
async function npcInteraction(state: GameGraphState) {
  const npcId = state.session.currentLocationId // 从 actionResult 解析
  const npcAgent = npcAgents[npcId]
  if (!npcAgent) return state

  let response = ''
  for await (const e of npcAgent.run(state.playerInput)) {
    if (e.type === 'text_delta') response += e.text
  }
  return { ...state, narrativeOutput: response, pendingAction: 'done' }
}

/**
 * 节点 4: 战斗 (条件进入)
 */
const combat = agentNode(battleAgent, (state) => {
  return `战斗开始！
场景: ${state.session.locations[state.session.currentLocationId].name}
玩家: HP ${state.session.player.hp}/${state.session.player.maxHp}
敌人: ${JSON.stringify(state.session.combat.turnOrder.filter(c => c.type === 'monster'))}

等待玩家战斗指令: "${state.playerInput}"
按先攻顺序执行一轮战斗。`
}, { resultKey: 'actionResult' })

/**
 * 节点 5: 渲染输出
 */
async function renderOutput(state: GameGraphState) {
  // RenderScene 工具已在各 Agent 内部调用
  // 此节点做最终的状态同步和清理
  return {
    ...state,
    pendingAction: '',
    shouldEndGame: state.session.player.hp <= 0,
  }
}

// ─── 构建 Graph ──────────────────────────────

const gameGraph = new AgentGraph('trpg-session', {
  maxIterations: 50,    // 一局游戏最多 50 步
  checkpoint: true,     // 启用存档
})

gameGraph
  .addNode('parse', parseInput)
  .addNode('dm', dmNarrate)
  .addNode('npc', npcInteraction)
  .addNode('combat', combat)
  .addNode('render', renderOutput)

  // 固定流转
  .addEdge('parse', 'dm')

  // DM 之后根据 pendingAction 条件路由
  .addConditionalEdge('dm', (state) => {
    if (state.pendingAction === 'npc_interaction') return 'npc'
    if (state.pendingAction === 'combat') return 'combat'
    return 'render'
  })

  // NPC / 战斗结束后都到渲染
  .addEdge('npc', 'render')
  .addEdge('combat', 'render')

  // 渲染后判断游戏是否结束
  .addConditionalEdge('render', (state) => {
    if (state.shouldEndGame) return END
    return END  // 单步结束，等待下一次玩家输入
  })
```

### 4.1 游戏主循环

```typescript
// 每次玩家输入触发一次 Graph 运行
async function gameLoop(session: GameSession) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const ask = () => new Promise<string>(resolve => {
    rl.question('⚔️  你> ', resolve)
  })

  while (true) {
    const input = await ask()
    if (input.trim() === '/quit') break

    const initialState: GameGraphState = {
      session,
      playerInput: input,
      dmIntent: '',
      pendingAction: '',
      actionResult: '',
      narrativeOutput: '',
      shouldEndGame: false,
      _nodeHistory: [],
    }

    for await (const event of gameGraph.run(initialState)) {
      if (event.type === 'graph_complete') {
        // 从最终 state 同步回 session
        session = event.state.session
        if (event.state.shouldEndGame) {
          console.log('\n💀 游戏结束...')
          rl.close()
          return
        }
      }
    }
  }

  rl.close()
}
```

### 4.2 状态流转图

```
                ┌──────────────────────────────────────┐
                │         玩家输入 (readline)            │
                └──────────────┬───────────────────────┘
                               │
                               ▼
                    ┌──────────────────┐
                    │    parse (DM)    │
                    │  解析玩家意图     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │     dm (DM)      │
                    │  叙事 + 执行动作  │
                    └────────┬─────────┘
                             │
               ┌─────────────┼─────────────┐
               │             │             │
    pendingAction=       (default)    pendingAction=
    "npc_interaction"                  "combat"
               │             │             │
               ▼             │             ▼
      ┌────────────┐        │     ┌────────────┐
      │  npc (NPC  │        │     │  combat    │
      │   Agent)   │        │     │  (Battle   │
      └──────┬─────┘        │     │   Agent)   │
             │              │     └──────┬─────┘
             │              │            │
             └──────────────┼────────────┘
                            │
                            ▼
                   ┌────────────────┐
                   │    render      │
                   │  渲染 + 输出    │
                   └────────┬───────┘
                            │
                  shouldEndGame?
                   /            \
                  yes            no
                  ↓              ↓
                 END      等待下一次输入
```

## 5. 工具 → 游戏动作映射

| 工具 | 游戏动作 | 调用者 | 修改的状态 |
|------|----------|--------|-----------|
| `RollDice` | 所有随机判定 | DM / Battle | 无直接状态修改 |
| `Move` | 移动到新地点 / 战斗移动 | DM / Battle | currentLocationId, position |
| `Look` | 观察环境 / 检查目标 | DM | isExplored |
| `Talk` | 与 NPC 对话 | DM → NPC Agent | npc.disposition |
| `Attack` | 战斗攻击 | Battle | hp, conditions |
| `UseItem` | 使用/装备/交易物品 | DM / Battle | inventory, equipped |
| `Search` | 搜索区域/容器 | DM | location.items, inventory |
| `Rest` | 短休/长休恢复 | DM | hp, spellSlots |
| `RenderScene` | 渲染输出给玩家 | 所有 Agent | 无 (只读) |

## 6. 存档与恢复

`AgentGraph` 内置 checkpoint 机制，每个节点执行后自动保存状态：

```typescript
// 存档保存在 ~/.occ/checkpoints/trpg-session/
// 格式: {timestamp}-{nodeId}.json

// 恢复存档
const checkpoints = gameGraph.getCheckpoints()
// 选择一个存档恢复
for await (const event of gameGraph.resume(checkpoints[0])) {
  // ...
}
```

配合 `GameSession` 的序列化，可以实现完整的游戏存档/读档。

## 7. 扩展点

| 扩展方向 | 实现方式 |
|---------|---------|
| 新 NPC | 创建新的 NPC Agent 实例，注入到 npcAgents 表 |
| 新怪物行为 | 在 Battle Agent 的 systemPrompt 中添加新行为模式 |
| 新技能/法术 | 扩展 types.ts，在 DM/Battle Agent 的 prompt 中说明规则 |
| 支线任务 | 添加 Quest 数据 + 在 NPC Agent 的 knownInfo 中引用 |
| 随机事件 | 在 Graph 的 render → END 之间添加 "random_event" 节点 |
| 多人模式 | 每个玩家一个输入通道，DM Agent 轮流处理 |
