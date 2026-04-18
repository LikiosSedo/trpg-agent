/**
 * 2026-04-18 验证回合开始 banner + 演出延迟 +50%
 * - 我方/敌方/盟友 banner 各截一帧
 * - 验证 actor_turn_start 触发 banner 显示
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('回合 banner · 我方/敌方', async ({ page }) => {
  test.setTimeout(30_000)
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
      ]
    }
    // @ts-ignore
    if (typeof window.initCombatGrid === 'function') window.initCombatGrid(fakeGrid)
  })
  await page.waitForTimeout(300)

  // 我方回合 banner — 卡片+banner 同帧
  await page.evaluate(() => {
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'actor_turn_start',
      actorId: 'player', actorName: '林克', side: 'player',
      portrait: 'portraits/pc-fighter.png', intent: 'attack',
      targetId: 'Goblin', targetName: 'Goblin', targetSide: 'enemy',
      targetPortrait: 'portraits/monsters/monster-goblin.png',
    })})
  })
  // banner 在 0.22s 处达到峰值缩放,截 250ms 抓中间
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'tests/e2e/screenshots/turn-banner-player.png', fullPage: false })

  // 等 banner 走完(0.9s)
  await page.waitForTimeout(900)

  // 敌方回合
  await page.evaluate(() => {
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'actor_turn_end', actorId: 'player'
    })})
  })
  await page.waitForTimeout(500)

  await page.evaluate(() => {
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'actor_turn_start',
      actorId: 'Goblin_2', actorName: 'Goblin', side: 'enemy',
      portrait: 'portraits/monsters/monster-goblin.png', intent: 'attack',
      targetId: 'player', targetName: '林克', targetSide: 'player',
      targetPortrait: 'portraits/pc-fighter.png',
    })})
  })
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'tests/e2e/screenshots/turn-banner-enemy.png', fullPage: false })

  // 验证 DOM 状态
  const tbState = await page.evaluate(() => {
    const el = document.getElementById('battle-turn-banner')
    return el ? { className: el.className, textContent: el.textContent } : null
  })
  expect(tbState).not.toBeNull()
  expect(tbState!.textContent).toContain('Goblin')
})
