import { test, expect } from '@playwright/test'
import { GridPage } from '../fixtures/grid-page.js'
import { ActionsPage } from '../fixtures/actions-page.js'
import { InventoryPage } from '../fixtures/inventory-page.js'
import { CombatPanelPage } from '../fixtures/combat-panel-page.js'
import { baseScenario, bossScenario, lowHpScenario } from '../fixtures/scenarios.js'

// 视觉回归基线 —— 每个关键界面固定一张截图，任何像素级回归都会被捕获。
// 首次运行：npx playwright test vrt --update-snapshots
// 之后：npx playwright test vrt  → 差异 > maxDiffPixelRatio 时报错

const VRT = { maxDiffPixelRatio: 0.02, threshold: 0.2 } as const

test.describe('VRT 基线', () => {
  test('战棋 · 基础场景', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.hideChrome()
    await page.addStyleTag({
      content: `
        #combat-grid-container.active { padding: 24px 28px !important; gap: 12px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }
      `,
    })
    await expect(page.locator('#combat-grid-container')).toHaveScreenshot('grid-base.png', VRT)
  })

  test('战棋 · Boss 场景', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(bossScenario())
    await g.hideChrome()
    await page.addStyleTag({
      content: `#combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }`,
    })
    // Boss pulse 是动画，需冻结
    await page.addStyleTag({
      content: `.grid-unit.boss, .grid-hp.critical { animation: none !important; }`,
    })
    await expect(page.locator('#combat-grid-container')).toHaveScreenshot('grid-boss.png', VRT)
  })

  test('战棋 · 低 HP critical', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(lowHpScenario())
    await g.hideChrome()
    await page.addStyleTag({
      content: `#combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; } .grid-hp.critical { animation: none !important; }`,
    })
    await expect(page.locator('#combat-grid-container')).toHaveScreenshot('grid-low-hp.png', VRT)
  })

  test('场景选项 · icon + 主线', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({
      suggestions: [
        '★ 寻找守护者之印',
        { text: '购买治疗药水', icon: 'ra-potion' },
        '离开商店',
      ],
    })
    await page.addStyleTag({
      content: `#login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; } #messages { padding: 20px !important; }`,
    })
    await expect(page.locator('#messages')).toHaveScreenshot('actions.png', VRT)
  })

  test('背包 · 装备 + 物品', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    await inv.showInventory({
      equipment: [{ name: '长剑', slot: '主手' }, { name: '皮甲', slot: '躯干' }],
      items: [
        { name: '治疗药水', quantity: 3, description: '恢复 2d4+2 HP' },
        { name: '旅行口粮', quantity: 5, description: '一日所需' },
      ],
    })
    await page.addStyleTag({
      content: `#login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; } #panel-sheet { position: static !important; max-height: none !important; transform: none !important; }`,
    })
    await expect(page.locator('#panel-sheet')).toHaveScreenshot('inventory.png', VRT)
  })

  test('战斗面板 · 目标选择', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({
      targets: [
        { id: 'wolf_1', name: '灰狼', hp: 11, maxHp: 11 },
        { id: 'wolf_2', name: '恶狼', hp: 5, maxHp: 11 },
        { id: 'wolf_3', name: '野狼', hp: 7, maxHp: 11 },
      ],
    })
    await c.page.evaluate(() => (window as any).combatAttack())
    await page.addStyleTag({
      content: `#login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-grid-container, #messages, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; } #combat-panel { position: static !important; padding: 24px !important; }`,
    })
    await expect(page.locator('#combat-panel')).toHaveScreenshot('combat-target-selector.png', VRT)
  })
})
