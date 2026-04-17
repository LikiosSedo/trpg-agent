/**
 * Codex 接入冒烟测试 — 跑一次最小请求,确认 OAuth + Responses API + SSE 全链路通。
 *
 * 用法:
 *   npx tsx scripts/codex-smoke.ts                        # 仅文本
 *   npx tsx scripts/codex-smoke.ts tool                   # 带一个 dummy 工具,验证 tool_call 解析
 */

import { z } from 'zod'
import { CodexResponsesProvider } from '../src/agent/codex-provider.js'
import { loadCodexTokens } from '../src/agent/codex-auth.js'

const mode = process.argv[2] ?? 'text'   // 'text' | 'tool' | 'turn2'

async function main() {
  // 先确认 auth.json 能读
  const tokens = loadCodexTokens()
  console.log(`[smoke] account_id = ${tokens.account_id}`)
  console.log(`[smoke] access_token prefix = ${tokens.access_token.slice(0, 12)}...`)

  const provider = new CodexResponsesProvider({
    type: 'codex',
    model: 'gpt-5.4',
    apiKey: '',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
  })

  const tools =
    mode === 'tool' || mode === 'turn2'
      ? [
          {
            name: 'GetWeather',
            description: 'Get the weather for a city.',
            inputSchema: z.object({
              city: z.string().describe('City name in English'),
            }),
            isConcurrencySafe: true,
            isReadOnly: true,
            execute: async () => ({ output: '' }),
          },
        ]
      : []

  const userMsg =
    mode === 'tool' || mode === 'turn2'
      ? "What's the weather in Tokyo? Use the GetWeather tool."
      : '用一句中文说"你好,我是 GPT-5.4"。'

  console.log(`\n[smoke] prompt: ${userMsg}\n`)
  console.log(`[smoke] streaming...\n----`)

  let textBuf = ''
  let reasoningBuf = ''
  const toolCalls: any[] = []
  let finishReason = ''

  for await (const ev of provider.stream(
    [{ role: 'user', content: userMsg }],
    tools,
    { systemPrompt: 'You are a concise assistant.', maxTokens: 200 },
  )) {
    switch (ev.type) {
      case 'text_delta':
        process.stdout.write(ev.text)
        textBuf += ev.text
        break
      case 'reasoning_delta':
        reasoningBuf += ev.text
        break
      case 'tool_call':
        toolCalls.push(ev)
        break
      case 'finish':
        finishReason = ev.reason
        break
    }
  }

  console.log(`\n----`)
  console.log(`[smoke] finish_reason: ${finishReason}`)
  console.log(`[smoke] text bytes: ${textBuf.length}`)
  console.log(`[smoke] reasoning bytes: ${reasoningBuf.length}`)
  console.log(`[smoke] tool_calls: ${toolCalls.length}`)
  if (toolCalls.length > 0) {
    for (const tc of toolCalls) {
      console.log(`  - ${tc.name}(${tc.argsJson}) [id=${tc.id}]`)
    }
  }
  // 第二轮:把工具结果塞回去,看 LLM 能不能基于结果继续叙事
  if (mode === 'turn2' && toolCalls.length > 0) {
    const tc = toolCalls[0]
    const followupMessages = [
      { role: 'user', content: userMsg },
      {
        role: 'assistant',
        content: textBuf || null,
        tool_calls: [
          { id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.argsJson } },
        ],
      },
      {
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({ tempC: 18, conditions: 'cloudy with light rain' }),
      },
    ]
    console.log(`\n[smoke] turn 2 — feeding tool result back...\n----`)
    let turn2Text = ''
    let turn2Finish = ''
    for await (const ev of provider.stream(followupMessages, tools, {
      systemPrompt: 'You are a concise assistant.',
    })) {
      switch (ev.type) {
        case 'text_delta':
          process.stdout.write(ev.text)
          turn2Text += ev.text
          break
        case 'finish':
          turn2Finish = ev.reason
          break
      }
    }
    console.log(`\n----`)
    console.log(`[smoke] turn 2 finish: ${turn2Finish}, text bytes: ${turn2Text.length}`)
  }

  console.log(`\n[smoke] OK ✓`)
}

main().catch(err => {
  console.error(`\n[smoke] FAILED:`, err)
  process.exit(1)
})
