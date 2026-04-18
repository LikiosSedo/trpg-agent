/**
 * 2026-04-18 验证战士(无法术) + 无物品时的边界:
 * - 法术按钮应灰掉(disabled) + tooltip
 * - 物品按钮应灰掉(disabled) + tooltip
 * - 即使强制点击也只 gridLog,不 appendMsg(战棋模式下 #messages 隐藏)
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('战士战斗 · 法术/物品按钮空态灰显', async ({ page }) => {
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
        { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 30, maxHp: 38 },
        { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15 },
      ]
    }
    // @ts-ignore
    if (typeof window.initCombatGrid === 'function') window.initCombatGrid(fakeGrid)
    // 模拟 combat_action_req: 战士无法术 / 无物品
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_action_req',
      targets: [{ id: 'Goblin', name: 'Goblin', hp: 15, maxHp: 15 }],
      spells: [],
      items: [],
      allies: [],
      playerHp: 30, playerMaxHp: 38,
    })})
  })
  await page.waitForTimeout(300)

  // 验证按钮状态
  const btnState = await page.evaluate(() => {
    const spell = document.getElementById('grid-btn-spell') as HTMLButtonElement
    const item = document.getElementById('grid-btn-item') as HTMLButtonElement
    return {
      spellDisabled: spell?.disabled,
      spellTitle: spell?.title,
      itemDisabled: item?.disabled,
      itemTitle: item?.title,
    }
  })
  expect(btnState.spellDisabled).toBe(true)
  expect(btnState.spellTitle).toContain('法术')
  expect(btnState.itemDisabled).toBe(true)
  expect(btnState.itemTitle).toContain('物品')

  await page.screenshot({ path: 'tests/e2e/screenshots/spell-item-disabled.png', fullPage: false })

  // 强行调用 gridSpellMode (绕过 disabled),验证反馈走 gridLog 不走 appendMsg
  await page.evaluate(() => {
    // @ts-ignore
    window.gridSpellMode()
    // @ts-ignore
    window.gridItemMode()
  })
  await page.waitForTimeout(200)

  const logText = await page.evaluate(() => {
    const log = document.getElementById('combat-grid-log')
    return log ? log.textContent : ''
  })
  expect(logText).toContain('法术')
  expect(logText).toContain('物品')

  await page.screenshot({ path: 'tests/e2e/screenshots/spell-item-empty-feedback.png', fullPage: false })
})

test('法师战斗 · 法术按钮可用', async ({ page }) => {
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
        { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '艾娜', hp: 18, maxHp: 22 },
        { id: 'Goblin', side: 'enemy', pos: { x: 3, y: 0 }, moveSpeed: 3, attackRange: 1, name: 'Goblin', hp: 15, maxHp: 15 },
      ]
    }
    // @ts-ignore
    if (typeof window.initCombatGrid === 'function') window.initCombatGrid(fakeGrid)
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_action_req',
      targets: [{ id: 'Goblin', name: 'Goblin', hp: 15, maxHp: 15 }],
      spells: [
        { name: '火焰飞弹', description: '远程伤害', remaining: 0, max: 0, isCantrip: true },
        { name: '魔法导弹', description: '必中', remaining: 3, max: 3, isCantrip: false },
      ],
      items: [{ name: '治疗药水', description: '回复 2d4+2 HP' }],
      allies: [],
      playerHp: 18, playerMaxHp: 22,
    })})
  })
  await page.waitForTimeout(300)

  const btnState = await page.evaluate(() => {
    const spell = document.getElementById('grid-btn-spell') as HTMLButtonElement
    const item = document.getElementById('grid-btn-item') as HTMLButtonElement
    return {
      spellDisabled: spell?.disabled,
      itemDisabled: item?.disabled,
    }
  })
  expect(btnState.spellDisabled).toBe(false)
  expect(btnState.itemDisabled).toBe(false)

  await page.screenshot({ path: 'tests/e2e/screenshots/spell-item-mage.png', fullPage: false })
})
