#!/usr/bin/env tsx
/**
 * Playtest 脚本 —— 用真实 LLM 跑 10 轮典型玩家输入，收集：
 *   - 每轮 DM 叙事 transcript
 *   - 每轮 session 状态 delta（新增记忆/信任变化/图鉴发现/任务进度）
 *   - 整局诊断（调用 world-activity 分析器）
 *
 * 目的：从"玩家视角"走一遍核心系统，暴露真实 gap。
 * 花费：会用 token（根据 ~/.occ/config.json 的 provider）。
 *
 * 用法：npm run playtest
 */

import { initItemRegistry } from '../src/game-state.js'
import { GameEngine } from '../src/engine.js'
import { GameFactStore } from '../src/game-facts.js'
import { analyze, formatReport } from './world-activity.js'
import type { GameSession } from '../src/types.js'

// ─── 玩家 10 轮脚本（覆盖典型系统）──
const SCENARIO: string[] = [
  '看看四周',
  '走向格雷格，问问他瘟疫的事',
  '尝试说服格雷格多说些矿道的旧事',
  '去公会找艾琳娜接任务',
  '搜索公告板',
  '去草药堂看看叶绿的药水',
  '答应小莉我会帮她找到东西',
  '向南穿过暮色森林',
  '继续深入森林寻找线索',
  '小心翼翼地搜索周围',
]

// ─── 状态快照 ──
interface Snapshot {
  turn: number
  hp: number
  gold: number
  location: string
  timeOfDay: string
  trusts: Record<string, number>
  bestiaryEnc: number
  bestiaryWeak: number
  memoryInteractions: number
  memoryImpressions: number
  activeQuests: number
  flagCount: number
}

function snap(s: GameSession): Snapshot {
  const trusts: Record<string, number> = {}
  for (const n of s.npcs) trusts[n.name] = n.trust
  const bestiaryEntries = Object.values(s.player.bestiary ?? {})
  const mem = Object.values(s.npcMemories ?? {})
  return {
    turn: s.turnCount,
    hp: s.player.hp,
    gold: s.player.gold,
    location: s.worldState.currentLocation,
    timeOfDay: s.worldState.timeOfDay,
    trusts,
    bestiaryEnc: bestiaryEntries.filter((e: any) => e.encountered).length,
    bestiaryWeak: bestiaryEntries.filter((e: any) => e.weaknessKnown).length,
    memoryInteractions: mem.reduce((a: number, m: any) => a + (m.interactions?.length ?? 0), 0),
    memoryImpressions: mem.reduce((a: number, m: any) => a + (m.impressions?.length ?? 0), 0),
    activeQuests: s.quests.filter(q => q.status === 'active').length,
    flagCount: Object.keys(s.worldState.flags).length,
  }
}

function diffSnap(a: Snapshot, b: Snapshot): string {
  const parts: string[] = []
  if (a.hp !== b.hp) parts.push(`HP ${a.hp}→${b.hp}`)
  if (a.gold !== b.gold) parts.push(`金 ${a.gold}→${b.gold}`)
  if (a.location !== b.location) parts.push(`位 ${a.location}→${b.location}`)
  if (a.timeOfDay !== b.timeOfDay) parts.push(`时 ${a.timeOfDay}→${b.timeOfDay}`)
  if (a.memoryInteractions !== b.memoryInteractions)
    parts.push(`记忆+${b.memoryInteractions - a.memoryInteractions}`)
  if (a.memoryImpressions !== b.memoryImpressions)
    parts.push(`印象+${b.memoryImpressions - a.memoryImpressions}`)
  if (a.bestiaryEnc !== b.bestiaryEnc) parts.push(`遭遇+${b.bestiaryEnc - a.bestiaryEnc}`)
  if (a.bestiaryWeak !== b.bestiaryWeak) parts.push(`弱点+${b.bestiaryWeak - a.bestiaryWeak}`)
  if (a.activeQuests !== b.activeQuests) parts.push(`任务${a.activeQuests}→${b.activeQuests}`)
  if (a.flagCount !== b.flagCount) parts.push(`flag+${b.flagCount - a.flagCount}`)
  for (const name of Object.keys(b.trusts)) {
    const oldV = a.trusts[name] ?? 0
    const newV = b.trusts[name]
    if (oldV !== newV) parts.push(`${name}信任${oldV}→${newV}`)
  }
  return parts.length > 0 ? '  Δ ' + parts.join(' | ') : ''
}

// ─── Transcript 收集 ──
interface TurnRecord {
  idx: number
  input: string
  dmText: string
  eventTypes: string[]
  durationMs: number
  before: Snapshot
  after: Snapshot
  errors: string[]
}

async function playOneTurn(
  engine: GameEngine,
  input: string,
  idx: number,
): Promise<TurnRecord> {
  const before = snap(engine.session)
  const start = Date.now()
  let dmText = ''
  const eventTypes: string[] = []
  const errors: string[] = []

  // 如果在战斗中，先把战斗推完（自动防御）再处理本轮 input。
  // playtest 脚本不适合模拟细致战斗决策，默认"防御 + 挺过去"。
  if (engine.session.combat?.active) {
    console.log(`  [combat] 进入战斗状态，自动防御过关`)
    let guard = 0
    while (engine.session.combat?.active && guard < 12) {
      guard++
      try {
        for await (const e of engine.processGridAction({ action: 'grid_defend' })) {
          eventTypes.push('[combat]' + e.type)
        }
      } catch (err) {
        errors.push('combat turn failed: ' + (err as Error).message)
        break
      }
    }
    if (engine.session.combat?.active) {
      errors.push('战斗 12 轮后仍未结束 — 放弃本轮')
      return { idx, input, dmText, eventTypes, durationMs: Date.now() - start, before, after: snap(engine.session), errors }
    }
    console.log(`  [combat] 战斗结束`)
  }

  try {
    for await (const event of engine.processTurn(input)) {
      eventTypes.push(event.type)
      if (event.type === 'text_delta') dmText += (event as any).text ?? ''
      else if (event.type === 'dm_end' && (event as any).text) {
        // dm_end.text 是后端处理过的完整叙事（可能比 streamed 更干净）
        dmText = (event as any).text
      }
    }
  } catch (err) {
    errors.push((err as Error).message)
  }

  return {
    idx,
    input,
    dmText: dmText.slice(0, 600),
    eventTypes,
    durationMs: Date.now() - start,
    before,
    after: snap(engine.session),
    errors,
  }
}

async function main() {
  console.log('═══ Playtest: 10 轮真实 LLM 会话 ═══')
  console.log('模型:', process.env.TRPG_MODEL ?? '(from ~/.occ/config.json)')
  console.log()

  initItemRegistry()
  // 随机名字防止和现有存档冲突
  const name = 'playtest-' + Date.now().toString(36).slice(-5)
  const classId = 'fighter'
  const engine = GameEngine.createGame(name, classId)

  console.log(`▸ 创建角色: ${name} (${classId})`)
  console.log(`▸ 初始 HP: ${engine.session.player.hp}/${engine.session.player.maxHp}  金币: ${engine.session.player.gold}`)
  console.log()

  // 开场叙事（first prompt 不占 SCENARIO 名额）
  try {
    let openingText = ''
    for await (const e of engine.streamOpening()) {
      if (e.type === 'text_delta') openingText += (e as any).text ?? ''
      else if (e.type === 'dm_end' && (e as any).text) openingText = (e as any).text
    }
    console.log(`[开场] ${openingText.slice(0, 300)}`)
    console.log()
  } catch (err) {
    console.warn('[开场失败]', (err as Error).message)
  }

  const transcript: TurnRecord[] = []
  for (let i = 0; i < SCENARIO.length; i++) {
    const input = SCENARIO[i]
    console.log(`─── Turn ${i + 1}/${SCENARIO.length} ────────────────`)
    console.log(`> ${input}`)
    const rec = await playOneTurn(engine, input, i + 1)
    console.log(`[DM] ${rec.dmText.slice(0, 400)}${rec.dmText.length > 400 ? '…' : ''}`)
    const d = diffSnap(rec.before, rec.after)
    if (d) console.log(d)
    const uniqueEvents = [...new Set(rec.eventTypes)].filter(e =>
      !['text_delta', 'sync', 'dm_start', 'dm_end'].includes(e))
    if (uniqueEvents.length > 0) console.log(`  事件: ${uniqueEvents.join(', ')}`)
    if (rec.errors.length > 0) console.log(`  ❌ ${rec.errors.join(' / ')}`)
    console.log(`  耗时: ${(rec.durationMs / 1000).toFixed(1)}s`)
    console.log()
    transcript.push(rec)
  }

  // 存档
  try {
    const facts = new GameFactStore(engine.session)
    const savePath = facts.save('playtest-' + name)
    console.log(`💾 存档: ${savePath}`)
  } catch (err) {
    console.warn('存档失败:', (err as Error).message)
  }

  // 诊断
  console.log()
  console.log('═══ 最终诊断 ═══')
  const report = analyze({ session: engine.session }, 'playtest (in-memory)')
  console.log(formatReport(report))

  // 主观观察
  console.log()
  console.log('═══ 玩家视角速评 ═══')
  const obs: string[] = []
  const finalSnap = transcript[transcript.length - 1].after
  if (finalSnap.memoryInteractions === 0) {
    obs.push('❗ 10 轮过后 NPC 记忆仍为空 — 提取器未运行 / 异步任务未完成 / 对话输入未触发 Talk')
  } else {
    obs.push(`✓ NPC 记忆积累: ${finalSnap.memoryInteractions} 条互动 + ${finalSnap.memoryImpressions} 条印象`)
  }
  if (Object.values(finalSnap.trusts).every(v => v === 0)) {
    obs.push('❗ 所有 NPC 信任度仍为 0 — 对话没有任何情感波动')
  } else {
    const changed = Object.entries(finalSnap.trusts).filter(([, v]) => v !== 0)
    obs.push(`✓ ${changed.length} 个 NPC 信任度发生变化: ${changed.map(([n, v]) => `${n}(${v > 0 ? '+' : ''}${v})`).join(', ')}`)
  }
  if (finalSnap.bestiaryWeak === 0) {
    obs.push('⚠ 未发现任何怪物弱点（玩家未触发 bestiary reveal 路径）')
  }
  const avgDur = transcript.reduce((a, r) => a + r.durationMs, 0) / transcript.length / 1000
  obs.push(`⏱ 平均每轮 ${avgDur.toFixed(1)} 秒`)
  const errors = transcript.filter(r => r.errors.length > 0)
  if (errors.length > 0) {
    obs.push(`❌ ${errors.length} 轮有异常: ${errors.map(e => `#${e.idx}(${e.errors[0]})`).join(', ')}`)
  }
  for (const o of obs) console.log('  ' + o)

  console.log()
  console.log('═══ 完成 ═══')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
