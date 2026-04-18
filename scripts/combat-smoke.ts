#!/usr/bin/env tsx
/**
 * 战斗系统 smoke test —— 跳过 LLM 直接验证关键事件流:
 *
 *   1. Bug #1: 战斗胜利后 session.combat 被 endCombat 清理
 *   2. Bug #1: 胜利事件序列含 combat_grid_end + sync
 *   3. Bug #4: 怪物回合有 combat_narrative (每次命中一段)
 *   4. 后端 grid_spell / grid_item action handler 不崩
 *
 * 用法: npx tsx scripts/combat-smoke.ts
 * 花费: 0 token (纯代码层)
 */

import { initItemRegistry } from '../src/game-state.js'
import { GameEngine } from '../src/engine.js'
import { startCombat } from '../src/combat-manager.js'
import type { TurnEvent } from '../src/engine.js'

async function main() {
  await initItemRegistry()
  const engine = GameEngine.createGame('烟测', 'fighter')
  const session = engine.session

  // 强制开一场战斗: 2 个 Goblin(HP 15 各),保证多回合 + 多怪物触发 perMonster 逐切片
  const monstersDb = (await import('../data/monsters.json', { with: { type: 'json' } })).default
  const npcDb = (await import('../data/npc-combatants.json', { with: { type: 'json' } })).default
  const allDb = [...monstersDb, ...npcDb]
  startCombat(session, ['Goblin', 'Goblin'], allDb as any)
  console.log(`[smoke] 战斗开始 | 玩家 HP ${session.player.hp}/${session.player.maxHp} | 敌人数=${session.combat?.monsters.length}`)
  // Debug: 单位分布
  const grid = session.combat?.grid
  if (grid) {
    console.log(`[smoke] 单位分布:`)
    for (const [, u] of (grid as any).units as Map<string, any>) {
      console.log(`  ${u.side} ${u.id} @(${u.pos.x},${u.pos.y}) speed=${u.moveSpeed} range=${u.attackRange}`)
    }
    const attackable = grid.getAttackableTargets('player')
    console.log(`[smoke] attackable for player: ${JSON.stringify(attackable)}`)
  }

  // 驱动玩家回合 → 系统自动推进怪物回合,直到胜利/失败
  const eventCounts: Record<string, number> = {}
  const narrativeSnippets: string[] = []
  const turnSequence: string[] = []  // 记录 actor_turn_start/end 的顺序,验证逐角色结算
  let victorySeen = false
  let gridEndSeen = false
  let syncAfterVictory = false

  for (let round = 0; round < 15 && session.combat?.active; round++) {
    // 从 attackable 拿能打的目标(避开"目标不在攻击范围"错,先走一步就好)
    const gridRef = session.combat?.grid
    if (!gridRef) break
    const attackable = gridRef.getAttackableTargets('player')
    if (attackable.length === 0) {
      // 没目标可打 → 移动到最近敌人方向,下回合再打
      const enemies = session.combat!.monsters.filter(m => m.hp > 0)
      if (enemies.length === 0) break
      const enemyPos = gridRef.getUnit(enemies[0].id)?.pos
      if (!enemyPos) break
      const reachable = gridRef.getReachable('player')
      let best: { x: number; y: number } | null = null
      let bestDist = Infinity
      for (const [k] of reachable) {
        const [x, y] = k.split(',').map(Number)
        const d = Math.abs(x - enemyPos.x) + Math.abs(y - enemyPos.y)
        if (d < bestDist) { bestDist = d; best = { x, y } }
      }
      if (best) {
        for await (const _ev of engine.processGridAction({ action: 'grid_move', target: best })) {}
      }
      continue
    }
    const target = attackable[0]
    const monsterBefore = session.combat!.monsters.find(m => m.id === target.targetId)!

    console.log(`\n[smoke] R${round + 1} 玩家攻击 → ${monsterBefore.name} (HP ${monsterBefore.hp})`)
    for await (const ev of engine.processGridAction({ action: 'grid_attack', targetId: target.targetId })) {
      eventCounts[ev.type] = (eventCounts[ev.type] ?? 0) + 1
      if (ev.type === 'dm_error') console.log(`  [dm_error] ${(ev as any).message}`)
      if (ev.type === 'combat_narrative') narrativeSnippets.push((ev as any).text)
      if (ev.type === 'actor_turn_start') turnSequence.push(`+${(ev as any).actorName}(${(ev as any).intent ?? '?'})`)
      if (ev.type === 'actor_turn_end') turnSequence.push(`-${(ev as any).actorId}`)
      // 胜利判定:combat_grid_end 带 victory 结果(grid 路径的唯一胜利信号)
      if (ev.type === 'combat_grid_end' && (ev as any).result === 'victory') {
        victorySeen = true
        gridEndSeen = true
      }
      if (ev.type === 'combat_grid_end') gridEndSeen = true
      if (ev.type === 'sync' && gridEndSeen) syncAfterVictory = true
    }
  }

  console.log('\n=== 事件汇总 ===')
  for (const [t, n] of Object.entries(eventCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)} × ${t}`)
  }

  console.log('\n=== 验证 Bug 修复 ===')
  // Bug #1
  const combatCleared = session.combat === null || !session.combat?.active
  console.log(`  [Bug #1] 战斗结束后 session.combat 清理: ${combatCleared ? '✅' : '❌'}`)
  console.log(`  [Bug #1] 收到 combat_grid_end 事件:     ${gridEndSeen ? '✅' : '❌'}`)
  console.log(`  [Bug #1] 胜利后收到 sync 事件:           ${syncAfterVictory ? '✅' : '❌'}`)
  console.log(`  [Bug #1] 收到 victory 状态:              ${victorySeen ? '✅' : '❌'}`)

  // Bug #4
  const hasMonsterNarratives = narrativeSnippets.length > 0
  console.log(`  [Bug #4] combat_narrative 事件数:        ${narrativeSnippets.length} ${hasMonsterNarratives ? '✅' : '❌'}`)
  if (narrativeSnippets.length > 0) {
    console.log(`           样例: "${narrativeSnippets[0]?.slice(0, 60)}..."`)
  }

  // Wave1 actor_turn 验证
  console.log('\n=== Wave1 演出框架 ===')
  const hasActorTurns = turnSequence.length > 0
  console.log(`  [Wave1] actor_turn 事件序列 (${turnSequence.length} 条):`)
  // 预期:每回合 +player(attack) -player +Orc Warrior(attack) -orc-id
  //       胜利时可能没 Orc 回合(被秒杀)
  const preview = turnSequence.slice(0, 12).join(' → ')
  console.log(`    ${preview}${turnSequence.length > 12 ? ' ...' : ''}`)
  // 关键:每个 start 都有配对的 end
  const starts = turnSequence.filter(s => s.startsWith('+')).length
  const ends = turnSequence.filter(s => s.startsWith('-')).length
  const paired = starts === ends
  console.log(`  [Wave1] start/end 配对:                ${starts}=${ends} ${paired ? '✅' : '❌'}`)

  // Bug #3 (grid_spell handler) + Bug #2 (grid_item handler) 后端不崩
  console.log('\n=== 后端 handler 可达性 ===')
  startCombat(session, ['Goblin'], allDb as any)
  let spellOk = true
  let itemOk = true
  // 用玩家实际有的法术(而不是乱猜"Fire Bolt")
  const anySpell = session.player.spells?.[0]?.name
  if (anySpell) {
    try {
      for await (const _ev of engine.processGridAction({ action: 'grid_spell', spellName: anySpell, targetId: session.combat!.monsters[0]!.id })) {}
    } catch (e) { spellOk = false; console.error('grid_spell 抛错:', (e as Error).message) }
    console.log(`  [Bug #3] grid_spell handler (${anySpell}): ${spellOk ? '✅ 不崩' : '❌ 崩'}`)
  } else {
    console.log(`  [Bug #3] grid_spell handler: 跳过(fighter 无法术,不阻塞验证)`)
  }

  if (!session.combat?.active) startCombat(session, ['Goblin'], allDb as any)
  try {
    for await (const _ev of engine.processGridAction({ action: 'grid_item', itemName: '治疗药水' })) {}
  } catch (e) { itemOk = false; console.error('grid_item 抛错:', (e as Error).message) }
  console.log(`  [Bug #2] grid_item handler:             ${itemOk ? '✅ 不崩' : '❌ 崩'}`)

  const spellPass = anySpell ? spellOk : true
  const allPassed = combatCleared && gridEndSeen && syncAfterVictory && victorySeen && hasMonsterNarratives && spellPass && itemOk && paired
  console.log(`\n=== ${allPassed ? '🎉 全部通过' : '⚠ 有未通过项'} ===`)
  process.exit(allPassed ? 0 : 1)
}

main().catch(e => { console.error('[smoke] 崩:', e); process.exit(1) })
