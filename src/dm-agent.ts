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
  RenderSceneTool, TransferItemTool, MoveNPCTool, SetActionsTool, SetAmbianceTool,
  // GameOverTool 不给 DM — Game Over 由代码条件触发（HP=0 / 全镇驱逐）
  ChangeTrustTool, ProposeTradeActionTool, TriggerHostileNPCTool, TriggerTrustCascade,
  ManagePartyTool,
} from './tools/index.js'
import { getFacts, getSession } from './game-state.js'
import { ChapterManager } from './chapter-manager.js'
import { buildDMPrompt } from './dm-prompt.js'

// ─── Config ──────────────────────────────────

function loadConfig() {
  // 优先用环境变量（Render 等云平台），其次读本地配置文件
  if (process.env.TRPG_API_KEY) {
    if (!process.env.TRPG_BASE_URL) {
      throw new Error('TRPG_API_KEY 已设置但缺少 TRPG_BASE_URL，请显式提供 LLM endpoint')
    }
    const config: Record<string, unknown> = {
      apiKey: process.env.TRPG_API_KEY,
      baseUrl: process.env.TRPG_BASE_URL,
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
    // 注意：AttackTool 不在 DM 工具列表——战斗由代码入口控制
    // （玩家攻击意图 / 区域遭遇 / 章节事件）
    tools: [
      DiceTool, MoveTool, LookTool, TalkTool,
      UseItemTool, SearchTool, RestTool,
      RenderSceneTool, TransferItemTool, MoveNPCTool, SetActionsTool, SetAmbianceTool,
  // GameOverTool 不给 DM — Game Over 由代码条件触发（HP=0 / 全镇驱逐）
      ChangeTrustTool, ProposeTradeActionTool, TriggerHostileNPCTool, TriggerTrustCascade,
      ManagePartyTool,
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

// ─── 工具开关（战斗叙事等场景用） ──────

/** 暂存被静音的工具，unmute 时恢复 */
let mutedTools: Map<string, any> | null = null

/**
 * 静音 DM 的工具——只保留白名单中的工具，其余全部移除。
 * 下一次 dm.run() 只会向 LLM 发送白名单工具的 schema。
 * 调用后必须配对 unmuteDMTools()。
 *
 * @param keep 要保留的工具名数组，默认 ['SetActions']（允许生成选项）
 *
 * 注意：SetActions 会被强制保留（即使传入空数组），确保 DM 始终能生成后续选项。
 */
export function muteDMTools(keep: string[] = ['SetActions']): void {
  if (!agent) return
  if (mutedTools) return // 已经静音，防止重复
  const registry = (agent as any).tools
  // 强制保留 SetActions（即使调用方传入空数组），确保战斗叙事后能生成选项
  const keepSet = new Set([...keep, 'SetActions'])
  mutedTools = new Map()
  // 遍历所有工具，不在白名单里的移除并暂存
  for (const [name, tool] of registry.tools) {
    if (!keepSet.has(name)) {
      mutedTools.set(name, tool)
    }
  }
  for (const name of mutedTools.keys()) {
    registry.tools.delete(name)
  }
  const kept = Array.from(keepSet).filter(k => registry.tools.has(k))
  console.log(`[dm-agent] 工具已静音 (${mutedTools.size} muted, 保留: ${kept.join(', ') || '无'})`)
}

/**
 * 恢复 DM 的所有工具。与 muteDMTools() 配对使用。
 */
export function unmuteDMTools(): void {
  if (!agent || !mutedTools) return
  const registry = (agent as any).tools
  for (const [name, tool] of mutedTools) {
    registry.tools.set(name, tool)
  }
  console.log(`[dm-agent] 工具已恢复 (${mutedTools.size} tools restored)`)
  mutedTools = null
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
