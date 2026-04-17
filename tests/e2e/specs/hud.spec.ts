import { test, expect } from '@playwright/test'
import { HUDPage } from '../fixtures/hud-page.js'

test.describe('顶部 HUD', () => {
  test('基础渲染：HP/金币/时间/位置', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({
      player: { hp: 18, maxHp: 20, gold: 42 },
      worldState: { timeOfDay: 'morning', currentLocation: 'dawnbreak-town' },
    })
    await expect(h.hpEl()).toContainText('18/20')
    await expect(h.goldEl()).toContainText('42')
    await expect(h.timeEl()).toContainText('晨')
    await expect(h.locEl()).toContainText('破晓镇')
    await h.screenshotHUD('90-hud-basic')
  })

  test('HP > 50% → 绿色', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({ player: { hp: 15, maxHp: 20, gold: 0 } })
    const color = await h.getHpColor()
    expect(color).toMatch(/rgb\(76,\s*175,\s*80\)|#4caf50/)
  })

  test('HP 25-50% → 橙色 (low)', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({ player: { hp: 8, maxHp: 20, gold: 0 } })
    const color = await h.getHpColor()
    expect(color).toMatch(/rgb\(255,\s*152,\s*0\)|#ff9800/)
  })

  test('HP ≤ 25% → 红色 (critical)', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({ player: { hp: 4, maxHp: 20, gold: 0 } })
    const color = await h.getHpColor()
    expect(color).toMatch(/rgb\(244,\s*67,\s*54\)|#f44336/)
    await h.screenshotHUD('91-hud-hp-critical')
  })

  test('HP = 0 → 红色 + 渲染"0/N"', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({ player: { hp: 0, maxHp: 20, gold: 10 } })
    await expect(h.hpEl()).toContainText('0/20')
  })

  test('HP/maxHp 都为 0 → 不崩溃（防零除）', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({ player: { hp: 0, maxHp: 0, gold: 0 } })
    await expect(h.hpEl()).toContainText('0/0')
    // 颜色 fallback 到绿色（hpPct=1）
    const color = await h.getHpColor()
    expect(color).toMatch(/rgb\(76,\s*175,\s*80\)|#4caf50/)
  })

  test('大数字金币 99999 正常渲染（无溢出）', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({ player: { hp: 20, maxHp: 20, gold: 99999 } })
    await expect(h.goldEl()).toContainText('99999')
    // 检查 HUD 整个不超过视口宽度
    const box = await page.locator('#player-hud').boundingBox()
    const vpWidth = page.viewportSize()!.width
    expect(box!.width).toBeLessThanOrEqual(vpWidth)
    await h.screenshotHUD('92-hud-big-gold')
  })

  test('时间四阶段图标切换', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    const phases = [
      { time: 'morning' as const, label: '晨', icon: 'ra-sunbeams' },
      { time: 'afternoon' as const, label: '午', icon: 'ra-sun' },
      { time: 'evening' as const, label: '暮', icon: 'ra-moon-sun' },
      { time: 'night' as const, label: '夜', icon: 'ra-lantern-flame' },
    ]
    for (const p of phases) {
      await h.update({
        player: { hp: 20, maxHp: 20, gold: 0 },
        worldState: { timeOfDay: p.time },
      })
      await expect(h.timeEl()).toContainText(p.label)
      await expect(h.timeEl().locator(`i.ra.${p.icon}`)).toHaveCount(1)
    }
  })

  test('未知 location → 显示"未知"', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    await h.update({
      player: { hp: 20, maxHp: 20, gold: 0 },
      worldState: { currentLocation: 'unknown-zone' as any },
    })
    await expect(h.locEl()).toContainText('未知')
  })

  test('4 个已知 location 正确映射中文', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    const locs = [
      ['dawnbreak-town', '破晓镇'],
      ['twilight-woods', '暮色森林'],
      ['greyspine-mines', '灰脊矿道'],
      ['shatterstone-wastes', '碎石荒原'],
    ]
    for (const [id, label] of locs) {
      await h.update({
        player: { hp: 20, maxHp: 20, gold: 0 },
        worldState: { currentLocation: id as any },
      })
      await expect(h.locEl()).toContainText(label)
    }
  })

  test('undefined session.player → 直接 return，HUD 不变', async ({ page }) => {
    const h = new HUDPage(page)
    await h.boot()
    // 先有个值
    await h.update({ player: { hp: 5, maxHp: 5, gold: 1 } })
    // 然后用 undefined
    await page.evaluate(() => (window as any).updateHUD({} as any))
    // HP 文本不变
    await expect(h.hpEl()).toContainText('5/5')
  })
})
