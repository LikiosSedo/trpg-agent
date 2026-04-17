import { test, expect } from '@playwright/test'
import { QuestHintPage } from '../fixtures/quest-hint-page.js'

test.describe('主线任务条', () => {
  test('基础渲染：章节 + 目标 + 进度点', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({
      chapter: 'Ch1',
      objective: '收集 3 个线索',
      progress: '1/3',
      action: '前往酒馆询问格雷格',
    })
    await expect(q.bar()).toHaveClass(/show/)
    await expect(q.chapter()).toHaveText('Ch1')
    await expect(q.objective()).toHaveText('收集 3 个线索')
    await expect(q.progress()).toContainText('1/3')
    // 进度点：3 个总，1 个 filled
    await expect(q.dots()).toHaveCount(3)
    await expect(q.filledDots()).toHaveCount(1)
    await q.screenshotQuest('95-quest-basic')
  })

  test('进度 0/3 → 3 个空点', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: '开始', progress: '0/3' })
    await expect(q.dots()).toHaveCount(3)
    await expect(q.filledDots()).toHaveCount(0)
  })

  test('进度 3/3 → 全填满', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: '完成', progress: '3/3' })
    await expect(q.dots()).toHaveCount(3)
    await expect(q.filledDots()).toHaveCount(3)
    await q.screenshotQuest('96-quest-complete')
  })

  test('进度 5/10 → 5 填 5 空', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch2', objective: '长流程', progress: '5/10' })
    await expect(q.dots()).toHaveCount(10)
    await expect(q.filledDots()).toHaveCount(5)
  })

  test('hint=null → 隐藏（show class 被移除）', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: '目标', progress: '1/3' })
    await expect(q.bar()).toHaveClass(/show/)
    await q.update(null)
    await expect(q.bar()).not.toHaveClass(/show/)
  })

  test('hint.objective 为空 → 隐藏', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: '目标', progress: '1/3' })
    await expect(q.bar()).toHaveClass(/show/)
    await q.update({ chapter: 'Ch1' }) // 无 objective
    await expect(q.bar()).not.toHaveClass(/show/)
  })

  test('点击任务条 → hint.action 填入 #input，不自动发送', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({
      chapter: 'Ch1', objective: '询问格雷格', progress: '0/1',
      action: '和格雷格谈谈瘟疫的事',
    })
    await q.bar().click()
    await expect(page.locator('#input')).toHaveValue('和格雷格谈谈瘟疫的事')
    // 输入框获得焦点
    const focused = await page.evaluate(() => document.activeElement?.id)
    expect(focused).toBe('input')
  })

  test('无 action → 点击条不填任何内容', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    // 先放点其他内容在 input
    await page.locator('#input').fill('旧内容')
    await q.update({ chapter: 'Ch1', objective: '目标', progress: '0/1' })
    await q.bar().click()
    await expect(page.locator('#input')).toHaveValue('旧内容')
  })

  test('长 objective 不溢出容器', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({
      chapter: 'Ch3',
      objective: '深入暮色森林寻找失踪的守护者之印并带回破晓镇交给艾琳娜女士',
      progress: '0/1',
    })
    const barBox = await q.bar().boundingBox()
    const vpWidth = page.viewportSize()!.width
    expect(barBox!.width).toBeLessThanOrEqual(vpWidth)
    await q.screenshotQuest('97-quest-long-objective')
  })

  test('progress 格式异常 ("abc/xyz") → 0 dots', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: 'X', progress: 'abc/xyz' })
    // parseInt 解析失败 → NaN，for 循环 i < NaN = false → 0 dots
    await expect(q.dots()).toHaveCount(0)
  })

  test('progress 缺省 → 默认 "0/0" → 0 dots', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: 'X' })
    await expect(q.dots()).toHaveCount(0)
  })

  test('重复 update → 内容更新，不累积', async ({ page }) => {
    const q = new QuestHintPage(page)
    await q.boot()
    await q.update({ chapter: 'Ch1', objective: '旧目标', progress: '1/2' })
    await q.update({ chapter: 'Ch2', objective: '新目标', progress: '0/5' })
    await expect(q.objective()).toHaveText('新目标')
    await expect(q.chapter()).toHaveText('Ch2')
    await expect(q.dots()).toHaveCount(5)
  })
})
