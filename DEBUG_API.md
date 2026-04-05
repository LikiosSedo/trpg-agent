# 调试 API 系统

## 概述

调试 API 系统提供了可编程的接口，让 AI 助手可以自动化测试和诊断游戏问题，无需手动点击网页。

## API 端点

### 1. 完整诊断报告
```bash
GET /api/debug/diagnostics
```

返回系统各模块的健康检查结果：
- **NPC 名称匹配**：检查 session.npcs 和 dossier 的一致性
- **NPC 位置信息**：验证位置数据完整性
- **信任系统**：检查信任值是否在正常范围
- **章节系统**：当前章节和完成的节点
- **战斗系统**：战斗状态和回合信息

**响应示例：**
```json
{
  "timestamp": "2026-04-06T03:00:00.000Z",
  "checks": [
    {
      "category": "npc-matching",
      "name": "NPC \"格雷格\" key consistency",
      "status": "pass",
      "message": "session.npcs[].name 和 dossier key 一致"
    },
    {
      "category": "npc-location",
      "name": "NPCs at current location",
      "status": "pass",
      "message": "当前位置 dawnbreak-town/shattered-shield-tavern 有 2 个 NPC",
      "details": {
        "playerLocation": "dawnbreak-town",
        "playerSubLocation": "shattered-shield-tavern",
        "npcsHere": ["格雷格", "小莉"]
      }
    }
  ],
  "summary": {
    "total": 15,
    "passed": 13,
    "failed": 0,
    "warnings": 2
  }
}
```

### 2. NPC 面板数据
```bash
GET /api/debug/npc-panel
```

返回前端 NPC 面板渲染所需的完整数据，用于验证前端显示逻辑。

**响应示例：**
```json
{
  "npcs": [
    {
      "key": "格雷格",
      "name": "格雷格·铁拳头",
      "title": "碎盾亭酒馆老板",
      "trust": 0,
      "totalLayers": 11,
      "knownLayers": 2,
      "unlocked": true,
      "condition": "normal"
    }
  ],
  "npcLocations": {
    "格雷格": {
      "location": "dawnbreak-town",
      "subLocation": "shattered-shield-tavern"
    }
  },
  "playerLocation": "dawnbreak-town",
  "playerSubLocation": "shattered-shield-tavern"
}
```

### 3. 会话状态
```bash
GET /api/debug/session
```

返回当前游戏会话的核心状态信息。

**响应示例：**
```json
{
  "player": {
    "name": "林克",
    "class": "fighter",
    "hp": 38,
    "maxHp": 38,
    "gold": 50
  },
  "world": {
    "location": "dawnbreak-town",
    "subLocation": "shattered-shield-tavern",
    "timeOfDay": "morning"
  },
  "chapter": {
    "current": 1,
    "completedBeats": ["ch1_intro"]
  },
  "combat": {
    "active": false
  },
  "npcs": [
    {
      "name": "格雷格",
      "trust": 0,
      "location": "dawnbreak-town",
      "subLocation": "shattered-shield-tavern",
      "condition": "normal"
    }
  ],
  "turnCount": 1
}
```

## 使用方法

### 方法 1：使用测试脚本（推荐）

```bash
# 运行所有诊断
node test-debug-api.js

# 只运行完整诊断
node test-debug-api.js diagnostics

# 只查看 NPC 面板数据
node test-debug-api.js npc-panel

# 只查看会话状态
node test-debug-api.js session

# 指定服务器地址
TRPG_URL=http://localhost:3000 node test-debug-api.js
```

### 方法 2：使用 curl

```bash
# 完整诊断
curl http://localhost:3000/api/debug/diagnostics | jq

# NPC 面板
curl http://localhost:3000/api/debug/npc-panel | jq

# 会话状态
curl http://localhost:3000/api/debug/session | jq
```

### 方法 3：在代码中调用

```javascript
async function diagnoseGame() {
  const response = await fetch('http://localhost:3000/api/debug/diagnostics')
  const report = await response.json()
  
  if (report.summary.failed > 0) {
    console.error('发现问题：', report.checks.filter(c => c.status === 'fail'))
  }
}
```

## AI 助手使用指南

当用户报告问题时，AI 助手可以：

1. **自动诊断**：调用 `/api/debug/diagnostics` 获取完整报告
2. **验证修复**：修改代码后，再次调用 API 验证问题是否解决
3. **对比数据**：调用 `/api/debug/npc-panel` 对比前端渲染逻辑
4. **状态检查**：调用 `/api/debug/session` 确认游戏状态

### 示例工作流

```bash
# 1. 用户报告："NPC 不显示在当前位置"
# 2. AI 调用诊断 API
curl http://localhost:3000/api/debug/diagnostics | jq '.checks[] | select(.category == "npc-location")'

# 3. 发现问题：位置匹配逻辑错误
# 4. 修改代码
# 5. 重新诊断验证
curl http://localhost:3000/api/debug/diagnostics | jq '.summary'

# 6. 确认修复成功
```

## 错误处理

### 503 Service Unavailable
```json
{
  "error": "游戏未启动"
}
```
**原因**：没有活跃的游戏会话  
**解决**：在浏览器中创建角色并开始游戏

### 500 Internal Server Error
```json
{
  "error": "具体错误信息"
}
```
**原因**：服务器内部错误  
**解决**：查看服务器日志，检查代码逻辑

## 扩展调试系统

### 添加新的诊断检查

在 `src/debug-api.ts` 中添加新的诊断函数：

```typescript
export function diagnoseNewFeature(session: GameSession): DebugCheck[] {
  const checks: DebugCheck[] = []
  
  // 添加检查逻辑
  checks.push({
    category: 'new-feature',
    name: 'Feature X status',
    status: 'pass',
    message: '功能正常',
    details: { /* 详细信息 */ }
  })
  
  return checks
}
```

然后在 `runFullDiagnostics()` 中调用：

```typescript
export function runFullDiagnostics(engine: GameEngine, session: GameSession): DebugReport {
  const checks: DebugCheck[] = [
    ...diagnoseNPCNameMatching(engine, session),
    ...diagnoseTrustSystem(session),
    ...diagnoseNewFeature(session),  // 新增
  ]
  // ...
}
```

### 添加新的 API 端点

在 `src/server.ts` 中添加：

```typescript
app.get('/api/debug/my-feature', (_req, res) => {
  if (!globalEngine) {
    res.status(503).json({ error: '游戏未启动' })
    return
  }
  try {
    const data = getMyFeatureData(globalEngine.session)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})
```

## 安全注意事项

- 调试 API 不需要认证，仅用于开发环境
- 生产环境应该禁用或添加认证保护
- 不要暴露敏感的玩家数据

## 未来改进

- [ ] 添加 WebSocket 实时诊断推送
- [ ] 支持历史诊断记录查询
- [ ] 添加性能监控指标
- [ ] 支持自动化回归测试
- [ ] 添加诊断结果可视化面板
