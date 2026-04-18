/**
 * 战斗联动布局审计(规划前侦察)
 *
 * 目的: 截图看"战斗进行中"真实 UI —— 地图 + 操作面板 + 演出卡片
 * 同时存在时的位置关系。为 Wave 2 重新规划布局做依据。
 *
 * 手法: 进游戏 → 模拟一个完整战斗状态(用 combat_grid_init 事件注入)
 *       + 显示卡片 → 截图。
 */

import { test, expect } from '@playwright/test'

test('战斗联动布局 · 当前状态快照', async ({ page }) => {
  test.setTimeout(30_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('http://localhost:3008/')

  // 绕过主菜单,直接伪造 game-screen 可见 + 注入 combat_grid_init
  await page.evaluate(() => {
    // 跳过菜单屏
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const create = document.getElementById('create-screen')
    if (create) create.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'

    // 伪造最小 combat state,触发网格渲染
    const fakeGrid = {
      width: 7, height: 5,
      terrain: Array.from({ length: 5 }, () => Array(7).fill(0)),
      units: [
        { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38, portrait: 'portraits/pc-fighter.png' },
        { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15, portrait: '' },
        { id: 'Goblin_2', side: 'enemy', pos: { x: 1, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 12, maxHp: 15, portrait: '' },
      ]
    }
    // @ts-ignore
    if (typeof window.initCombatGrid === 'function') window.initCombatGrid(fakeGrid)
  })

  await page.waitForTimeout(500)

  // 截图 1: 战斗基础布局(无演出卡片)
  await page.screenshot({
    path: 'tests/e2e/screenshots/layout-audit-0-baseline.png',
    fullPage: false,
  })

  // 截图 2: 玩家攻击 Goblin —— 双立绘对决
  await page.evaluate(() => {
    // @ts-ignore
    window.showActorPair(
      { actorName: '林克', side: 'player', intent: 'attack', portrait: 'portraits/pc-fighter.png' },
      { actorName: 'Goblin', side: 'enemy', portrait: 'portraits/monsters/monster-goblin.png' },
    )
  })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: 'tests/e2e/screenshots/layout-audit-1-player-vs-goblin.png',
    fullPage: false,
  })

  // 截图 3: Goblin 反击玩家 —— 反向对决
  await page.evaluate(() => {
    // @ts-ignore
    window.hideActorCard()
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => {
    // @ts-ignore
    window.showActorPair(
      { actorName: 'Goblin', side: 'enemy', intent: 'attack', portrait: 'portraits/monsters/monster-goblin.png' },
      { actorName: '林克', side: 'player', portrait: 'portraits/pc-fighter.png' },
    )
  })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: 'tests/e2e/screenshots/layout-audit-2-goblin-vs-player.png',
    fullPage: false,
  })

  // 截图 4: 玩家防御 —— 单卡(无 target)
  await page.evaluate(() => {
    // @ts-ignore
    window.hideActorCard()
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => {
    // @ts-ignore
    window.showActorPair(
      { actorName: '林克', side: 'player', intent: 'defend', portrait: 'portraits/pc-fighter.png' },
    )
  })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: 'tests/e2e/screenshots/layout-audit-3-defend-solo.png',
    fullPage: false,
  })

  // 截图 5: 蛛母 boss 对战玩家 —— 用真立绘
  await page.evaluate(() => {
    // @ts-ignore
    window.hideActorCard()
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => {
    // @ts-ignore
    window.showActorPair(
      { actorName: '蛛母', side: 'enemy', intent: 'attack', portrait: 'portraits/monsters/monster-spider-matriarch.png' },
      { actorName: '林克', side: 'player', portrait: 'portraits/pc-fighter.png' },
    )
  })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: 'tests/e2e/screenshots/layout-audit-4-boss-vs-player.png',
    fullPage: false,
  })

  // 检查关键元素是否被卡片覆盖
  const info = await page.evaluate(() => {
    const stage = document.getElementById('battle-actor-stage')
    const gridEl = document.getElementById('combat-grid')
    const actions = document.getElementById('grid-actions')
    const card = stage?.querySelector('.battle-actor-card') as HTMLElement | null
    const cardRect = card?.getBoundingClientRect()
    const gridRect = gridEl?.getBoundingClientRect()
    const actionsRect = actions?.getBoundingClientRect()
    return { cardRect, gridRect, actionsRect, vh: window.innerHeight, vw: window.innerWidth }
  })
  console.log('[layout-audit]', JSON.stringify(info, null, 2))
})
