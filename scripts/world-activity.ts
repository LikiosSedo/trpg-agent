#!/usr/bin/env tsx
/**
 * 世界活跃度诊断 —— 统计一份存档里各"世界呼吸"系统的实际数据密度。
 *
 * 用途：
 *   - 快速判断玩家这一局游戏过程中，系统真实在产出多少"代入感信号"
 *   - 发现某个系统虽然实现了但没被触发（数据稀薄）
 *   - 对比不同局的活跃度，指导内容扩展方向
 *
 * 用法：
 *   npm run world-activity                         # 默认扫 saves/
 *   npx tsx scripts/world-activity.ts [file.json]  # 指定存档
 *   npx tsx scripts/world-activity.ts --json       # 机器可读 JSON
 */

import fs from 'node:fs'
import path from 'node:path'

// ─── 类型（从 session 结构抽必要部分，保持对运行时的零依赖）──
interface SaveData {
  session?: SessionShape
  // 老版本可能直接是 session
  [k: string]: any
}
interface SessionShape {
  turnCount?: number
  chapter?: { currentChapter?: string }
  worldState?: {
    currentLocation?: string
    timeOfDay?: string
    flags?: Record<string, any>
  }
  player?: {
    name?: string
    level?: number
    hp?: number
    maxHp?: number
    gold?: number
    clues?: string[]
    bestiary?: Record<string, {
      encountered?: boolean
      weaknessKnown?: boolean
      resistanceKnown?: boolean
      immunityKnown?: boolean
      notes?: string[]
    }>
  }
  npcs?: Array<{
    name: string
    trust?: number
    interactionLog?: string[]
    playerPromises?: string[]
    trackedPromises?: Array<{ content: string; fulfilled?: boolean }>
    permanentGrudge?: boolean
  }>
  npcMemories?: Record<string, {
    impressions?: string[]
    interactions?: Array<{ turn: number; type?: string; summary?: string }>
    unfulfilledPromises?: string[]
  }>
  quests?: Array<{ status: 'active' | 'completed' | 'failed'; objectivesCompleted?: boolean[] }>
  dmJournal?: Array<{ turn: number; note: string }>
}

interface ActivityReport {
  saveFile: string
  turn: number
  chapter?: string
  location?: string
  player: { name?: string; level?: number; hp?: number; maxHp?: number; gold?: number }
  npc: {
    total: number
    withInteractionLog: number
    interactionLogTotalEntries: number
    trustDistribution: { hostile: number; curt: number; neutral: number; friendly: number; close: number }
    permanentGrudges: number
  }
  memory: {
    npcsWithMemory: number
    totalInteractions: number
    totalImpressions: number
    totalUnfulfilledPromises: number
    byType: Record<string, number>
  }
  bestiary: {
    encountered: number
    weaknessKnown: number
    resistanceKnown: number
    immunityKnown: number
    notesTotal: number
  }
  idleEvents: {
    triggered: number      // 从 flags 里 idle_event_* 计数
    uniqueNpcs: number
  }
  quests: { active: number; completed: number; failed: number; objectivesCompleted: number }
  journal: { entries: number; recentTurn?: number }
  trackedPromises: { total: number; fulfilled: number; pending: number }
  clues: number
  flags: number
  // 衍生指标
  insights: string[]
}

// ─── 分析主函数 ──
function analyze(data: SaveData, saveFile: string): ActivityReport {
  const s: SessionShape = data.session ?? data
  const npcs = s.npcs ?? []
  // 区分 undefined（老存档，字段不存在）vs {}（引擎已初始化但无产出）
  const hasMemoryField = s.npcMemories !== undefined
  const hasBestiaryField = s.player?.bestiary !== undefined
  const memories = s.npcMemories ?? {}
  const bestiary = s.player?.bestiary ?? {}
  const flags = s.worldState?.flags ?? {}
  const quests = s.quests ?? []
  const journal = s.dmJournal ?? []

  // Trust 分布 —— 对齐 CLAUDE.md 信任梯度语义
  const trustDist = { hostile: 0, curt: 0, neutral: 0, friendly: 0, close: 0 }
  for (const n of npcs) {
    const t = n.trust ?? 0
    if (t <= -4) trustDist.hostile++
    else if (t <= -1) trustDist.curt++
    else if (t <= 2) trustDist.neutral++
    else if (t <= 5) trustDist.friendly++
    else trustDist.close++
  }

  const permanentGrudges = npcs.filter(n => n.permanentGrudge).length
  const withLog = npcs.filter(n => (n.interactionLog ?? []).length > 0)
  const logTotal = npcs.reduce((a, n) => a + (n.interactionLog?.length ?? 0), 0)

  // Memory
  const memoryValues = Object.values(memories)
  const totalInteractions = memoryValues.reduce((a, m) => a + (m.interactions?.length ?? 0), 0)
  const totalImpressions = memoryValues.reduce((a, m) => a + (m.impressions?.length ?? 0), 0)
  const totalPromises = memoryValues.reduce((a, m) => a + (m.unfulfilledPromises?.length ?? 0), 0)

  const byType: Record<string, number> = {}
  for (const m of memoryValues) {
    for (const i of (m.interactions ?? [])) {
      const t = i.type ?? 'talk'
      byType[t] = (byType[t] ?? 0) + 1
    }
  }

  // Bestiary
  const bestiaryEntries = Object.values(bestiary)
  const bEnc = bestiaryEntries.filter(e => e.encountered).length
  const bWeak = bestiaryEntries.filter(e => e.weaknessKnown).length
  const bRes = bestiaryEntries.filter(e => e.resistanceKnown).length
  const bImm = bestiaryEntries.filter(e => e.immunityKnown).length
  const bNotes = bestiaryEntries.reduce((a, e) => a + (e.notes?.length ?? 0), 0)

  // Idle events：从 flags 里 idle_event_* 时间戳统计
  const idleKeys = Object.keys(flags).filter(k => k.startsWith('idle_event_'))
  const idleTriggered = idleKeys.reduce((a, k) => a + (typeof flags[k] === 'number' ? 1 : 0), 0)

  // TrackedPromises
  let tpTotal = 0, tpFul = 0
  for (const n of npcs) {
    for (const p of (n.trackedPromises ?? [])) {
      tpTotal++
      if (p.fulfilled) tpFul++
    }
  }

  // Quests
  let qAct = 0, qComp = 0, qFail = 0, qObjDone = 0
  for (const q of quests) {
    if (q.status === 'active') qAct++
    else if (q.status === 'completed') qComp++
    else qFail++
    qObjDone += (q.objectivesCompleted ?? []).filter(Boolean).length
  }

  // 衍生洞察（启发式）
  const insights: string[] = []
  const turn = s.turnCount ?? 0
  if (turn === 0) {
    insights.push('⚠ turn=0：疑似初始/未开玩存档，下述数据仅反映初始状态')
  }
  if (turn >= 10 && totalInteractions === 0) {
    if (!hasMemoryField) {
      insights.push('🟡 存档无 npcMemories 字段 — 记忆系统 feature 引入前的老存档（不是 bug）')
    } else {
      insights.push('🔴 玩了 ≥10 轮但 npcMemories.interactions=0 — 提取器可能失败（检查 DM provider 初始化）')
    }
  }
  if (turn >= 10 && idleTriggered === 0 && hasMemoryField) {
    // 新存档才报；老存档（feature 引入前）不会有 idle event 触发记录
    insights.push('🟡 玩了 ≥10 轮无 idle event 触发 — 6% 概率偏低或 NPC 不在场')
  }
  if (bEnc > 0 && bWeak === 0) {
    insights.push('🟡 遭遇了怪物但一个弱点都没发现 — 玩家未对话 NPC 获取情报，或数据门控过严')
  }
  if (!hasBestiaryField && turn >= 3) {
    insights.push('🟡 存档无 player.bestiary 字段 — 图鉴系统 feature 引入前的老存档')
  }
  if (bWeak > 0) {
    insights.push(`✓ 已发现 ${bWeak} 个怪物弱点 — 战斗叙事 callback 生效`)
  }
  if (totalImpressions > 0) {
    insights.push(`✓ 已积累 ${totalImpressions} 条 NPC 印象 — 世界记忆在演化`)
  }
  if (qAct > 0 && qObjDone === 0 && turn >= 5) {
    insights.push('🟡 有活跃任务但 0 个 objective 完成（玩了 ≥5 轮）— 任务进度可能卡住')
  }
  if (permanentGrudges > 0) {
    insights.push(`🔴 有 ${permanentGrudges} 个 NPC 永久仇恨玩家（不可恢复）`)
  }

  return {
    saveFile,
    turn,
    chapter: s.chapter?.currentChapter,
    location: s.worldState?.currentLocation,
    player: {
      name: s.player?.name,
      level: s.player?.level,
      hp: s.player?.hp,
      maxHp: s.player?.maxHp,
      gold: s.player?.gold,
    },
    npc: {
      total: npcs.length,
      withInteractionLog: withLog.length,
      interactionLogTotalEntries: logTotal,
      trustDistribution: trustDist,
      permanentGrudges,
    },
    memory: {
      npcsWithMemory: memoryValues.filter(m => (m.interactions?.length ?? 0) > 0 || (m.impressions?.length ?? 0) > 0).length,
      totalInteractions,
      totalImpressions,
      totalUnfulfilledPromises: totalPromises,
      byType,
    },
    bestiary: {
      encountered: bEnc,
      weaknessKnown: bWeak,
      resistanceKnown: bRes,
      immunityKnown: bImm,
      notesTotal: bNotes,
    },
    idleEvents: {
      triggered: idleTriggered,
      uniqueNpcs: idleKeys.length,
    },
    quests: { active: qAct, completed: qComp, failed: qFail, objectivesCompleted: qObjDone },
    journal: { entries: journal.length, recentTurn: journal[journal.length - 1]?.turn },
    trackedPromises: { total: tpTotal, fulfilled: tpFul, pending: tpTotal - tpFul },
    clues: s.player?.clues?.length ?? 0,
    flags: Object.keys(flags).length,
    insights,
  }
}

// ─── 文本渲染 ──
function formatReport(r: ActivityReport): string {
  const lines: string[] = []
  const sep = '─'.repeat(60)
  lines.push(sep)
  lines.push(`📊 世界活跃度诊断  ${r.saveFile}`)
  lines.push(sep)
  lines.push(`Turn ${r.turn} · 章节 ${r.chapter ?? '未设'} · 位置 ${r.location ?? '未知'}`)
  lines.push(`玩家: ${r.player.name ?? '—'} Lv${r.player.level ?? '—'} | HP ${r.player.hp ?? 0}/${r.player.maxHp ?? 0} | 💰${r.player.gold ?? 0}`)
  lines.push('')

  lines.push(`【NPC】总${r.npc.total} · 有交互日志${r.npc.withInteractionLog} · 日志总条${r.npc.interactionLogTotalEntries}`)
  const d = r.npc.trustDistribution
  lines.push(`  信任分布：敌对${d.hostile} / 冷淡${d.curt} / 中立${d.neutral} / 友好${d.friendly} / 挚友${d.close}` + (r.npc.permanentGrudges > 0 ? ` | 永久仇恨${r.npc.permanentGrudges}` : ''))
  lines.push('')

  lines.push(`【NPC 记忆】有记忆${r.memory.npcsWithMemory} / ${r.npc.total} · 互动条${r.memory.totalInteractions} · 印象${r.memory.totalImpressions} · 未兑现承诺${r.memory.totalUnfulfilledPromises}`)
  if (Object.keys(r.memory.byType).length > 0) {
    lines.push(`  类型分布：${Object.entries(r.memory.byType).map(([t, c]) => `${t}:${c}`).join(' / ')}`)
  }
  lines.push('')

  lines.push(`【怪物图鉴】遭遇${r.bestiary.encountered} · 弱点${r.bestiary.weaknessKnown} · 抗性${r.bestiary.resistanceKnown} · 免疫${r.bestiary.immunityKnown} · 备注${r.bestiary.notesTotal}`)
  lines.push('')

  lines.push(`【Idle 微事件】触发${r.idleEvents.triggered} 次 · 涉及${r.idleEvents.uniqueNpcs} 个 NPC`)
  lines.push('')

  lines.push(`【任务】活跃${r.quests.active} · 完成${r.quests.completed} · 失败${r.quests.failed} · 目标完成${r.quests.objectivesCompleted}`)
  lines.push(`【承诺追踪】${r.trackedPromises.fulfilled}/${r.trackedPromises.total} (待兑现 ${r.trackedPromises.pending})`)
  lines.push(`【DM 札记】${r.journal.entries} 条${r.journal.recentTurn ? ` (最新: Turn ${r.journal.recentTurn})` : ''}`)
  lines.push(`【线索/Flags】线索 ${r.clues} · Flag ${r.flags}`)
  lines.push('')

  if (r.insights.length > 0) {
    lines.push('🔍 洞察:')
    for (const i of r.insights) lines.push(`  ${i}`)
  }
  lines.push(sep)
  return lines.join('\n')
}

// ─── 入口 ──
function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const files = args.filter(a => !a.startsWith('--'))
  const targets: string[] = []

  if (files.length > 0) {
    for (const f of files) {
      if (!fs.existsSync(f)) {
        console.error(`文件不存在: ${f}`)
        process.exit(1)
      }
      targets.push(f)
    }
  } else {
    // 默认扫 saves/
    const dir = 'saves'
    if (!fs.existsSync(dir)) {
      console.error('找不到 saves/ 目录。')
      process.exit(1)
    }
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    if (all.length === 0) {
      console.error('saves/ 目录没有任何 .json 存档。')
      process.exit(1)
    }
    for (const f of all) targets.push(path.join(dir, f))
  }

  const reports = targets.map(f => {
    try {
      const raw = fs.readFileSync(f, 'utf-8')
      return analyze(JSON.parse(raw), f)
    } catch (err) {
      console.error(`解析 ${f} 失败:`, (err as Error).message)
      return null
    }
  }).filter((r): r is ActivityReport => r !== null)

  if (jsonMode) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2))
  } else {
    for (const r of reports) console.log(formatReport(r))
    if (reports.length > 1) {
      console.log('')
      console.log(`扫描了 ${reports.length} 份存档。`)
    }
  }
}

// 允许作为 module 导入（测试用）
export { analyze, formatReport }
export type { ActivityReport, SaveData }

// 直接运行时执行 main
// import.meta.url 判断：tsx 下 file:// 前缀
const isMain = import.meta.url.includes(path.basename(process.argv[1] ?? ''))
if (isMain) main()
