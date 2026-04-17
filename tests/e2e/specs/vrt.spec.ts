import { test, expect } from '@playwright/test'
import { GridPage } from '../fixtures/grid-page.js'
import { ActionsPage } from '../fixtures/actions-page.js'
import { InventoryPage } from '../fixtures/inventory-page.js'
import { CombatPanelPage } from '../fixtures/combat-panel-page.js'
import { baseScenario, bossScenario, lowHpScenario } from '../fixtures/scenarios.js'
import { TradePage } from '../fixtures/trade-page.js'
import { NPCDetailPage } from '../fixtures/npc-detail-page.js'
import { HUDPage } from '../fixtures/hud-page.js'
import { QuestHintPage } from '../fixtures/quest-hint-page.js'

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

  test('交易 · 余额充足 + 砍价', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({
      npc: '铁匠韩猛',
      items: [
        { name: '治疗药水', quantity: 3, price: 15 },
        { name: '火把', quantity: 2, price: 5 },
      ],
      canBargain: true,
    })
    await page.addStyleTag({
      content: `#login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; } #messages { padding: 24px !important; max-width: 520px; margin: 0 auto; }`,
    })
    await expect(page.locator('.trade-proposal-card')).toHaveScreenshot('trade-basic.png', VRT)
  })

  test('交易 · 余额不足', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(10)
    await t.show({ npc: '商人', items: [{ name: '稀有药水', price: 50 }] })
    await page.addStyleTag({
      content: `#login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; } #messages { padding: 24px !important; max-width: 520px; margin: 0 auto; }`,
    })
    await expect(page.locator('.trade-proposal-card')).toHaveScreenshot('trade-insufficient.png', VRT)
  })

  test('NPC 详情 · 中等信任 + 情报分组', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({
      name: '小莉',
      title: '破晓镇孤女',
      trust: 5,
      appearance: '瘦小，棕色短发，破旧的连衣裙',
      discovered: [
        { fact: '父母死于瘟疫', category: '背景' },
        { fact: '喜欢糖果', category: '喜好' },
      ],
      locked: 2,
    })
    await page.addStyleTag({
      content: `#login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; } #panel-sheet { position: static !important; max-height: none !important; transform: none !important; }`,
    })
    await expect(page.locator('#panel-sheet')).toHaveScreenshot('npc-detail.png', VRT)
  })

  test('HUD · 健康态', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({
      player: { hp: 18, maxHp: 20, gold: 42 },
      worldState: { timeOfDay: 'morning', currentLocation: 'dawnbreak-town' },
    })
    await page.addStyleTag({
      content: `#login-screen, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; } #header { padding: 16px !important; } #player-hud { font-size: 16px !important; }`,
    })
    await expect(page.locator('#header')).toHaveScreenshot('hud-healthy.png', VRT)
  })

  test('任务条 · 进度中', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: '收集 3 个线索', progress: '1/3' })
    await page.addStyleTag({
      content: `#login-screen, #header, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; } body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; padding-top: 20px; } #quest-hint-bar { max-width: 520px; margin: 24px auto !important; }`,
    })
    await expect(page.locator('#quest-hint-bar')).toHaveScreenshot('quest-progress.png', VRT)
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
