/**
 * Codex Responses API Provider — ChatGPT 订阅接入
 *
 * 走 ChatGPT Plus/Pro 订阅,直接请求 https://chatgpt.com/backend-api/codex/responses。
 * 使用 OAuth Bearer token(从 ~/.codex/auth.json 读),不走 sk-... API key 计费。
 *
 * 设计:
 * - **接口与 OpenAICompatProvider 完全对齐**:同样的 stream() / invoke() 签名,
 *   同样吐 LowLevelEvent 4 种事件。Agent 层零改动。
 * - **请求体翻译**:Chat Completions messages → Responses API input(类型不同)。
 *   - role:'system' 单独抽出来变 instructions(顶层字段)
 *   - role:'user'/'assistant' → { type:'message', role, content:[{type:'input_text'|'output_text', text}] }
 *   - role:'assistant' + tool_calls → 拆成多个 { type:'function_call', call_id, name, arguments }
 *   - role:'tool' → { type:'function_call_output', call_id, output }
 * - **工具翻译**:flat 化(去掉 chat completions 的 function: 嵌套层),加 strict:false
 * - **SSE 事件**:Responses API 用 `data: {"type":"response.output_text.delta", ...}` 形式,
 *   事件类型在 JSON 的 type 字段(不是 SSE 的 event: 行)。我们只看 data: 行。
 * - **认证**:Bearer access_token + chatgpt-account-id header。401 时刷一次 token 重试。
 * - **错误**:response.failed / response.incomplete 直接抛;HTTP 4xx/5xx 用 errors.ts 分类。
 *
 * 已知坑(从 Codex CLI 源码学到的):
 * - chatgpt.com 后端有时只发 response.output_item.done 不发 response.completed
 * - reasoning_summary_text.delta 和 reasoning_text.delta 都是思考链,要分别处理
 */

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Tool, ProviderConfig } from './types.js'
import {
  RetryableError,
  StreamParseError,
  httpErrorFromStatus,
} from './errors.js'
import type { LowLevelEvent, FinishReason, StreamOptions } from './provider.js'
import { loadCodexTokens, refreshCodexTokens } from './codex-auth.js'

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const DEFAULT_ORIGINATOR = 'codex_cli_rs'
const DEFAULT_USER_AGENT = 'codex_cli_rs/0.0.0 (trpg-agent)'

// ─── Provider 主类 ───────────────────────────────────

export class CodexResponsesProvider {
  private readonly model: string
  private readonly baseUrl: string
  private readonly extraHeaders: Record<string, string>

  constructor(config: ProviderConfig) {
    this.model = config.model
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.extraHeaders = config.headers ?? {}
  }

  /**
   * 流式调用。同 OpenAICompatProvider.stream 的契约:
   * - tool_call 事件是"完整的"(id/name/argsJson 全到齐才 emit)
   * - finish 事件保证最后一个(除非异常)
   */
  async *stream(
    messages: any[],
    tools: Tool[],
    options: StreamOptions = {},
  ): AsyncGenerator<LowLevelEvent> {
    const body = this.buildRequestBody(messages, tools, options, /*stream*/ true)
    const response = await this.fetchWithAuthRetry(body, options.signal)
    if (!response.body) {
      throw new StreamParseError('Response body is null')
    }
    yield* this.parseSSEStream(response.body)
  }

  /**
   * 非流式调用 — 用于 rules-agent 和 npc-memory-extractor。
   * 我们仍然用 SSE 流式接口,然后聚合成一个仿 chat-completions 形状的对象返回,
   * 这样上层(只取 .choices[0].message.content)的代码不需要改。
   */
  async invoke(
    messages: any[],
    tools: Tool[],
    options: StreamOptions = {},
  ): Promise<any> {
    let text = ''
    let reasoning = ''
    const toolCalls: Array<{ id: string; name: string; argsJson: string }> = []
    let finishReason: FinishReason = 'stop'
    for await (const ev of this.stream(messages, tools, options)) {
      switch (ev.type) {
        case 'text_delta':
          text += ev.text
          break
        case 'reasoning_delta':
          reasoning += ev.text
          break
        case 'tool_call':
          toolCalls.push({ id: ev.id, name: ev.name, argsJson: ev.argsJson })
          break
        case 'finish':
          finishReason = ev.reason
          break
      }
    }
    return {
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text || null,
            ...(reasoning ? { reasoning_content: reasoning } : {}),
            ...(toolCalls.length > 0
              ? {
                  tool_calls: toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.argsJson },
                  })),
                }
              : {}),
          },
          finish_reason: finishReason,
        },
      ],
    }
  }

  // ─── 请求体构建 ───────────────────────────────────

  private buildRequestBody(
    messages: any[],
    tools: Tool[],
    options: StreamOptions,
    stream: boolean,
  ): any {
    // 1. 抽出 system prompt(顶层 instructions)
    let instructions = options.systemPrompt ?? ''
    const rest: any[] = []
    for (const msg of messages) {
      if (msg?.role === 'system') {
        // 多条 system 拼接(Responses API 只接受一个 instructions 字段)
        instructions = instructions
          ? `${instructions}\n\n${msg.content}`
          : (msg.content ?? '')
      } else {
        rest.push(msg)
      }
    }

    // 2. 翻译 messages → Responses API input items
    const input = chatMessagesToResponsesInput(rest)

    // 3. 翻译 tools(去 function: 嵌套)
    const responsesTools = tools.map(t => toolToResponsesFormat(t))

    // 4. Reasoning 配置(gpt-5.x 都支持)
    //    summary: 'auto' 让模型决定是否吐思考链总结
    const body: any = {
      model: this.model,
      instructions,
      input,
      tools: responsesTools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { summary: 'auto' },
      store: false,
      stream,
      include: ['reasoning.encrypted_content'],
    }

    // ChatGPT 订阅后端不接受 max_output_tokens / temperature — 全忽略
    // (会被 server 400: "Unsupported parameter: ..." 拒绝)
    void options.maxTokens
    void options.temperature

    return body
  }

  // ─── HTTP + 401 自动 refresh ──────────────────────

  private async fetchWithAuthRetry(
    body: any,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    let response = await this.fetchOnce(body, signal, /*forceRefresh*/ false)
    if (response.status === 401) {
      // 读 body 释放连接,然后刷新 token 重试一次
      try {
        await response.text()
      } catch {
        /* ignore */
      }
      console.warn('[codex-provider] 401 received, refreshing OAuth token and retrying')
      await refreshCodexTokens()
      response = await this.fetchOnce(body, signal, /*forceRefresh*/ true)
    }

    if (!response.ok) {
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

  private async fetchOnce(
    body: any,
    signal: AbortSignal | undefined,
    forceRefresh: boolean,
  ): Promise<Response> {
    const tokens = forceRefresh ? await refreshCodexTokens() : loadCodexTokens()
    const url = `${this.baseUrl}/responses`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${tokens.access_token}`,
      'chatgpt-account-id': tokens.account_id,
      originator: DEFAULT_ORIGINATOR,
      'User-Agent': DEFAULT_USER_AGENT,
      ...this.extraHeaders,
    }

    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err
      }
      throw new RetryableError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err,
      )
    }
  }

  // ─── SSE 解析 ─────────────────────────────────────

  /**
   * Responses API SSE 格式:
   *   event: response.output_text.delta\n
   *   data: {"type":"response.output_text.delta","delta":"hi","sequence_number":3,...}\n
   *   \n
   *
   * 我们忽略 event: 行,只看 data: 里 JSON 的 "type" 字段决定行为。
   * 这跟 codex-rs 的处理方式一致(见 sse/responses.rs 的 ResponsesStreamEvent)。
   */
  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<LowLevelEvent> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let toolCallEmitted = false
    let completed = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        while (true) {
          const sep = findEventSeparator(buffer)
          if (sep === -1) break
          const eventBlock = buffer.slice(0, sep.end)
          buffer = buffer.slice(sep.end + sep.sepLen)
          for (const ev of this.handleEventBlock(eventBlock)) {
            if (ev.type === 'tool_call') toolCallEmitted = true
            if (ev.type === 'finish') completed = true
            yield ev
          }
        }
      }

      // 如果流自然结束但没收到 response.completed,合成一个 finish
      // (chatgpt.com 后端偶尔不发 completed,见 hermes 的兜底注释)
      if (!completed) {
        yield {
          type: 'finish',
          reason: toolCallEmitted ? 'tool_calls' : 'stop',
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private *handleEventBlock(block: string): Generator<LowLevelEvent> {
    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trimStart()
      if (!data || data === '[DONE]') continue
      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch (err) {
        throw new StreamParseError(
          `Failed to parse Responses SSE chunk JSON: ${(err as Error).message}`,
          data,
          err,
        )
      }
      yield* this.handleResponsesChunk(chunk)
    }
  }

  /**
   * 处理一个 Responses API 事件 chunk。
   * 事件类型映射(只列我们关心的):
   *   response.output_text.delta            → text_delta
   *   response.reasoning_summary_text.delta → reasoning_delta
   *   response.reasoning_text.delta         → reasoning_delta
   *   response.output_item.done(function_call)→ tool_call
   *   response.completed                    → finish
   *   response.failed                       → throw (errors.ts 分类)
   *   response.incomplete                   → throw
   *   其他(created/added/...)              → 忽略
   */
  private *handleResponsesChunk(chunk: any): Generator<LowLevelEvent> {
    const kind = chunk?.type
    if (typeof kind !== 'string') return

    switch (kind) {
      case 'response.output_text.delta': {
        const delta = chunk.delta
        if (typeof delta === 'string' && delta.length > 0) {
          yield { type: 'text_delta', text: delta }
        }
        return
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const delta = chunk.delta
        if (typeof delta === 'string' && delta.length > 0) {
          yield { type: 'reasoning_delta', text: delta }
        }
        return
      }
      case 'response.output_item.done': {
        const item = chunk.item
        if (item?.type === 'function_call') {
          // call_id 是 LLM 视角的 ID,id 是后端记录 ID — 我们用 call_id
          // (这是 tool_call_output 配对时 LLM 期待看到的字段)
          const callId = item.call_id ?? item.id
          if (typeof callId === 'string' && typeof item.name === 'string') {
            yield {
              type: 'tool_call',
              id: callId,
              name: item.name,
              argsJson: typeof item.arguments === 'string' ? item.arguments : '',
            }
          }
        }
        // message 类型的 done 已经通过 deltas 流式吐过了,这里不重复
        return
      }
      case 'response.completed': {
        // chunk.response.output 里可能也有 function_calls,但通常都已经
        // 通过 output_item.done 流过了。这里只发 finish 信号。
        // finish_reason 由 SSE 循环根据是否 emit 过 tool_call 来决定。
        yield { type: 'finish', reason: 'stop' }
        return
      }
      case 'response.failed': {
        const err = chunk?.response?.error ?? chunk?.error
        const code = err?.code ?? 'unknown'
        const message = err?.message ?? 'Codex Responses API failed'
        // 上下文超限 / 配额耗尽 — 简单分类成 RetryableError(429-like)和直接抛
        if (typeof message === 'string' && /context.+window|context_length/i.test(message)) {
          throw new StreamParseError(`Context window exceeded: ${message}`)
        }
        if (code === 'rate_limit_exceeded' || /rate.?limit/i.test(String(message))) {
          throw new RetryableError(`Codex rate limited: ${message}`, 429)
        }
        throw new StreamParseError(`Codex response.failed (${code}): ${message}`)
      }
      case 'response.incomplete': {
        const reason =
          chunk?.response?.incomplete_details?.reason ?? 'unknown'
        throw new StreamParseError(`Codex response.incomplete: ${reason}`)
      }
      default:
        // created / output_item.added / reasoning_summary_part.added / 等等 — 忽略
        return
    }
  }
}

// ─── 模块级 helpers ────────────────────────────────────

/**
 * 把 OpenAI Chat Completions 的 messages 数组翻译为 Responses API 的 input 数组。
 *
 * 翻译规则:
 *   { role:'user', content:string } → { type:'message', role:'user',
 *                                       content:[{type:'input_text', text}] }
 *   { role:'assistant', content:string } → { type:'message', role:'assistant',
 *                                             content:[{type:'output_text', text}] }
 *   { role:'assistant', tool_calls:[...] } → 多个 { type:'function_call', call_id, name, arguments }
 *     (如果同时有 content 文本,前面再加一个 message item)
 *   { role:'tool', tool_call_id, content } → { type:'function_call_output', call_id, output }
 *
 * 不处理 system(由 buildRequestBody 抽出来塞 instructions)。
 */
export function chatMessagesToResponsesInput(messages: any[]): any[] {
  const out: any[] = []
  for (const msg of messages) {
    const role = msg?.role
    if (role === 'user') {
      const text = stringifyContent(msg.content)
      out.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      })
    } else if (role === 'assistant') {
      const text = stringifyContent(msg.content)
      if (text) {
        out.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        })
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const callId = tc?.id
          const name = tc?.function?.name
          const args = tc?.function?.arguments
          if (typeof callId === 'string' && typeof name === 'string') {
            out.push({
              type: 'function_call',
              call_id: callId,
              name,
              arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
            })
          }
        }
      }
    } else if (role === 'tool') {
      const callId = msg.tool_call_id
      const output = stringifyContent(msg.content)
      if (typeof callId === 'string') {
        out.push({
          type: 'function_call_output',
          call_id: callId,
          output,
        })
      }
    }
    // 其他(包括 system,理论上已被抽出)— 跳过
  }
  return out
}

/** content 既可能是 string 也可能是 part 数组 — 统一拍平为字符串 */
function stringifyContent(content: any): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const p of content) {
      if (typeof p === 'string') parts.push(p)
      else if (typeof p?.text === 'string') parts.push(p.text)
    }
    return parts.join('')
  }
  return String(content)
}

/**
 * Tool 定义翻译:Chat Completions 嵌套格式 → Responses 平铺格式
 *
 *   Chat: { type:'function', function:{ name, description, parameters } }
 *   Resp: { type:'function', name, description, parameters, strict:false }
 */
function toolToResponsesFormat(tool: Tool): any {
  const jsonSchema: any = zodToJsonSchema(tool.inputSchema as z.ZodType, {
    target: 'openAi',
    $refStrategy: 'none',
  })
  delete jsonSchema.$schema
  delete jsonSchema.default
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: jsonSchema,
    strict: false,
  }
}

// ─── SSE 分隔符查找(与 provider.ts 同款) ─────────

function findEventSeparator(
  buffer: string,
): { end: number; sepLen: number } | -1 {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return -1
  if (lf === -1) return { end: crlf, sepLen: 4 }
  if (crlf === -1) return { end: lf, sepLen: 2 }
  return lf < crlf ? { end: lf, sepLen: 2 } : { end: crlf, sepLen: 4 }
}
