/**
 * 直接向 Codex 发送 DM 开场 prompt,逐个事件打印,定位"空响应"根因。
 *
 * 为什么不用 codex-smoke:我们需要看 DM 真实 system prompt + 开场 user 消息
 * 下 Codex 吐了什么(reasoning? tool_call? 文本? 全没?)。
 */

import { initItemRegistry } from '../src/game-state.js'
import { CodexResponsesProvider } from '../src/agent/codex-provider.js'
import { buildDMPrompt } from '../src/dm-prompt.js'
import { createGameSession } from '../src/game-data.js'
import {
  DiceTool, MoveTool, LookTool, TalkTool,
  UseItemTool, SearchTool, RestTool,
  RenderSceneTool, TransferItemTool, MoveNPCTool, SetActionsTool, SetAmbianceTool,
  ChangeTrustTool, ProposeTradeActionTool, TriggerHostileNPCTool, TriggerTrustCascade,
  ManagePartyTool,
  ListLoreTool, ReadLoreTool, GrepLoreTool,
  RecordJournalTool,
} from '../src/tools/index.js'

async function main() {
  initItemRegistry()
  // 构造 session 以便 buildDMPrompt 能读到
  const session = createGameSession('测试者', 'fighter')
  // 把 session 塞进全局 — buildDMPrompt 会读它
  const { setSession } = await import('../src/game-state.js')
  setSession(session)

  const systemPrompt = buildDMPrompt()
  console.log(`[probe] system prompt length: ${systemPrompt.length} chars`)

  const userPrompt = [
    `新游戏开始。玩家角色: ${session.player.name}，战士。`,
    '请开始第一幕：马车上醒来。简短3-4段。',
    '叙事结束后通过工具调用接口调用 SetActions 提供初始选项。',
    '重要：不要在文本中写 <setactions> 标签、JSON 或任何伪工具调用 — 必须通过真正的 function calling 接口调用。',
  ].join('\n')

  console.log(`[probe] user prompt length: ${userPrompt.length} chars`)

  const provider = new CodexResponsesProvider({
    type: 'codex',
    model: 'gpt-5.4',
    apiKey: '',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
  })

  const tools = [
    DiceTool, MoveTool, LookTool, TalkTool,
    UseItemTool, SearchTool, RestTool,
    RenderSceneTool, TransferItemTool, MoveNPCTool, SetActionsTool, SetAmbianceTool,
    ChangeTrustTool, ProposeTradeActionTool, TriggerHostileNPCTool, TriggerTrustCascade,
    ManagePartyTool,
    ListLoreTool, ReadLoreTool, GrepLoreTool,
    RecordJournalTool,
  ]
  console.log(`[probe] tools: ${tools.length}`)

  const counts: Record<string, number> = {}
  let textAcc = ''
  let reasoningAcc = ''
  const toolCalls: any[] = []

  console.log(`\n[probe] sending request...`)
  const t0 = Date.now()

  for await (const ev of provider.stream(
    [{ role: 'user', content: userPrompt }],
    tools,
    { systemPrompt },
  )) {
    counts[ev.type] = (counts[ev.type] ?? 0) + 1
    switch (ev.type) {
      case 'text_delta':
        textAcc += ev.text
        break
      case 'reasoning_delta':
        reasoningAcc += ev.text
        break
      case 'tool_call':
        toolCalls.push(ev)
        break
    }
  }
  const ms = Date.now() - t0

  console.log(`\n[probe] done in ${ms}ms`)
  console.log(`[probe] event counts:`, counts)
  console.log(`[probe] text (${textAcc.length} chars): ${JSON.stringify(textAcc.slice(0, 400))}`)
  console.log(`[probe] reasoning (${reasoningAcc.length} chars): ${JSON.stringify(reasoningAcc.slice(0, 200))}`)
  console.log(`[probe] tool_calls (${toolCalls.length}):`)
  for (const tc of toolCalls) {
    console.log(`   ${tc.name}(${tc.argsJson.slice(0, 120)}...)`)
  }
}

main().catch(err => {
  console.error(`[probe] crash:`, err)
  process.exit(1)
})
