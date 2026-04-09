#!/usr/bin/env node
/**
 * Phase 5/6 集成测试 — 真实 LLM 调用 Lore/Journal 工具的端到端验证
 *
 * 这是单元测试覆盖不到的关键路径:
 *   - 单元测试验证 LoreStore / appendJournal 的函数级行为
 *   - 但从来没让真实 LLM 实际调用 ReadLore/RecordJournal 工具
 *   - 如果工具 schema / description 有问题,LLM 会拒绝调用,或参数格式错
 *
 * 运行:
 *   npx tsx scripts/test-phase5-6-integration.mjs
 */

import { initGameState, initItemRegistry, getSession, getFacts } from '../src/game-state.ts'
import { createGameSession } from '../src/game-data.ts'
import { initDMAgent, dmRespond } from '../src/dm-agent.ts'
import { ChapterManager } from '../src/chapter-manager.ts'

let passed = 0
let failed = 0

function assert(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function group(name) {
  console.log(`\n── ${name} ──`)
}

/** 跑一次 dmRespond,收集所有事件,返回聚合结果 */
async function runDMTurn(input) {
  const result = {
    events: [],
    eventCounts: {},
    toolResults: [],
    text: '',
    thinking: '',
    error: null,
  }

  try {
    for await (const ev of dmRespond(input)) {
      result.events.push(ev.type)
      result.eventCounts[ev.type] = (result.eventCounts[ev.type] ?? 0) + 1

      // 字段名对齐 agent/types.ts:
      //   text_delta     → { text: string }
      //   thinking_delta → { thinking: string }
      //   tool_result    → { id?, name, output, isError }
      if (ev.type === 'text_delta' && ev.text) result.text += ev.text
      if (ev.type === 'thinking_delta' && ev.thinking) result.thinking += ev.thinking
      if (ev.type === 'tool_result') {
        result.toolResults.push({
          name: ev.name,
          output: (ev.output ?? '').slice(0, 200),
          isError: ev.isError,
        })
      }
    }
  } catch (err) {
    result.error = err
  }

  return result
}

function dumpTurnStats(r) {
  const cts = Object.entries(r.eventCounts).map(([t, c]) => `${t}=${c}`).join(', ')
  console.log(`  事件: ${r.events.length} 个 (${cts})`)
  console.log(`  text=${r.text.length} · thinking=${r.thinking.length} · tools=${r.toolResults.length}`)
  for (const tr of r.toolResults) {
    const errMark = tr.isError ? ' [ERROR]' : ''
    console.log(`    → ${tr.name}: ${tr.output}${errMark}`)
  }
  if (r.text) console.log(`  text 预览: ${r.text.slice(0, 120)}${r.text.length > 120 ? '…' : ''}`)
}

// ── Setup ────────────────────────────────────────────

console.log('=== Phase 5/6 real-LLM integration test ===')
console.log('初始化游戏状态...')
initItemRegistry()
const freshSession = createGameSession('测试玩家', 'fighter')
initGameState(freshSession)
new ChapterManager(freshSession).processAutoBeats?.()
console.log(`  session.turnCount = ${getSession().turnCount}`)
console.log(`  session.chapter?.currentChapter = ${getSession().chapter?.currentChapter}`)

console.log('初始化 DM agent...')
initDMAgent()

// ── Test 1 ───────────────────────────────────────────

async function test1() {
  group('Test 1: DM 调用 ReadLore 查询格雷格')
  const input = '【系统引导】你需要回答关于格雷格的一个问题。请先调用 ReadLore 工具查询"格雷格"的完整设定,然后基于查到的内容用一两句话总结他的身份。不要编造内容,必须以 ReadLore 返回的信息为准。'
  const r = await runDMTurn(input)

  if (r.error) {
    console.error(`  ✗ dmRespond 抛异常: ${r.error.message}`)
    failed += 1
    return
  }
  dumpTurnStats(r)

  const loreCall = r.toolResults.find(tr => /^(ReadLore|ListLore|GrepLore)$/i.test(tr.name ?? ''))
  assert('DM 至少调用了一个 Lore 工具', loreCall !== undefined,
    `实际: ${r.toolResults.map(t => t.name).join(',') || '无'}`)

  if (loreCall) {
    assert('Lore 工具无 error', !loreCall.isError)
    assert('Lore 返回非空', loreCall.output.length > 0)
    assert('Lore 输出包含"格雷格"', loreCall.output.includes('格雷格'))
  }

  // DM 可能在 thinking 里写总结而没输出 text — 对于 kimi-thinking 这是合法的。
  // 但至少应该有某种内容产出。
  assert('至少有某种内容输出(text 或 thinking)', r.text.length + r.thinking.length > 0)
  assert('最终有叙事文本', r.text.length > 5,
    `如果只有 thinking 说明 LLM 决定不输出 text,可能需要调 prompt`)
  assert('无 error 事件', !r.events.includes('error'))
}

// ── Test 2 ───────────────────────────────────────────

async function test2() {
  group('Test 2: DM 调用 RecordJournal 记录决策')
  const input = '【系统引导】玩家刚才做出了一个重大决定:他选择为了保护小莉,放弃了去矿洞的悬赏任务。这是一个会影响后续剧情走向的选择。请你调用 RecordJournal 工具记录这个决定(type="decision"),然后用一句话确认这个选择的情感色彩。'
  const r = await runDMTurn(input)

  if (r.error) {
    console.error(`  ✗ dmRespond 抛异常: ${r.error.message}`)
    failed += 1
    return
  }
  dumpTurnStats(r)

  const journalCall = r.toolResults.find(tr => tr.name === 'RecordJournal')
  assert('DM 调用了 RecordJournal', journalCall !== undefined,
    `实际: ${r.toolResults.map(t => t.name).join(',') || '无'}`)

  if (journalCall) {
    assert('RecordJournal 无 error', !journalCall.isError)
  }

  // 最终真相:session.dmJournal 到底写进去没有
  const journal = getSession().dmJournal ?? []
  console.log(`  session.dmJournal 长度: ${journal.length}`)
  if (journal.length > 0) {
    const last = journal[journal.length - 1]
    console.log(`  最新: [${last.type}] ${last.content.slice(0, 100)}`)
  }
  assert('session.dmJournal 已写入', journal.length > 0)
  if (journal.length > 0) {
    const latest = journal[journal.length - 1]
    assert('type === decision', latest.type === 'decision', `实际: ${latest.type}`)
    assert('content 非空', latest.content.length > 0)
  }
}

// ── Run ──────────────────────────────────────────────

;(async () => {
  try {
    await test1()
    await test2()
  } catch (err) {
    console.error(`\n致命错误: ${err.stack ?? err.message}`)
    failed += 1
  }

  console.log(`\n══════════════════════════════════════════`)
  console.log(`  通过: ${passed}  失败: ${failed}`)
  console.log(`══════════════════════════════════════════`)
  process.exit(failed > 0 ? 1 : 0)
})()
