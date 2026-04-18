/**
 * Wave 2 现状审计 · 完整战斗时序 e2e
 *
 * 目的: 独立观察"真实演出节奏"——卡片/移动/数字/震屏 是否协同,有没有视觉割裂
 *
 * 手法: 模拟一个完整的 WS 消息序列(玩家攻击 → Goblin 反击暴击 → 玩家击杀)
 *       通过 page.evaluate 直接推到 handleWsMessage,完全模拟后端 yield 速度(瞬间)
 *       每隔 ~250ms 截一张,得到 12-16 帧,串起来看节奏
 *
 * 不依赖真 LLM、真战斗。只测前端演出层。
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

// 完整战斗序列:玩家(攻击/命中) → Goblin_2 反击(暴击) → 玩家击杀 Goblin
const COMBAT_EVENTS: any[] = [
  // R1 玩家回合
  {
    type: 'actor_turn_start',
    actorId: 'player', actorName: '林克', side: 'player',
    portrait: 'portraits/pc-fighter.png', intent: 'attack',
    targetId: 'Goblin', targetName: 'Goblin', targetSide: 'enemy',
    targetPortrait: 'portraits/monsters/monster-goblin.png',
  },
  { type: 'combat_grid_move', unitId: 'player', path: [{x:3,y:4},{x:3,y:3},{x:3,y:2},{x:3,y:1}] },
  { type: 'combat_status', text: '林克 攻击(长剑+1): d20(15)+7=22 vs AC14 → 命中', ended: false },
  { type: 'combat_status', text: '伤害: 1d8+4=12 → Goblin HP: 3/15', ended: false },
  {
    type: 'combat_grid_attack',
    attackerId: 'player', targetId: 'Goblin',
    damage: 12, hit: true, isCritical: false, narrative: ''
  },
  { type: 'actor_turn_end', actorId: 'player' },

  // R2 Goblin_2 反击(暴击玩家)
  {
    type: 'actor_turn_start',
    actorId: 'Goblin_2', actorName: 'Goblin', side: 'enemy',
    portrait: 'portraits/monsters/monster-goblin.png', intent: 'attack',
    targetId: 'player', targetName: '林克', targetSide: 'player',
    targetPortrait: 'portraits/pc-fighter.png',
  },
  { type: 'combat_grid_move', unitId: 'Goblin_2', path: [{x:1,y:0},{x:2,y:1},{x:3,y:2}] },
  { type: 'combat_narrative', text: '哥布林低嚎扑出,毒爪撕开你的护甲——' },
  {
    type: 'combat_grid_attack',
    attackerId: 'Goblin_2', targetId: 'player',
    damage: 8, hit: true, isCritical: true, narrative: ''
  },
  { type: 'combat_monster', text: 'Goblin_2 攻击 林克: 暴击! 伤害 8', playerHp: 22, playerMaxHp: 38 },
  { type: 'actor_turn_end', actorId: 'Goblin_2' },

  // R3 玩家击杀 Goblin
  {
    type: 'actor_turn_start',
    actorId: 'player', actorName: '林克', side: 'player',
    portrait: 'portraits/pc-fighter.png', intent: 'attack',
    targetId: 'Goblin', targetName: 'Goblin', targetSide: 'enemy',
    targetPortrait: 'portraits/monsters/monster-goblin.png',
  },
  {
    type: 'combat_grid_attack',
    attackerId: 'player', targetId: 'Goblin',
    damage: 6, hit: true, isCritical: false, narrative: ''
  },
  { type: 'combat_grid_death', unitId: 'Goblin' },
  { type: 'actor_turn_end', actorId: 'player' },
]

test('完整战斗时序 · 移动端', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })  // iPhone 12

  await page.goto('http://localhost:3008/')
  await page.evaluate(() => {
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'
    const fakeGrid = {
      width: 7, height: 5,
      terrain: Array.from({ length: 5 }, () => Array(7).fill(0)),
      units: [
        { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
        { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
      ]
    }
    // @ts-ignore
    if (typeof window.initCombatGrid === 'function') window.initCombatGrid(fakeGrid)
    // @ts-ignore
    window.showActorPair(
      { actorName: '林克', side: 'player', intent: 'attack', portrait: 'portraits/pc-fighter.png' },
      { actorName: 'Goblin', side: 'enemy', portrait: 'portraits/monsters/monster-goblin.png' }
    )
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/screenshots/timing-mobile-pair.png', fullPage: false })

  // 暴击演出在移动端
  await page.evaluate(() => {
    // @ts-ignore
    window.playHitEffect({ hit: true, isCritical: true, damage: 24 })
  })
  await page.waitForTimeout(280)
  await page.screenshot({ path: 'tests/e2e/screenshots/timing-mobile-crit.png', fullPage: false })
})

test('完整战斗时序 · 多帧录像', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('http://localhost:3008/')

  await page.evaluate(() => {
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'
    const fakeGrid = {
      width: 7, height: 5,
      terrain: Array.from({ length: 5 }, () => Array(7).fill(0)),
      units: [
        { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
        { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
        { id: 'Goblin_2', side: 'enemy', pos: { x: 1, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 12, maxHp: 15, portrait: 'portraits/monsters/monster-goblin.png' },
      ]
    }
    // @ts-ignore
    if (typeof window.initCombatGrid === 'function') window.initCombatGrid(fakeGrid)
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'tests/e2e/screenshots/timing-00-pregame.png', fullPage: false })

  // 模拟后端"瞬间 yield":所有事件 push 给 handleWsMessage,几乎同一帧
  await page.evaluate((events) => {
    for (const ev of events) {
      // 后端事件以 WS message 形式投递,前端走 handleWsMessage
      // @ts-ignore
      window.handleWsMessage({ data: JSON.stringify(ev) })
    }
  }, COMBAT_EVENTS)

  // 每 250ms 截一帧,共 16 帧 = 4 秒覆盖整个演出
  for (let i = 1; i <= 16; i++) {
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `tests/e2e/screenshots/timing-${String(i).padStart(2, '0')}-frame.png`,
      fullPage: false,
    })
  }
})
