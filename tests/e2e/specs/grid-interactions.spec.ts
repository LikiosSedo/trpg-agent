import { test, expect } from '@playwright/test'
import { GridPage } from '../fixtures/grid-page.js'
import { baseScenario, wallScenario } from '../fixtures/scenarios.js'

test.describe('点击 & Mode 切换 & 取消行动', () => {
  test('点击移动按钮 → reachable 高亮 → 再点一次取消（P1#5）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())

    expect(await g.getMode()).toBe('idle')
    await g.btnMove().click()
    expect(await g.getMode()).toBe('move')
    // 玩家周围至少 1 格 reachable
    await expect(g.cell(2, 2)).toHaveClass(/reachable/)
    await expect(g.btnMove()).toHaveClass(/active/)
    await g.screenshotGrid('10-move-mode-on')

    // 再次点击 → 取消
    await g.btnMove().click()
    expect(await g.getMode()).toBe('idle')
    await expect(g.cell(2, 2)).not.toHaveClass(/reachable/)
    await expect(g.btnMove()).not.toHaveClass(/active/)
    await g.screenshotGrid('11-move-mode-cancelled')
  })

  test('点击攻击按钮 → attackable 斜纹 → 再点一次取消', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())

    await g.btnAttack().click()
    expect(await g.getMode()).toBe('attack')
    await expect(g.btnAttack()).toHaveClass(/active/)
    // 玩家位置到敌人中间应该有 reachable 和 attackable
    // Goblin_1 在 (5,2)
    await expect(g.cell(5, 2)).toHaveClass(/attackable/)
    // 验证斜纹图案已应用（computed style 含 repeating-linear-gradient）
    const bg = await g.cell(5, 2).evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(bg).toContain('repeating-linear-gradient')
    await g.screenshotGrid('12-attack-stripes')

    await g.btnAttack().click()
    expect(await g.getMode()).toBe('idle')
  })

  test('点击不可达格 → shake 动画 + 日志提示（P1#4）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.btnMove().click()

    // (6,4) 是右下角，远超玩家 speed 3
    const farCell = g.cell(6, 4)
    await farCell.click()
    // invalid-click class 短暂出现
    await expect(farCell).toHaveClass(/invalid-click/, { timeout: 200 })
    // 日志里有提示
    const logText = await g.page.locator('#combat-grid-log').textContent()
    expect(logText).toContain('超出移动范围')
    await g.screenshotGrid('13-invalid-move-shake')
  })

  test('攻击模式下点击空格 → 不在攻击范围提示', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.btnAttack().click()
    // (3,4) 空地
    await g.cell(3, 4).click()
    await expect(g.cell(3, 4)).toHaveClass(/invalid-click/, { timeout: 300 })
    const logText = await g.page.locator('#combat-grid-log').textContent()
    expect(logText).toContain('此处没有敌人')
  })

  test('idle 模式下点击任意格 → shake 提示先选行动', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    // mode 保持 idle
    const cell = g.cell(2, 2)
    await cell.click()
    await expect(cell).toHaveClass(/invalid-click/, { timeout: 300 })
  })

  test('墙场景：BFS 不允许穿墙，墙后的格不亮', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(wallScenario())
    await g.btnMove().click()
    // 墙在 (3,2)(4,2)，玩家 speed 4 从 (1,2) 绕过去需要远路；(5,2) 不可达
    await expect(g.cell(5, 2)).not.toHaveClass(/reachable/)
    // 但绕到 (2,2) 可达
    await expect(g.cell(2, 2)).toHaveClass(/reachable/)
    await g.screenshotGrid('14-wall-bfs')
  })
})
