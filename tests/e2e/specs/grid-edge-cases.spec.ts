import { test, expect } from '@playwright/test'
import { GridPage } from '../fixtures/grid-page.js'
import { baseScenario } from '../fixtures/scenarios.js'

test.describe('边界 & 错误态', () => {
  test('spawn 坐标越界 → 拒绝 + console.warn（P0#2）', async ({ page }) => {
    const g = new GridPage(page)
    const warns: string[] = []
    page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()) })

    await g.boot(baseScenario())

    // 注入 spawn with 非法坐标
    await g.pushWsMessage({
      type: 'combat_grid_spawn',
      unit: { id: 'bad', side: 'enemy', pos: { x: -1, y: 10 }, moveSpeed: 2, attackRange: 1, hp: 5, maxHp: 5 },
    })
    await page.waitForTimeout(100)

    // 非法单位不应被渲染
    await expect(g.unit('bad')).toHaveCount(0)
    expect(warns.some((w) => w.includes('spawn ignored'))).toBe(true)
  })

  test('spawn 合法坐标 → 成功渲染 + 日志', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.pushWsMessage({
      type: 'combat_grid_spawn',
      unit: { id: 'spider_1', side: 'enemy', pos: { x: 4, y: 1 }, moveSpeed: 2, attackRange: 1, name: '蛛卵', hp: 3, maxHp: 3 },
    })
    await expect(g.unit('spider_1')).toBeVisible()
    const log = await g.page.locator('#combat-grid-log').textContent()
    expect(log).toContain('蛛卵')
    expect(log).toContain('出现')
    await g.screenshotGrid('20-spawn-valid')
  })

  test('重复 spawn 同 id → 不会造成重复渲染', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    const unit = { id: 'dupe', side: 'enemy', pos: { x: 4, y: 1 }, moveSpeed: 2, attackRange: 1, hp: 3, maxHp: 3 }
    await g.pushWsMessage({ type: 'combat_grid_spawn', unit })
    await g.pushWsMessage({ type: 'combat_grid_spawn', unit })
    const count = await g.unit('dupe').count()
    expect(count).toBe(1)
  })

  test('防御按钮 disable 后 pending → 超时前不可再点', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.installWsMock()
    await g.btnDefend().click()
    expect(await g.getPending()).toBe(true)
    // 所有按钮 disabled
    await expect(g.btnAttack()).toBeDisabled()
    await expect(g.btnMove()).toBeDisabled()
    await expect(g.btnDefend()).toBeDisabled()
    // ws.send 被调用了一次，带 grid_defend
    const sent = await g.getWsSent()
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('grid_defend')
  })

  test('combat_grid_end 事件 → 清理 UI + 重置 pending', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.installWsMock()
    await g.btnDefend().click()
    expect(await g.getPending()).toBe(true)

    await g.pushWsMessage({ type: 'combat_grid_end', result: 'victory', loot: { gold: 10 } })
    await page.waitForTimeout(150)
    await expect(g.page.locator('#combat-grid-container.active')).toHaveCount(0)
    expect(await g.getPending()).toBe(false)
    await g.screenshot('21-combat-end-cleanup')
  })

  test('pending=true 时点击网格无响应（debounce 保护）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.setPending(true)
    await g.btnMove().click()
    // mode 应该还是 idle，不该切到 move
    expect(await g.getMode()).toBe('idle')
  })
})
