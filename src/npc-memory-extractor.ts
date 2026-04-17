/**
 * NPC 记忆提取器 — 从对话中提取 NPC 对玩家的记忆
 *
 * 使用和 DM 相同的 LLM provider，轻量 prompt + 低 max_tokens。
 * 在 Talk 后台异步调用，不阻塞玩家下一轮输入。
 *
 * 失败时静默降级（跳过本次记忆提取），不影响游戏流程。
 */

import type { GameSession, NPCInteractionMemory } from './types.js'
import { ensureMemoryStore } from './npc-memory.js'

// ─── Provider 复用 ──────────────────────────────

let _providerConfig: any = null

/** 由 dm-agent.ts 在 initDMAgent 时调用，共享 provider 配置 */
export function setExtractorProvider(config: any): void {
  _providerConfig = config
}

// ─── 提取 prompt ──────────────────────────────

function buildExtractionPrompt(
  npcName: string,
  playerMessage: string,
  narrativeExcerpt: string,
  existingImpressions: string[],
): string {
  const impressionCtx = existingImpressions.length > 0
    ? `当前印象: ${existingImpressions.join(', ')}`
    : '（首次互动，尚无印象）'

  return `你是 NPC 记忆提取器。从对话中提取 ${npcName} 对玩家的记忆。只输出 JSON，不要其他文字。

[玩家说]
${playerMessage}

[DM叙事中${npcName}的部分]
${narrativeExcerpt || '（无具体叙事）'}

[${npcName}的${impressionCtx}]

输出格式（严格 JSON）:
{"summary":"一句话概括本次互动(最多50字)","playerRevealed":["玩家透露的信息"],"npcRevealed":["NPC透露的信息"],"mood":"互动氛围","impressions":["基于全部互动的3个最新印象"]}`
}

// ─── 叙事摘取 ──────────────────────────────

/** 从 DM 全文叙事中提取和指定 NPC 相关的段落 */
function extractNPCNarrative(fullText: string, npcName: string): string {
  if (!fullText) return ''
  const paragraphs = fullText.split(/\n{2,}/)
  const relevant = paragraphs.filter(p => p.includes(npcName))
  if (relevant.length > 0) return relevant.join('\n\n').slice(0, 500)
  // fallback: 如果没找到名字，取全文前 300 字
  return fullText.slice(0, 300)
}

// ─── 主提取函数 ──────────────────────────────

export interface ExtractionResult {
  interaction: NPCInteractionMemory
  impressions: string[]
}

export async function extractMemory(params: {
  npcName: string
  playerMessage: string
  dmNarrative: string
  talkToolOutput: string
  session: GameSession
}): Promise<ExtractionResult | null> {
  if (!_providerConfig) {
    console.warn('[npc-memory] 提取器未初始化(无 provider 配置)')
    return null
  }

  const { npcName, playerMessage, dmNarrative, session } = params
  const store = ensureMemoryStore(session, npcName)
  const narrativeExcerpt = extractNPCNarrative(dmNarrative, npcName)

  const prompt = buildExtractionPrompt(
    npcName,
    playerMessage,
    narrativeExcerpt,
    store.impressions,
  )

  try {
    // 直接调用 LLM provider（不走 agent 循环，无工具）
    const { createProvider } = await import('./agent/provider-factory.js')
    const provider = createProvider(_providerConfig)

    let responseText = ''
    const messages = [
      { role: 'system', content: '只输出 JSON，不要其他文字。' },
      { role: 'user', content: prompt },
    ]
    for await (const chunk of provider.stream(messages, [], { maxTokens: 300, temperature: 0.3 })) {
      if (chunk.type === 'text_delta') {
        responseText += chunk.text ?? ''
      }
    }

    // 解析 JSON（容忍 markdown fences）
    const jsonStr = responseText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()

    const data = JSON.parse(jsonStr)

    const interaction: NPCInteractionMemory = {
      turn: session.turnCount,
      chapter: session.chapter?.currentChapter ?? 'ch1',
      summary: String(data.summary ?? '').slice(0, 60),
      type: 'talk',
      playerRevealed: Array.isArray(data.playerRevealed) ? data.playerRevealed.filter(Boolean) : undefined,
      npcRevealed: Array.isArray(data.npcRevealed) ? data.npcRevealed.filter(Boolean) : undefined,
      mood: data.mood || undefined,
    }

    const impressions = Array.isArray(data.impressions)
      ? data.impressions.filter(Boolean).slice(0, 3)
      : []

    console.log(`[npc-memory] ✓ 提取 ${npcName} 记忆: "${interaction.summary}"`)
    return { interaction, impressions }
  } catch (err) {
    console.warn(`[npc-memory] 提取 ${npcName} 记忆失败:`, (err as Error).message?.slice(0, 80))
    return null
  }
}
