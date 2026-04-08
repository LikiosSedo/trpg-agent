/**
 * Messages 操作工具
 *
 * OpenAI-compatible 协议的消息数据结构 + 操作函数。
 *
 * 设计决定:
 * - 不自己定义强类型的 Message union,而是用 `any` + type guard。
 *   理由:各 provider (Kimi/DeepSeek/GLM/Doubao) 的细节字段不完全一致,
 *   强类型会逼我们对每个变体写 adapter,成本高但收益小。
 *   上层调用都通过 type guard 访问特定字段,足以保证安全。
 *
 * - 不做 tokenizer 真实计数,用 char-based 4:1 近似估算。这是 Codex 的做法
 *   (codex-rs 也是估算的),误差可接受,而且能避免额外依赖 tiktoken。
 *
 * - 配对操作是核心:OpenAI 协议要求 assistant 消息里 tool_calls 数组中的
 *   每一个 call,必须在后续 messages 里有对应的 role="tool" + tool_call_id
 *   匹配的消息。裁剪历史时如果破坏了这个配对,下一次 API 调用会 schema error。
 *   这是 Codex 的 normalize::remove_corresponding_for() 要解决的同一个问题。
 */

// ─── 常量 ────────────────────────────────────────────

/** char-based token 估算比例:1 token ≈ 4 chars(UTF-8 中英文混合的经验值) */
const CHARS_PER_TOKEN = 4

// ─── Type Guards ─────────────────────────────────────

/** 判断是否为 tool result 消息 */
export function isToolResult(msg: any): boolean {
  return msg?.role === 'tool' && typeof msg?.tool_call_id === 'string'
}

/** 判断是否为带 tool_calls 的 assistant 消息 */
export function isAssistantWithToolCalls(msg: any): boolean {
  return (
    msg?.role === 'assistant' &&
    Array.isArray(msg?.tool_calls) &&
    msg.tool_calls.length > 0
  )
}

/** 判断是否为纯文本的 user 消息 */
export function isUserMessage(msg: any): boolean {
  return msg?.role === 'user'
}

/** 判断是否为 system 消息 */
export function isSystemMessage(msg: any): boolean {
  return msg?.role === 'system'
}

// ─── Token 估算 ──────────────────────────────────────

/**
 * 估算单条消息的 token 数。
 *
 * 覆盖场景:
 * - content 是字符串:直接按字符数 / 4
 * - content 是数组(多模态):拼接所有 text 部分
 * - tool_calls:把函数名 + arguments JSON 计入
 * - tool_call_id / role / name 等元数据:固定加 5 tokens(OpenAI 协议开销)
 */
export function estimateMessageTokens(msg: any): number {
  if (!msg) return 0
  let charCount = 0

  // content 字段
  const content = msg.content
  if (typeof content === 'string') {
    charCount += content.length
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        charCount += part.length
      } else if (part?.type === 'text' && typeof part.text === 'string') {
        charCount += part.text.length
      }
      // 图片等其他部分暂不估算
    }
  }

  // reasoning_content (DeepSeek/Kimi 思考链)
  if (typeof msg.reasoning_content === 'string') {
    charCount += msg.reasoning_content.length
  }

  // tool_calls (assistant 发起的工具调用)
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (typeof tc?.function?.name === 'string') {
        charCount += tc.function.name.length
      }
      if (typeof tc?.function?.arguments === 'string') {
        charCount += tc.function.arguments.length
      }
    }
  }

  // 协议开销:role / name / tool_call_id 等固定字段
  const overhead = 5

  return Math.ceil(charCount / CHARS_PER_TOKEN) + overhead
}

/** 估算 messages 数组的总 token 数 */
export function estimateTokens(messages: any[]): number {
  let total = 0
  for (const msg of messages) total += estimateMessageTokens(msg)
  return total
}

// ─── 配对操作(核心) ─────────────────────────────────

/**
 * 给定一个 tool_call id,在 messages 数组中查找对应的 tool result 消息索引。
 *
 * @returns 找到的索引,找不到返回 -1
 */
export function findPairedToolResult(
  messages: any[],
  toolCallId: string,
): number {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (isToolResult(msg) && msg.tool_call_id === toolCallId) {
      return i
    }
  }
  return -1
}

/**
 * 收集一条 assistant 消息中所有 tool_call ids。
 * 用于裁剪时知道"删掉这条 assistant 要同时删哪些 tool result"。
 */
export function collectToolCallIds(msg: any): string[] {
  if (!isAssistantWithToolCalls(msg)) return []
  const ids: string[] = []
  for (const tc of msg.tool_calls) {
    if (typeof tc?.id === 'string') ids.push(tc.id)
  }
  return ids
}

/**
 * 删除消息及其配对内容,保证协议完整性。
 *
 * 规则:
 * 1. 如果要删的是 assistant + tool_calls → 同时删所有匹配的 tool result
 * 2. 如果要删的是 tool result → 不动对应的 assistant(这通常是"重做"场景,
 *    删 tool result 但保留 assistant 的 tool_call 是协议错误,因此此函数拒绝这样做,
 *    调用方应改为删整个 assistant)
 * 3. 其他类型的消息(user / system / 纯 assistant 文本)→ 直接删
 *
 * 这是 Codex 的 normalize::remove_corresponding_for() 的简化版。
 *
 * @param messages 原数组(会被 **原地修改**)
 * @param index    要删的消息索引
 * @returns        实际删除的消息数量
 */
export function removeWithPair(messages: any[], index: number): number {
  if (index < 0 || index >= messages.length) return 0
  const target = messages[index]

  // Case 1: assistant with tool_calls → 删自己 + 所有配对的 tool result
  if (isAssistantWithToolCalls(target)) {
    const ids = collectToolCallIds(target)
    // 先删 assistant 本身
    messages.splice(index, 1)
    // 然后删每一个配对的 tool result(从 index 位置继续往后找,因为 index 已经前进了 1)
    let removed = 1
    for (const id of ids) {
      const pairIdx = findPairedToolResult(messages, id)
      if (pairIdx >= 0) {
        messages.splice(pairIdx, 1)
        removed++
      }
    }
    return removed
  }

  // Case 2: tool result 单独删 → 拒绝(会破坏协议)
  if (isToolResult(target)) {
    throw new Error(
      `[messages.removeWithPair] Refuse to delete a tool result (tool_call_id=${target.tool_call_id}) alone. ` +
        `This would orphan the matching assistant tool_call and break OpenAI protocol. ` +
        `Delete the containing assistant message instead.`,
    )
  }

  // Case 3: 普通消息(user / system / 无 tool_calls 的 assistant)→ 直接删
  messages.splice(index, 1)
  return 1
}

// ─── 批量保留操作 ────────────────────────────────────

/**
 * 保留最近 N 条 user message 开始的消息,丢弃之前的所有。
 * 用于滑动窗口压缩 —— Phase 4 会用到。Phase 1 先放这里,接口稳定。
 *
 * 算法:
 * 1. 从末尾反向扫描,找到第 N 个 user message 的位置(cut index)
 * 2. 但要保证 cut index 不会切断 assistant/tool_result 配对 —— 如果 cut 后
 *    剩余的 messages 头部是孤儿 tool result(缺对应 assistant),向后移动 cut
 *    直到配对完整
 * 3. 返回 cut 之前的(将被丢弃的) + cut 之后的(将被保留的)
 *
 * @param messages  原数组(不修改)
 * @param keepLastN 要保留的最近 user message 数量
 * @returns         { kept, dropped } 两个新数组
 */
export function splitByRecentUserMessages(
  messages: any[],
  keepLastN: number,
): { kept: any[]; dropped: any[] } {
  if (keepLastN <= 0 || messages.length === 0) {
    return { kept: [], dropped: [...messages] }
  }

  // 从末尾反向找第 N 个 user message
  let userSeen = 0
  let cutIdx = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserMessage(messages[i])) {
      userSeen++
      if (userSeen >= keepLastN) {
        cutIdx = i
        break
      }
    }
  }

  // 如果 cut 后头部是 orphan tool result,向后推直到不是
  while (cutIdx < messages.length && isToolResult(messages[cutIdx])) {
    cutIdx++
  }

  return {
    kept: messages.slice(cutIdx),
    dropped: messages.slice(0, cutIdx),
  }
}
