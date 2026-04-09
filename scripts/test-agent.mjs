#!/usr/bin/env node
/**
 * End-to-end Agent smoke test — 验证完整的 "user input → LLM → tool call →
 * tool execute → LLM 继续 → text output" 全流程。
 *
 * 测试内容:
 *   1. 单 turn 无工具:简单问答 → 只有 text_delta 事件
 *   2. 多 turn 带工具:要求掷骰子 → LLM 调 RollDice → 执行 → LLM 叙述结果
 *
 * 运行方式:
 *   cd /Users/sdliu/project/trpg-agent-refactor
 *   npx tsx scripts/test-agent.mjs
 */

import { z } from 'zod'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createAgent } from '../src/agent/index.ts'

// ─── 配置 ────────────────────────────────────────────

function loadConfig() {
  if (process.env.TRPG_API_KEY) {
    if (!process.env.TRPG_BASE_URL) {
      throw new Error('TRPG_API_KEY 已设置但缺少 TRPG_BASE_URL')
    }
    return {
      apiKey: process.env.TRPG_API_KEY,
      baseUrl: process.env.TRPG_BASE_URL,
      model: process.env.TRPG_MODEL ?? 'kimi-for-coding',
      type: 'openai',
      headers: process.env.TRPG_HEADERS ? JSON.parse(process.env.TRPG_HEADERS) : undefined,
      streamUsage: process.env.TRPG_STREAM_USAGE === 'false' ? false : undefined,
    }
  }
  const configPath = join(homedir(), '.occ', 'config.json')
  if (existsSync(configPath)) {
    const c = JSON.parse(readFileSync(configPath, 'utf-8'))
    return {
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      model: c.model ?? 'kimi-for-coding',
      type: 'openai',
      headers: c.headers,
      streamUsage: c.streamUsage,
    }
  }
  throw new Error('找不到配置')
}

const providerConfig = loadConfig()

console.log(`\n=== TRPGAgent end-to-end test ===`)
console.log(`Model: ${providerConfig.model}\n`)

// ─── 定义一个真实可执行的 DiceTool ─────────────────

let diceExecuteCount = 0

const diceTool = {
  name: 'RollDice',
  description: '掷骰子并计算结果。用于技能检定、攻击判定等。当玩家需要掷骰时必须调用此工具。',
  inputSchema: z.object({
    dice: z.string().describe('骰子表达式,如 "d20" 或 "2d6+3"'),
    purpose: z.string().describe('掷骰目的,如 "力量检定" 或 "攻击判定"'),
    dc: z.number().optional().describe('难度等级(可选)'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input) {
    diceExecuteCount++
    // 简单实现:d20 就是 1-20 随机
    const match = input.dice.match(/^d(\d+)$/)
    if (!match) {
      return { output: `(不支持的骰子: ${input.dice})` }
    }
    const sides = parseInt(match[1], 10)
    const roll = Math.floor(Math.random() * sides) + 1
    const dc = input.dc
    const pass = dc !== undefined ? roll >= dc : null
    const output =
      `掷骰结果: ${input.purpose} d${sides} = ${roll}` +
      (dc !== undefined ? ` vs DC${dc} → ${pass ? '成功' : '失败'}` : '')
    console.log(`  [tool.execute] ${output}`)
    return { output }
  },
}

// ─── Test 1: 单 turn 无工具 ─────────────────────────

console.log('--- Test 1: Single turn, no tools ---')
console.log('Request: "用一句话形容暮色森林"\n')

try {
  const agent1 = createAgent({
    provider: providerConfig,
    tools: [],
    systemPrompt: '你是 TRPG 说书人,语言要有画面感。',
    maxTurns: 5,
    apiThrottleMs: 0, // smoke test 不需要节流
    maxTokens: 2000,
  })

  let textOutput = ''
  let thinkingChars = 0
  let turnEnded = false

  for await (const ev of agent1.run('用一句话形容暮色中的森林,不超过 30 字。')) {
    switch (ev.type) {
      case 'text_delta':
        textOutput += ev.text
        process.stdout.write(ev.text)
        break
      case 'thinking_delta':
        thinkingChars += ev.thinking.length
        break
      case 'tool_result':
        console.log(`\n[unexpected tool_result] ${ev.name}: ${ev.output}`)
        break
      case 'turn_end':
        turnEnded = true
        break
    }
  }

  console.log(
    `\n  ✓ Test 1 done. text=${textOutput.length} chars, thinking=${thinkingChars} chars, turnEnded=${turnEnded}`,
  )
  console.log(`    messages.length = ${agent1.getMessages().length} (expected 2: user + assistant)`)
} catch (err) {
  console.error(`\n  ✗ Test 1 failed: ${err.name}: ${err.message}`)
  process.exit(1)
}

// ─── Test 2: 多 turn + 工具调用 ────────────────────

console.log('\n--- Test 2: Multi-turn with tool call ---')
console.log('Request: "玩家想进行一次力量检定(DC 15),请帮他掷 d20 然后描述结果。"\n')

try {
  diceExecuteCount = 0

  const agent2 = createAgent({
    provider: providerConfig,
    tools: [diceTool],
    systemPrompt:
      '你是 TRPG 说书人。玩家需要掷骰时必须调用 RollDice 工具,不要自己编造结果。' +
      '收到掷骰结果后,用 1-2 句有画面感的话描述发生了什么。',
    maxTurns: 5,
    apiThrottleMs: 0,
    maxTokens: 3000,
  })

  let textOutput = ''
  let toolResultCount = 0
  let turnEnded = false
  let eventCount = 0

  for await (const ev of agent2.run(
    '玩家想进行一次力量检定(DC 15),请帮他掷 d20 然后描述结果。',
  )) {
    eventCount++
    switch (ev.type) {
      case 'text_delta':
        textOutput += ev.text
        process.stdout.write(ev.text)
        break
      case 'thinking_delta':
        // 静默
        break
      case 'tool_result':
        toolResultCount++
        console.log(`\n  [tool_result] ${ev.name} isError=${ev.isError}`)
        console.log(`    output: ${ev.output}`)
        break
      case 'turn_end':
        turnEnded = true
        break
    }
  }

  console.log(`\n  ✓ Test 2 done.`)
  console.log(`    text length: ${textOutput.length} chars`)
  console.log(`    tool_result events: ${toolResultCount}`)
  console.log(`    diceTool.execute called: ${diceExecuteCount} times`)
  console.log(`    total events: ${eventCount}`)
  console.log(`    turn_end fired: ${turnEnded}`)
  console.log(`    messages.length: ${agent2.getMessages().length}`)

  // 验证期望:
  if (diceExecuteCount === 0) {
    console.warn(`  ⚠ LLM 没有调用 RollDice!可能是 prompt 或模型的问题`)
  }
  if (toolResultCount !== diceExecuteCount) {
    console.error(`  ✗ tool_result 事件数 (${toolResultCount}) != diceTool 执行数 (${diceExecuteCount})`)
    process.exit(1)
  }
  if (!turnEnded) {
    console.error(`  ✗ turn_end 没有 fire!`)
    process.exit(1)
  }

  // dump messages 让人看看
  console.log(`\n  messages trace:`)
  for (const msg of agent2.getMessages()) {
    if (msg.role === 'user') {
      console.log(`    [user]       ${String(msg.content).slice(0, 60)}...`)
    } else if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string' ? msg.content.slice(0, 60) : '(no text)'
      const tc = msg.tool_calls ? ` + ${msg.tool_calls.length} tool_calls` : ''
      console.log(`    [assistant]  ${text}...${tc}`)
    } else if (msg.role === 'tool') {
      console.log(`    [tool ${msg.tool_call_id.slice(0, 15)}...] ${String(msg.content).slice(0, 60)}...`)
    }
  }
} catch (err) {
  console.error(`\n  ✗ Test 2 failed: ${err.name}: ${err.message}`)
  if (err.cause) console.error(`    cause: ${err.cause}`)
  process.exit(1)
}

console.log('\n=== All tests passed ===\n')
