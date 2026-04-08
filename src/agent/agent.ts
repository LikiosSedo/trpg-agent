/**
 * TRPGAgent — Agent 主循环
 *
 * 职责:
 *   1. 维护 messages 历史
 *   2. 运行多轮 continuation:user input → LLM → 工具调用 → 把结果塞回 → 再 LLM → ...
 *   3. 把 provider 的低层事件转换为上层消费的 AgentEvent
 *   4. 错误处理:retry / backoff / timeout
 *   5. mute/unmute 工具(dm-agent 在战斗叙事等场景用)
 *
 * 实现 IAgent 接口,可以 drop-in 替换 open-claude-cli 的 Agent。
 *
 * 事件形状和 open-claude-cli 兼容:
 *   `{ type: 'text_delta' | 'thinking_delta' | 'tool_result' | 'turn_end' }`
 *   engine.ts 现有的事件消费代码(event.type === 'text_delta' 等)不需要改动。
 *
 * 设计决定:
 *
 * - **`<think>` 标签 fallback 放在 agent 层 post-process**:某些老模型把思考
 *   嵌在 content 里(用 `<think>...</think>` 包起来),而不是用标准的
 *   `reasoning_content` 字段。provider 层只处理标准协议,这种非标准行为由
 *   agent.ts 的 text_delta → thinking_delta 流式分离器处理。
 *
 * - **空响应/截断的兼容 hack**:engine.ts 当前有一堆 "continue" 过滤(比如
 *   `if (text.includes('(Empty response:')) continue`)。这是某些 provider 的
 *   历史怪癖。新 Agent 继承这些 hack,放在 ThinkTagParser 之后的同一个过滤层。
 *
 * - **Retry 策略**:exponential backoff + jitter,最多 3 次。只针对
 *   `RetryableError`(429 / 5xx / 网络);`PromptTooLongError` 当前直接抛
 *   (Phase 4 加 ContextManager 后捕获它);`StreamParseError` 不重试(通常是 bug)。
 *
 * - **API throttle**:简单版 —— 记录 `lastCallTime`,下次调用前 sleep 补足间隔。
 *   不做 queue,不做 rate limit 窗口。
 */

import type { Tool, IAgent, AgentEvent, ProviderConfig } from './types.js'
import {
  OpenAICompatProvider,
  type LowLevelEvent,
  type FinishReason,
} from './provider.js'
import { runToolCall } from './tool-runner.js'
import {
  AgentError,
  PromptTooLongError,
  RetryableError,
  isRetryable,
} from './errors.js'

// ─── 构造配置 ────────────────────────────────────────

export interface AgentConfig {
  provider: ProviderConfig
  tools: Tool[]
  systemPrompt?: string
  /** 最大 continuation 轮次。超过后强制停止并 yield turn_end */
  maxTurns?: number
  /** 两次 LLM 调用之间的最小间隔(毫秒)。用于限流防护 */
  apiThrottleMs?: number
  /** 单次 LLM 调用的最大 token 数 */
  maxTokens?: number
  /** 采样温度 */
  temperature?: number
  /** LLM 调用的最大重试次数(仅对 RetryableError 生效) */
  maxRetries?: number
  /** 执行 tool 时传给 tool.execute(input, context) 的上下文 */
  toolContext?: any
}

// ─── 默认值 ──────────────────────────────────────────

const DEFAULT_MAX_TURNS = 20
const DEFAULT_API_THROTTLE_MS = 1500
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_MAX_TOKENS = 8192
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_JITTER_MS = 200

// ─── Agent 主类 ──────────────────────────────────────

export class TRPGAgent implements IAgent {
  private provider: OpenAICompatProvider
  private activeTools: Tool[]
  private readonly mutedTools = new Map<string, Tool>()
  private readonly systemPrompt?: string
  private readonly maxTurns: number
  private readonly apiThrottleMs: number
  private readonly maxRetries: number
  private readonly maxTokens: number
  private readonly temperature?: number
  private readonly toolContext?: any

  public messages: any[] = []
  private lastApiCallTime = 0

  constructor(config: AgentConfig) {
    this.provider = new OpenAICompatProvider(config.provider)
    this.activeTools = [...config.tools]
    this.systemPrompt = config.systemPrompt
    this.maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS
    this.apiThrottleMs = config.apiThrottleMs ?? DEFAULT_API_THROTTLE_MS
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
    this.temperature = config.temperature
    this.toolContext = config.toolContext
  }

  // ─── 公开 API(IAgent 接口) ──────────────────────

  /**
   * 发送用户输入,返回事件流。
   *
   * 主循环:
   *   1. Push user message
   *   2. Loop:
   *      a. throttle
   *      b. call provider.stream 并累积 assistant message
   *      c. 如果有 tool_calls → 执行所有 → push tool result → continue
   *      d. 否则 → yield turn_end → return
   *   3. 超过 maxTurns → yield turn_end → return
   */
  async *run(input: string): AsyncGenerator<AgentEvent> {
    this.messages.push({ role: 'user', content: input })

    for (let turn = 0; turn < this.maxTurns; turn++) {
      // 1. API throttle
      await this.throttle()

      // 2. 调用 LLM(带重试)
      const assistantMsg: any = { role: 'assistant', content: '' }
      const toolCalls: Array<{ id: string; name: string; argsJson: string }> = []
      let finishReason: FinishReason = 'other'

      const thinkParser = new ThinkTagParser()

      try {
        for await (const lowLevel of this.streamWithRetry()) {
          // provider 吐出的 low-level 事件转换为对外的 AgentEvent
          yield* this.processLowLevelEvent(
            lowLevel,
            assistantMsg,
            toolCalls,
            thinkParser,
            (r) => { finishReason = r },
          )
        }
        // 流结束后 flush ThinkTagParser 残余
        const tail = thinkParser.flush()
        if (tail.text) {
          assistantMsg.content += tail.text
          yield { type: 'text_delta', text: tail.text }
        }
        if (tail.thinking) {
          yield { type: 'thinking_delta', thinking: tail.thinking }
        }
      } catch (err) {
        // PromptTooLongError 暂不自动处理(Phase 4 做),直接抛给上层
        if (err instanceof PromptTooLongError) throw err
        // StreamParseError 和其他 AgentError 也抛(通常是 bug)
        throw err
      }

      // 3. 把 assistant 消息(含可能的 tool_calls)塞回 messages
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.argsJson },
        }))
      }
      // 清理:content 为空字符串时改为 null(OpenAI 协议允许 null)
      if (assistantMsg.content === '') assistantMsg.content = null
      this.messages.push(assistantMsg)

      // 4. 如果有 tool calls,执行 + 塞回 tool result,继续下一 turn
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const { result, message } = await runToolCall(
            this.activeTools,
            tc.id,
            tc.name,
            tc.argsJson,
            this.toolContext,
          )
          this.messages.push(message)
          yield {
            type: 'tool_result',
            id: tc.id,
            name: tc.name,
            output: result.output,
            isError: !!result.isError,
          }
        }
        // 继续下一 turn,让 LLM 看到 tool 结果后决定下一步
        continue
      }

      // 5. 没有 tool calls,正常结束
      yield { type: 'turn_end' }
      return
    }

    // 超过 maxTurns,强制结束
    console.warn(`[TRPGAgent] Max turns (${this.maxTurns}) reached, terminating.`)
    yield { type: 'turn_end' }
  }

  getMessages(): any[] {
    return this.messages
  }

  // ─── 工具 mute/unmute(dm-agent 在战斗叙事时用) ───

  /**
   * 临时禁用部分工具,只保留白名单。调用后必须配对 unmute。
   * 重复 mute 会被忽略(幂等)。
   */
  muteTools(keep: string[]): void {
    if (this.mutedTools.size > 0) {
      console.warn('[TRPGAgent] muteTools() called while already muted, ignoring')
      return
    }
    const keepSet = new Set(keep)
    const remaining: Tool[] = []
    for (const tool of this.activeTools) {
      if (keepSet.has(tool.name)) {
        remaining.push(tool)
      } else {
        this.mutedTools.set(tool.name, tool)
      }
    }
    this.activeTools = remaining
  }

  /** 恢复被 mute 的工具。幂等:没在 mute 状态时也不报错。 */
  unmuteTools(): void {
    if (this.mutedTools.size === 0) return
    for (const tool of this.mutedTools.values()) {
      this.activeTools.push(tool)
    }
    this.mutedTools.clear()
  }

  /** 当前活跃工具列表(供调试) */
  get tools(): ReadonlyArray<Tool> {
    return this.activeTools
  }

  // ─── 内部:Low-level event → AgentEvent 转换 ──────

  private *processLowLevelEvent(
    ev: LowLevelEvent,
    assistantMsg: any,
    toolCalls: Array<{ id: string; name: string; argsJson: string }>,
    thinkParser: ThinkTagParser,
    onFinish: (r: FinishReason) => void,
  ): Generator<AgentEvent> {
    switch (ev.type) {
      case 'text_delta': {
        // 过滤已知的垃圾片段(某些 provider 会在 stream 里吐调试字符串)
        if (isGarbageText(ev.text)) return

        // <think> 标签分离:把 content 里可能包含的 thinking 部分提取出来
        const { text, thinking } = thinkParser.feed(ev.text)
        if (thinking) {
          yield { type: 'thinking_delta', thinking }
        }
        if (text) {
          assistantMsg.content += text
          yield { type: 'text_delta', text }
        }
        return
      }

      case 'reasoning_delta': {
        // 标准 reasoning_content 协议 → 累积到 assistantMsg + emit thinking_delta
        //
        // 关键:reasoning_content 必须累积到 assistantMsg 里并随后续请求一起
        // 发回服务端。原因是某些 thinking 模型(如 Kimi K2.5 thinking)在 strict
        // 模式下会校验历史消息:"如果启用 thinking,每个 assistant tool_call 消息
        // 必须带 reasoning_content 字段",否则下一次请求直接 HTTP 400。
        //
        // 对不校验此字段的 provider(比如早期 DeepSeek),多带一个字段无副作用。
        if (typeof assistantMsg.reasoning_content !== 'string') {
          assistantMsg.reasoning_content = ''
        }
        assistantMsg.reasoning_content += ev.text
        yield { type: 'thinking_delta', thinking: ev.text }
        return
      }

      case 'tool_call': {
        // provider 已经把 id/name/argsJson 累积完整
        toolCalls.push({ id: ev.id, name: ev.name, argsJson: ev.argsJson })
        return
      }

      case 'finish': {
        onFinish(ev.reason)
        return
      }
    }
  }

  // ─── 内部:带重试的 stream ────────────────────────

  private async *streamWithRetry(): AsyncGenerator<LowLevelEvent> {
    let attempt = 0
    while (true) {
      try {
        const stream = this.provider.stream(
          this.messages,
          this.activeTools,
          {
            systemPrompt: this.systemPrompt,
            maxTokens: this.maxTokens,
            temperature: this.temperature,
          },
        )
        // 必须包装在一个 try,这样 for-await 过程中抛错也能被捕获
        for await (const ev of stream) {
          yield ev
        }
        // 正常结束,跳出重试循环
        return
      } catch (err) {
        this.lastApiCallTime = Date.now() // 即使失败也更新,避免重试打爆
        if (!isRetryable(err) || attempt >= this.maxRetries) {
          throw err
        }
        attempt++
        const delay = backoffDelay(attempt)
        console.warn(
          `[TRPGAgent] Retryable error on attempt ${attempt}/${this.maxRetries}, ` +
            `backing off ${delay}ms: ${(err as Error).message}`,
        )
        await sleep(delay)
      }
    }
  }

  // ─── 内部:API throttle ──────────────────────────

  private async throttle(): Promise<void> {
    if (this.apiThrottleMs <= 0) return
    const now = Date.now()
    const elapsed = now - this.lastApiCallTime
    const waitMs = this.apiThrottleMs - elapsed
    if (waitMs > 0) {
      await sleep(waitMs)
    }
    this.lastApiCallTime = Date.now()
  }
}

// ─── Factory(一致的构造入口) ──────────────────────

/** 创建一个 TRPG Agent。返回的对象实现 IAgent 接口。 */
export function createAgent(config: AgentConfig): TRPGAgent {
  return new TRPGAgent(config)
}

// ═══ 辅助 ════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** exponential backoff + jitter: base * 2^(attempt-1) + random(0, jitter) */
function backoffDelay(attempt: number): number {
  const base = BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
  const jitter = Math.floor(Math.random() * BACKOFF_MAX_JITTER_MS)
  return base + jitter
}

/**
 * 过滤已知垃圾片段 —— 某些 provider 在 stream 里吐调试字符串。
 * 这些是 engine.ts 当前的兼容 hack,新 Agent 继承它们。
 * TODO: 等底层模型稳定后删除这些过滤。
 */
function isGarbageText(text: string): boolean {
  return (
    text.includes("'content': [") ||
    text.includes('(Empty response:') ||
    text.includes("'type': 'thinking'") ||
    text.includes('[DEBUG]')
  )
}

// ─── ThinkTagParser ──────────────────────────────────

/**
 * 流式 `<think>...</think>` 标签分离器。
 *
 * 处理场景:某些老模型(早期 Kimi 等)不使用标准的 `reasoning_content` 字段,
 * 而是把思考内容嵌入 content,用 `<think>...</think>` 包起来。我们需要在流式
 * 接收时把这两部分分开,让上层以 text_delta / thinking_delta 两种事件消费。
 *
 * 算法:一个简单的状态机
 *   - 在 `inThink=false` 状态,text 默认输出到 narrative
 *   - 遇到 `<think>` 开标签 → 切到 `inThink=true`
 *   - 在 `inThink=true` 状态,text 输出到 thinking
 *   - 遇到 `</think>` 闭标签 → 切回 `inThink=false`
 *
 * 边界情况:标签可能被 stream chunk 切成两半,比如 "<thi" + "nk>"。
 * 用 `buffer` 存未确认的尾部字符,直到能判断是正文还是标签起始。
 */
class ThinkTagParser {
  private inThink = false
  private buffer = ''

  /**
   * 喂入新的 chunk,返回可立即输出的 narrative / thinking 两部分。
   * 未确定归属的尾部留在 buffer。
   */
  feed(chunk: string): { text: string; thinking: string } {
    this.buffer += chunk
    let narrative = ''
    let thinking = ''

    while (true) {
      if (!this.inThink) {
        // 找 <think> 开标签
        const tagIdx = this.buffer.indexOf('<think>')
        if (tagIdx >= 0) {
          // 标签前的都是 narrative
          narrative += this.buffer.slice(0, tagIdx)
          this.buffer = this.buffer.slice(tagIdx + '<think>'.length)
          this.inThink = true
          continue
        }
        // 没找到完整标签 — 保留最后 6 个字符以防标签被 chunk 切断,其余输出
        const safeLen = Math.max(0, this.buffer.length - 6)
        narrative += this.buffer.slice(0, safeLen)
        this.buffer = this.buffer.slice(safeLen)
        break
      } else {
        // 找 </think> 闭标签
        const tagIdx = this.buffer.indexOf('</think>')
        if (tagIdx >= 0) {
          thinking += this.buffer.slice(0, tagIdx)
          this.buffer = this.buffer.slice(tagIdx + '</think>'.length)
          this.inThink = false
          continue
        }
        // 没找到闭标签 — 保留最后 7 个字符以防被切断,其余输出到 thinking
        const safeLen = Math.max(0, this.buffer.length - 7)
        thinking += this.buffer.slice(0, safeLen)
        this.buffer = this.buffer.slice(safeLen)
        break
      }
    }

    return { text: narrative, thinking }
  }

  /** stream 结束时调用,flush buffer 里残余的内容 */
  flush(): { text: string; thinking: string } {
    const remaining = this.buffer
    this.buffer = ''
    if (this.inThink) {
      // stream 结束但 <think> 没有闭合 — 把残余当作 thinking 吐出去
      this.inThink = false
      return { text: '', thinking: remaining }
    }
    return { text: remaining, thinking: '' }
  }
}
