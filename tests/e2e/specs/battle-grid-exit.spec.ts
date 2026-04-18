/**
 * 2026-04-18 验证 grid 战斗结束后干净退出 (用户报告的"卡在普通战斗环节"根因)
 *
 * Bug 重现路径:
 *   - combat_grid_end handler 内 enqueue cleanup,最后一行 battleQueue.queue.length = 0
 *   - 后续 combat_status ended:true 入队的 doCleanup 被这行清掉
 *   - combatMode 永远不被设回 false → 玩家卡在 legacy combat-btn UI
 *
 * 修复:
 *   1. 移除 battleQueue.queue.length = 0
 *   2. endCombatGrid 内部兜底设 combatMode=false 等关键状态
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('Grid 战斗结束 → 干净退出 (combatMode 必须 false)', async ({ page }) => {
  test.setTimeout(20_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('http://localhost:3008/')

  await page.evaluate(() => {
    const menu = document.getElementById('resume-screen')
    if (menu) menu.style.display = 'none'
    const game = document.getElementById('game-screen')
    if (game) game.style.display = 'flex'
    // 注入 grid + 进入战斗模式
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
    // 进入战斗模式 (模拟 combat_action_req 设置 combatMode=true 等)
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_action_req',
      targets: [{ id: 'Goblin', name: 'Goblin', hp: 15, maxHp: 15 }],
      spells: [], items: [], allies: [],
      playerHp: 30, playerMaxHp: 38,
    })})
  })
  await page.waitForTimeout(200)

  // 确认进入战斗
  const inCombat = await page.evaluate(() => {
    return {
      // @ts-ignore
      combatMode: window.combatMode,
      // @ts-ignore
      gridState: !!window.gridState,
    }
  })
  // combatMode 是模块作用域,window.combatMode 可能 undefined
  // 直接检查 grid 容器是否激活
  const gridActive = await page.evaluate(() => {
    return document.getElementById('combat-grid-container')?.classList.contains('active')
  })
  expect(gridActive).toBe(true)

  // 模拟胜利序列(后端实际发送的事件顺序):
  // 1. combat_status text=lootText, ended:false
  // 2. combat_loot popup
  // 3. combat_grid_end (隐藏 grid, 入队 cleanup)
  // 4. combat_status text='', ended:true (cleanup combatMode)
  await page.evaluate(() => {
    const ws = (data: any) => {
      // @ts-ignore
      window.handleWsMessage({ data: JSON.stringify(data) })
    }
    ws({ type: 'combat_status', text: '战斗胜利！获得: 短剑 +1 + 15金币', ended: false })
    ws({ type: 'combat_loot', result: 'victory',
         loot: { items: ['短剑 +1'], gold: 15 }, monsters: ['Goblin'] })
    ws({ type: 'combat_grid_end', result: 'victory',
         loot: { items: ['短剑 +1'], gold: 15 } })
    ws({ type: 'combat_status', text: '', ended: true, result: 'victory' })
  })

  // 等队列处理完 (battleQueue 是异步,需要时间排空)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'tests/e2e/screenshots/grid-exit-after.png', fullPage: false })

  // 验证彻底退出战斗
  const afterState = await page.evaluate(() => {
    const grid = document.getElementById('combat-grid-container')
    const gridActive = grid?.classList.contains('active')
    // 检查 combat-btn (legacy UI) 是否显示
    const combatBtns = document.querySelectorAll('.combat-btn')
    const visibleBtns = Array.from(combatBtns).filter(b => {
      const style = window.getComputedStyle(b as HTMLElement)
      return style.display !== 'none' && (b as HTMLElement).offsetParent !== null
    })
    // input 应该启用 (玩家可以继续输入)
    const inputDisabled = (document.getElementById('input') as HTMLInputElement)?.disabled
    // 检查 popup 还在(4s 内)
    const popup = document.querySelector('.combat-loot-popup.show')
    return {
      gridActive,
      visibleCombatBtns: visibleBtns.length,
      inputDisabled,
      popupShown: !!popup,
    }
  })

  // 关键断言: grid 隐藏 + combat-btn 不再显示 (combatMode=false)
  expect(afterState.gridActive).toBe(false)
  expect(afterState.visibleCombatBtns).toBe(0)
  expect(afterState.popupShown).toBe(true)  // 弹窗在 4s 内还会显示
})

test('Grid 战斗失败 → 干净退出', async ({ page }) => {
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
        { id: 'player', side: 'player', pos: { x: 3, y: 4 }, moveSpeed: 3, attackRange: 1, name: '林克', hp: 0, maxHp: 38 },
      ]
    }
    // @ts-ignore
    window.initCombatGrid(fakeGrid)
    // @ts-ignore
    window.handleWsMessage({ data: JSON.stringify({
      type: 'combat_action_req',
      targets: [], spells: [], items: [], allies: [],
      playerHp: 0, playerMaxHp: 38,
    })})
  })
  await page.waitForTimeout(200)

  await page.evaluate(() => {
    const ws = (data: any) => {
      // @ts-ignore
      window.handleWsMessage({ data: JSON.stringify(data) })
    }
    ws({ type: 'combat_status', text: '战斗失败...', ended: false })
    ws({ type: 'combat_loot', result: 'defeat', monsters: ['Spider Matriarch'] })
    ws({ type: 'combat_grid_end', result: 'defeat' })
    ws({ type: 'combat_status', text: '', ended: true, result: 'defeat' })
  })

  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'tests/e2e/screenshots/grid-exit-defeat.png', fullPage: false })

  const afterState = await page.evaluate(() => {
    const grid = document.getElementById('combat-grid-container')
    return {
      gridActive: grid?.classList.contains('active'),
      visibleCombatBtns: Array.from(document.querySelectorAll('.combat-btn')).filter(b => {
        const s = window.getComputedStyle(b as HTMLElement)
        return s.display !== 'none' && (b as HTMLElement).offsetParent !== null
      }).length,
      popupShown: !!document.querySelector('.combat-loot-popup.show'),
    }
  })
  expect(afterState.gridActive).toBe(false)
  expect(afterState.visibleCombatBtns).toBe(0)
  expect(afterState.popupShown).toBe(true)
})
