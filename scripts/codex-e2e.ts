/**
 * Codex 真实端到端测试 — 启动一局完整游戏,跑一轮玩家输入,验证 DM 整套流程。
 *
 * 跟 codex-smoke 的区别:
 *   smoke 测的是"自建假工具能不能调通 OAuth + SSE + tool_call"
 *   e2e  测的是"真实 18 个 DM 工具 + system prompt + 章节 + context manager 跑得动"
 *
 * 用法:
 *   TRPG_PROVIDER_TYPE=codex npx tsx scripts/codex-e2e.ts
 *
 * 退出码 0 = 通过(收到至少一条 dm_text 增量 + dm_end + actions),其他 = 失败。
 */

import { GameEngine, type TurnEvent } from '../src/engine.js'
import { initItemRegistry } from '../src/game-state.js'

if (process.env.TRPG_PROVIDER_TYPE !== 'codex') {
  console.error(
    '[e2e] 请设置 TRPG_PROVIDER_TYPE=codex 环境变量后再跑(否则会走默认 provider)',
  )
  process.exit(2)
}

interface Stats {
  textBytes: number
  toolCalls: { name: string; output: string }[]
  events: Record<string, number>
  actionsCount: number | null
  errors: string[]
  combatTriggered: boolean
}

function bump(stats: Stats, type: string) {
  stats.events[type] = (stats.events[type] ?? 0) + 1
}

async function consumeStream(
  label: string,
  stream: AsyncGenerator<TurnEvent>,
  stats: Stats,
) {
  console.log(`\n[e2e] ─── ${label} ───`)
  for await (const ev of stream) {
    bump(stats, ev.type)
    switch (ev.type) {
      case 'dm_text_delta':
        if (typeof (ev as any).text === 'string') {
          process.stdout.write((ev as any).text)
          stats.textBytes += (ev as any).text.length
        }
        break
      case 'dm_end': {
        const a = (ev as any).actions ?? {}
        const sCount = (a.suggestions?.length) ?? 0
        const dCount = (a.details?.length) ?? 0
        console.log(`\n[e2e] dm_end. suggestions=${sCount}, details=${dCount}`)
        stats.actionsCount = sCount + dCount
        break
      }
      case 'tool_result':
        stats.toolCalls.push({
          name: (ev as any).name,
          output: String((ev as any).output ?? '').slice(0, 80),
        })
        break
      case 'safety_block':
        stats.errors.push(`safety_block: ${(ev as any).reason ?? '?'}`)
        break
      case 'death':
        stats.errors.push('death event in opening or first turn')
        break
      case 'combat_start':
      case 'combat_round':
      case 'combat_narrative':
        stats.combatTriggered = true
        break
    }
  }
}

async function main() {
  initItemRegistry()

  const stats: Stats = {
    textBytes: 0,
    toolCalls: [],
    events: {},
    actionsCount: null,
    errors: [],
    combatTriggered: false,
  }

  console.log(`[e2e] model: ${process.env.TRPG_MODEL ?? 'gpt-5.4 (default)'}`)
  console.log(`[e2e] creating game...`)
  const engine = GameEngine.createGame('测试者', 'fighter')
  console.log(`[e2e] game created. player=${engine.session.player.name}, hp=${engine.session.player.hp}`)
  console.log(`[e2e] starting location: ${engine.session.worldState.currentLocation}`)

  // 1. Opening narrative
  await consumeStream('Opening narrative', engine.streamOpening(), stats)

  // 2. 一句平淡的探索性输入 — 不会触发战斗,DM 应该回叙事 + 选项
  await consumeStream(
    'Player turn: "我环顾四周,看看这个地方"',
    engine.processTurn('我环顾四周,看看这个地方'),
    stats,
  )

  // ─── Verdict ─────────────────────────────────
  console.log(`\n\n[e2e] ═══ 结果汇总 ═══`)
  console.log(`[e2e] 事件计数:`, stats.events)
  console.log(`[e2e] 总文本字节: ${stats.textBytes}`)
  console.log(`[e2e] dm_end actions: ${stats.actionsCount}`)
  console.log(`[e2e] 工具调用 (${stats.toolCalls.length}):`)
  for (const tc of stats.toolCalls) {
    console.log(`   - ${tc.name}: ${tc.output.replace(/\s+/g, ' ')}`)
  }
  if (stats.errors.length > 0) {
    console.log(`[e2e] ⚠️  错误:`, stats.errors)
  }

  // ─── 通过条件 ───────────────────────────────
  // 1. 至少有一些 DM 文本(说明流式没断)
  // 2. 至少有一个 dm_end(说明 turn 完整结束)
  // 3. dm_end 带选项(说明 SetActions 被调用,核心 DM 流程通)
  // 4. 没有 safety_block / death / 异常
  const passed =
    stats.textBytes > 50 &&
    (stats.events.dm_end ?? 0) >= 1 &&
    (stats.actionsCount ?? 0) >= 2 &&
    stats.errors.length === 0

  if (passed) {
    console.log(`\n[e2e] ✅ PASS — Codex 订阅在真实 DM 流程下工作正常`)
    process.exit(0)
  } else {
    console.log(`\n[e2e] ❌ FAIL`)
    if (stats.textBytes <= 50) console.log(`   - 文本过少 (${stats.textBytes} bytes)`)
    if ((stats.events.dm_end ?? 0) < 1) console.log(`   - 缺 dm_end 事件`)
    if ((stats.actionsCount ?? 0) < 2) console.log(`   - 选项数不足 (${stats.actionsCount})`)
    if (stats.errors.length > 0) console.log(`   - 有错误:`, stats.errors)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(`\n[e2e] CRASH:`, err)
  process.exit(1)
})
