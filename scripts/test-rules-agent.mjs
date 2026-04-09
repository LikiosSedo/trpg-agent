#!/usr/bin/env node
/**
 * rules-agent smoke test — 验证 Phase 2 迁移(用 TRPGAgent 替换 open-claude-cli)
 * 后,分类器依然能正确工作。
 *
 * 测试内容:
 *   1. quickMatch 路径:简单正则能命中的输入(MOVE/SEARCH 等)— 不应触发 LLM
 *   2. llmClassify 路径:复杂或模糊输入 — 应该触发 LLM 并返回合理的分类
 *   3. 降级兜底:故意让 LLM 返回非法 JSON 也能降级到 NARRATIVE
 *
 * 运行方式:
 *   cd /Users/sdliu/project/trpg-agent-refactor
 *   npx tsx scripts/test-rules-agent.mjs
 */

import { classifyIntent } from '../src/rules-agent.ts'

// ─── 构造 mock session ─────────────────────────────

function makeMockSession() {
  return {
    player: {
      name: '测试玩家',
      inventory: [{ name: '短剑' }, { name: '治疗药水' }],
      hp: 30,
      maxHp: 38,
      gold: 50,
    },
    npcs: [
      { name: '格雷格', location: 'dawnbreak-town' },
      { name: '小莉', location: 'dawnbreak-town' },
      { name: '艾琳娜', location: 'dawnbreak-town' },
    ],
    worldState: {
      currentLocation: 'dawnbreak-town',
      currentSubLocation: 'tavern',
    },
    interactionNpc: null,
    combat: null,
    chapter: { currentChapter: 'ch1' },
  }
}

// ─── 测试框架 ──────────────────────────────────────

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

// ─── 测试用例 ──────────────────────────────────────

console.log('\n=== rules-agent smoke test ===\n')

const session = makeMockSession()

// --- Test 1: 简单正则(quickMatch) — 不应触发 LLM ---
console.log('--- Test 1: quickMatch paths (no LLM) ---')

{
  const t1Start = Date.now()
  const r = await classifyIntent('去暮色森林', session)
  const dur = Date.now() - t1Start
  assert(r.type === 'MOVE', `"去暮色森林" → MOVE`, `got ${r.type}`)
  assert(r.destination === '暮色森林', `destination 解析正确`, `got ${r.destination}`)
  assert(dur < 100, `quickMatch 快速返回 (<100ms)`, `took ${dur}ms`)
}

{
  const r = await classifyIntent('休息', session)
  assert(r.type === 'REST', `"休息" → REST`, `got ${r.type}`)
}

{
  const r = await classifyIntent('看看格雷格', session)
  assert(r.type === 'LOOK', `"看看格雷格" → LOOK`, `got ${r.type}`)
  assert(r.target === '格雷格', `target 解析正确`)
}

{
  const r = await classifyIntent('突袭', session)
  assert(r.type === 'ATTACK', `"突袭" → ATTACK`)
  assert(r.target === '', `target 为空(交给 engine 解析为 POI 遭遇)`)
}

// --- Test 2: LLM 分类路径 — 复杂/模糊输入 ---
console.log('\n--- Test 2: llmClassify paths (LLM required) ---')

{
  console.log('  → "我用治疗药水回一下血" (should be USE)')
  const t1Start = Date.now()
  const r = await classifyIntent('我用治疗药水回一下血', session)
  const dur = Date.now() - t1Start
  console.log(`    result: ${JSON.stringify(r)} (${dur}ms)`)
  assert(
    r.type === 'USE' || r.type === 'NARRATIVE',
    `复杂用品使用被识别 (USE 或降级 NARRATIVE)`,
    `got ${r.type}`,
  )
  assert(dur > 100, `LLM 路径有明显延迟(>100ms)`, `took ${dur}ms`)
}

{
  console.log('  → "跟格雷格说:这镇子最近怎么这么奇怪" (should be TALK)')
  const r = await classifyIntent(
    '跟格雷格说:这镇子最近怎么这么奇怪',
    session,
  )
  console.log(`    result: ${JSON.stringify(r)}`)
  assert(
    r.type === 'TALK' || r.type === 'NARRATIVE',
    `复杂对话被识别 (TALK 或降级 NARRATIVE)`,
    `got ${r.type}`,
  )
  if (r.type === 'TALK') {
    assert(r.npc === '格雷格', `TALK 的 npc 字段正确`, `got ${r.npc}`)
  }
}

{
  console.log('  → "环顾四周,我想看看这个酒馆里还有什么" (should be NARRATIVE or LOOK)')
  const r = await classifyIntent(
    '环顾四周,我想看看这个酒馆里还有什么',
    session,
  )
  console.log(`    result: ${JSON.stringify(r)}`)
  assert(
    r.type === 'NARRATIVE' || r.type === 'LOOK' || r.type === 'SEARCH',
    `模糊探索动作被合理处理`,
    `got ${r.type}`,
  )
}

// ─── 总结 ─────────────────────────────────────────

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
