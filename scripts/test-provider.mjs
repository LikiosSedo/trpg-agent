#!/usr/bin/env node
/**
 * Provider smoke test — 直接调用 provider.ts,验证 streaming 和 tool calling
 * 不经过 agent.ts,用于 Phase 1 Step 2 的独立验证。
 *
 * 运行方式(需要在 worktree 目录):
 *   cd /Users/sdliu/project/trpg-agent-refactor
 *   TRPG_API_KEY=... TRPG_BASE_URL=... TRPG_MODEL=... node --import tsx scripts/test-provider.mjs
 *
 * 或者用 tsx 直接跑:
 *   pnpm tsx scripts/test-provider.mjs
 *
 * 测试内容:
 *   1. 纯文本 streaming:"说一句中文问候" → 应该看到 text_delta 逐字输出
 *   2. 工具调用 streaming:"掷一个 d20" → 应该触发 RollDice tool_call
 */

import { z } from 'zod'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { OpenAICompatProvider } from '../src/agent/provider.ts'

// ─── 配置 ────────────────────────────────────────────
// 优先环境变量,fallback ~/.occ/config.json(和 dm-agent.ts 的 loadConfig 一致)

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
  throw new Error('找不到配置:既没有 TRPG_API_KEY 环境变量也没有 ~/.occ/config.json')
}

let config
try {
  config = loadConfig()
} catch (err) {
  console.error(`❌ ${err.message}`)
  process.exit(1)
}

console.log(`\n=== Provider smoke test ===`)
console.log(`Model: ${config.model}`)
console.log(`BaseURL: ${config.baseUrl}\n`)

const provider = new OpenAICompatProvider(config)

// ─── 测试 1:纯文本 streaming ─────────────────────

console.log('--- Test 1: Pure text streaming ---')
console.log('Request: "用一句话描写暮色中的森林"')
process.stdout.write('Response: ')

try {
  const messages = [
    { role: 'user', content: '用一句话描写暮色中的森林,不要超过 30 字。' },
  ]

  let textChars = 0
  let reasoningChars = 0
  let finishReason = null

  for await (const ev of provider.stream(messages, [], {
    systemPrompt: '你是一个 TRPG 的说书人,叙事要有画面感。',
    maxTokens: 1000,  // 给 thinking 模型留足空间
  })) {
    switch (ev.type) {
      case 'text_delta':
        process.stdout.write(ev.text)
        textChars += ev.text.length
        break
      case 'reasoning_delta':
        reasoningChars += ev.text.length
        break
      case 'tool_call':
        console.log(`\n[unexpected tool_call in text test] ${ev.name}(${ev.argsJson})`)
        break
      case 'finish':
        finishReason = ev.reason
        break
    }
  }

  console.log(`\n  ✓ Test 1 done. text=${textChars} chars, reasoning=${reasoningChars} chars, finish=${finishReason}`)
} catch (err) {
  console.error(`\n  ✗ Test 1 failed: ${err.name}: ${err.message}`)
  if (err.cause) console.error(`    Cause: ${err.cause}`)
  process.exit(1)
}

// ─── 测试 2:Tool calling streaming ────────────────

console.log('\n--- Test 2: Tool calling ---')
console.log('Request: "请掷一个 d20,主题是力量检定"')

const rollDiceTool = {
  name: 'RollDice',
  description: '掷骰子并计算结果。用于技能检定、攻击判定等。',
  inputSchema: z.object({
    dice: z.string().describe('骰子表达式,如 "d20" 或 "2d6+3"'),
    purpose: z.string().describe('掷骰目的,如 "力量检定" 或 "攻击判定"'),
    dc: z.number().optional().describe('难度等级(可选)'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input) {
    return { output: `(smoke test 不实际执行)` }
  },
}

try {
  const messages = [
    { role: 'user', content: '请帮我掷一个 d20,这是力量检定,DC 15。' },
  ]

  let toolCallCount = 0
  let finishReason = null

  for await (const ev of provider.stream(messages, [rollDiceTool], {
    systemPrompt: '你是 TRPG 说书人,玩家需要掷骰时必须调用 RollDice 工具。',
    maxTokens: 200,
  })) {
    switch (ev.type) {
      case 'text_delta':
        process.stdout.write(ev.text)
        break
      case 'reasoning_delta':
        // 静默
        break
      case 'tool_call':
        toolCallCount++
        console.log(`\n[tool_call] id=${ev.id} name=${ev.name}`)
        console.log(`  argsJson: ${ev.argsJson}`)
        try {
          const parsed = JSON.parse(ev.argsJson)
          console.log(`  parsed: ${JSON.stringify(parsed)}`)
        } catch (e) {
          console.log(`  ⚠ argsJson 不是合法 JSON: ${e.message}`)
        }
        break
      case 'finish':
        finishReason = ev.reason
        break
    }
  }

  console.log(`\n  ✓ Test 2 done. tool_calls=${toolCallCount}, finish=${finishReason}`)
  if (toolCallCount === 0) {
    console.warn('  ⚠ 注意: LLM 没有调用工具。可能是 prompt 或模型的问题,不是 provider bug。')
  }
} catch (err) {
  console.error(`\n  ✗ Test 2 failed: ${err.name}: ${err.message}`)
  if (err.cause) console.error(`    Cause: ${err.cause}`)
  process.exit(1)
}

console.log('\n=== All tests passed ===\n')
