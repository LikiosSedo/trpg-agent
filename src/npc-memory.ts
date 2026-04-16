/**
 * NPC 记忆系统 — 让每个 NPC 拥有"灵魂"
 *
 * 存储 NPC 对玩家的互动记忆：对话要点、印象、未兑现承诺。
 * 数据持久化在 session.npcMemories，随存档保存/加载。
 *
 * 设计原则：
 *   - npcMemories 是 session 级数据，不在 dmMessages 里，压缩不会丢失
 *   - 印象（impressions）每次提取整体替换（演化而非堆积）
 *   - 互动（interactions）FIFO + 首条保留（第一印象不丢）
 *   - 承诺从 trust-system 同步（单一数据源）
 */

import type { GameSession, NPCInteractionMemory, NPCMemoryStore } from './types.js'

// ─── 常量 ──────────────────────────────────────

/** 每个 NPC 最多保留的互动记忆条数 */
export const MAX_INTERACTIONS_PER_NPC = 15
/** 最多保留的印象条数 */
export const MAX_IMPRESSIONS = 3
/** 互动摘要最大字符数 */
export const SUMMARY_MAX_LENGTH = 60
/** prompt 注入时取最近 N 条互动 */
const CONTEXT_INJECT_RECENT = 5
/** 归档快照取最近 N 条互动 */
const SNAPSHOT_INJECT_RECENT = 8

// ─── 数据操作 ──────────────────────────────────

/** 懒初始化 NPC 记忆库 */
export function ensureMemoryStore(session: GameSession, npcName: string): NPCMemoryStore {
  if (!session.npcMemories) session.npcMemories = {}
  if (!session.npcMemories[npcName]) {
    session.npcMemories[npcName] = {
      impressions: [],
      interactions: [],
      unfulfilledPromises: [],
    }
  }
  return session.npcMemories[npcName]
}

/** 追加一条互动记忆，FIFO 淘汰（保留首条） */
export function appendInteraction(
  session: GameSession,
  npcName: string,
  memory: NPCInteractionMemory,
): void {
  const store = ensureMemoryStore(session, npcName)
  // 截断摘要
  if (memory.summary.length > SUMMARY_MAX_LENGTH) {
    memory.summary = memory.summary.slice(0, SUMMARY_MAX_LENGTH - 1) + '…'
  }
  store.interactions.push(memory)
  // 淘汰：保留首条(第一印象) + 最近 N-1 条
  while (store.interactions.length > MAX_INTERACTIONS_PER_NPC) {
    store.interactions.splice(1, 1) // 删除索引1（第二旧的），保留索引0（最初的）
  }
}

/** 整体替换印象（演化而非堆积） */
export function updateImpressions(
  session: GameSession,
  npcName: string,
  newImpressions: string[],
): void {
  const store = ensureMemoryStore(session, npcName)
  store.impressions = newImpressions.slice(0, MAX_IMPRESSIONS)
}

/** 从 NPC 数据同步未兑现承诺 */
export function syncPromises(session: GameSession, npcName: string): void {
  const store = ensureMemoryStore(session, npcName)
  const npc = session.npcs.find(n => n.name === npcName)
  if (!npc) return
  const tracked = (npc as any).trackedPromises as Array<{ content: string; fulfilled: boolean }> | undefined
  if (tracked) {
    store.unfulfilledPromises = tracked
      .filter(p => !p.fulfilled)
      .map(p => p.content)
  }
}

// ─── Prompt 注入 ──────────────────────────────

/** 生成用于 DM prompt 注入的 NPC 记忆文本（Talk 时使用） */
export function getMemoryForPrompt(session: GameSession, npcName: string): string {
  if (!session.npcMemories?.[npcName]) return ''
  const store = session.npcMemories[npcName]
  const parts: string[] = []

  if (store.impressions.length > 0) {
    parts.push(`印象=[${store.impressions.join(', ')}]`)
  }

  const recent = store.interactions.slice(-CONTEXT_INJECT_RECENT)
  if (recent.length > 0) {
    const lines = recent.map(m => {
      const mood = m.mood ? `(${m.mood})` : ''
      return `第${m.turn}轮-${m.summary}${mood}`
    })
    parts.push(`最近互动: ${lines.join('; ')}`)
  }

  if (store.unfulfilledPromises.length > 0) {
    parts.push(`玩家未兑现的承诺: ${store.unfulfilledPromises.join('; ')}`)
  }

  if (parts.length === 0) return ''
  return `[${npcName}对你的记忆] ${parts.join('。')}`
}

/** 生成用于归档快照的 NPC 记忆摘要 */
export function formatMemoriesForSnapshot(session: GameSession): string {
  if (!session.npcMemories) return ''
  const entries: string[] = []
  for (const [name, store] of Object.entries(session.npcMemories)) {
    if (store.interactions.length === 0 && store.impressions.length === 0) continue
    const parts: string[] = []
    if (store.impressions.length > 0) {
      parts.push(`印象: ${store.impressions.join(', ')}`)
    }
    const recent = store.interactions.slice(-SNAPSHOT_INJECT_RECENT)
    if (recent.length > 0) {
      parts.push(`互动(${recent.length}条): ${recent.map(m => m.summary).join('; ')}`)
    }
    if (store.unfulfilledPromises.length > 0) {
      parts.push(`承诺: ${store.unfulfilledPromises.join('; ')}`)
    }
    entries.push(`${name}: ${parts.join('。')}`)
  }
  if (entries.length === 0) return ''
  return `NPC记忆:\n${entries.join('\n')}`
}
