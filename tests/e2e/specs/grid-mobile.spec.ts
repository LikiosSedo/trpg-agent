import { test, expect } from '@playwright/test'
import { GridPage } from '../fixtures/grid-page.js'
import { mobileScenario } from '../fixtures/scenarios.js'

test.describe('移动端布局（375×667）', () => {
  test('7 列格子完整显示，不溢出（P1#7）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(mobileScenario())

    // viewport 已由 project=mobile 决定（iPhone SE 375×667）
    const containerBox = await g.page.locator('.combat-grid').boundingBox()
    expect(containerBox).not.toBeNull()
    const vpWidth = page.viewportSize()?.width ?? 375
    // 网格总宽 ≤ viewport（含 cell + gap）
    expect(containerBox!.width).toBeLessThanOrEqual(vpWidth - 4)

    // 第 1 列和第 7 列（最后一列）都在视口内
    const firstCell = await g.cell(0, 2).boundingBox()
    const lastCell  = await g.cell(6, 2).boundingBox()
    expect(firstCell!.x).toBeGreaterThanOrEqual(0)
    expect(lastCell!.x + lastCell!.width).toBeLessThanOrEqual(vpWidth)

    // 格子实际大小应匹配 --grid-cell-size: 38px
    const cellSize = await g.cell(0, 0).evaluate((el) =>
      getComputedStyle(el).getPropertyValue('width').trim()
    )
    expect(cellSize).toBe('38px')
    await g.screenshot('30-mobile-layout')
  })

  test('移动端攻击按钮可点击，激活后高亮正常', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(mobileScenario())
    await g.btnAttack().click()
    await expect(g.cell(5, 2)).toHaveClass(/attackable/)
    await g.screenshot('31-mobile-attack')
  })
})
