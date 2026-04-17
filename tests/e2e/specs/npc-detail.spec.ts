import { test, expect } from '@playwright/test'
import { NPCDetailPage } from '../fixtures/npc-detail-page.js'

test.describe('NPC 详情卡', () => {
  test('基础渲染：名字 + 头衔 + 信任度条 + 立绘 fallback', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({
      name: '格雷格',
      title: '破晓镇酒馆老板',
      trust: 3,
    })
    await expect(n.panelBody()).toContainText('格雷格')
    await expect(n.panelBody()).toContainText('破晓镇酒馆老板')
    await expect(n.panelBody()).toContainText('+3')
    // 指针位置：trust=3 → (3+10)/20 = 65%
    expect(await n.getTrustPointerLeft()).toBe('65%')
    await n.screenshotNPC('80-npc-basic')
  })

  test('信任度 +10 上限 → 指针 100%', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({ name: '挚友', trust: 10 })
    expect(await n.getTrustPointerLeft()).toBe('100%')
    await expect(n.panelBody()).toContainText('+10')
    await n.screenshotNPC('81-npc-trust-max')
  })

  test('信任度 -10 下限 → 指针 0%', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({ name: '死敌', trust: -10 })
    expect(await n.getTrustPointerLeft()).toBe('0%')
    await expect(n.panelBody()).toContainText('-10')
    await n.screenshotNPC('82-npc-trust-min')
  })

  test('信任度 0 → 指针居中 50%，显示 "0"（无 + 号）', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({ name: '路人', trust: 0 })
    expect(await n.getTrustPointerLeft()).toBe('50%')
    const txt = await n.panelBody().textContent()
    expect(txt).toMatch(/信任度:\s*0/)
    // 0 不应显示为 "+0"
    expect(txt).not.toMatch(/\+0/)
  })

  test('外貌描述渲染到独立 panel-card', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({
      name: '艾琳娜',
      trust: 5,
      appearance: '银发，锐利的蓝眼睛，总是穿着深蓝色法师袍',
    })
    await expect(n.sectionTitle('外貌')).toBeVisible()
    await expect(n.panelBody()).toContainText('银发，锐利的蓝眼睛')
  })

  test('已知情报按 category 分组渲染', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({
      name: '小莉',
      trust: 5,
      discovered: [
        { fact: '孤女，父母在瘟疫中去世', category: '背景' },
        { fact: '喜欢糖果', category: '喜好' },
        { fact: '害怕打雷', category: '喜好' },
      ],
    })
    await expect(n.sectionTitle('已知情报')).toBeVisible()
    await expect(n.factItem('孤女')).toBeVisible()
    await expect(n.factItem('喜欢糖果')).toBeVisible()
    await expect(n.factItem('害怕打雷')).toBeVisible()
    // 分组标题存在
    await expect(n.panelBody().getByText('背景', { exact: true })).toBeVisible()
    await expect(n.panelBody().getByText('喜好', { exact: true })).toBeVisible()
    await n.screenshotNPC('83-npc-facts-grouped')
  })

  test('未分类情报落到"其他"组', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({
      name: '陌生人',
      trust: 1,
      discovered: [{ fact: '行踪神秘' }],
    })
    await expect(n.panelBody().getByText('其他', { exact: true })).toBeVisible()
  })

  test('locked > 0 显示未解锁提示', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({
      name: '艾琳娜', trust: 3,
      discovered: [{ fact: '公会长', category: '身份' }],
      locked: 4,
    })
    await expect(n.panelBody()).toContainText('还有 4 条情报未解锁')
    // 锁图标存在
    await expect(n.panelBody().locator('i.ra.ra-locked-fortress')).toHaveCount(1)
  })

  test('locked = 0 不显示未解锁提示', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({ name: '格雷格', trust: 10, locked: 0 })
    await expect(n.panelBody()).not.toContainText('还有')
    await expect(n.panelBody()).not.toContainText('未解锁')
  })

  test('空 data.name → 显示 "未找到" 提示', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    await n.show({ name: '' } as any)
    await expect(n.panelBody()).toContainText('未找到')
  })

  test('HTML 转义：名字/外貌/情报含 <script> 不注入', async ({ page }) => {
    const n = new NPCDetailPage(page)
    await n.boot()
    const xss = '<img src=x onerror=1>'
    await n.show({
      name: xss,
      title: xss,
      trust: 0,
      appearance: xss,
      discovered: [{ fact: xss, category: xss }],
    })
    const html = await n.panelBody().innerHTML()
    expect(html).not.toContain('<img src=x onerror')
    expect(html).toMatch(/&lt;img/)
  })
})
