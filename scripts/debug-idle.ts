#!/usr/bin/env tsx
/**
 * 诊断：深度追踪 getIdleEvent 每一次过滤决策。
 */

import fs from 'node:fs'

const save = JSON.parse(fs.readFileSync('saves/playtest-playtest-v6qek.json', 'utf-8'))
const session = save.session ?? save

// 强制玩家在破晓镇
session.worldState.currentLocation = 'dawnbreak-town'
session.worldState.timeOfDay = 'morning'
session.interactionNpc = undefined
session.worldState.flags = {}
session.turnCount = 5

// 复制 getIdleEvent 实现步骤进行逐行诊断（从 src 拷贝）
const IDLE_SNIPPETS_SRC = fs.readFileSync('src/npc-idle-events.ts', 'utf-8')
const matches = IDLE_SNIPPETS_SRC.match(/\{\s*npc:.+?\}/g) ?? []
console.log(`snippets 解析得到 ${matches.length} 条`)
console.log('前 3 条 raw:', matches.slice(0, 3))

// 直接 import 并手工走步骤
const mod: any = await import('../src/npc-idle-events.js')
console.log()
console.log('─── 手动 dry-run ───')
const playerLoc = session.worldState.currentLocation
const time = session.worldState.timeOfDay
const candidates = session.npcs.filter((n: any) =>
  n.location === playerLoc
  && (n.condition ?? 'normal') === 'normal'
  && n.name !== session.interactionNpc
)
console.log(`playerLoc=${playerLoc}, time=${time}`)
console.log(`candidates: ${candidates.length} → ${candidates.map((n: any) => n.name).join(',')}`)

// 手动调 getIdleEvent 并打点
let hit = 0, miss = 0, filterMiss = 0
for (let i = 0; i < 200; i++) {
  session.worldState.flags = {}
  const r = Math.random()
  if (r > 0.12) { miss++; continue }
  const out = mod.getIdleEvent(session)
  if (out) hit++
  else filterMiss++
}
console.log()
console.log(`200 次：hit=${hit}  rand>0.12 skip=${miss}  rand<0.12 但 filtered=${filterMiss}`)

// 再跑 1 次强制 Math.random=0.05（肯定过 rand 检查）并看返回
console.log()
console.log('─── 强制 rand=0.05 ───')
const orig = Math.random
Math.random = () => 0.05
try {
  session.worldState.flags = {}
  const out = mod.getIdleEvent(session)
  console.log(`out: "${out}"`)
  console.log(`flags after: ${JSON.stringify(session.worldState.flags)}`)
} finally {
  Math.random = orig
}
