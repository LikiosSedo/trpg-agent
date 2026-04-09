/**
 * OpenAI-compatible Streaming Provider
 *
 * 只支持 OpenAI 兼容的 HTTP + SSE 接口(Kimi / DeepSeek / GLM / Doubao 等
 * 走 siflow 中转都走这条路径)。不支持 Anthropic 原生 / Ollama。
 *
 * 设计决定:
 * - **内部累积 tool_call,对外只 emit 完整的 `tool_call` 事件**。
 *   上层 agent 不需要关心 tool_call 是如何分多个 chunk 到达的,只需要在
 *   拿到 `tool_call` 事件时知道 id/name/argsJson 已经完整。
 *   代价:失去了"实时显示工具参数累积"的能力 —— 但 TRPG 场景不需要,
 *   DM 调 SetActions/Talk 时玩家不需要看参数逐字出现。
 *
 * - **SSE 解析手写 fetch + ReadableStream**,不加 eventsource-parser 依赖。
 *   OpenAI 的 SSE 格式很简单(`data: ...\n\n` 切 + `[DONE]` 结束),
 *   ~50 行就能搞定。
 *
 * - **zod → JSON Schema 用 `zod-to-json-schema` 库**。手写会漏嵌套 / union /
 *   enum / optional 等 corner case,不划算。
 *
 * - **reasoning_content 作为一级事件**(`reasoning_delta`)。DeepSeek/Kimi
 *   的思考链协议就是这样,我们原生支持。不处理 `<think>` 标签 —— 那是
 *   agent.ts 层的 post-process 逻辑,不污染 provider。
 *
 * - **错误分类委托给 errors.ts 的 `httpErrorFromStatus()`**。provider 只
 *   负责识别 HTTP 状态码和网络层错误,具体语义由 errors 模块判定。
 */

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Tool, ProviderConfig } from './types.js'
import {
  RetryableError,
  StreamParseError,
  httpErrorFromStatus,
} from './errors.js'

// ─── 对外事件类型 ────────────────────────────────────

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'other'

/**
 * Provider.stream() 吐出的低层事件。
 *
 * 注意:tool_call 事件是"完整的" —— id/name/argsJson 都已累积完成,
 * 上层不需要拼接。finish 事件一定在最后一个事件(除非抛异常)。
 */
export type LowLevelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; argsJson: string }
  | { type: 'finish'; reason: FinishReason }

// ─── 调用选项 ────────────────────────────────────────

export interface StreamOptions {
  /** System prompt — 会被插入到 messages 最前(如果 messages[0] 已经是 system,则替换) */
  systemPrompt?: string
  /** 最大输出 token 数(OpenAI 的 max_tokens 参数) */
  maxTokens?: number
  /** 采样温度 */
  temperature?: number
  /** 取消请求的 AbortSignal */
  signal?: AbortSignal
}

// ─── Provider 主类 ───────────────────────────────────

export class OpenAICompatProvider {
  constructor(private config: ProviderConfig) {}

  /**
   * 流式调用 LLM,返回低层事件生成器。
   *
   * 典型使用:
   *   for await (const ev of provider.stream(messages, tools, { systemPrompt })) {
   *     switch (ev.type) { ... }
   *   }
   *
   * 异常:
   *   - PromptTooLongError:  上下文超限(HTTP 413 或 400+关键词)
   *   - RetryableError:      429 / 5xx / 网络层错误 → 上层 backoff 重试
   *   - StreamParseError:    SSE 格式错误 / JSON 解析失败 → 不重试
   *   - AgentError:          其他未分类错误
   */
  async *stream(
    messages: any[],
    tools: Tool[],
    options: StreamOptions = {},
  ): AsyncGenerator<LowLevelEvent> {
    const body = this.buildRequestBody(messages, tools, options, /*stream*/ true)
    const response = await this.fetchWithErrorHandling(body, options.signal)

    if (!response.body) {
      throw new StreamParseError('Response body is null')
    }

    yield* this.parseSSEStream(response.body)
  }

  /**
   * 非流式调用 — 一次性返回完整响应。
   *
   * Phase 1 保留此方法主要给 rules-agent 用:它只需要一个简单的 JSON 分类
   * 结果,不需要流式 UX,用 invoke() 更简单。
   */
  async invoke(
    messages: any[],
    tools: Tool[],
    options: StreamOptions = {},
  ): Promise<any> {
    const body = this.buildRequestBody(messages, tools, options, /*stream*/ false)
    const response = await this.fetchWithErrorHandling(body, options.signal)
    try {
      return await response.json()
    } catch (err) {
      throw new StreamParseError(
        `Failed to parse non-stream response JSON: ${(err as Error).message}`,
        undefined,
        err,
      )
    }
  }

  // ─── 请求体构建 ───────────────────────────────────

  private buildRequestBody(
    messages: any[],
    tools: Tool[],
    options: StreamOptions,
    stream: boolean,
  ): any {
    const finalMessages = this.prependSystemPrompt(messages, options.systemPrompt)
    const body: any = {
      model: this.config.model,
      messages: finalMessages,
      stream,
    }

    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options.temperature !== undefined) body.temperature = options.temperature

    if (tools.length > 0) {
      body.tools = tools.map(t => this.toolToOpenAIFormat(t))
    }

    if (stream && this.config.streamUsage !== false) {
      // 大多数 provider 支持;某些后端不支持(比如 Kimi coding API 的
      // 旧版本),config.streamUsage = false 时关掉。
      body.stream_options = { include_usage: true }
    }

    return body
  }

  /**
   * 把 systemPrompt 注入 messages 数组头部。
   * 如果 messages[0] 已经是 system 消息,替换它(避免重复);否则 prepend。
   */
  private prependSystemPrompt(messages: any[], systemPrompt?: string): any[] {
    if (!systemPrompt) return messages
    if (messages.length > 0 && messages[0]?.role === 'system') {
      return [{ role: 'system', content: systemPrompt }, ...messages.slice(1)]
    }
    return [{ role: 'system', content: systemPrompt }, ...messages]
  }

  /**
   * zod schema → OpenAI function calling schema
   */
  private toolToOpenAIFormat(tool: Tool): any {
    const jsonSchema: any = zodToJsonSchema(tool.inputSchema as z.ZodType, {
      target: 'openAi',
      $refStrategy: 'none',
    })
    // 清理一些 OpenAI 不需要的元数据字段
    delete jsonSchema.$schema
    delete jsonSchema.default
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      },
    }
  }

  // ─── HTTP + 错误处理 ──────────────────────────────

  private async fetchWithErrorHandling(
    body: any,
    signal?: AbortSignal,
  ): Promise<Response> {
    // baseUrl 可能已经包含 /chat/completions(某些 provider 要求)或没有。
    // 简单处理:如果 baseUrl 以 /chat/completions 结尾就直接用,否则 append。
    const endpoint = this.config.baseUrl.endsWith('/chat/completions')
      ? this.config.baseUrl
      : `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...(this.config.headers ?? {}),
    }

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      // 网络层错误 → RetryableError
      if (err instanceof Error && err.name === 'AbortError') {
        // AbortSignal 触发 → 直接抛原错误,不当作 retryable
        throw err
      }
      throw new RetryableError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err,
      )
    }

    if (!response.ok) {
      // 尝试读 body 作为 debug 信息
      let errorText = ''
      try {
        errorText = await response.text()
      } catch {
        /* ignore */
      }
      throw httpErrorFromStatus(response.status, errorText)
    }

    return response
  }

  // ─── SSE 解析 ─────────────────────────────────────

  /**
   * 解析 SSE stream,吐出 LowLevelEvent。
   *
   * SSE 格式:
   *   data: {"id":"...", "choices":[{"delta":{"content":"hel"}}]}\n
   *   \n
   *   data: {"id":"...", "choices":[{"delta":{"content":"lo"}}]}\n
   *   \n
   *   data: [DONE]\n
   *   \n
   *
   * 多行 event 之间用 \n\n 分隔;[DONE] 是 OpenAI 约定的结束标记。
   */
  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<LowLevelEvent> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    /**
     * tool_call 累积状态。OpenAI 协议:
     *   delta.tool_calls 是一个数组,每个元素 { index, id?, function: { name?, arguments? } }
     *   同一个 index 的 delta 代表同一个 tool_call 的分片。id 和 name 通常在
     *   第一个 delta 就给,arguments 可能分多个 delta。
     *
     * 我们内部累积 id/name/argsJson,在 finish_reason 到来时一次性 emit 完整 tool_call。
     */
    const toolCallsByIndex = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 按 \n\n 切 event(兼容 \r\n\r\n)— 循环取出所有完整 event,
        // 残余的不完整片段留在 buffer 等下一次 read
        while (true) {
          const sep = findEventSeparator(buffer)
          if (sep === -1) break

          const eventBlock = buffer.slice(0, sep.end)
          buffer = buffer.slice(sep.end + sep.sepLen)

          yield* this.handleEventBlock(eventBlock, toolCallsByIndex)
        }
      }

      // Stream 正常结束。通常最后一个事件是 `data: [DONE]` 已经被处理。
      // 如果没有 [DONE](某些 provider 会省略),我们也走完了 loop,直接退出。
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 处理一个完整的 SSE event block(多行,每行一个 field)。
   * OpenAI 只用 `data: ...` 行,其他都忽略。
   */
  private *handleEventBlock(
    eventBlock: string,
    toolCallsByIndex: Map<number, { id: string; name: string; argsJson: string }>,
  ): Generator<LowLevelEvent> {
    for (const rawLine of eventBlock.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (!line.startsWith('data:')) continue
      // "data: " 或 "data:" 都接受(空格可选)
      const data = line.slice(5).trimStart()
      if (data === '[DONE]') {
        // 结束标记 — 通常已经有 finish_reason 事件了,直接返回
        return
      }

      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch (err) {
        throw new StreamParseError(
          `Failed to parse SSE chunk JSON: ${(err as Error).message}`,
          data,
          err,
        )
      }

      yield* this.handleChunk(chunk, toolCallsByIndex)
    }
  }

  /**
   * 处理一个 OpenAI chunk(单个 JSON 对象)。
   *
   * Chunk format:
   *   {
   *     id: "...",
   *     choices: [{
   *       index: 0,
   *       delta: { role?, content?, reasoning_content?, tool_calls?[] },
   *       finish_reason: null | "stop" | "tool_calls" | "length" | ...
   *     }],
   *     usage?: { prompt_tokens, completion_tokens, total_tokens }
   *   }
   */
  private *handleChunk(
    chunk: any,
    toolCallsByIndex: Map<number, { id: string; name: string; argsJson: string }>,
  ): Generator<LowLevelEvent> {
    const choice = chunk?.choices?.[0]
    if (!choice) return

    const delta = choice.delta ?? {}

    // 1. 普通文本增量
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      yield { type: 'text_delta', text: delta.content }
    }

    // 2. 思考链增量(DeepSeek/Kimi)
    if (
      typeof delta.reasoning_content === 'string' &&
      delta.reasoning_content.length > 0
    ) {
      yield { type: 'reasoning_delta', text: delta.reasoning_content }
    }

    // 3. Tool calls 增量累积
    if (Array.isArray(delta.tool_calls)) {
      for (const tcDelta of delta.tool_calls) {
        const index: number =
          typeof tcDelta.index === 'number' ? tcDelta.index : 0

        let state = toolCallsByIndex.get(index)
        if (!state) {
          state = { id: '', name: '', argsJson: '' }
          toolCallsByIndex.set(index, state)
        }

        if (typeof tcDelta.id === 'string' && tcDelta.id.length > 0) {
          state.id = tcDelta.id
        }

        const funcName = tcDelta.function?.name
        if (typeof funcName === 'string' && funcName.length > 0) {
          state.name += funcName // 某些 provider 会分片 name,保险起见用 +=
        }

        const args = tcDelta.function?.arguments
        if (typeof args === 'string' && args.length > 0) {
          state.argsJson += args
        }
      }
    }

    // 4. Finish reason → emit 所有累积的 tool_call + finish
    if (choice.finish_reason) {
      // 按 index 顺序 emit tool_calls
      const sortedIndices = Array.from(toolCallsByIndex.keys()).sort((a, b) => a - b)
      for (const idx of sortedIndices) {
        const state = toolCallsByIndex.get(idx)!
        if (!state.id) {
          // 协议异常:有 tool_call 但没收到 id。跳过,不 throw(容错)。
          console.warn(
            `[provider] tool_call at index ${idx} has no id, skipping. name="${state.name}" args="${state.argsJson.slice(0, 50)}"`,
          )
          continue
        }
        yield {
          type: 'tool_call',
          id: state.id,
          name: state.name,
          argsJson: state.argsJson,
        }
      }
      toolCallsByIndex.clear()

      const reason: FinishReason =
        choice.finish_reason === 'stop'
          ? 'stop'
          : choice.finish_reason === 'tool_calls'
            ? 'tool_calls'
            : choice.finish_reason === 'length'
              ? 'length'
              : 'other'
      yield { type: 'finish', reason }
    }
  }
}

// ─── 辅助:SSE event 分隔符查找 ────────────────────

/**
 * 在 buffer 里找第一个 event 分隔符(`\n\n` 或 `\r\n\r\n`)。
 * 返回 `{ end: 分隔符起始索引, sepLen: 分隔符长度 }`,找不到返回 -1 的哨兵对象。
 *
 * 为什么不用 indexOf:需要同时支持 `\n\n` 和 `\r\n\r\n`,并且告诉调用方
 * 分隔符长度以便 slice。
 */
function findEventSeparator(
  buffer: string,
): { end: number; sepLen: number } | -1 {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return -1
  // 取最靠前的那个
  if (lf === -1) return { end: crlf, sepLen: 4 }
  if (crlf === -1) return { end: lf, sepLen: 2 }
  return lf < crlf ? { end: lf, sepLen: 2 } : { end: crlf, sepLen: 4 }
}
