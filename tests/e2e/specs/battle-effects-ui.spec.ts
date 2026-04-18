/**
 * Wave 2 Tier 1 特效截图测试
 * - 命中震动 + 红 flash
 * - 伤害数字飞出(普通/暴击)
 * - Miss 飘字
 * - 暴击全屏震屏 + 大红 banner
 * - 网格当前行动单位高亮
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('Tier1 特效 · 命中/暴击/Miss', async ({ page }) => {
  test.setTimeout(30_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('http://localhost:3008/')

  // 跳到游戏画面 + 注入 grid + 显示双卡
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
    // @ts-ignore
    window.highlightGridActor('player')
  })
  await page.waitForTimeout(450)
  await page.screenshot({ path: 'tests/e2e/screenshots/effects-0-baseline.png', fullPage: false })

  // 普通命中: 12 伤害
  await page.evaluate(() => {
    // @ts-ignore
    window.playHitEffect({ hit: true, isCritical: false, damage: 12 })
  })
  await page.waitForTimeout(180)  // 抓到震动 + 数字飞起的中间
  await page.screenshot({ path: 'tests/e2e/screenshots/effects-1-hit-normal.png', fullPage: false })
  await page.waitForTimeout(900)

  // Miss
  await page.evaluate(() => {
    // @ts-ignore
    window.playHitEffect({ hit: false, isCritical: false, damage: 0 })
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'tests/e2e/screenshots/effects-2-miss.png', fullPage: false })
  await page.waitForTimeout(800)

  // 暴击: 24 伤害
  await page.evaluate(() => {
    // @ts-ignore
    window.playHitEffect({ hit: true, isCritical: true, damage: 24 })
  })
  await page.waitForTimeout(250)  // 抓到 banner 中间帧
  await page.screenshot({ path: 'tests/e2e/screenshots/effects-3-critical.png', fullPage: false })
  await page.waitForTimeout(900)

  // 网格高亮:玩家正在行动
  await page.screenshot({ path: 'tests/e2e/screenshots/effects-4-grid-highlight.png', fullPage: false })
})
