/**
 * 战斗演出卡片 UI 布局截图测试（Wave 1 MVP）
 *
 * 不跑真战斗(真 codex 太慢),直接 page.evaluate 调 showActorCard 模拟角色回合,
 * 截图验证:
 *   - 立绘卡片居中
 *   - side-player/enemy/ally 三色边框
 *   - intent-attack/spell/defend/move 顶部色条
 *   - fallback 图标(没有立绘时)
 *   - 移动端响应式
 *
 * 运行: npx playwright test tests/e2e/specs/battle-stage-ui.spec.ts
 *
 * 前置: server 在 3008 启动(不一定需要 codex,普通 kimi 也行)
 */

import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('战斗卡片 · 各 intent × side 组合', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('http://localhost:3008/')

  // 跳过认证/菜单,等 DOM 就绪后直接渲染卡片
  await page.waitForSelector('#battle-actor-stage', { state: 'attached', timeout: 10_000 })

  const cases: Array<{ label: string; data: any }> = [
    { label: 'player-attack', data: { actorName: '林克', side: 'player', intent: 'attack', portrait: 'portraits/pc-fighter.png' } },
    { label: 'player-spell',  data: { actorName: '莉娅', side: 'player', intent: 'spell',  portrait: 'portraits/pc-mage.png' } },
    { label: 'player-defend', data: { actorName: '林克', side: 'player', intent: 'defend', portrait: 'portraits/pc-fighter.png' } },
    { label: 'enemy-attack',  data: { actorName: 'Goblin', side: 'enemy', intent: 'attack', portrait: '' } },
    { label: 'enemy-spider',  data: { actorName: '巨型蜘蛛', side: 'enemy', intent: 'attack', portrait: 'portraits/monster-giant-spider.png' } },
    { label: 'ally-attack',   data: { actorName: '格雷格', side: 'ally', intent: 'attack', portrait: 'portraits/greg-ironfist.png' } },
  ]

  for (const c of cases) {
    await page.evaluate((d) => {
      // @ts-ignore
      window.showActorCard(d)
    }, c.data)
    // 等卡片动画稳定(battleCardSlideIn 是 400ms)
    await page.waitForTimeout(500)
    await page.screenshot({
      path: `tests/e2e/screenshots/battle-stage-${c.label}.png`,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 720 },
    })
    await page.evaluate(() => {
      // @ts-ignore
      window.hideActorCard()
    })
    await page.waitForTimeout(350)
  }
})

test('战斗卡片 · 队列串行播放时序', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('http://localhost:3008/')
  await page.waitForSelector('#battle-actor-stage', { state: 'attached', timeout: 10_000 })

  // 模拟一个完整回合序列:玩家 → Goblin A → Goblin B
  const sequence = [
    { actorName: '林克', side: 'player', intent: 'attack', portrait: 'portraits/pc-fighter.png' },
    { actorName: 'Goblin', side: 'enemy', intent: 'attack', portrait: '' },
    { actorName: 'Goblin_2', side: 'enemy', intent: 'attack', portrait: '' },
  ]

  // 模拟真实 WS 时序:show → hold → hide → next (手动调 showActorCard)
  // 每个卡片截一张,看到序列切换效果
  for (let i = 0; i < sequence.length; i++) {
    const data = sequence[i]
    await page.evaluate((d) => {
      // @ts-ignore
      window.showActorCard(d)
    }, data)
    await page.waitForTimeout(500)  // 等卡片 slide in 完成
    await page.screenshot({
      path: `tests/e2e/screenshots/battle-stage-sequence-${i}-${data.actorName}.png`,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 720 },
    })
    await page.evaluate(() => {
      // @ts-ignore
      window.hideActorCard()
    })
    await page.waitForTimeout(350)
  }
})

test('战斗卡片 · 移动端响应式', async ({ page }) => {
  test.setTimeout(30_000)
  await page.setViewportSize({ width: 390, height: 844 })  // iPhone 12
  await page.goto('http://localhost:3008/')
  await page.waitForSelector('#battle-actor-stage', { state: 'attached', timeout: 10_000 })

  await page.evaluate(() => {
    // @ts-ignore
    window.showActorCard({ actorName: '蛛母', side: 'enemy', intent: 'attack', portrait: '' })
  })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: 'tests/e2e/screenshots/battle-stage-mobile.png',
    fullPage: false,
  })
})
