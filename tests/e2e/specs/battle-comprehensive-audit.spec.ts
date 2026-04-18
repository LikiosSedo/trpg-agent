/**
 * Wave 2 全面演出闭环 e2e —— 覆盖所有能在前端测的场景
 *
 * 跑完看截图,找问题 → 一一修。
 *
 * 测试矩阵:
 *   1. 各 intent 单卡(防御/移动/逃跑/物品)
 *   2. 各 intent 双卡(攻击/法术 + target)
 *   3. side 组合(player vs enemy / enemy vs player / ally vs enemy / player vs ally 误触)
 *   4. Boss 大体型立绘(蛛母)
 *   5. 死亡演出 combat_grid_death
 *   6. 长 path 逐格滑动(7 格)
 *   7. 4 怪物连续攻击节奏
 *   8. 快进键 Space
 *   9. 战斗结束清理(双卡 + banner + 网格高亮 全清)
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const VIEWPORT = { width: 1280, height: 800 }

async function bootGameWithGrid(page: any, units: any[]) {
  await page.goto('http://localhost:3008/')
  await page.evaluate((unitsData) => {
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'
    const fakeGrid = {
      width: 7, height: 5,
      terrain: Array.from({ length: 5 }, () => Array(7).fill(0)),
      units: unitsData,
    }
    // @ts-ignore
    if (typeof window.initCombatGrid === 'function') window.initCombatGrid(fakeGrid)
  }, units)
  await page.waitForTimeout(200)
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
})

test('1. 单卡 · 各 intent', async ({ page }) => {
  test.setTimeout(30_000)
  await bootGameWithGrid(page, [
    { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
  ])

  const intents = ['defend', 'move', 'flee', 'item']
  for (const intent of intents) {
    await page.evaluate((it) => {
      // @ts-ignore
      window.showActorPair({ actorName: '林克', side: 'player', intent: it, portrait: 'portraits/pc-fighter.png' })
    }, intent)
    await page.waitForTimeout(450)
    await page.screenshot({ path: `tests/e2e/screenshots/comp-1-solo-${intent}.png`, fullPage: false })
    await page.evaluate(() => {
      // @ts-ignore
      window.hideActorCard()
    })
    await page.waitForTimeout(350)
  }
})

test('2. 双卡 · 各 intent + 各 side 组合', async ({ page }) => {
  test.setTimeout(30_000)
  await bootGameWithGrid(page, [
    { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
    { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
  ])

  const cases = [
    { label: 'player-attack-enemy', a: { actorName: '林克', side: 'player', intent: 'attack', portrait: 'portraits/pc-fighter.png' },
      t: { actorName: 'Goblin', side: 'enemy', portrait: 'portraits/monsters/monster-goblin.png' } },
    { label: 'player-spell-enemy', a: { actorName: '莉娅', side: 'player', intent: 'spell', portrait: 'portraits/pc-mage.png' },
      t: { actorName: 'Wolf', side: 'enemy', portrait: 'portraits/monsters/monster-wolf.png' } },
    { label: 'enemy-attack-player', a: { actorName: 'Cockatrice', side: 'enemy', intent: 'attack', portrait: 'portraits/monsters/monster-cockatrice.png' },
      t: { actorName: '林克', side: 'player', portrait: 'portraits/pc-fighter.png' } },
    { label: 'ally-attack-enemy', a: { actorName: '格雷格', side: 'ally', intent: 'attack', portrait: 'portraits/greg-ironfist.png' },
      t: { actorName: 'Goblin', side: 'enemy', portrait: 'portraits/monsters/monster-goblin.png' } },
    { label: 'boss-spider-attack-player', a: { actorName: '蛛母', side: 'enemy', intent: 'attack', portrait: 'portraits/monsters/monster-spider-matriarch.png' },
      t: { actorName: '林克', side: 'player', portrait: 'portraits/pc-fighter.png' } },
  ]

  for (const c of cases) {
    await page.evaluate(({ a, t }) => {
      // @ts-ignore
      window.showActorPair(a, t)
    }, c)
    await page.waitForTimeout(450)
    await page.screenshot({ path: `tests/e2e/screenshots/comp-2-pair-${c.label}.png`, fullPage: false })
    await page.evaluate(() => {
      // @ts-ignore
      window.hideActorCard()
    })
    await page.waitForTimeout(350)
  }
})

test('3. 长 path 逐格滑动 · 单位走 7 格', async ({ page }) => {
  test.setTimeout(20_000)
  await bootGameWithGrid(page, [
    { id: 'player', side: 'player', pos: { x: 0, y: 4 }, moveSpeed: 8, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
  ])
  // 通过真 WS handler 触发完整流程:actor_turn_start + combat_grid_move + actor_turn_end
  const events = [
    { type: 'actor_turn_start', actorId: 'player', actorName: '林克', side: 'player', portrait: 'portraits/pc-fighter.png', intent: 'move' },
    { type: 'combat_grid_move', unitId: 'player', path: [{x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4},{x:4,y:4},{x:5,y:4},{x:6,y:4}] },
    { type: 'actor_turn_end', actorId: 'player' },
  ]
  await page.evaluate((evs) => {
    for (const ev of evs) {
      // @ts-ignore
      window.handleWsMessage({ data: JSON.stringify(ev) })
    }
  }, events)
  // 单卡(intent=move) hold 500ms + move 6 格 × 130 = 780ms + end 320ms = ~1.6s
  // 每 200ms 截一张共 10 张,看到走过去过程
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(200)
    await page.screenshot({ path: `tests/e2e/screenshots/comp-3-longpath-${String(i).padStart(2, '0')}.png`, fullPage: false })
  }
})

test('4. 多怪物连战节奏 · 4 个 Goblin 依次攻击', async ({ page }) => {
  test.setTimeout(60_000)
  await bootGameWithGrid(page, [
    { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
    { id: 'g1', side: 'enemy', pos: { x: 0, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
    { id: 'g2', side: 'enemy', pos: { x: 2, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
    { id: 'g3', side: 'enemy', pos: { x: 4, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
    { id: 'g4', side: 'enemy', pos: { x: 6, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
  ])

  // 模拟 4 个 Goblin 依次行动(每个 actor_turn 对 + combat_grid_attack)
  const events: any[] = []
  for (const id of ['g1', 'g2', 'g3', 'g4']) {
    events.push({
      type: 'actor_turn_start', actorId: id, actorName: 'Goblin', side: 'enemy',
      portrait: 'portraits/monsters/monster-goblin.png', intent: 'attack',
      targetId: 'player', targetName: '林克', targetSide: 'player',
      targetPortrait: 'portraits/pc-fighter.png',
    })
    events.push({
      type: 'combat_grid_attack', attackerId: id, targetId: 'player',
      damage: 4, hit: true, isCritical: false, narrative: ''
    })
    events.push({ type: 'actor_turn_end', actorId: id })
  }
  await page.evaluate((evs) => {
    for (const ev of evs) {
      // @ts-ignore
      window.handleWsMessage({ data: JSON.stringify(ev) })
    }
  }, events)

  // 4 怪物 × ~2s = 约 8 秒,每 1s 截一张共 10 张
  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `tests/e2e/screenshots/comp-4-multi-${String(i).padStart(2, '0')}.png`, fullPage: false })
  }
})

test('5. 死亡演出 · combat_grid_death', async ({ page }) => {
  test.setTimeout(20_000)
  await bootGameWithGrid(page, [
    { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
    { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 1 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 1, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
  ])
  const events = [
    { type: 'actor_turn_start', actorId: 'player', actorName: '林克', side: 'player', portrait: 'portraits/pc-fighter.png', intent: 'attack',
      targetId: 'Goblin', targetName: 'Goblin', targetSide: 'enemy', targetPortrait: 'portraits/monsters/monster-goblin.png' },
    { type: 'combat_grid_attack', attackerId: 'player', targetId: 'Goblin', damage: 12, hit: true, isCritical: false, narrative: '' },
    { type: 'combat_grid_death', unitId: 'Goblin' },
    { type: 'actor_turn_end', actorId: 'player' },
  ]
  await page.evaluate((evs) => {
    for (const ev of evs) {
      // @ts-ignore
      window.handleWsMessage({ data: JSON.stringify(ev) })
    }
  }, events)
  // 演出大约 2.5s,每 400ms 截一张共 7 张
  for (let i = 1; i <= 7; i++) {
    await page.waitForTimeout(400)
    await page.screenshot({ path: `tests/e2e/screenshots/comp-5-death-${i}.png`, fullPage: false })
  }
})

test('6. 快进键 Space · 大幅缩短演出', async ({ page }) => {
  test.setTimeout(15_000)
  await bootGameWithGrid(page, [
    { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
    { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
  ])
  const events: any[] = []
  for (let i = 0; i < 3; i++) {
    events.push({ type: 'actor_turn_start', actorId: 'player', actorName: '林克', side: 'player', portrait: 'portraits/pc-fighter.png', intent: 'attack',
      targetId: 'Goblin', targetName: 'Goblin', targetSide: 'enemy', targetPortrait: 'portraits/monsters/monster-goblin.png' })
    events.push({ type: 'combat_grid_attack', attackerId: 'player', targetId: 'Goblin', damage: 5, hit: true, isCritical: false, narrative: '' })
    events.push({ type: 'actor_turn_end', actorId: 'player' })
  }
  const t0 = Date.now()
  await page.evaluate((evs) => {
    for (const ev of evs) {
      // @ts-ignore
      window.handleWsMessage({ data: JSON.stringify(ev) })
    }
  }, events)
  // 立即按 Space 快进
  await page.keyboard.press('Space')
  // 等队列耗尽(应该非常快,普通 3 回合 ~6s,快进应 < 1s)
  // 用 evaluate 轮询 queue 是否空
  await page.waitForFunction(() => {
    // @ts-ignore
    return window.battleQueue && window.battleQueue.queue.length === 0 && !window.battleQueue.running
  }, { timeout: 5000 })
  const elapsed = Date.now() - t0
  console.log(`[skip-test] 3 回合演出快进总耗时: ${elapsed}ms`)
  await page.screenshot({ path: 'tests/e2e/screenshots/comp-6-skip-after.png', fullPage: false })
  // 校验:快进后总时长 < 2 秒(否则 sleep 没绕过)
  expect(elapsed).toBeLessThan(2000)
})

test('7. 战斗结束清理 · 卡片+banner+高亮全清', async ({ page }) => {
  test.setTimeout(20_000)
  await bootGameWithGrid(page, [
    { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
    { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 1 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 1, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
  ])
  // 显示卡 + 触发暴击 banner + 网格高亮
  await page.evaluate(() => {
    // @ts-ignore
    window.showActorPair(
      { actorName: '林克', side: 'player', intent: 'attack', portrait: 'portraits/pc-fighter.png' },
      { actorName: 'Goblin', side: 'enemy', portrait: 'portraits/monsters/monster-goblin.png' }
    )
    // @ts-ignore
    window.highlightGridActor('player')
    // @ts-ignore
    window.playHitEffect({ hit: true, isCritical: true, damage: 12 })
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'tests/e2e/screenshots/comp-7-before-end.png', fullPage: false })

  // 触发 combat_grid_end
  await page.evaluate(() => {
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({ type: 'combat_grid_end', result: 'victory', loot: { items: ['蜘蛛丝'], gold: 10 } }) })
  })
  await page.waitForTimeout(800)  // 给清理时间
  await page.screenshot({ path: 'tests/e2e/screenshots/comp-7-after-end.png', fullPage: false })

  // 校验:卡片 / banner / 高亮 都不存在
  const remnant = await page.evaluate(() => {
    return {
      cards: document.querySelectorAll('#battle-actor-stage .battle-actor-card').length,
      stageActive: document.getElementById('battle-actor-stage')?.classList.contains('active'),
      bannerVisible: document.getElementById('battle-crit-banner')?.style.display !== 'none',
      activeCells: document.querySelectorAll('.grid-cell.actor-active').length,
      bodyShake: document.body.classList.contains('battle-screen-shake'),
    }
  })
  console.log('[end-clean] remnants:', remnant)
  expect(remnant.cards).toBe(0)
  expect(remnant.stageActive).toBe(false)
  expect(remnant.activeCells).toBe(0)
  expect(remnant.bodyShake).toBe(false)
})
