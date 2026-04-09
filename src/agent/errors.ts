/**
 * Agent 层错误类型
 *
 * 分类依据:上层应该如何响应这个错误
 *
 *   - PromptTooLongError: 上下文撑爆,需要触发压缩(Phase 4 的 ContextManager 处理)
 *   - RetryableError:    网络/限流/临时服务端错误,应自动 backoff 重试
 *   - StreamParseError:  provider 收到的 SSE chunk 格式不合法,通常是 bug,不重试
 *   - TimeoutError:      请求总耗时超过上限,放弃
 *   - AgentError:        其他未分类错误的基类
 *
 * 所有错误都保留了原始 cause 字段,便于日志追溯。
 */

/** Agent 层所有错误的基类 */
export class AgentError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'AgentError'
  }
}

/**
 * Prompt 超出模型上下文窗口。
 *
 * 触发时机:provider 收到 HTTP 413,或 LLM 返回包含 "context length exceeded" /
 *   "maximum context length" / "too many tokens" 等关键词的错误响应。
 *
 * 处理方式:Phase 4 的 ContextManager 应该捕获此错误,执行 forceCompact(),然后重试。
 *   Phase 1 暂不自动处理,只把它抛出去,让上层知道发生了什么。
 */
export class PromptTooLongError extends AgentError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'PromptTooLongError'
  }
}

/**
 * 可重试错误 — 网络临时故障、限流、服务端 5xx。
 *
 * 触发时机:HTTP 429 / 500 / 502 / 503 / 504,或 fetch 本身抛出的网络错误(ECONNRESET 等)。
 *
 * 处理方式:Agent 主循环应该 exponential backoff + jitter 重试,最多 3 次。
 */
export class RetryableError extends AgentError {
  constructor(
    message: string,
    /** HTTP 状态码,fetch 网络错误时为 undefined */
    public readonly statusCode: number | undefined,
    cause?: unknown,
  ) {
    super(message, cause)
    this.name = 'RetryableError'
  }
}

/**
 * SSE 流解析错误 — provider 收到的数据不符合 OpenAI streaming 协议。
 *
 * 触发时机:JSON.parse 失败、chunk 缺少 `choices[0].delta` 字段、tool_call id 断流等。
 *
 * 处理方式:通常是 bug 或上游模型异常,不重试。记录详细 debug 信息后抛出。
 */
export class StreamParseError extends AgentError {
  constructor(message: string, public readonly chunk?: string, cause?: unknown) {
    super(message, cause)
    this.name = 'StreamParseError'
  }
}

/** 请求总耗时超限 */
export class TimeoutError extends AgentError {
  constructor(message: string, public readonly elapsedMs: number, cause?: unknown) {
    super(message, cause)
    this.name = 'TimeoutError'
  }
}

// ─── 分类辅助 ────────────────────────────────────────

/** 判断是否为 PromptTooLongError(或带有该语义的错误) */
export function isPromptTooLong(err: unknown): err is PromptTooLongError {
  if (err instanceof PromptTooLongError) return true
  // 兼容:有些 provider 不返回 413,而是在消息里提示
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('context length') ||
      msg.includes('context window') ||
      msg.includes('maximum context') ||
      msg.includes('too many tokens') ||
      msg.includes('prompt is too long')
    )
  }
  return false
}

/** 判断是否为 RetryableError */
export function isRetryable(err: unknown): err is RetryableError {
  if (err instanceof RetryableError) return true
  // fetch 底层网络错误通常是 TypeError/Error,消息里包含 ECONNRESET/ETIMEDOUT 等
  if (err instanceof Error) {
    const msg = err.message
    return (
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('EAI_AGAIN') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('fetch failed')
    )
  }
  return false
}

/**
 * 从 HTTP 响应构造合适的错误类型。
 *
 * 调用方(provider)在收到非 2xx 响应时使用此函数,它会根据状态码自动选择
 * PromptTooLongError / RetryableError / AgentError。
 */
export function httpErrorFromStatus(
  statusCode: number,
  body: string,
  cause?: unknown,
): AgentError {
  // 413 Payload Too Large → 上下文超限
  if (statusCode === 413) {
    return new PromptTooLongError(
      `HTTP 413: prompt too long (${truncate(body, 200)})`,
      cause,
    )
  }
  // 某些 provider 用 400 + 特定错误消息表达上下文超限
  if (statusCode === 400 && isPromptTooLong(new Error(body))) {
    return new PromptTooLongError(
      `HTTP 400 with context-exceeded message: ${truncate(body, 200)}`,
      cause,
    )
  }
  // 429 限流 / 5xx 服务端错误 → 可重试
  if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
    return new RetryableError(
      `HTTP ${statusCode}: ${truncate(body, 200)}`,
      statusCode,
      cause,
    )
  }
  // 其他 4xx 一般是客户端 bug,不重试
  return new AgentError(
    `HTTP ${statusCode}: ${truncate(body, 200)}`,
    cause,
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '...[truncated]'
}
