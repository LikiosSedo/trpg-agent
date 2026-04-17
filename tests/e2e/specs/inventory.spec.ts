import { test, expect } from '@playwright/test'
import { InventoryPage } from '../fixtures/inventory-page.js'

test.describe('背包面板', () => {
  test('空背包 → 显示空状态提示', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    await inv.showInventory({})
    await expect(inv.panelTitle()).toHaveText('背包')
    await expect(inv.panelBody()).toContainText('背包空空如也')
    await inv.screenshotPanel('50-inventory-empty')
  })

  test('装备 + 物品分区渲染', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    await inv.showInventory({
      equipment: [
        { name: '长剑', slot: '主手' },
        { name: '皮甲', slot: '躯干' },
      ],
      items: [
        { name: '治疗药水', quantity: 3, description: '恢复 2d4+2 HP' },
        { name: '火把', quantity: 1, description: '照亮黑暗区域' },
        { name: '旅行口粮', quantity: 5, description: '一日所需' },
      ],
    })

    await expect(inv.sectionTitle('装备')).toBeVisible()
    await expect(inv.sectionTitle('物品')).toBeVisible()
    await expect(inv.itemRow('长剑')).toBeVisible()
    await expect(inv.itemRow('皮甲')).toBeVisible()
    await expect(inv.itemRow('治疗药水')).toBeVisible()

    // 数量 ×N 显示
    const potionText = await inv.itemRow('治疗药水').textContent()
    expect(potionText).toContain('×3')
    const torchText = await inv.itemRow('火把').textContent()
    // 数量=1 不显示 "×1"
    expect(torchText).not.toContain('×1')

    await inv.screenshotPanel('51-inventory-filled')
  })

  test('只有装备，无物品', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    await inv.showInventory({
      equipment: [{ name: '法师法袍', slot: '躯干' }],
    })
    await expect(inv.sectionTitle('装备')).toBeVisible()
    await expect(inv.sectionTitle('物品')).toHaveCount(0)
  })

  test('只有物品，无装备', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    await inv.showInventory({
      items: [{ name: '金币袋', quantity: 42, description: '42枚金币' }],
    })
    await expect(inv.sectionTitle('装备')).toHaveCount(0)
    await expect(inv.itemRow('金币袋')).toContainText('×42')
  })

  test('更新覆盖：第二次 showInventory 清空旧内容', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    await inv.showInventory({ items: [{ name: '旧物品A' }] })
    await expect(inv.itemRow('旧物品A')).toBeVisible()

    await inv.showInventory({ items: [{ name: '新物品B' }] })
    await expect(inv.itemRow('旧物品A')).toHaveCount(0)
    await expect(inv.itemRow('新物品B')).toBeVisible()
  })

  test('HTML 转义：物品名含 <script> 不会注入', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    const xss = '<img src=x onerror=alert(1)>'
    await inv.showInventory({ items: [{ name: xss, quantity: 1 }] })
    const html = await inv.panelBody().innerHTML()
    // 原始尖括号应被转义
    expect(html).not.toContain('<img src=x onerror')
    // 文本里能看到转义后的内容
    expect(html).toMatch(/&lt;img|&amp;lt;img/)
  })

  test('closePanel 后再 open → 状态正确', async ({ page }) => {
    const inv = new InventoryPage(page)
    await inv.boot()
    await inv.showInventory({ items: [{ name: '道具' }] })
    await expect(inv.page.locator('#panel-sheet.open')).toHaveCount(1)
    await inv.closePanel()
    await expect(inv.page.locator('#panel-sheet.open')).toHaveCount(0)
    // 重新打开
    await inv.showInventory({ items: [{ name: '新道具' }] })
    await expect(inv.page.locator('#panel-sheet.open')).toHaveCount(1)
    await expect(inv.itemRow('新道具')).toBeVisible()
  })
})
