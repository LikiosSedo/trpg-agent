/**
 * Context Manager — 上下文压缩(TRPG 极简版)
 *
 * 核心哲学(来自 Phase 4 讨论):
 *
 * 1. **只负责流畅性,不负责完美记忆**
 *    TRPG 的"长期记忆"由更上层的机制承担:
 *      - 剧本级: 未来的 lore 文件系统(Phase 5)
 *      - 存档级: NPC.interactionLog, quests, flags, 信任度等结构化数据
 *    这个模块只确保 dmMessages 不会撑爆 context window 以及 DM 输出流畅。
 *
 * 2. **零 LLM 调用**
 *    不做 LLM 摘要。压缩时用代码从 session 直接生成结构化快照
 *    (`buildArchivalSnapshot` 回调),作为归档消息的 content。
 *    好处:0 延迟 · 0 失败路径 · 0 额外成本 · 100% 准确
 *
 * 3. **Codex 之上的改进**
 *    Codex 的 ContextManager:0.85 阈值晚触发 + 30% 保留 + 复杂 circuit breaker
 *    我们的改进:0.6 阈值早触发 + 最近 12 turn 完整保留 + 不会失败所以不需要
 *    circuit breaker。核心是"简单可靠" > "功能丰富"。
 *
 * 4. **和 Phase 5 Lore 的配合**
 *    归档消息的措辞动态检测 lore 工具是否存在。如果注册了 ReadLore/GrepLore
 *    等,就提示 DM 可以查询;没有就省略这句。
 */

import type { Tool } from './types.js'
import {
  estimateTokens,
  splitByRecentUserMessages,
  isSystemMessage,
} from './messages.js'

// ─── 配置 ────────────────────────────────────────────

export interface ContextManagerConfig {
  /**
   * 模型的 context window 上限(token 数)。
   * 默认 100_000 —— 对现代模型(Kimi K2.5 / DeepSeek V3 / GLM 4.6 / Doubao
   * Pro 等)都是安全下界。需要更精确可以按 model 配置。
   */
  modelContextWindow?: number

  /**
   * 触发压缩的 token 使用率。tokens >= modelContextWindow * threshold 时触发。
   * 默认 0.6。
   *
   * 为什么是 0.6(比 Codex 的 0.85 早):
   *   - 早触发 → 每次压缩丢弃的消息少 → 对当前叙事连续性影响小
   *   - 留 40% buffer 给 LLM 输出 + reasoning_content + tool_call args
   *   - 和"不频繁压缩"的目标不矛盾 —— 0.6 阈值在 TRPG 节奏下仍然需要
   *     几十个 turn 才首次触发
   */
  compactThreshold?: number

  /**
   * 保留最近多少个 user turn 的完整 messages。
   * 默认 12。这是"当前这段戏"的上下文窗口。
   *
   * 为什么是 12:
   *   - 太少(<8)→ 叙事连续性损失,DM 突然换措辞
   *   - 太多(>15)→ 压缩频繁,或保留的 token 过多导致压缩意义降低
   *   - 12 是经验平衡值 —— TRPG 一个 beat 通常 10-20 turn,保留 12 能覆盖
   *     最近一整个 beat
   */
  keepRecentTurns?: number

  /**
   * 生成归档快照内容的回调。
   *
   * 调用方(dm-agent 等)提供一个函数,返回一个多行字符串,描述当前游戏状态
   * 的核心信息(位置/任务/NPC/信任度/最近交互/等)。这个字符串会被包装为
   * 一条 user message,插入到保留的最近 K turn 之前。
   *
   * 如果不提供,fallback 到一个极简的固定占位符。
   */
  buildArchivalSnapshot?: (options: { keepRecentTurns: number; availableToolNames: string[] }) => string
}

// ─── 默认值 ──────────────────────────────────────────

const DEFAULTS = {
  modelContextWindow: 100_000,
  compactThreshold: 0.6,
  keepRecentTurns: 12,
}

const FALLBACK_SNAPSHOT =
  '[系统] 早期对话历史已归档。请基于当前游戏状态(通过 [游戏状态] 标签注入)' +
  '和最近保留的对话继续推进剧情。'

// ─── 结果类型 ────────────────────────────────────────

export interface CompactResult {
  /** 策略:'archival' = 生成归档消息;'noop' = 消息不够,无压缩 */
  strategy: 'archival' | 'noop'
  /** 被归档的消息数量(不含保留的) */
  droppedCount: number
  /** 压缩后 messages 数组的长度 */
  keptCount: number
  /** 压缩前估算 token 数 */
  tokensBefore: number
  /** 压缩后估算 token 数 */
  tokensAfter: number
}

// ─── 主类 ────────────────────────────────────────────

export class ContextManager {
  private readonly modelContextWindow: number
  private readonly compactThreshold: number
  private readonly keepRecentTurns: number
  private readonly buildSnapshot?: ContextManagerConfig['buildArchivalSnapshot']

  constructor(config: ContextManagerConfig = {}) {
    this.modelContextWindow = config.modelContextWindow ?? DEFAULTS.modelContextWindow
    this.compactThreshold = config.compactThreshold ?? DEFAULTS.compactThreshold
    this.keepRecentTurns = config.keepRecentTurns ?? DEFAULTS.keepRecentTurns
    this.buildSnapshot = config.buildArchivalSnapshot
  }

  /** 检查 messages 是否需要压缩 */
  needsCompact(messages: any[]): boolean {
    const budget = this.modelContextWindow * this.compactThreshold
    return estimateTokens(messages) >= budget
  }

  /**
   * 执行压缩(原地修改 messages 数组)。
   *
   * 策略:
   *   1. 用 splitByRecentUserMessages 切分,保留最近 K turn 完整
   *      (配对保护:tool_call 和 tool_result 不会被切断)
   *   2. 把早期的 dropped 替换为一条结构化归档消息(从 session 代码生成)
   *   3. system 消息保留在最前(如果 messages[0] 是 system)
   *   4. 原地 replace
   *
   * 不会失败 —— 这是设计目标。如果某个环节异常(如 buildSnapshot 抛),
   * fallback 到纯 truncation(用 FALLBACK_SNAPSHOT 固定字符串)。
   *
   * @param messages - 会被原地修改
   * @param tools - 当前注册的工具列表,用于检测 lore 工具是否存在
   * @returns 压缩结果报告
   */
  compact(messages: any[], tools: ReadonlyArray<Tool> = []): CompactResult {
    const tokensBefore = estimateTokens(messages)

    // 1. 切分:保留最近 K turn 完整 + dropped 早期消息
    const { kept, dropped } = splitByRecentUserMessages(messages, this.keepRecentTurns)

    if (dropped.length === 0) {
      // messages 太短,切不出东西来 —— no-op
      return {
        strategy: 'noop',
        droppedCount: 0,
        keptCount: messages.length,
        tokensBefore,
        tokensAfter: tokensBefore,
      }
    }

    // 2. 生成归档消息 content
    let snapshotContent: string
    try {
      if (this.buildSnapshot) {
        snapshotContent = this.buildSnapshot({
          keepRecentTurns: this.keepRecentTurns,
          availableToolNames: tools.map(t => t.name),
        })
      } else {
        snapshotContent = FALLBACK_SNAPSHOT
      }
    } catch (err) {
      // buildSnapshot 异常 → fallback 到固定字符串,不让压缩失败
      console.warn(
        `[context-manager] buildArchivalSnapshot threw, using fallback: ${(err as Error).message}`,
      )
      snapshotContent = FALLBACK_SNAPSHOT
    }

    const archivalMessage = {
      role: 'user' as const,
      content: snapshotContent,
    }

    // 3. 组装新 messages:
    //    保留 system 消息(如果有,通常在 messages[0])
    //    + 归档消息(替代被 dropped 的所有早期 messages)
    //    + kept 里去掉 system 的部分(防止重复)
    const systemFromDropped = dropped.filter(m => isSystemMessage(m))
    const systemFromKept = kept.filter(m => isSystemMessage(m))
    const allSystem = [...systemFromDropped, ...systemFromKept]
    const keptNoSystem = kept.filter(m => !isSystemMessage(m))

    const newMessages = [...allSystem, archivalMessage, ...keptNoSystem]

    // 4. 原地替换
    messages.length = 0
    messages.push(...newMessages)

    const tokensAfter = estimateTokens(messages)

    return {
      strategy: 'archival',
      droppedCount: dropped.filter(m => !isSystemMessage(m)).length,
      keptCount: newMessages.length,
      tokensBefore,
      tokensAfter,
    }
  }
}
