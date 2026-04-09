#!/usr/bin/env node
/**
 * dm-agent smoke test — 验证 Phase 3 迁移的包装层行为正确。
 *
 * **不调用 LLM**。dmRespond 的真实 streaming + tool calling 行为已经在
 * Phase 1 的 test-agent.mjs 里用 createAgent 直接验证过,这里只测
 * dm-agent.ts 包装层相对于旧版(open-claude-cli)的语义一致性:
 *
 *   1. initDMAgent() 能成功初始化
 *   2. muteDMTools([]) 强制保留 SetActions(CLAUDE.md 架构陷阱 #2 兜底)
 *   3. muteDMTools(['Talk']) 只保留 Talk + SetActions(显式 + 自动兜底)
 *   4. unmuteDMTools() 恢复全部工具,且对未 mute 状态幂等
 *   5. 重复 muteDMTools() 被正确幂等(第二次调用不应再次污染 mutedTools)
 *   6. getDMMessages() / restoreDMMessages() 往返一致
 *
 * 运行方式:
 *   cd /Users/sdliu/project/trpg-agent-refactor
 *   npx tsx scripts/test-dm-agent.mjs
 */

import {
  initDMAgent,
  getDMAgent,
  muteDMTools,
  unmuteDMTools,
  getDMMessages,
  restoreDMMessages,
} from '../src/dm-agent.ts'

// ─── 辅助 ────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(condition, name, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

function toolNames(agent) {
  return agent.tools.map(t => t.name).sort()
}

// ─── 初始化 ─────────────────────────────────────────

console.log('\n=== dm-agent smoke test ===\n')

console.log('--- Test 0: initDMAgent() ---')
try {
  initDMAgent()
  console.log('  ✓ initDMAgent() 成功')
  passed++
} catch (err) {
  console.error(`  ✗ initDMAgent() 抛异常: ${err.message}`)
  failed++
  process.exit(1)
}

const agent = getDMAgent()
const allTools = toolNames(agent)
console.log(`  ✓ getDMAgent() 返回 agent,注册了 ${allTools.length} 个工具: ${allTools.join(', ')}`)
passed++

const EXPECTED_TOOLS = [
  'ChangeTrust', 'LookEnv', 'ManageParty', 'Move', 'MoveNPC',
  'ProposeTrade', 'RenderScene', 'Rest', 'RollDice', 'Search',
  'SetActions', 'SetAmbiance', 'Talk', 'TransferItem',
  'TriggerHostileNPC', 'TriggerTrustCascade', 'UseItem',
]
// 不严格匹配,只检查 SetActions 和 Talk 必在
assert(allTools.includes('SetActions'), 'SetActions 在工具列表中')
assert(allTools.includes('Talk'), 'Talk 在工具列表中')
assert(!allTools.includes('Attack'), 'Attack 不在 DM 工具列表(由代码入口控制)')

// ─── Test 1: 空白名单的 SetActions 兜底 ───────────

console.log('\n--- Test 1: muteDMTools([]) 强制保留 SetActions (架构陷阱 #2 兜底) ---')
{
  muteDMTools([])
  const after = toolNames(agent)
  assert(after.length === 1, `mute 后只剩 1 个工具`, `got ${after.length}: [${after.join(',')}]`)
  assert(after[0] === 'SetActions', `剩下的是 SetActions`, `got ${after[0]}`)
  unmuteDMTools()
  const restored = toolNames(agent)
  assert(
    restored.length === allTools.length,
    `unmute 后恢复到 ${allTools.length} 个工具`,
    `got ${restored.length}`,
  )
}

// ─── Test 2: 显式白名单 + 自动 SetActions ─────────

console.log('\n--- Test 2: muteDMTools([Talk]) → 只保留 Talk + SetActions ---')
{
  muteDMTools(['Talk'])
  const after = toolNames(agent)
  assert(after.length === 2, `mute 后剩 2 个工具`, `got ${after.length}: [${after.join(',')}]`)
  assert(after.includes('Talk'), `Talk 在保留列表`)
  assert(after.includes('SetActions'), `SetActions 自动保留`)
  unmuteDMTools()
  assert(
    toolNames(agent).length === allTools.length,
    `unmute 后完全恢复`,
  )
}

// ─── Test 3: 显式包含 SetActions 不重复 ────────────

console.log('\n--- Test 3: muteDMTools([SetActions, Talk]) 不应双倍保留 ---')
{
  muteDMTools(['SetActions', 'Talk'])
  const after = toolNames(agent)
  assert(after.length === 2, `mute 后剩 2 个工具`, `got ${after.length}: [${after.join(',')}]`)
  assert(
    after.includes('SetActions') && after.includes('Talk'),
    `SetActions 和 Talk 都在`,
  )
  unmuteDMTools()
}

// ─── Test 4: 重复 mute 的幂等性 ───────────────────

console.log('\n--- Test 4: 重复 muteDMTools() 幂等 ---')
{
  muteDMTools(['Talk'])
  const afterFirst = toolNames(agent)
  muteDMTools(['Move']) // 第二次 mute(不同白名单),应该被忽略或不破坏
  const afterSecond = toolNames(agent)
  assert(
    afterFirst.length === afterSecond.length,
    `重复 mute 不应改变 active 工具数量`,
    `first=${afterFirst.length}, second=${afterSecond.length}`,
  )
  assert(
    JSON.stringify(afterFirst) === JSON.stringify(afterSecond),
    `重复 mute 保持第一次的白名单`,
  )
  unmuteDMTools()
  assert(
    toolNames(agent).length === allTools.length,
    `unmute 后恢复全部工具`,
  )
}

// ─── Test 5: unmute 对未 mute 状态幂等 ────────────

console.log('\n--- Test 5: unmuteDMTools() 对未 mute 状态幂等 ---')
{
  const before = toolNames(agent)
  unmuteDMTools() // 重复 unmute,应该无副作用
  unmuteDMTools()
  const after = toolNames(agent)
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    `重复 unmute 不改变状态`,
  )
}

// ─── Test 6: messages 持久化往返 ───────────────────

console.log('\n--- Test 6: getDMMessages() / restoreDMMessages() 往返 ---')
{
  const sample = [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好,勇士。' },
  ]
  restoreDMMessages(sample)
  const retrieved = getDMMessages()
  assert(
    retrieved.length === sample.length,
    `往返后 messages 长度一致`,
    `sent ${sample.length}, got ${retrieved.length}`,
  )
  assert(
    retrieved[0]?.role === 'user' && retrieved[0]?.content === '你好',
    `user message 内容保持`,
  )
  assert(
    retrieved[1]?.role === 'assistant' && retrieved[1]?.content === '你好,勇士。',
    `assistant message 内容保持`,
  )
  // 清空,避免污染后续测试
  restoreDMMessages([])
}

// ─── 总结 ─────────────────────────────────────────

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
