# 暴力后果系统设计

## 核心逻辑

```
玩家攻击NPC → 设置 violence_alert flag → 每轮检查 → 延迟到期 → 响应者行动
```

## 触发条件

Attack 工具攻击 NPC 时（engine.ts 中已有信任 -5 逻辑），同时设置：
```typescript
session.worldState.flags['violence_alert'] = JSON.stringify({
  triggerTurn: session.turnCount,
  victimName: targetNPC,
  location: session.worldState.currentLocation,
  subLocation: session.worldState.currentSubLocation,
  delay: calculateDelay(session),  // 几轮后触发响应
  responded: false,
})
```

## 延迟计算

```typescript
function calculateDelay(session): number {
  let delay = 5  // 基础延迟

  // 时间影响
  if (session.worldState.timeOfDay === 'night') delay += 4      // 深夜 +4
  else if (session.worldState.timeOfDay === 'evening') delay += 2 // 黄昏 +2
  
  // 目击者加速：同子场景有其他 NPC
  const witnesses = session.npcs.filter(n => 
    n.location === session.worldState.currentLocation &&
    (n.subLocation ?? n.homeBase) === session.worldState.currentSubLocation &&
    n.name !== victimName &&
    n.condition !== 'unconscious'
  )
  if (witnesses.length > 0) delay -= 3  // 有目击者，提前 3 轮
  
  // 平民目击者特殊效果：虽然不战斗，但会"报警"
  const civilianWitness = witnesses.find(n => !getPersonality(n.name).canFight)
  if (civilianWitness) delay -= 1  // 平民跑去报信，再快 1 轮

  return Math.max(1, delay)  // 最少 1 轮延迟
}
```

## 每轮检查（processTurn 中）

```typescript
const alert = session.worldState.flags['violence_alert']
if (alert && !alert.responded) {
  const elapsed = session.turnCount - alert.triggerTurn
  
  if (elapsed >= alert.delay) {
    // 找第一个能战斗的、信任极低的 NPC 来响应
    const responder = findResponder(session, alert)
    if (responder) {
      alert.responded = true
      // 1. 移动响应者到事发地点
      responder.subLocation = alert.subLocation
      // 2. 注入 DM 上下文："格雷格赶到现场"
      // 3. 下一轮如果玩家还在 → 自动触发战斗
      session.worldState.flags['pending_npc_combat'] = responder.name
    }
  } else if (elapsed === alert.delay - 1) {
    // 提前 1 轮预警：DM 上下文注入
    // "[世界事件：远处传来急促的脚步声，有人正在赶来]"
  }
}
```

## 响应者选择

```typescript
function findResponder(session, alert): NPC | null {
  const candidates = session.npcs.filter(n =>
    n.name !== alert.victimName &&
    n.condition !== 'unconscious' &&
    getPersonality(n.name).canFight &&
    n.trust <= getPersonality(n.name).thresholds.hostile  // 对玩家已经敌对
  )
  
  // 优先级：
  // 1. 有 bond 关系的（格雷格保护小莉）
  // 2. 同区域的战斗者
  // 3. 韩猛（治安职责）
  // 4. 最强的
  
  // 按战斗力排序，弱的先来（先派韩猛，留格雷格压阵）
  return candidates.sort((a, b) => {
    // 韩猛有治安职责，优先
    if (a.name === '韩猛') return -1
    if (b.name === '韩猛') return 1
    return 0
  })[0] ?? null
}
```

## 玩家逃跑的处理

如果玩家在延迟期间离开了事发地点（Move 到其他区域）：
- 不触发追击战斗
- 但信任暴跌仍然生效（已经在攻击时处理了）
- 响应者发现受害者 → 全镇警戒升级
- 下次玩家回到破晓镇 → 响应者在入口等着

## 不会被滥用

- 每次暴力事件只触发一个响应者（不是全镇围攻）
- 打完响应者后需要再等下一个 alert 周期
- 深夜无人时延迟最长（8-9 轮），给玩家充足逃跑时间
- 只有对玩家已经敌对的 NPC 才会响应（信任没跌到 hostile 的不来）
