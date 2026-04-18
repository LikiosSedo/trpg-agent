/**
 * 2026-04-18 验证战斗胜利结算弹窗
 * 用户反馈: 打赢战斗没有结算环节,战利品感知不明显
 *
 * 测试 3 种场景:
 *   - victory + 有战利品 (金币 + 物品)
 *   - victory + 空战利品 (杀了什么没掉东西)
 *   - defeat (没有战利品但显示败北)
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('Loot popup · 胜利 + 战利品', async ({ page }) => {
  test.setTimeout(20_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('http://localhost:3008/')
  await page.evaluate(() => {
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'
  })

  await page.evaluate(() => {
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_loot',
      result: 'victory',
      loot: { items: ['短剑 +1', '治疗药水', '蜘蛛丝'], gold: 25 },
      monsters: ['Giant Spider', 'Cockatrice'],
    })})
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/screenshots/loot-popup-victory.png', fullPage: false })

  const state = await page.evaluate(() => {
    const popup = document.querySelector('.combat-loot-popup')
    return popup ? {
      visible: popup.classList.contains('show'),
      title: popup.querySelector('.loot-title')?.textContent?.trim(),
      lootRows: popup.querySelectorAll('.loot-row').length,
      hasGold: !!popup.querySelector('.loot-row.gold'),
    } : null
  })
  expect(state).not.toBeNull()
  expect(state!.visible).toBe(true)
  expect(state!.title).toContain('胜')
  expect(state!.hasGold).toBe(true)
  expect(state!.lootRows).toBe(4)  // 1 gold + 3 items
})

test('Loot popup · 胜利无战利品', async ({ page }) => {
  test.setTimeout(20_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('http://localhost:3008/')
  await page.evaluate(() => {
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'
  })

  await page.evaluate(() => {
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_loot',
      result: 'victory',
      loot: { items: [], gold: 0 },
      monsters: ['Goblin'],
    })})
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/screenshots/loot-popup-empty.png', fullPage: false })

  const empty = await page.evaluate(() => {
    return document.querySelector('.combat-loot-popup .loot-empty')?.textContent?.includes('未获得')
  })
  expect(empty).toBe(true)
})

test('Loot popup · 失败', async ({ page }) => {
  test.setTimeout(20_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('http://localhost:3008/')
  await page.evaluate(() => {
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'
  })

  await page.evaluate(() => {
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_loot',
      result: 'defeat',
      monsters: ['Spider Matriarch'],
    })})
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/screenshots/loot-popup-defeat.png', fullPage: false })

  const state = await page.evaluate(() => {
    const popup = document.querySelector('.combat-loot-popup')
    return popup ? {
      isDefeat: popup.classList.contains('defeat'),
      title: popup.querySelector('.loot-title')?.textContent?.trim(),
    } : null
  })
  expect(state!.isDefeat).toBe(true)
  expect(state!.title).toContain('败')
})
