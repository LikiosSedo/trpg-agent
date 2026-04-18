/**
 * 2026-04-18 验证战士点法术/物品时弹屏幕中央 toast (visible no matter what)
 *
 * 用户报告: 点法术按钮没反应。根因:
 *   - gridSpellMode 走 gridLog 警告,但 gridLog 默认折叠 → 用户看不到
 *   - 即使 disabled 加灰显, 移动端上 active 高亮容易让人以为按钮坏了
 *
 * 修复: 改用 showCombatToast 屏幕中央 1.5s 醒目提示
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('战士点法术 → 屏幕中央 toast', async ({ page }) => {
  test.setTimeout(20_000)
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
        { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38 },
        { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15 },
      ]
    }
    // @ts-ignore
    window.initCombatGrid(fakeGrid)
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_action_req',
      targets: [{ id: 'Goblin', name: 'Goblin', hp: 15, maxHp: 15 }],
      spells: [], items: [], allies: [],
      playerHp: 30, playerMaxHp: 38,
    })})
  })
  await page.waitForTimeout(200)

  // 强行触发 gridSpellMode (绕过 disabled)
  await page.evaluate(() => {
    // @ts-ignore
    window.gridSpellMode()
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'tests/e2e/screenshots/spell-toast.png', fullPage: false })

  const toast = await page.evaluate(() => {
    const t = document.querySelector('.combat-toast.warn.show')
    return t ? { text: t.textContent?.trim(), className: t.className } : null
  })
  expect(toast).not.toBeNull()
  expect(toast!.text).toContain('法术')

  // 物品同样
  await page.waitForTimeout(1700)  // 等 toast 淡出
  await page.evaluate(() => {
    // @ts-ignore
    window.gridItemMode()
  })
  await page.waitForTimeout(300)
  const itemToast = await page.evaluate(() => {
    const t = document.querySelector('.combat-toast.warn.show')
    return t ? t.textContent?.trim() : null
  })
  expect(itemToast).toContain('物品')
})
