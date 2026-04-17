/**
 * Provider Factory — 根据 ProviderConfig.type 选择实现
 *
 *   type: 'openai' (默认) → OpenAICompatProvider(走 /chat/completions)
 *   type: 'codex'         → CodexResponsesProvider(走 chatgpt.com/backend-api/codex/responses)
 *
 * 两个 provider 实现同样的鸭子接口(stream + invoke),agent.ts 直接用 LLMProvider 类型。
 */

import type { ProviderConfig } from './types.js'
import { OpenAICompatProvider, type LowLevelEvent, type StreamOptions } from './provider.js'
import { CodexResponsesProvider } from './codex-provider.js'
import type { Tool } from './types.js'

export interface LLMProvider {
  stream(
    messages: any[],
    tools: Tool[],
    options?: StreamOptions,
  ): AsyncGenerator<LowLevelEvent>
  invoke(messages: any[], tools: Tool[], options?: StreamOptions): Promise<any>
}

export function createProvider(config: ProviderConfig): LLMProvider {
  if (config.type === 'codex') {
    return new CodexResponsesProvider(config)
  }
  return new OpenAICompatProvider(config)
}
