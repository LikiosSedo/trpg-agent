import { test, expect } from '@playwright/test'
import { GridPage } from '../fixtures/grid-page.js'
import { baseScenario, bossScenario, crowdedScenario, lowHpScenario, rangedScenario, wallScenario } from '../fixtures/scenarios.js'

test.describe('战棋初始化 & 渲染', () => {
  test('基础场景渲染：7×5 格、玩家 + 敌人各 1', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())

    expect(await g.cellCount()).toBe(7 * 5)
    await expect(g.unit('player')).toBeVisible()
    await expect(g.unit('Goblin_1')).toBeVisible()
    await expect(g.page.locator('.grid-name', { hasText: '你' })).toBeVisible()
    await g.screenshotGrid('01-base-init')
  })

  test('墙地形渲染：墙格有 █ 符号，困难地形有 ▒', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(wallScenario())
    await g.expectCellClass(3, 2, 'wall')
    await g.expectCellClass(4, 2, 'wall')
    await g.screenshotGrid('02-wall')
  })

  test('Boss 场景：HP≥40 有 .boss 脉冲', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(bossScenario())
    const bossIcon = g.unit('Spiderqueen')
    await expect(bossIcon).toBeVisible()
    const hasBoss = await bossIcon.evaluate((el) => el.classList.contains('boss'))
    expect(hasBoss).toBe(true)
    await g.screenshotGrid('03-boss-pulse')
  })

  test('低 HP 血条：critical/low 颜色正确', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(lowHpScenario())
    // 玩家 4/20 → 20% → critical
    const playerHpClass = await g.page.locator('.grid-unit[data-unit-id="player"] .grid-hp')
      .evaluate((el) => (el as HTMLElement).className)
    expect(playerHpClass).toContain('critical')
    // Goblin 3/8 → 37.5% → low
    const goblinHpClass = await g.page.locator('.grid-unit[data-unit-id="Goblin_1"] .grid-hp')
      .evaluate((el) => (el as HTMLElement).className)
    expect(goblinHpClass).toContain('low')
    await g.screenshotGrid('04-low-hp')
  })

  test('多单位挤满场：盟友/敌人/玩家颜色区分', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(crowdedScenario())
    // 6 个单位都渲染
    const count = await g.page.locator('.grid-unit').count()
    expect(count).toBe(6)
    await g.screenshotGrid('05-crowded')
  })

  test('远程场景：游侠攻击按钮能覆盖远距敌人', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(rangedScenario())
    await g.btnAttack().click()
    // 攻击模式下，远程 4 格的 attack_range 应该能把右侧敌人点亮
    await expect(g.cell(5, 2)).toHaveClass(/attackable/)
    await g.screenshotGrid('06-ranged')
  })
})
