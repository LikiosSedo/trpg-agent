import { test, expect } from '@playwright/test'
import { CombatPanelPage } from '../fixtures/combat-panel-page.js'

test.describe('旧战斗面板（非网格）', () => {
  test('单敌人 → 点攻击直接发送，不弹 selector', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({
      targets: [{ id: 'goblin_1', name: '哥布林', hp: 8, maxHp: 8 }],
    })
    await c.page.evaluate(() => (window as any).combatAttack())
    await expect(c.selector()).toHaveCount(0)
    const sent = await c.getWsSent()
    expect(sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ type: 'combat_action', action: 'attack', targetId: 'goblin_1' })
  })

  test('多敌人 → 弹 selector 列出全部 + 取消项', async ({ page }) => {
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
    await expect(c.selector()).toBeVisible()
    await expect(c.selectorTitle()).toHaveText('选择目标')
    await expect(c.selectorItem('灰狼')).toBeVisible()
    await expect(c.selectorItem('恶狼')).toContainText('HP 5/11')
    await expect(c.selectorItem('取消')).toBeVisible()
    await c.screenshotPanel('60-combat-target-selector')
  })

  test('selector 点击目标 → 发送 attack + selector 关闭', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({
      targets: [
        { id: 'wolf_1', name: '灰狼', hp: 11, maxHp: 11 },
        { id: 'wolf_2', name: '恶狼', hp: 5, maxHp: 11 },
      ],
    })
    await c.page.evaluate(() => (window as any).combatAttack())
    await c.selectorItem('恶狼').click()
    await expect(c.selector()).toHaveCount(0)
    const sent = await c.getWsSent()
    expect(sent[0]).toMatchObject({ action: 'attack', targetId: 'wolf_2' })
  })

  test('selector 点击取消 → 不发送 + selector 关闭', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({
      targets: [
        { id: 'a', name: 'A', hp: 10, maxHp: 10 },
        { id: 'b', name: 'B', hp: 10, maxHp: 10 },
      ],
    })
    await c.page.evaluate(() => (window as any).combatAttack())
    await c.selectorItem('取消').click()
    await expect(c.selector()).toHaveCount(0)
    expect((await c.getWsSent()).length).toBe(0)
  })

  test('已选中目标 + 多敌人 → 跳过 selector 直接攻击', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({
      targets: [
        { id: 'wolf_1', name: '灰狼', hp: 11, maxHp: 11 },
        { id: 'wolf_2', name: '恶狼', hp: 5, maxHp: 11 },
      ],
      selectedTargetId: 'wolf_2',
    })
    await c.page.evaluate(() => (window as any).combatAttack())
    await expect(c.selector()).toHaveCount(0)
    const sent = await c.getWsSent()
    expect(sent[0]).toMatchObject({ action: 'attack', targetId: 'wolf_2' })
  })

  test('无可用法术 → 提示而不发送', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({ targets: [{ id: 'a', name: 'A', hp: 8, maxHp: 8 }], spells: [] })
    await c.page.evaluate(() => (window as any).combatSpell())
    await expect(c.selector()).toHaveCount(0)
    expect((await c.getWsSent()).length).toBe(0)
    // 消息里应该看到提示（messages 内）
    const messages = await c.page.locator('#messages').textContent()
    expect(messages).toContain('没有可用的法术')
  })

  test('选择增益法术 → 直接施放（不选目标）', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({
      targets: [{ id: 'a', name: 'A', hp: 8, maxHp: 8 }],
      spells: [
        { name: 'Shield of Faith', isBuff: true, isCantrip: false, remaining: 2, max: 4 },
        { name: 'Fire Bolt', isBuff: false, isCantrip: true },
      ],
    })
    await c.page.evaluate(() => (window as any).combatSpell())
    await expect(c.selectorTitle()).toHaveText('选择法术')
    await expect(c.selectorItem('Shield of Faith')).toContainText('增益')
    await expect(c.selectorItem('Fire Bolt')).toContainText('攻击')
    await c.selectorItem('Shield of Faith').click()
    // 增益 → 直接发送，不弹第二个 selector
    await expect(c.selector()).toHaveCount(0)
    const sent = await c.getWsSent()
    expect(sent[0]).toMatchObject({ action: 'spell', spellId: 'Shield of Faith' })
    await c.screenshotPanel('61-combat-spell-list')
  })

  test('攻击法术 + 多敌人 → 两级 selector（先选法术再选目标）', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({
      targets: [
        { id: 'a', name: 'A', hp: 8, maxHp: 8 },
        { id: 'b', name: 'B', hp: 8, maxHp: 8 },
      ],
      spells: [{ name: 'Fire Bolt', isBuff: false, isCantrip: true }],
    })
    await c.page.evaluate(() => (window as any).combatSpell())
    await c.selectorItem('Fire Bolt').click()
    await expect(c.selectorTitle()).toHaveText('选择目标')
    await c.selectorItem('B').click()
    const sent = await c.getWsSent()
    expect(sent[0]).toMatchObject({ action: 'spell', spellId: 'Fire Bolt', targetId: 'b' })
  })

  test('无可用物品 → 提示', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({ items: [] })
    await c.page.evaluate(() => (window as any).combatItem())
    await expect(c.selector()).toHaveCount(0)
    const messages = await c.page.locator('#messages').textContent()
    expect(messages).toContain('没有可用的物品')
  })

  test('防御 → 直接发送 action=defend', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.page.evaluate(() => (window as any).combatDefend())
    const sent = await c.getWsSent()
    expect(sent[0]).toMatchObject({ action: 'defend' })
  })

  test('逃跑 → 直接发送 action=flee', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.page.evaluate(() => (window as any).combatFlee())
    const sent = await c.getWsSent()
    expect(sent[0]).toMatchObject({ action: 'flee' })
  })

  test('sending=true 时再点攻击 → 被拒绝', async ({ page }) => {
    const c = new CombatPanelPage(page)
    await c.boot()
    await c.setState({ targets: [{ id: 'a', name: 'A', hp: 8, maxHp: 8 }] })
    await c.page.evaluate(() => (window as any).combatAttack())
    expect((await c.getWsSent()).length).toBe(1)
    // 不 reset sending → 再点不发
    await c.page.evaluate(() => (window as any).combatAttack())
    expect((await c.getWsSent()).length).toBe(1)
  })
})
