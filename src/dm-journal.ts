/**
 * DM Journal — 存档级叙事札记(Phase 6)
 *
 * 一个追加型数组,DM 通过 RecordJournal 工具写入,系统自动注入到
 * [游戏状态] 上下文 + 归档快照,让 DM 跨 turn、跨压缩、跨 session
 * 保持对"本次冒险独有的叙事锚点"的记忆。
 *
 * 设计原则:
 *
 *   1. **和 events 不同** —— events 是机械状态变化(自动触发),
 *      journal 是 DM 主动的叙事决定。两者并存,用途不同。
 *
 *   2. **追加不改** —— 没有 edit/delete API。如果 DM 写错了,后续
 *      可以再写一条 note 纠正(就像人记日记一样)。
 *
 *   3. **限流** —— 每 turn 最多写 2 条,防止 DM 把它当 tool-spam 的出口。
 *      单条 300 字符,强制截断。
 *
 *   4. **存储无上限,注入有上限** —— 存档里可以无限长(磁盘便宜),但
 *      注入 prompt 时只取最近 N 条(10~20),防止上下文膨胀。
 */

import type { GameSession, DMJournalEntry } from './types.js'

// ─── 配置 ────────────────────────────────────

/** 每 turn 最多写入次数 */
export const MAX_WRITES_PER_TURN = 2

/** 单条内容最大字符数,超出截断 */
export const MAX_CONTENT_LENGTH = 300

/** 注入 [游戏状态] prompt 时的最近条数 */
export const CONTEXT_INJECT_COUNT = 10

/** 注入归档快照时的最近条数(比 prompt 更多,因为快照更"永久") */
export const SNAPSHOT_INJECT_COUNT = 20

// ─── 限流状态(module-local) ─────────────────

let writesThisTurn = 0

/**
 * engine 在 processTurn 入口调用,重置 per-turn 写入计数器。
 * 也会在 game-state.setSession 时被外部显式调用一次,清干净旧存档 load 时的残余。
 */
export function resetJournalTurnCounter(): void {
  writesThisTurn = 0
}

// ─── 写入 API ────────────────────────────────

export interface AppendResult {
  ok: boolean
  /** 失败原因(如果有) */
  reason?: 'rate_limit' | 'empty_content'
  /** 实际写入的条目(成功时) */
  entry?: DMJournalEntry
  /** 本 turn 剩余可写次数 */
  remaining: number
}

/**
 * 追加一条 journal。
 *
 * 限流:每 turn 最多 MAX_WRITES_PER_TURN 次,超出静默拒绝并返回 {ok: false}。
 * 截断:content 超过 MAX_CONTENT_LENGTH 会被截断并加 "…" 后缀。
 * 原地修改 session.dmJournal(首次访问时懒初始化为空数组)。
 */
export function appendJournal(
  session: GameSession,
  input: {
    type: DMJournalEntry['type']
    content: string
    tags?: string[]
  },
): AppendResult {
  if (writesThisTurn >= MAX_WRITES_PER_TURN) {
    return {
      ok: false,
      reason: 'rate_limit',
      remaining: 0,
    }
  }

  const trimmed = (input.content ?? '').trim()
  if (!trimmed) {
    return {
      ok: false,
      reason: 'empty_content',
      remaining: MAX_WRITES_PER_TURN - writesThisTurn,
    }
  }

  let content = trimmed
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH - 1) + '…'
  }

  const entry: DMJournalEntry = {
    turn: session.turnCount,
    chapter: session.chapter?.currentChapter ?? 'ch1',
    type: input.type,
    content,
    tags: input.tags?.length ? input.tags : undefined,
  }

  if (!session.dmJournal) session.dmJournal = []
  session.dmJournal.push(entry)

  writesThisTurn += 1

  return {
    ok: true,
    entry,
    remaining: MAX_WRITES_PER_TURN - writesThisTurn,
  }
}

// ─── 读取 API ────────────────────────────────

/** 返回最近 N 条 journal(按时间顺序,最旧在前,最新在后) */
export function getRecentJournal(
  session: GameSession,
  count: number,
): DMJournalEntry[] {
  const all = session.dmJournal ?? []
  if (count >= all.length) return [...all]
  return all.slice(-count)
}

/**
 * 把 journal 条目格式化为多行字符串,用于注入 prompt 或 snapshot。
 * 空数组时返回空字符串(调用方用 filter(Boolean) 处理)。
 */
export function formatJournalForPrompt(
  entries: DMJournalEntry[],
  title = 'DM 札记',
): string {
  if (entries.length === 0) return ''
  const lines = entries.map(e => {
    const tags = e.tags?.length ? ` #${e.tags.join(' #')}` : ''
    return `- [Turn ${e.turn} · ${e.chapter} · ${e.type}] ${e.content}${tags}`
  })
  return `${title}:\n${lines.join('\n')}`
}

// ─── 测试用 ──────────────────────────────────

/** 测试用:返回当前 turn 已写入的次数 */
export function _getWritesThisTurn(): number {
  return writesThisTurn
}
