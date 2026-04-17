/**
 * TRPG 专用 Agent 层 — 类型定义
 *
 * 这个文件定义工具层(19 个 src/tools/*.ts)和 Agent 层之间的接口契约。
 * 设计原则:
 * - 只覆盖 TRPG 实际需要的功能,不做 coding agent 包袱
 * - 工具接口向 zod 友好(便于类型推断)
 * - 事件类型设计为 `{ type: 'text_delta' | 'thinking_delta' | 'tool_result' }`
 *   一组简单离散事件,便于 engine.ts 的消费代码 switch 处理。
 *
 * 历史:Phase 0-5 期间此文件作为"解耦层",让项目可以从 open-claude-cli 平滑
 * 迁移到自己的 TRPGAgent 实现。迁移完成后,它是项目 Agent 抽象的唯一 source of truth。
 */

import type { ZodType } from 'zod'

// ─── Tool ─────────────────────────────────────────────

/**
 * 工具执行结果
 *
 * 注意:项目中很多工具把 ToolResult 当作"多返回值通道",会在标准字段之外
 * 附加业务元数据(如 `firstInnocentKill`, `discoveredPoi`, `lootGranted` 等)。
 * 这些字段被 action-executor.ts 读取用于后续副作用处理。因此接口允许额外字段。
 *
 * 建议未来做 "Phase 0.5 类型强化":给每个工具定义独立的 ExtendedResult 类型,
 * 消除 `[key: string]: any`。但当前先保留这个逃生口,确保 Phase 0 零运行时影响。
 */
export interface ToolResult {
  /** 注入回 LLM 的文本(tool_result 消息的 content) */
  output: string
  /** 标记为错误时,LLM 会看到 isError: true 并可能重试或调整策略 */
  isError?: boolean
  /** 允许工具扩展自定义字段(action-executor 等消费方使用) */
  [key: string]: any
}

/**
 * 工具定义接口。
 *
 * TRPG 项目的每个工具实现这个接口。inputSchema 用 zod,运行时 provider 层
 * 会把 zod schema 转换为 JSON Schema 发给 LLM。
 */
export interface Tool<TInput = any> {
  /** 工具名(LLM 看到的标识) */
  name: string
  /** 工具描述(LLM 用它决定何时调用) */
  description: string
  /** 输入参数 schema */
  inputSchema: ZodType<TInput>
  /** 能否并发调用(同一 turn 内) */
  isConcurrencySafe: boolean
  /** 是否只读(不修改 session 状态),影响缓存和日志 */
  isReadOnly: boolean
  /**
   * 执行工具。
   *
   * @param input 由 LLM 提供的参数(会先经过 inputSchema 校验)
   * @param context 可选的执行上下文(历史兼容字段,当前大多数工具实现忽略它;
   *                保留是为了兼容 open-claude-cli 的 `execute(input, context?)`
   *                双参数签名,以及测试文件里的 `.execute(input, {} as any)`)
   */
  execute(input: TInput, context?: any): Promise<ToolResult>
}

// ─── Agent 事件流 ────────────────────────────────────

/**
 * Agent.run() 返回的事件流类型。
 *
 * 兼容性注意:当前的事件形状与 open-claude-cli 的 engine.js 中 dispatchRunEvent()
 * 产出的事件保持一致(text_delta / thinking_delta / tool_result),使得
 * Phase 1 切换到自建 Agent 时,engine.ts 里的事件消费逻辑(event.type === 'text_delta'
 * 等)不需要改动。
 */
export type AgentEvent =
  /** LLM 文本增量(流式叙事) */
  | { type: 'text_delta'; text: string }
  /** LLM 思考链增量(reasoning_content / <think> 标签) */
  | { type: 'thinking_delta'; thinking: string }
  /** 工具开始调用(未来可用,当前 engine.ts 未消费) */
  | { type: 'tool_call_start'; id: string; name: string }
  /** 工具参数增量(未来可用) */
  | { type: 'tool_call_delta'; id: string; partialJson: string }
  /** 工具执行完成,结果已注入 messages */
  | { type: 'tool_result'; id?: string; name: string; output: string; isError: boolean }
  /** 一个完整 LLM turn 结束(可选,用于上层跟踪) */
  | { type: 'turn_end' }

// ─── Agent 接口 ──────────────────────────────────────

/**
 * Agent 接口 — 封装"发送输入 → 流式返回事件"的抽象。
 *
 * 运行时实现在 src/agent/agent.ts (`TRPGAgent` 类)。
 * 此接口历史上曾兼容 open-claude-cli 的 Agent(Phase 0-3 迁移期间),
 * 现在是项目的唯一 Agent 抽象。
 */
export interface IAgent {
  /** 发送用户输入,返回事件流 */
  run(input: string): AsyncGenerator<AgentEvent>
  /** 获取完整对话历史(用于持久化到 session.dmMessages) */
  getMessages(): any[]
  /** 完整对话历史(支持直接赋值以恢复) */
  messages: any[]
}

// ─── Provider 配置 ───────────────────────────────────

/**
 * LLM Provider 配置。
 *
 * 只支持 OpenAI-compatible API(通过 siflow 中转能覆盖 Kimi / DeepSeek / GLM / Doubao 等)。
 * 不支持 Anthropic 原生 / Ollama,这些是 coding agent 的需求。
 */
export interface ProviderConfig {
  model: string
  apiKey: string
  baseUrl: string
  /** 'openai' = 走 /chat/completions(默认);'codex' = 走 ChatGPT 订阅(Responses API) */
  type?: 'openai' | 'codex'
  /** 自定义 headers(如 Kimi coding API 伪装) */
  headers?: Record<string, string>
  /** 是否在 stream 请求里带 stream_options.include_usage(某些后端不支持) */
  streamUsage?: boolean
}
