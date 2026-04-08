#!/usr/bin/env node
/**
 * Context Manager + Archival Snapshot smoke test
 *
 * 纯单元测试,不调 LLM。验证 Phase 4 的核心行为:
 *   1. needsCompact 阈值判断正确
 *   2. compact 保留最近 K turn,早期变成归档消息
 *   3. 配对保护:tool_call 和 tool_result 不被切断
 *   4. system 消息保留在最前
 *   5. buildArchivalSnapshot 从 session 生成合理内容
 *   6. fallback:没有 buildSnapshot 回调时用默认文本
 *   7. buildSnapshot 抛异常时走 fallback
 *   8. 有 lore 工具时措辞动态调整
 *
 * 运行:
 *   cd /Users/sdliu/project/trpg-agent-refactor
 *   npx tsx scripts/test-context-manager.mjs
 */

import { z } from 'zod'
import { ContextManager, buildArchivalSnapshot } from '../src/agent/index.ts'
import { estimateTokens } from '../src/agent/messages.ts'

// ─── 测试框架 ──────────────────────────────────────

let passed = 0
let failed = 0

function assert(cond, name, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
    failed++
  }
}

// ─── Helpers ───────────────────────────────────────

/** 生成 N 个 turn 的 fake messages(user + assistant 成对)。withSystem 控制是否在最前面加一个 system 消息。 */
function makeFakeMessages(turns, charsPerMsg = 500, withSystem = true) {
  const msgs = withSystem
    ? [{ role: 'system', content: '你是 TRPG 主持人。'.repeat(10) }]
    : []
  for (let i = 0; i < turns; i++) {
    msgs.push({
      role: 'user',
      content: `玩家第${i + 1}轮输入: ${'这是一段较长的玩家输入内容,用于触发 token 估算。'.repeat(charsPerMsg / 40)}`,
    })
    msgs.push({
      role: 'assistant',
      content: `DM 第${i + 1}轮叙事: ${'这是一段较长的 DM 叙事内容,包含场景描写和 NPC 对话。'.repeat(charsPerMsg / 40)}`,
    })
  }
  return msgs
}

/** 生成一个带 tool_call 配对的 fake turn */
function makeToolCallTurn(turnIdx, toolCallId) {
  return [
    { role: 'user', content: `玩家第${turnIdx}轮: 和 NPC 对话` },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: { name: 'Talk', arguments: '{"npcId":"格雷格","message":"你好"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: toolCallId, content: '格雷格: "你好,勇士。"' },
    { role: 'assistant', content: `DM 第${turnIdx}轮叙事` },
  ]
}

/** 构造一个最小化的 mock session */
function makeMockSession() {
  return {
    player: {
      name: '测试玩家',
      className: '战士',
      level: 3,
      inventory: [],
      hp: 25,
      maxHp: 30,
      gold: 45,
      abilityModifiers: { STR: 2, CON: 1 },
      skills: [],
      equipped: {},
      spells: [],
    },
    npcs: [
      {
        name: '格雷格',
        trust: 3,
        knownFacts: [],
        playerPromises: [],
        interactionLog: [
          '第2轮：玩家对格雷格说"我是来找工作的冒险者"',
          '第5轮：玩家对格雷格说"告诉我矿洞的事"',
        ],
        location: 'dawnbreak-town',
        mood: 'neutral',
        trackedPromises: [
          { text: '调查矿洞事件', deadlineTurn: 30, fulfilled: false },
        ],
      },
      {
        name: '小莉',
        trust: 4,
        knownFacts: [],
        playerPromises: [],
        interactionLog: [
          '第3轮：玩家对小莉说"你会识字吗"',
        ],
        location: 'dawnbreak-town',
        mood: 'curious',
      },
      {
        name: '艾琳娜',
        trust: 1,
        knownFacts: [],
        playerPromises: [],
        interactionLog: [],
        location: 'dawnbreak-town',
        mood: 'professional',
      },
    ],
    worldState: {
      currentLocation: 'dawnbreak-town',
      currentSubLocation: 'tavern',
      flags: {
        'discovered_greg_scar': true,
        'violence_alert_active': 'victim=小莉,turn=10',
        'poi_unlocked_old_lumber_camp': true,
      },
    },
    chapter: {
      currentChapter: 'ch1',
      completedBeats: ['meet_greg', 'get_quest_forest'],
    },
    quests: [
      { name: '森林试炼', status: 'active', description: '...' },
      { name: '前去见格雷格', status: 'completed', description: '...' },
    ],
    dmMessages: [],
    turnCount: 15,
  }
}

// ═════════════════════════════════════════════════════

console.log('\n=== Context Manager + Archival Snapshot smoke test ===\n')

// ─── Test 1: needsCompact 阈值判断 ───────────────

console.log('--- Test 1: needsCompact 阈值判断 ---')
{
  const cm = new ContextManager({
    modelContextWindow: 1000,
    compactThreshold: 0.5, // 500 tokens 触发
    keepRecentTurns: 3,
  })

  // 空数组不触发
  assert(!cm.needsCompact([]), '空 messages 不需要压缩')

  // 小量 messages 不触发
  const small = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]
  assert(!cm.needsCompact(small), '少量 messages 不需要压缩')

  // 大量 messages 触发
  const big = makeFakeMessages(10, 200) // ~4000 chars → ~1000 tokens
  assert(cm.needsCompact(big), '大量 messages 需要压缩')
}

// ─── Test 2: compact 保留最近 K turn ──────────────

console.log('\n--- Test 2: compact 保留最近 K turn,早期变成归档消息 ---')
{
  const cm = new ContextManager({
    modelContextWindow: 1000,
    compactThreshold: 0.3,
    keepRecentTurns: 3,
  })

  const messages = makeFakeMessages(10, 100) // 10 turn × (user+assistant)
  const originalLength = messages.length
  const originalTokens = estimateTokens(messages)

  const result = cm.compact(messages)

  assert(result.strategy === 'archival', '策略应该是 archival')
  assert(result.droppedCount > 0, `droppedCount > 0 (got ${result.droppedCount})`)
  assert(
    messages.length < originalLength,
    `压缩后 length 减少 (${originalLength} → ${messages.length})`,
  )
  assert(
    result.tokensAfter < result.tokensBefore,
    `tokens 减少 (${result.tokensBefore} → ${result.tokensAfter})`,
  )

  // 第一条应该是 system,第二条应该是归档消息
  assert(messages[0]?.role === 'system', '第一条是 system message')
  assert(messages[1]?.role === 'user', '第二条是 user message (归档)')
  assert(
    typeof messages[1]?.content === 'string' &&
      messages[1].content.startsWith('[系统]'),
    '归档消息以 [系统] 前缀开头',
  )

  // 最后的 K 个 user message 应该都在
  const userMessages = messages.filter(m => m.role === 'user')
  // 去掉归档消息本身,应该剩 >= 3 个真实 user
  assert(
    userMessages.length >= 4, // 1 归档 + 3 真实
    `保留的 user messages >= 4 (got ${userMessages.length})`,
  )
}

// ─── Test 3: 配对保护 ─────────────────────────────

console.log('\n--- Test 3: 配对保护(tool_call / tool_result 不被切断) ---')
{
  const cm = new ContextManager({
    modelContextWindow: 1000,
    compactThreshold: 0.3,
    keepRecentTurns: 2,
  })

  // 构造一个包含多个 tool_call 对的消息流
  const messages = [
    { role: 'system', content: 'system prompt'.repeat(20) },
    ...makeToolCallTurn(1, 'call_1'),
    ...makeToolCallTurn(2, 'call_2'),
    ...makeToolCallTurn(3, 'call_3'),
    ...makeToolCallTurn(4, 'call_4'),
    ...makeToolCallTurn(5, 'call_5'),
  ]

  cm.compact(messages)

  // 验证所有保留的 assistant 消息的 tool_call 都有对应的 tool result
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const hasMatchingResult = messages.some(
          other => other.role === 'tool' && other.tool_call_id === tc.id,
        )
        assert(
          hasMatchingResult,
          `tool_call ${tc.id} 有对应的 tool result`,
          `orphaned in position ${i}`,
        )
      }
    }

    if (m.role === 'tool') {
      const hasMatchingCall = messages.some(
        other =>
          other.role === 'assistant' &&
          Array.isArray(other.tool_calls) &&
          other.tool_calls.some(tc => tc.id === m.tool_call_id),
      )
      assert(
        hasMatchingCall,
        `tool result ${m.tool_call_id} 有对应的 tool_call`,
        `orphaned in position ${i}`,
      )
    }
  }
}

// ─── Test 4: system 消息保留 ──────────────────────

console.log('\n--- Test 4: system 消息保留在最前 ---')
{
  const cm = new ContextManager({
    modelContextWindow: 1000,
    compactThreshold: 0.3,
    keepRecentTurns: 2,
  })

  // 不让 makeFakeMessages 自动加 system,这样我们能精确控制 system 数量
  const messages = [
    { role: 'system', content: '系统提示'.repeat(50) },
    ...makeFakeMessages(10, 100, /* withSystem= */ false),
  ]

  cm.compact(messages)

  assert(messages[0]?.role === 'system', '压缩后第一条仍是 system')
  // 只有一个 system(context-manager 不去重,但我们输入只有一个)
  const systemCount = messages.filter(m => m.role === 'system').length
  assert(systemCount === 1, `只有一个 system message (got ${systemCount})`)
}

// ─── Test 5: buildArchivalSnapshot 从 session 生成 ─────

console.log('\n--- Test 5: buildArchivalSnapshot 从 session 生成合理内容 ---')
{
  const session = makeMockSession()
  const snapshot = buildArchivalSnapshot(session, { keepRecentTurns: 12 })

  console.log('  ──── snapshot 输出 ────')
  console.log(
    snapshot
      .split('\n')
      .map(l => '  ' + l)
      .join('\n'),
  )
  console.log('  ──────────────────────')

  assert(snapshot.startsWith('[系统]'), '以 [系统] 前缀开头')
  assert(snapshot.includes('破晓镇'), '包含位置(破晓镇)')
  assert(snapshot.includes('碎盾亭酒馆'), '包含子地点(碎盾亭酒馆)')
  assert(snapshot.includes('第 1 章') || snapshot.includes('ch1'), '包含章节')
  assert(snapshot.includes('森林试炼'), '包含活跃任务')
  assert(snapshot.includes('格雷格'), '包含关键 NPC')
  assert(snapshot.includes('小莉'), '包含关键 NPC(小莉)')
  assert(snapshot.includes('玩家对格雷格说'), '包含最近交互')
  assert(snapshot.includes('discovered_greg_scar'), '包含关键 flag')
  assert(snapshot.includes('调查矿洞事件'), '包含未兑现承诺')
  assert(snapshot.includes('最近 12 轮对话'), '包含保留 turn 数提示')
  assert(!snapshot.includes('lore 工具'), '没有 lore 工具时不提示查询 lore')
}

// ─── Test 6: 有 lore 工具时动态措辞 ───────────────

console.log('\n--- Test 6: 有 lore 工具时措辞动态调整 ---')
{
  const session = makeMockSession()
  const snapshotWithLore = buildArchivalSnapshot(session, {
    keepRecentTurns: 12,
    availableToolNames: ['ReadLore', 'GrepLore', 'SetActions', 'Talk'],
  })

  assert(
    snapshotWithLore.includes('lore 工具') || snapshotWithLore.includes('ReadLore'),
    '有 lore 工具时在提示里提到',
  )

  const snapshotWithoutLore = buildArchivalSnapshot(session, {
    keepRecentTurns: 12,
    availableToolNames: ['SetActions', 'Talk'],
  })

  assert(
    !snapshotWithoutLore.includes('lore 工具') && !snapshotWithoutLore.includes('ReadLore'),
    '无 lore 工具时不提示',
  )
}

// ─── Test 7: fallback 行为(无 buildSnapshot 回调) ────

console.log('\n--- Test 7: 无 buildSnapshot 回调时用 fallback ---')
{
  const cm = new ContextManager({
    modelContextWindow: 1000,
    compactThreshold: 0.3,
    keepRecentTurns: 3,
    // 不提供 buildArchivalSnapshot
  })

  const messages = makeFakeMessages(10, 100)
  const result = cm.compact(messages)

  assert(result.strategy === 'archival', 'fallback 也走 archival 策略')
  // 找到归档消息(应该是 user role,在 system 之后)
  const archivalMsg = messages.find(
    m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[系统]'),
  )
  assert(archivalMsg != null, '有一条 fallback 归档消息')
}

// ─── Test 8: buildSnapshot 抛异常时优雅降级 ─────────

console.log('\n--- Test 8: buildSnapshot 抛异常时走 fallback,不让压缩失败 ---')
{
  const cm = new ContextManager({
    modelContextWindow: 1000,
    compactThreshold: 0.3,
    keepRecentTurns: 3,
    buildArchivalSnapshot: () => {
      throw new Error('故意抛异常')
    },
  })

  const messages = makeFakeMessages(10, 100)

  let didThrow = false
  let result
  try {
    result = cm.compact(messages)
  } catch (err) {
    didThrow = true
  }

  assert(!didThrow, 'compact 不应该抛异常')
  assert(result?.strategy === 'archival', '依然走 archival 策略(带 fallback 文本)')
}

// ─── Test 9: noop 行为(messages 太短) ────────────

console.log('\n--- Test 9: messages 太短时 noop,不做任何改动 ---')
{
  const cm = new ContextManager({
    modelContextWindow: 1000,
    compactThreshold: 0.1,
    keepRecentTurns: 10, // 要保留 10 个 user turn,但只有 2 个
  })

  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'bye' },
    { role: 'assistant', content: 'goodbye' },
  ]
  const lenBefore = messages.length

  const result = cm.compact(messages)

  assert(result.strategy === 'noop', 'noop 策略')
  assert(messages.length === lenBefore, '数组长度不变')
  assert(result.droppedCount === 0, 'droppedCount === 0')
}

// ─── 总结 ─────────────────────────────────────────

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
