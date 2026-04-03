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
  RenderSceneTool, TransferItemTool,
} from './tools/index.js'
import { getFacts, getSession } from './game-state.js'
import { ChapterManager } from './chapter-manager.js'
import { buildDMPrompt } from './dm-prompt.js'

// ─── Config ──────────────────────────────────

function loadConfig() {
  // 优先用环境变量（Render 等云平台），其次读本地配置文件
  if (process.env.TRPG_API_KEY) {
    const config: Record<string, unknown> = {
      apiKey: process.env.TRPG_API_KEY,
      baseUrl: process.env.TRPG_BASE_URL ?? 'https://your-llm-endpoint/v1',
      model: process.env.TRPG_MODEL ?? 'moonshotai/Kimi-K2.5',
      type: process.env.TRPG_PROVIDER_TYPE ?? 'openai',
    }
    // Kimi coding API 需要伪装成 coding agent + 禁用 stream_options
    if (process.env.TRPG_HEADERS) {
      try { config.headers = JSON.parse(process.env.TRPG_HEADERS) } catch {}
    }
    if (process.env.TRPG_STREAM_USAGE === 'false') {
      config.streamUsage = false
    }
    return config
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
      RenderSceneTool, TransferItemTool,
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

/** 导出 DM 对话历史（用于持久化） */
export function getDMMessages(): any[] {
  return agent?.getMessages() ?? []
}

/** 恢复 DM 对话历史（重连时调用） */
export function restoreDMMessages(messages: any[]): void {
  if (agent && messages?.length) {
    agent.messages = messages
  }
}

/**
 * 向 DM 发送玩家输入，返回响应流。
 * 每次自动注入 GameFactStore 上下文。
 */
export async function* dmRespond(playerInput: string): AsyncGenerator<any> {
  const dm = getDMAgent()
  const context = getFacts().toPromptContext()
  const chapterCtx = getChapterContext()
  const message = [
    `[游戏状态]\n${context}`,
    chapterCtx ? `\n[章节剧本]\n${chapterCtx}` : '',
    `\n[玩家输入]\n${playerInput}`,
  ].filter(Boolean).join('\n')
  yield* dm.run(message)
}

function getChapterContext(): string {
  const session = getSession()
  if (!session.chapter) return ''
  const cm = new ChapterManager(session)
  return cm.getPromptContext()
}
