/**
 * Tool Runner — 工具执行 + 结果包装
 *
 * 职责:
 *   1. 从 tools 注册表里找到 LLM 请求调用的 tool
 *   2. 用 zod 校验 LLM 给的参数 JSON
 *   3. 调用 tool.execute() 并捕获异常
 *   4. 把 ToolResult 包装成 OpenAI 协议的 tool result message,塞回 messages 数组
 *
 * 错误处理哲学(fail-soft 不 fail-fast):
 *   所有异常都被捕获并转成 `ToolResult { isError: true, output: '...' }`,
 *   不 throw 到 agent 层。理由:LLM 调用工具时传错参数/工具崩是"正常路径"的
 *   一部分(LLM 看到 isError=true 可以自己调整策略重试),如果 throw 到 agent
 *   层会让整个 turn 炸掉,对玩家体验极差。
 *
 *   注意:这里的 fail-soft 只针对"工具执行过程中的错误",不包括上游 LLM
 *   协议错误(PromptTooLong / Retryable / StreamParse 等 —— 那些依然会在
 *   provider 层抛出,由 agent 层处理)。
 */

import type { Tool, ToolResult } from './types.js'

// ─── 单步操作 ────────────────────────────────────────

/**
 * 在 tools 注册表中按 name 查找工具。
 */
export function findTool(tools: Tool[], name: string): Tool | undefined {
  return tools.find(t => t.name === name)
}

/**
 * 执行单个工具调用:parse argsJson → zod 校验 → execute。
 *
 * 所有异常被捕获,转成 `ToolResult { isError: true }`,绝不向上抛。
 */
export async function executeTool(
  tool: Tool,
  argsJson: string,
  context?: any,
): Promise<ToolResult> {
  // 1. Parse JSON
  let rawArgs: unknown
  try {
    rawArgs = argsJson.length > 0 ? JSON.parse(argsJson) : {}
  } catch (err) {
    return {
      output:
        `Tool "${tool.name}" arguments JSON parse error: ${(err as Error).message}. ` +
        `Raw: ${truncate(argsJson, 200)}`,
      isError: true,
    }
  }

  // 2. Zod 校验
  const validation = tool.inputSchema.safeParse(rawArgs)
  if (!validation.success) {
    return {
      output:
        `Tool "${tool.name}" arguments validation failed: ${validation.error.message}. ` +
        `Received: ${truncate(JSON.stringify(rawArgs), 200)}`,
      isError: true,
    }
  }

  // 3. Execute
  try {
    const result = await tool.execute(validation.data, context)
    // 兼容性防御:有些工具可能返回非对象(历史 bug),规范化一下
    if (typeof result !== 'object' || result === null) {
      return {
        output: String(result ?? ''),
        isError: false,
      }
    }
    return result
  } catch (err) {
    return {
      output:
        `Tool "${tool.name}" execution threw: ` +
        (err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
      isError: true,
    }
  }
}

/**
 * 把 ToolResult 包装成 OpenAI 的 tool result message 格式,准备塞回 messages 数组。
 *
 * OpenAI 协议要求:
 *   { role: 'tool', tool_call_id: '<id from assistant.tool_calls>', content: '<output>' }
 *
 * 注意:我们**不**把 isError 字段加到 message 里 —— OpenAI 协议没有这个字段。
 * isError 只用于内部逻辑(比如统计失败率 / 触发 retry),对 LLM 透明。
 * 如果工具失败了,我们依赖 output 文本本身让 LLM 知道(工具返回的 output
 * 已经包含了错误描述)。
 */
export function toToolResultMessage(
  toolCallId: string,
  result: ToolResult,
): any {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: result.output,
  }
}

// ─── 组合方法(agent.ts 的主要入口) ──────────────────

/**
 * 一站式处理:find → execute → wrap。
 *
 * Agent 主循环收到 provider 的 `tool_call` 事件时,直接调用这个函数:
 *
 *   const { result, message } = await runToolCall(tools, tc.id, tc.name, tc.argsJson)
 *   messages.push(message)
 *   yield { type: 'tool_result', ... }
 *
 * 找不到工具时也会返回 error ToolResult(LLM 可以看到 "Tool X not found"
 * 自己纠正 —— 比让整个 turn 崩掉好)。
 */
export async function runToolCall(
  tools: Tool[],
  callId: string,
  name: string,
  argsJson: string,
  context?: any,
): Promise<{ result: ToolResult; message: any }> {
  const tool = findTool(tools, name)
  if (!tool) {
    const availableNames = tools.map(t => t.name).join(', ')
    const result: ToolResult = {
      output:
        `Tool "${name}" not found in registry. ` +
        `Available tools: ${availableNames || '(none)'}`,
      isError: true,
    }
    return { result, message: toToolResultMessage(callId, result) }
  }

  const result = await executeTool(tool, argsJson, context)
  return { result, message: toToolResultMessage(callId, result) }
}

// ─── 辅助 ────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '...[truncated]'
}
