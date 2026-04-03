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
  // 优先用环境变量（Render 等云平台），其次读本地配置文件
  if (process.env.TRPG_API_KEY) {
    return {
      apiKey: process.env.TRPG_API_KEY,
      baseUrl: process.env.TRPG_BASE_URL ?? 'https://your-llm-endpoint/v1',
      model: process.env.TRPG_MODEL ?? 'moonshotai/Kimi-K2.5',
      type: process.env.TRPG_PROVIDER_TYPE ?? 'openai',
    }
  }
  const configPath = join(homedir(), '.occ', 'config.json')
  if (!existsSync(configPath)) {
    throw new Error('未找到配置。设置环境变量 TRPG_API_KEY + TRPG_BASE_URL + TRPG_MODEL，或创建 ~/.occ/config.json')
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
      headers: config.headers,
      streamUsage: config.streamUsage,
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
