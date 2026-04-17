/**
 * TRPG Agent — 对外公开 API
 *
 * 使用方式:
 *
 *   import { createAgent, type Tool } from './agent/index.js'
 *
 *   const agent = createAgent({
 *     provider: { model, apiKey, baseUrl, type: 'openai' },
 *     tools: [DiceTool, TalkTool, ...],
 *     systemPrompt: '你是 TRPG 主持人...',
 *     maxTurns: 20,
 *     apiThrottleMs: 1500,
 *   })
 *
 *   for await (const event of agent.run('玩家输入')) {
 *     switch (event.type) {
 *       case 'text_delta':     // 流式叙事文本
 *       case 'thinking_delta': // 思考链(如果模型支持)
 *       case 'tool_result':    // 工具执行结果
 *       case 'turn_end':       // 一个完整 turn 结束
 *     }
 *   }
 */

// 类型
export type {
  Tool,
  ToolResult,
  IAgent,
  AgentEvent,
  ProviderConfig,
} from './types.js'

// Agent 主类 + factory
export { TRPGAgent, createAgent, type AgentConfig } from './agent.js'

// Provider(如果 rules-agent 想直接用非流式 invoke)
export {
  OpenAICompatProvider,
  type LowLevelEvent,
  type StreamOptions,
  type FinishReason,
} from './provider.js'

// Codex 订阅 provider + factory
export { CodexResponsesProvider } from './codex-provider.js'
export { createProvider, type LLMProvider } from './provider-factory.js'

// 错误类型
export {
  AgentError,
  PromptTooLongError,
  RetryableError,
  StreamParseError,
  TimeoutError,
  isPromptTooLong,
  isRetryable,
  httpErrorFromStatus,
} from './errors.js'

// Messages 工具
export {
  estimateTokens,
  estimateMessageTokens,
  isToolResult,
  isAssistantWithToolCalls,
  isUserMessage,
  isSystemMessage,
  removeWithPair,
  splitByRecentUserMessages,
} from './messages.js'

// Tool runner(高级用法)
export { runToolCall, executeTool, findTool } from './tool-runner.js'

// Context manager (Phase 4: 上下文压缩)
export {
  ContextManager,
  type ContextManagerConfig,
  type CompactResult,
} from './context-manager.js'

// Archival snapshot (Phase 4: 结构化归档快照生成)
export { buildArchivalSnapshot, type SnapshotOptions } from './archival-snapshot.js'
