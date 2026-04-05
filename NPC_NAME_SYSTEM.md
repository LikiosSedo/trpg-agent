# NPC 名称匹配系统设计文档

## 核心原则

**短名（key）用于查找，全名（name）用于显示**

## 数据结构

### 1. session.npcs[]
```typescript
{
  name: '格雷格',  // 短名，用于所有查找操作
  // ... 其他字段
}
```

### 2. dossier.entries (Map)
```typescript
Map<string, DossierEntry>
// key: '格雷格' (短名)
// value: { name: '格雷格·铁拳头', ... } (全名在 entry 内)
```

### 3. BASE_INFO (dossier.ts)
```typescript
{
  '格雷格': {  // key 是短名
    name: '格雷格·铁拳头',  // 全名
    title: '碎盾亭酒馆老板',
    appearance: '...'
  }
}
```

## 数据流

### 前端 → 后端（用户输入）
```
用户点击"交谈" → npcTalk('格雷格') 
→ 填入输入框："和格雷格交谈："
→ rules-agent 正则提取：'格雷格' (短名)
→ Talk tool: session.npcs.find(n => n.name === '格雷格')  ✓
```

### 后端 → 前端（NPC 列表）
```
/npc 命令 → engine.ts
→ npcLocations[npc.name] = {...}  // npc.name 是短名 '格雷格'
→ dossier.toListData(trustMap) 返回：
  [{ key: '格雷格', name: '格雷格·铁拳头', ... }]
→ 前端接收：
  data.npcLocations = { '格雷格': {...} }
  data.npcs = [{ key: '格雷格', name: '格雷格·铁拳头' }]
→ 前端查找：npcLocs[npc.key]  // npc.key = '格雷格' ✓
```

## 关键代码位置

### 后端
1. **engine.ts:865** - 构建 npcLocations
   ```typescript
   npcLocations[npc.name] = { ... }  // npc.name 是短名
   ```

2. **dossier.ts:482** - toListData()
   ```typescript
   return Array.from(this.entries).map(([key, entry]) => ({
     key,            // 短名（和 session.npcs[].name 一致）
     name: entry.name, // 全名（显示用）
     ...
   }))
   ```

3. **所有 NPC 查找**
   ```typescript
   session.npcs.find(n => n.name === npcId)  // 使用短名
   ```

### 前端
1. **index.html:2300** - 查找 NPC 位置
   ```javascript
   const loc = npcLocs[npc.key || npc.name]  // npc.key 是短名
   ```

2. **index.html:2328** - 获取头像
   ```javascript
   const npcKey = npc.key || npc.name  // 用于查找
   const portrait = NPC_PORTRAIT_MAP[npcKey]
   ```

3. **index.html:2356** - 交谈按钮
   ```javascript
   npcTalk('${esc(npcKey)}')  // 传递短名
   ```

## 调试日志

### 后端日志（engine.ts:872-876）
```
[npc-panel] player at: dawnbreak-town/town-square
[npc-panel] npcLocations keys: ['格雷格', '小莉', ...]
[npc-panel] dossier.toListData keys: ['格雷格(格雷格·铁拳头)', ...]
[npc-panel] 格雷格: dawnbreak-town/shattered-shield-tavern
```

### 前端日志（index.html:2297-2303）
```
[npc-panel-frontend] playerLoc: dawnbreak-town playerSub: town-square
[npc-panel-frontend] npcLocs keys: ['格雷格', '小莉', ...]
[npc-panel-frontend] npcs: ['key=格雷格 name=格雷格·铁拳头', ...]
[npc-panel-frontend] 格雷格(格雷格·铁拳头): loc={...}, sameSub=false
```

## 常见问题排查

### 问题：NPC 不显示在"当前在场"
**检查清单：**
1. 后端日志：`npcLocations` 的 key 是否是短名？
2. 前端日志：`npc.key` 是否正确传递？
3. 位置匹配：`loc.location === playerLoc && loc.subLocation === playerSub`
4. NPC 是否已解锁：`dossier.isUnlocked(npc.name)`

### 问题：点击"交谈"按钮无反应
**检查清单：**
1. 按钮传递的是短名还是全名？应该是短名
2. rules-agent 正则是否正确提取？
3. Talk tool 是否找到 NPC？`session.npcs.find(n => n.name === npcId)`

### 问题：NPC 头像不显示
**检查清单：**
1. `NPC_PORTRAIT_MAP` 的 key 是短名
2. `renderNPCCard` 使用 `npc.key` 查找

## 测试用例

### 测试 1：移动到 NPC 所在位置
```
输入：去碎盾亭酒馆
预期：格雷格和小莉显示在"当前在场"，有"交谈"按钮
```

### 测试 2：点击交谈按钮
```
操作：点击格雷格的"交谈"按钮
预期：输入框填入"和格雷格交谈："
```

### 测试 3：查看 NPC 详情
```
操作：点击 NPC 卡片
预期：显示完整档案，包含全名"格雷格·铁拳头"
```

## 未来改进建议

1. **类型安全**：定义 `NPCKey` 类型，区分短名和全名
2. **统一接口**：创建 `getNPCByKey(key: string)` 辅助函数
3. **验证机制**：启动时检查所有 NPC 名称的一致性
4. **错误提示**：当名称不匹配时，给出明确的错误信息

## 修改历史

- 2026-04-06: 添加详细日志，系统性审查名称匹配逻辑
- 2026-04-06: 确认 commit 33ad8ec 的修复已正确实现
