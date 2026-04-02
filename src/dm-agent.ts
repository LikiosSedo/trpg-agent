/**
 * DM Agent — 地下城主 Agent
 *
 * 使用 open-claude-cli Agent SDK，通过 ~/.occ/config.json 配置的 API 运行。
 * 支持任何 OpenAI-compatible API（Kimi、DeepSeek、Ollama 等）。
 */

import { Agent } from 'open-claude-cli/engine'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  DiceTool, MoveTool, LookTool, TalkTool,
  AttackTool, UseItemTool, SearchTool, RestTool,
  RenderSceneTool,
} from './tools/index.js'
import { getFacts } from './game-state.js'
import { buildDMPrompt } from './dm-prompt.js'

// ─── Config ──────────────────────────────────

function loadConfig() {
  const configPath = join(homedir(), '.occ', 'config.json')
  if (!existsSync(configPath)) {
    throw new Error(`未找到配置文件: ${configPath}\n请先配置: {"provider":"openai","apiKey":"...","baseUrl":"...","model":"..."}`)
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'))
}

// ─── Agent ───────────────────────────────────

let agent: Agent | null = null

export function initDMAgent(): void {
  const config = loadConfig()
  const model = process.env.TRPG_MODEL ?? config.model

  agent = new Agent({
    provider: {
      model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      type: config.type ?? 'openai',
    },
    tools: [
      DiceTool, MoveTool, LookTool, TalkTool,
      AttackTool, UseItemTool, SearchTool, RestTool,
      RenderSceneTool,
    ],
    systemPrompt: buildDMPrompt(),
    maxTurns: 20,
    apiThrottleMs: 1500,
  })

  console.log(`  DM 模式: open-claude-cli (${model})`)
}

export function getDMAgent(): Agent {
  if (!agent) throw new Error('DM Agent 未初始化 — 先调用 initDMAgent()')
  return agent
}

/**
 * 向 DM 发送玩家输入，返回响应流。
 * 每次自动注入 GameFactStore 上下文。
 */
export async function* dmRespond(playerInput: string): AsyncGenerator<any> {
  const dm = getDMAgent()
  const context = getFacts().toPromptContext()
  const message = `[游戏状态]\n${context}\n\n[玩家输入]\n${playerInput}`
  yield* dm.run(message)
}
