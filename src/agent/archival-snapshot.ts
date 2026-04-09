/**
 * Archival Snapshot — 把 session 的结构化状态序列化成一段文本,
 * 用作上下文压缩时的"归档消息"内容。
 *
 * 设计哲学(来自 Phase 4 的讨论):
 *
 * DM 的"记忆"应该分层:
 *   1. 系统级: 代码/规则/数值(硬规则)
 *   2. 剧本级: 世界观/NPC 设定/分支(静态知识,未来由 lore 工具按需加载)
 *   3. 存档级: 玩家关键决策/事件(动态快照)← 这个文件负责
 *   4. 对话级: 当前这段戏的流畅度(最近 12 turn 完整 messages)
 *
 * 上下文压缩(context-manager)的目的是**流畅性**,不是"完美记忆"。
 * 被压缩的早期对话,丢失的是"具体措辞",不是"剧情进展"——后者通过这个
 * snapshot 从结构化数据里精确提取出来,作为归档消息注入 DM 上下文。
 *
 * 为什么不用 LLM 摘要:
 *   - 零延迟(不阻塞 turn)
 *   - 零失败路径(代码生成,不会崩)
 *   - 100% 准确(从结构化数据直出,没有幻觉)
 *   - 信息密度和信息覆盖率比 300 字的 LLM 摘要更高
 *
 * 输出格式:多行纯文本,作为一条 user message 的 content。
 * 标记前缀 "[系统] ... 归档到存档" 让 DM 一眼识别这是系统反馈而非玩家输入。
 */

import type { GameSession } from '../types.js'
import { getRecentJournal, formatJournalForPrompt, SNAPSHOT_INJECT_COUNT } from '../dm-journal.js'

// ─── 对外主函数 ────────────────────────────────────

export interface SnapshotOptions {
  /** 当前活跃工具名列表。如果包含 lore 类工具(ReadLore/GrepLore),在提示里告诉 DM 可以查询 */
  availableToolNames?: string[]
  /** 保留的最近 turn 数(用于在提示里告诉 DM "最近 N 轮对话已完整保留") */
  keepRecentTurns?: number
}

/**
 * 从 session 生成归档快照文本。
 *
 * 这个函数**只读**,不修改 session。返回一个多行纯文本字符串,
 * context-manager 会把它作为 user message 的 content 插入 messages 数组。
 */
export function buildArchivalSnapshot(
  session: GameSession,
  options: SnapshotOptions = {},
): string {
  const lines: string[] = []

  lines.push('[系统] 早期对话历史已归档到存档。当前剧情状态快照:')
  lines.push('')

  // ── 章节 ──
  const chapterLine = formatChapter(session)
  if (chapterLine) lines.push(chapterLine)

  // ── 位置 ──
  const locationLine = formatLocation(session)
  if (locationLine) lines.push(locationLine)

  // ── 玩家状态(简短,避免和每轮注入的 [游戏状态] 重复) ──
  const playerLine = formatPlayer(session)
  if (playerLine) lines.push(playerLine)

  // ── 活跃任务 ──
  const questLine = formatActiveQuests(session)
  if (questLine) lines.push(questLine)

  // ── 信任度 top N NPC ──
  const trustLine = formatTopTrustedNPCs(session)
  if (trustLine) lines.push(trustLine)

  // ── 最近 NPC 交互 ──
  const recentInteractions = formatRecentInteractions(session)
  if (recentInteractions.length > 0) {
    lines.push('• 最近的 NPC 交互:')
    lines.push(...recentInteractions)
  }

  // ── 已触发的关键事件 flags ──
  const flagsLines = formatImportantFlags(session)
  if (flagsLines.length > 0) {
    lines.push('• 已触发的关键事件:')
    lines.push(...flagsLines)
  }

  // ── 承诺追踪(如果有)──
  const promisesLine = formatTrackedPromises(session)
  if (promisesLine) lines.push(promisesLine)

  // ── 章节 beat 进度 ──
  const beatLine = formatChapterBeats(session)
  if (beatLine) lines.push(beatLine)

  // ── Phase 6: DM 札记 —— 存档级叙事锚点,跨压缩保留 ──
  const journalEntries = getRecentJournal(session, SNAPSHOT_INJECT_COUNT)
  if (journalEntries.length > 0) {
    lines.push('')
    lines.push(formatJournalForPrompt(journalEntries, '• DM 札记(历史叙事锚点)'))
  }

  lines.push('')

  // ── 结尾引导 ──
  const keepN = options.keepRecentTurns ?? 12
  lines.push(`最近 ${keepN} 轮对话已完整保留。请基于当前状态继续推进剧情。`)

  // 动态:有 lore 工具就引导 DM 查询
  const hasLoreTools = (options.availableToolNames ?? []).some(
    name => /^(ReadLore|GrepLore|ListLore|SearchLore)$/i.test(name),
  )
  if (hasLoreTools) {
    lines.push('更多人物/世界观/历史细节可通过 lore 工具(ReadLore/GrepLore)查询。')
  }

  return lines.join('\n')
}

// ═══ 内部格式化辅助函数 ══════════════════════════════

function formatChapter(session: GameSession): string | null {
  const ch = session.chapter
  if (!ch?.currentChapter) return null
  // 章节 ID → 显示名(如果 chapter-manager 有 nameZh 就用,没有就用 id)
  const label = (ch as any).currentChapterName ?? ch.currentChapter
  return `• 章节: ${label}`
}

function formatLocation(session: GameSession): string | null {
  const loc = session.worldState?.currentLocation
  const sub = session.worldState?.currentSubLocation
  if (!loc) return null
  // 位置 id → 中文名(尽量)
  const locName = LOCATION_NAMES[loc] ?? loc
  if (sub) {
    const subName = SUBLOC_NAMES[sub] ?? sub
    return `• 位置: ${locName} · ${subName}`
  }
  return `• 位置: ${locName}`
}

function formatPlayer(session: GameSession): string | null {
  const p = session.player
  if (!p) return null
  const parts: string[] = []
  if (p.name) parts.push(p.name)
  if ((p as any).className) parts.push((p as any).className)
  if (typeof (p as any).level === 'number') parts.push(`Lv${(p as any).level}`)
  if (parts.length === 0) return null
  return `• 玩家: ${parts.join(' · ')}`
}

function formatActiveQuests(session: GameSession): string | null {
  const quests = (session.quests ?? []).filter(q => q.status === 'active')
  if (quests.length === 0) return null
  return `• 活跃任务: ${quests.map(q => q.name).join(', ')}`
}

function formatTopTrustedNPCs(session: GameSession): string | null {
  const npcs = session.npcs ?? []
  // 只看信任度 != 0 的(0 = 未交互/中立,没有信息价值)
  const sorted = npcs
    .filter(n => typeof n.trust === 'number' && n.trust !== 0)
    .sort((a, b) => Math.abs(b.trust) - Math.abs(a.trust))
    .slice(0, 5)
  if (sorted.length === 0) return null
  const parts = sorted.map(n => {
    const sign = n.trust > 0 ? '+' : ''
    return `${n.name}(${sign}${n.trust})`
  })
  return `• 关键 NPC 关系: ${parts.join(', ')}`
}

function formatRecentInteractions(session: GameSession): string[] {
  // 从所有 NPC 的 interactionLog 里找最近的几条,按 turn 数排序
  type LogEntry = { log: string; turn: number }
  const entries: LogEntry[] = []

  for (const npc of session.npcs ?? []) {
    if (!npc.interactionLog?.length) continue
    // interactionLog 的格式是 "第N轮:玩家对X说Y" (见 talk.ts)
    for (const log of npc.interactionLog) {
      const m = log.match(/^第(\d+)轮/)
      const turn = m ? parseInt(m[1], 10) : 0
      entries.push({ log, turn })
    }
  }

  // 按 turn 倒序,取最近 5 条
  entries.sort((a, b) => b.turn - a.turn)
  return entries.slice(0, 5).map(e => `  - ${e.log}`)
}

function formatImportantFlags(session: GameSession): string[] {
  const flags = session.worldState?.flags ?? {}
  const important: string[] = []

  for (const [key, value] of Object.entries(flags)) {
    // 过滤"重要"的 flag:发现类、暴力警报、关键事件、pending_encounter 等
    if (
      key.startsWith('discovered_') ||
      key.startsWith('violence_') ||
      key.startsWith('pending_') ||
      key.startsWith('poi_') ||
      key.includes('key') ||
      key.includes('unlock')
    ) {
      // value 如果是 bool/string,显示 key;如果是复杂 JSON,只显示 key 以免太长
      if (typeof value === 'boolean' && value) {
        important.push(`  - ${key}`)
      } else if (typeof value === 'string' && value.length < 40) {
        important.push(`  - ${key}: ${value}`)
      } else {
        important.push(`  - ${key}`)
      }
    }
    if (important.length >= 5) break
  }

  return important
}

function formatTrackedPromises(session: GameSession): string | null {
  const promises: Array<{ npc: string; text: string }> = []
  for (const npc of session.npcs ?? []) {
    for (const p of npc.trackedPromises ?? []) {
      if (!p.fulfilled) {
        promises.push({ npc: npc.name, text: p.text })
        if (promises.length >= 3) break
      }
    }
    if (promises.length >= 3) break
  }
  if (promises.length === 0) return null
  return `• 未兑现承诺: ${promises.map(p => `${p.npc}("${truncate(p.text, 20)}")`).join(', ')}`
}

function formatChapterBeats(session: GameSession): string | null {
  const ch: any = session.chapter
  if (!ch) return null
  const completed: string[] = ch.completedBeats ?? []
  if (completed.length === 0) return null
  // 只显示最近完成的 3 个
  const recent = completed.slice(-3)
  return `• 最近完成的章节节点: ${recent.join(' → ')}`
}

// ─── 常量:位置名映射(不依赖 maps.ts 以避免循环引用) ────

const LOCATION_NAMES: Record<string, string> = {
  'dawnbreak-town': '破晓镇',
  'twilight-woods': '暮色森林',
  'greyspine-mines': '灰脊矿道',
  'shatterstone-wastes': '碎石荒原',
}

const SUBLOC_NAMES: Record<string, string> = {
  'tavern': '碎盾亭酒馆',
  'town-square': '镇广场',
  'blacksmith': '铁砧铺',
  'herbalist': '草药堂',
  'adventurers-guild': '冒险者公会',
  'town-gate': '镇门',
  'forest-entrance': '森林入口',
  'old-lumber-camp': '旧伐木场',
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
