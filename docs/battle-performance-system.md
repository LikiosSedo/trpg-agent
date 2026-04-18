# 战斗演出系统设计方案（v1 · 2026-04-17）

> **状态**：设计记录,**Wave 1 MVP 可立即起手**,后面分波做。
> 本文档回答了用户关于"战斗演出 + 时序 + 技术栈"的完整思考。

## 一、问题重述(用户愿景)

战斗全屏分 **4 个模块**:
- 🗺️ 地图模块(战棋网格,已有)
- 📜 叙事模块(文本流日志,已有)
- 🎮 操作模块(按钮区,已有)
- 🎬 **演出模块(缺)**:复用弹窗机制,每次角色行动时弹立绘卡片+特效

**核心交互**:
- 先攻决定行动顺序,**每回合只有一个角色在"演出槽"**
- 轮到某角色 → 立绘卡片弹入 + 意图(攻击/法术/防御) + 特效演出
- 攻击时同时拉出受击方卡片 + 对应受击演出
- 结束后才轮到下个角色(**绝不瞬间结算**)

**核心要求**:
- 闭环、可复用、方便拓展(每个新怪物/NPC 复用同一演出系统)
- 保持现有克苏鲁 2D 日系风格
- 立绘用户用 GPT Image2 生成

## 二、现状分析(调研结论)

### 时序 bug 根因
- **后端**:`processGridAction` → `executePlayerTurn` 返回 roundLog 数组 → **CPU 瞬间 yield 一串事件**(combat_grid_move / attack / death / end),无延迟
- **前端**:WS handler **同步处理**,只在 `combat_monster` 这一条有 800ms setTimeout 延迟;单条消息内部多条叙事瞬间渲染
- **无 AnimationQueue**:消息到达直接 DOM 更新
- **无 actor_turn 信号**:`executeMonsterPhase` 一次性结算全轮怪物攻击,前端无法区分"是哪个怪物在动"

### 已有基建(意外地丰富)
- **CSS 动画**:15+ 个 `@keyframes` (`chudSlideIn`、`discoveryEntrance`、`lairEntrance`、`unitDeath`、`bossPulse`、`chudDamageFlash`...)
- **卡片组件**:`.lair_entrance`(沉浸式确认)、`npc_speaking`(立绘+气泡)、`npc_card`(模态)—— **演出卡片机制已跑通**
- **立绘**:39 个 PNG,其中 scenes/15、npcs/8、characters/4、monsters/4
- **缺口**:主要是**怪物立绘**(13 种怪物只有 4 张)、**角色立绘**(4 职业每个只有 1 张)

### 结论
**演出不是从零做,是把已有弹窗机制 + CSS 动画 + 立绘资产用 Animation Queue 串成流水线**。

## 三、核心架构

### 1. Animation Queue(前端新建)

当前:`ws.onmessage` → 立即 DOM 更新
新建:`ws.onmessage` → enqueue(job) → run() 逐个 await 播放

```typescript
class BattleAnimationQueue {
  private queue: AnimationJob[] = []
  private running = false

  enqueue(job: AnimationJob) {
    this.queue.push(job)
    if (!this.running) this.run()
  }

  private async run() {
    this.running = true
    while (this.queue.length > 0) {
      const job = this.queue.shift()!
      await job.play()  // 每个 job 是一个 async 函数,返回 Promise
    }
    this.running = false
  }

  skipToEnd() { /* 快进:所有 job 直接 resolve */ }
}
```

`AnimationJob` 是一个有 `.play(): Promise<void>` 的对象。每条 WS 战斗消息包装成一个 job。

### 2. actor_turn 事件(后端新增)

当前 WS 事件:
```
combat_grid_move, combat_status, combat_narrative, combat_grid_death, ...
```
问题:前端不知道"这组事件属于谁的回合"。

新增 `actor_turn_start` / `actor_turn_end`:
```typescript
yield { type: 'actor_turn_start', actorId: 'player', actorName: '林克', portrait: '...', side: 'player' }
  yield { type: 'combat_grid_move', ... }
  yield { type: 'combat_narrative', ... }
  yield { type: 'combat_status', ... }  // 伤害
  yield { type: 'combat_grid_death', ... }  // 如有
yield { type: 'actor_turn_end', actorId: 'player' }
```

改动点:
- `engine.ts:processGridAction`(玩家攻击)—— 开头 / 结尾各加一对
- `combat-manager.ts:executeMonsterPhase` —— 需要**从"一次性结算"改为"逐怪物 yield"**,每个怪物独立一对 actor_turn_start / end

### 3. 演出卡片模板(DOM + CSS)

新增 `<div id="battle-stage-overlay">`,全屏透明覆盖层。

每个 AnimationJob 的播放结构:

```
登场阶段 500ms ─┐
立绘从侧边滑入
+ 角色名字气泡
+ 动作意图("挥剑斩出")
                 ↓
动作演出 1000ms ─┐
攻击:立绘前倾 + 刀光 + 震屏
法术:立绘光晕 + 魔法阵 + 粒子
防御:立绘盾光泽 + 缓慢脉动
                 ↓
受击反馈 500ms ─┐ (如果攻击)
拉出受击方立绘
+ 震动 + 红光闪
+ 伤害数字 "-12" 飞出
                 ↓
退场 300ms ─────┐
立绘淡出 + 队列下一个
```

单次行动 2-3 秒,4 回合战斗约 30 秒,**可控**。

加快进键(`Space`):skipToEnd() 让所有 CSS animation `animation-play-state: paused` + 直接 resolve Promise。

### 4. 四种卡片模板

| 类型 | 主色 | 立绘姿态 | 关键演出 |
|---|---|---|---|
| **攻击** | 红色边框 | 前倾/举剑 | 刀光(CSS clip-path) + 震屏 + 伤害数飞出 |
| **法术** | 紫色边框 | 咏唱 | 魔法阵(旋转 CSS)+ 粒子(Canvas)+ 特殊词效 |
| **防御** | 蓝色边框 | 举盾 | 盾牌光泽(conic-gradient)+ 缓慢脉动 |
| **受击** | 自动联动 | 受击姿态 | 震动(transform)+ 红 flash + HP 下降 |

## 四、时序修复(关键)

**修前**: 玩家点击 → 后端瞬间 yield 10 条事件 → 前端立即 10 个 DOM 更新 → 玩家看到一片混乱
**修后**: 玩家点击 → 后端 yield → 前端 enqueue → **队列逐个 await 动画完成**

并发攻击(玩家秒杀怪物 + 战斗结束)原先瞬间结算,新版会:
1. 玩家攻击演出 2.5s
2. 怪物死亡演出 0.8s
3. 胜利卡片 + 战利品弹窗 1s
4. 清理棋盘 0.5s

**总计约 5s,代入感强,但不拖沓**。

## 五、技术栈结论(调研依据)

### 业界事实
| 产品 | 引擎 | 演出强度 |
|---|---|---|
| Disco Elysium | Unity | 中(对话为主,演出轻) |
| Slay the Spire 1 | Unity | 中(卡牌战棋) |
| Slay the Spire 2 | Godot(2024 迁移)| 同 1 代,引擎不影响演出 |
| 火焰纹章 Engage | Unity | 高(3D) |
| LLM-native RPG(DungeonGPT、RPGGo.ai)| **全部 React/Node + HTTP 流** | 轻 |

**关键**: **业界没有一个 LLM-native TRPG 因为加演出而迁引擎的先例**。Slay the Spire 迁 Godot 是 Unity 授权争议,不是演出需求。

### 渲染技术对比

| 方案 | 包体增量 | 能做什么 | 对当前项目的改动 |
|---|---|---|---|
| **A. DOM + CSS animation** | 0 | 立绘弹窗、滑入/淡出、震屏、HP bar、伤害数字 | 零改动(只用现有基建) |
| **B. + Canvas 2D** | 0 | +粒子、拖影、刀光轨迹 | 加 `<canvas>`,手写 ~200 行粒子代码 |
| **C. + Pixi.js** | 220KB | WebGL 加速、滤镜、复杂粒子、遮罩 | 加一个 js lib,boss 战专用;普通战斗用 A |
| **D. + Phaser 3** | 1.2MB | 完整游戏框架 + 物理 + 音效 | 战斗核心重写,不值得 |
| **E. Unity/Godot + HTTP API** | 100MB+ | AAA 级,但过度 | **完全重构 5600+ 行前端**,4 个月工程量 |

### 为什么**不**换引擎

1. **LLM-native 核心在 TypeScript**:工具系统、信任度、章节 beat、战棋判定 —— 都是 agent 友好的 TS 代码。换 C#/GDScript 就失去 Claude Code 开发优势。
2. **HTTP 流式叙事在浏览器最顺**:Godot + LLM 社区方案(godot-llm)把 HTTP 流塞进 GDScript 反而笨拙。现架构 WebSocket + TurnEvent 就是最优解。
3. **网页部署优势**:现在 `npm run web` 就能玩,换引擎要打包 WebGL 或发客户端,部署成本飙升。
4. **美学契合**:克苏鲁 2D 日系风格靠**文字节奏 + 立绘停格 + CSS 慢动作**传达,比粒子轰炸更对味。**DOM 的"静谧表达"比 Unity 的"炫技表达"更适合这个题材**。

### Claude Code agent 开发友好度
- TS + DOM:🟢 最友好,agent 能直读 5600 行 index.html,grep/edit 顺畅
- Pixi.js 增量:🟢 加一个 import,agent 不需要学引擎
- Unity/Godot:🔴 agent 没法操作 Unity Editor 场景,开发回到"人类手动拖组件"模式

### 结论

**当前战斗演出完全不需要换引擎**。技术路径:
- **Wave 1-3**: 纯 DOM + CSS animation + 少量 Canvas 2D 粒子(零依赖)
- **Wave 4(可选)**: boss 终极演出引入 Pixi.js(220KB,只在 boss 场景加载)
- **不做**: Phaser/Unity/Godot 迁移

## 六、立绘资产规划

用户用 GPT Image2 生成。保持克苏鲁 2D 日系风格。

### 需要的立绘清单

**玩家(4 职业 × 3 姿态 = 12 张)**:
- 待机 / 攻击 / 受击
- 职业:剑士 / 法师 / 游侠 / 牧师

**核心 NPC(10 人 × 2 姿态 = 20 张)**:
- 待机 / 战斗
- 格雷格、小莉、艾琳娜、韩猛、叶绿 等

**怪物(13 种 × 2 姿态 = 26 张)**:
- 待机 / 攻击
- Giant Spider、Goblin、Shadow、Hobgoblin 等
- Boss: Spider Matriarch / Shadow Weaver / Eclipsed Beast 额外加 1 张 Phase 2 变身立绘

**合计:~58 张新立绘**(现有 39 张覆盖部分场景/NPC/职业基础姿态,缺口主要是战斗姿态 + 怪物)

### 规格建议
- 尺寸:384×576 PNG(3:2 竖版,适合手机+桌面)
- 透明背景
- 中景半身(腰以上 + 手臂动作)
- 文件命名:`portraits/battle/player-fighter-attack.png`、`portraits/battle/giant-spider-attack.png`

可以先用现有 4 张怪物立绘跑通 Wave 1 MVP,后续用户补画时渐进替换。

## 七、工程分波

### Wave 1 · 时序 + Animation Queue(MVP,3-4 天)
**目标**:让战斗节奏明显变慢,玩家能感知"现在是谁在动"

- [ ] 后端加 `actor_turn_start` / `actor_turn_end` 事件(TurnEvent 类型定义)
- [ ] `processGridAction`(玩家)头尾包一对
- [ ] `executeMonsterPhase` 重构:**从"一次性结算"改为"逐怪物 yield"**,每个怪物独立一对
- [ ] 前端 `BattleAnimationQueue` 类
- [ ] 所有战斗相关 WS message 改为 enqueue
- [ ] 简陋版卡片:纯 DOM div + 立绘 img + fadeIn/slideIn CSS(用已有的 lairEntrance 样式 reskin)
- [ ] 验收:一场 3 回合战斗,能清楚看到"玩家 → 怪物"切换,每次约 2-3 秒演出

### Wave 2 · 演出丰满(3-4 天)
**目标**:攻击 / 法术 / 防御 / 受击 四种卡片模板差异化

- [ ] 四种卡片 CSS(边框色、背景光、专属 @keyframes)
- [ ] 伤害数字飞出动画(`.damage-number` + translate + opacity)
- [ ] 震屏(body shake transform)
- [ ] 红 flash(overlay filter)
- [ ] 受击卡片联动(攻击时同时显示攻击者 + 目标两张卡)
- [ ] 快进键 Space(skipToEnd)
- [ ] 技能特效:法术用 CSS conic-gradient 魔法阵、防御用 CSS 光泽

### Wave 3 · 立绘资产 + 相机(2-3 天,依赖用户生成立绘)
- [ ] 用户用 GPT Image2 批量生成立绘(~58 张)
- [ ] 扩展 `MONSTER_PORTRAITS` / 新增 `PLAYER_PORTRAITS` 映射
- [ ] 相机推近(CSS transform scale 到战斗焦点)
- [ ] 立绘姿态切换(攻击立绘 vs 待机立绘)

### Wave 4 · 粒子升级(可选,boss 战专用,1 周)
- [ ] 引入 Pixi.js(220KB)
- [ ] 3 个 boss 战专属粒子:毒雾 / 暗影粒子 / 虚空涟漪
- [ ] Phase 2 读条 bar + 特写镜头(和 boss-combat-design.md 的演出层对接)
- [ ] 胜利结算大字动画

## 八、立即起手建议

从 **Wave 1 第一步开始**:改 `executeMonsterPhase` 让它逐怪物 yield,前端加 AnimationQueue。

**原因**:
1. 时序 bug 是**当前体验最差的一环**(用户已明确指出"互相瞬间一起")
2. 改完之后,即使没有立绘,用 occ 的文字+现有 CSS 就能感受到节奏
3. 后续加立绘卡片是纯增量,风险低
4. AnimationQueue 做对后,后面所有演出都是"往框架里填内容"

工程量:Wave 1 MVP **不超过 3 天**,端到端跑通后再评估 Wave 2。

## 附录:关键开放问题

1. **演出时长 vs 快进**:玩家第 N 次打同样的小怪会烦,默认 Space 快进还是配置自动快进?
2. **网络抖动**:WS 消息延迟时 queue 会饿死,需要 timeout 兜底。
3. **多怪物同回合**:4 个 goblin 一起攻击总 10 秒可能冗长,需不需要"多小怪并行演出"?
4. **NPC 盟友演出**:同伴(ally)的立绘和怪物样式分开?
5. **叙事异步**:DM 的战斗叙事(combat_narrative)放在卡片下方字幕 还是 全屏居中特写?

这些等 Wave 1 跑通后再定。
