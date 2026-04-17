import { test, expect } from '@playwright/test'
import { TradePage } from '../fixtures/trade-page.js'

test.describe('交易卡片 (showTradeProposal)', () => {
  test('基础渲染：商家名 + 物品列表 + 总价 + 余额 → 按钮齐全', async ({ page }) => {
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

    await expect(t.header()).toContainText('铁匠韩猛')
    await expect(t.itemRow('治疗药水')).toContainText('x3')
    await expect(t.itemRow('治疗药水')).toContainText('45 金') // 15×3
    await expect(t.itemRow('火把')).toContainText('10 金')    // 5×2
    await expect(t.total()).toContainText('55 金')
    await expect(t.balance()).toContainText('余额：100 → 45 金')
    await expect(t.balance()).toHaveClass(/affordable/)
    await expect(t.btnConfirm()).toBeEnabled()
    await expect(t.btnBargain()).toBeVisible()
    await t.screenshotTrade('70-trade-basic')
  })

  test('余额不足 → 确认按钮 disabled + balance 红色', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(10)
    await t.show({
      npc: '商人',
      items: [{ name: '稀有药水', quantity: 1, price: 50 }],
    })
    await expect(t.balance()).toHaveClass(/unaffordable/)
    await expect(t.balance()).toContainText('余额：10 → -40 金')
    await expect(t.btnConfirm()).toBeDisabled()
    await t.screenshotTrade('71-trade-insufficient')
  })

  test('单件物品（quantity=1 或未设）→ 不显示 ×N', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({
      npc: '商人',
      items: [{ name: '普通剑', price: 30 }, { name: '卷轴', quantity: 1, price: 20 }],
    })
    const row1 = await t.itemRow('普通剑').textContent()
    const row2 = await t.itemRow('卷轴').textContent()
    expect(row1).not.toContain('x1')
    expect(row2).not.toContain('x1')
  })

  test('canBargain=false → 无砍价按钮', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({
      npc: '黑市商',
      items: [{ name: '神秘物品', price: 50 }],
      canBargain: false,
    })
    await expect(t.btnBargain()).toHaveCount(0)
    await expect(t.btnConfirm()).toBeVisible()
    await expect(t.btnCancel()).toBeVisible()
  })

  test('点击确认 → 发送 trade_execute + 卡片消失 + 输入锁', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({
      npc: '铁匠', items: [{ name: '长剑', price: 40 }],
    })
    await t.btnConfirm().click()
    await expect(t.card()).toHaveCount(0)
    const sent = await t.getWsSent()
    expect(sent[0]).toMatchObject({ type: 'trade_execute', npc: '铁匠', totalPrice: 40 })
    expect(sent[0].items[0]).toMatchObject({ name: '长剑', price: 40 })
    // 输入框锁定
    const inputDisabled = await page.locator('#input').isDisabled()
    expect(inputDisabled).toBe(true)
  })

  test('点击取消 → 发送 trade_cancel + 卡片消失', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({
      npc: '商人', items: [{ name: '药水', price: 15 }],
    })
    await t.btnCancel().click()
    await expect(t.card()).toHaveCount(0)
    const sent = await t.getWsSent()
    expect(sent[0]).toMatchObject({ type: 'trade_cancel', npc: '商人' })
  })

  test('点击砍价 → 不删卡片 + 输入框可用 + placeholder 变砍价', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({
      npc: '商人', items: [{ name: '药水', price: 50 }], canBargain: true,
    })
    await t.btnBargain().click()
    // 卡片仍在
    await expect(t.card()).toHaveCount(1)
    // 输入 placeholder 改
    const ph = await page.locator('#input').getAttribute('placeholder')
    expect(ph).toContain('砍价')
    // bargainMode 标志置位
    const mode = await page.evaluate(() => (window as any)._bargainMode)
    expect(mode).toBe(true)
    // 没发任何 ws（砍价是 DM 叙事流）
    expect((await t.getWsSent()).length).toBe(0)
  })

  test('重复调用 showTradeProposal → 旧卡片被移除，不叠加', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({ npc: '第一', items: [{ name: 'A', price: 10 }] })
    await t.show({ npc: '第二', items: [{ name: 'B', price: 20 }] })
    await expect(t.card()).toHaveCount(1)
    await expect(t.header()).toContainText('第二')
  })

  test('items 里的总价 = quantity × price 自动计算（忽略 data.totalPrice）', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    // DM 传了错误的 totalPrice=999，items 算出的是 15×2+10=40
    await t.show({
      npc: '商人',
      items: [
        { name: 'X', quantity: 2, price: 15 },
        { name: 'Y', quantity: 1, price: 10 },
      ],
      totalPrice: 999,
    })
    await expect(t.total()).toContainText('40 金')
    await expect(t.total()).not.toContainText('999')
  })

  test('HTML 转义：商家名/物品名含 < > 不被注入', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    const xss = '<img src=x onerror=1>'
    await t.show({
      npc: xss,
      items: [{ name: xss, price: 10 }],
    })
    const html = await t.card().innerHTML()
    expect(html).not.toContain('<img src=x onerror')
    expect(html).toMatch(/&lt;img/)
  })

  test('长商家名 + 多个物品 → 卡片不溢出', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(500)
    await t.show({
      npc: '破晓镇首席炼金师兼药草商艾琳娜·银月',
      items: Array.from({ length: 8 }, (_, i) => ({
        name: `药剂 ${i + 1}`, quantity: 1, price: 10 + i,
      })),
      canBargain: true,
    })
    await expect(t.card()).toBeVisible()
    await expect(t.total()).toContainText('108 金') // sum 10..17 = 108
    await t.screenshotTrade('72-trade-long-name')
  })

  test('默认 npc 名："商人"（未传 npc）', async ({ page }) => {
    const t = new TradePage(page)
    await t.boot(100)
    await t.show({ items: [{ name: 'X', price: 5 }] })
    await expect(t.header()).toContainText('商人')
  })
})
