/**
 * SetActions 流式过滤器 —— 防御 DM 的 "inline tool call 幻觉"
 *
 * 背景:
 *   有些 LLM(尤其是中文微调模型)在被要求"调用 SetActions"时,会把它
 *   理解为"在文本里写一段看起来像工具调用的 markup",而不是通过真正的
 *   function calling API 调用。典型产物:
 *
 *     ...最后一段叙事。
 *     <setactions>
 *     { "details": [...], "suggestions": [...] }
 *     </setactions>
 *
 *   这导致两个问题:
 *   1. 这段 XML 原样流到前端,玩家看到一堆乱码 JSON
 *   2. 真正的 SetActions 从未被调用,consumeActions() 返回 null,系统
 *      只能 fallback 到通用选项,DM 精心写的 contextual suggestions 白写
 *
 * 解法:
 *   1. 在流式 text_delta 的传输路径上插一个过滤器
 *   2. 缓冲小段文本,检测 `<setactions>` 开始标签
 *   3. 检测到后吞掉文本直到 `</setactions>`,把中间的内容通过回调交出去
 *   4. 调用方把收到的 JSON 尝试 parse + injectPendingActions(),把伪
 *      inline 调用转化为真正的 pendingActions 写入
 *
 * 效果:
 *   - 玩家看到的叙事是干净的(没有 XML 尾巴)
 *   - 选项仍然拿到了 DM 写的 contextual 内容
 *   - 对 DM 的行为没有侵入性(没有重试、没有二次请求)
 *
 * 未覆盖的幻觉变种(以后再加):
 *   - SetActions 其它别名: <set_actions>, <SetActions>, [setactions]
 *   - 纯 JSON 输出(没有 XML 包裹): { "details": ..., "suggestions": ... }
 *   - YAML 输出
 *
 * 当前只针对 `<setactions>` 这个具体形式 —— 日志显示是它。
 */

const OPEN_TAG_RE = /<setactions\b[^>]*>/i
const CLOSE_TAG = /<\/setactions\s*>/i
// 最长 "可能是开始标签" 的保留缓冲量。'<setactions ' = 12 字符,留一点余量
const SAFE_KEEP = 16

export interface FilterResult {
  /** 过滤后可以安全输出的文本(已经剥离了检测到的块和"可能正在组装的起始标签") */
  output: string
  /**
   * 本次 feed/flush 里检测到的所有完整块内容(原始 JSON 文本,可能带前后空白)。
   * 正常情况下每次最多 1 个,但一次 feed 里如果 chunk 里同时出现多个块,
   * 会返回多个。调用方应该遍历 inject 每一个。
   */
  detectedBlocks: string[]
}

/**
 * 流式状态机。调用方每次拿到 text_delta 就 feed(chunk),拿到
 * { output, detectedBlock }。
 *
 * - output 可以安全 yield 给前端
 * - detectedBlock 是 `<setactions>` 和 `</setactions>` 之间的字符(原始 JSON
 *   字符串,可能带前后空白),调用方 try/catch JSON.parse 决定是否 inject
 *
 * 结束时必须调用 flush(),把残留 buffer 交出来(通常是几个字符)。
 */
export class SetActionsStreamFilter {
  private buffer = ''
  private suppressing = false

  feed(chunk: string): FilterResult {
    this.buffer += chunk
    let output = ''
    const detectedBlocks: string[] = []

    while (this.buffer.length > 0) {
      if (!this.suppressing) {
        const match = this.buffer.match(OPEN_TAG_RE)
        if (!match || match.index === undefined) {
          // 没找到开始标签 —— 大部分 buffer 可以安全输出,但保留尾部 SAFE_KEEP
          // 以防下个 chunk 带来的 '<' 字符和当前尾部拼成完整的开始标签
          if (this.buffer.length > SAFE_KEEP) {
            output += this.buffer.slice(0, this.buffer.length - SAFE_KEEP)
            this.buffer = this.buffer.slice(this.buffer.length - SAFE_KEEP)
          }
          break
        }
        output += this.buffer.slice(0, match.index)
        this.buffer = this.buffer.slice(match.index + match[0].length)
        this.suppressing = true
      } else {
        const closeMatch = this.buffer.match(CLOSE_TAG)
        if (!closeMatch || closeMatch.index === undefined) break
        detectedBlocks.push(this.buffer.slice(0, closeMatch.index))
        this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length)
        this.suppressing = false
      }
    }

    return { output, detectedBlocks }
  }

  /**
   * 结束流 —— 把残留 buffer 交出来。
   * 如果结束时仍在 suppress 状态(开始标签出现了但结束标签永远没来),
   * 意味着 DM 写了一个不闭合的 XML 块 —— 我们选择**丢弃**这段内容而不是
   * 把它 echo 给前端(因为那是更糟的用户体验:看到一半的 JSON)。
   */
  flush(): FilterResult {
    if (this.suppressing) {
      const detectedBlocks = this.buffer ? [this.buffer] : []
      this.buffer = ''
      this.suppressing = false
      return { output: '', detectedBlocks }
    }
    const output = this.buffer
    this.buffer = ''
    return { output, detectedBlocks: [] }
  }
}

/**
 * 从检测到的 block 文本里提取 JSON 并解析。
 * block 可能是:
 *   ` \n{"details":...}\n `  — 纯 JSON
 *   ` \n\`\`\`json\n{...}\n\`\`\`\n `  — 带 markdown 代码围栏
 *   ` something invalid `  — 返回 null
 */
export function parseSetActionsBlock(rawBlock: string): any | null {
  if (!rawBlock) return null
  let text = rawBlock.trim()

  // 去掉 markdown 代码围栏
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenceMatch) text = fenceMatch[1].trim()

  // 尝试直接 parse
  try {
    return JSON.parse(text)
  } catch {
    // 也许文本前后有额外字符。尝试提取第一个 {...} 块
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1))
      } catch { /* fall through */ }
    }
  }
  return null
}
