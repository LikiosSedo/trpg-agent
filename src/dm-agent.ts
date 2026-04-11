/**
 * DM Agent — 地下城主 Agent
 *
 * 使用 TRPG 专用 Agent(src/agent/),通过 ~/.occ/config.json 或环境变量
 * 配置的 OpenAI-compatible API 运行(Kimi / DeepSeek / GLM / Doubao 等)。
 *
 * Phase 3 迁移自 open-claude-cli —— 运行时实现替换,外部 API
 * (initDMAgent / muteDMTools / unmuteDMTools / getDMMessages / restoreDMMessages /
 * dmRespond / getDMAgent)保持不变,engine.ts 零改动。
 */

import { createAgent, type TRPGAgent, buildArchivalSnapshot } from './agent/index.js'
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
  ListLoreTool, ReadLoreTool, GrepLoreTool,
  RecordJournalTool,
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
      model: process.env.TRPG_MODEL ?? 'kimi-for-coding',
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

let agent: TRPGAgent | null = null

export function initDMAgent(): void {
  const config = loadConfig()
  const model = process.env.TRPG_MODEL ?? config.model

  agent = createAgent({
    provider: {
      model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      type: config.type ?? 'openai',
      headers: config.headers,
      streamUsage: config.streamUsage,
    },
    // 注意:AttackTool 不在 DM 工具列表 — 战斗由代码入口控制
    // (玩家攻击意图 / 区域遭遇 / 章节事件)
    tools: [
      DiceTool, MoveTool, LookTool, TalkTool,
      UseItemTool, SearchTool, RestTool,
      RenderSceneTool, TransferItemTool, MoveNPCTool, SetActionsTool, SetAmbianceTool,
      // GameOverTool 不给 DM — Game Over 由代码条件触发(HP=0 / 全镇驱逐)
      ChangeTrustTool, ProposeTradeActionTool, TriggerHostileNPCTool, TriggerTrustCascade,
      ManagePartyTool,
      // Phase 5: Lore System — 剧本级记忆的按需查询
      ListLoreTool, ReadLoreTool, GrepLoreTool,
      // Phase 6: DM Journal — 存档级叙事札记(写入)
      RecordJournalTool,
    ],
    systemPrompt: buildDMPrompt(),
    maxTurns: 20,
    apiThrottleMs: 1500,
    // Phase 4: 上下文压缩 —— token >= 60% 阈值时把早期对话压成"归档快照"
    // 消息(从 session 代码生成,零 LLM 调用)。最近 12 turn 完整保留。
    contextManager: {
      modelContextWindow: 100_000,
      compactThreshold: 0.6,
      keepRecentTurns: 12,
      buildArchivalSnapshot: ({ keepRecentTurns, availableToolNames }) =>
        buildArchivalSnapshot(getSession(), { keepRecentTurns, availableToolNames }),
    },
  })

  console.log(`  DM 模式: TRPG Agent (${model})`)
}

export function getDMAgent(): TRPGAgent {
  if (!agent) throw new Error('DM Agent 未初始化 — 先调用 initDMAgent()')
  return agent
}

// ─── 工具开关(战斗叙事等场景用) ──────
//
// Phase 3 迁移:旧实现直接操作 open-claude-cli 的内部 registry
// `(agent as any).tools.tools`,这是个 hack。新 Agent 提供干净的
// muteTools/unmuteTools 公开 API,这里只是包一层并保留"强制 SetActions"兜底。

/**
 * 静音 DM 的工具 — 只保留白名单中的工具,其余全部临时移除。
 * 下一次 agent.run() 只会向 LLM 发送白名单工具的 schema。
 * 调用后必须配对 unmuteDMTools()。
 *
 * @param keep 要保留的工具名数组,默认 ['SetActions'](允许生成选项)
 *
 * **架构陷阱兜底**:SetActions 会被**强制保留**(即使调用方传入空数组),
 * 确保 DM 始终能生成后续选项。这是 CLAUDE.md 架构陷阱 #2 的防护:
 * `muteDMTools([])` 如果不加兜底会禁用所有工具包括 SetActions,导致战斗叙事
 * 结束后前端拿不到选项。我们在 dm-agent 这一层兜,新 Agent 的 muteTools 本身
 * 保持严格(按白名单)的通用语义。
 */
export function muteDMTools(keep: string[] = ['SetActions']): void {
  if (!agent) return
  const keepWithFallback = keep.includes('SetActions') ? keep : [...keep, 'SetActions']
  agent.muteTools(keepWithFallback)
  const activeNames = agent.tools.map(t => t.name)
  console.log(
    `[dm-agent] 工具已静音 (active: ${activeNames.join(', ') || '无'})`,
  )
}

/** 恢复 DM 的所有工具。与 muteDMTools() 配对使用。幂等。 */
export function unmuteDMTools(): void {
  if (!agent) return
  const before = agent.tools.length
  agent.unmuteTools()
  const after = agent.tools.length
  if (after !== before) {
    console.log(`[dm-agent] 工具已恢复 (${before} → ${after} tools)`)
  }
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
    chapterCtx ? `\n[章节剧本]（本章要传达的叙事素材，请自然融入，不要跳过）\n${chapterCtx}` : '',
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
