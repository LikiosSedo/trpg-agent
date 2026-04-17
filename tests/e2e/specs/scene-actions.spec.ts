import { test, expect } from '@playwright/test'
import { ActionsPage } from '../fixtures/actions-page.js'

test.describe('场景选项 SetActions', () => {
  test('基础渲染：3 个 suggestion 按钮', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({ suggestions: ['搜索周围', '查看尸体', '继续前进'] })

    await expect(a.actionsRoot()).toBeVisible()
    await expect(a.suggestionBtn('搜索周围')).toBeVisible()
    await expect(a.suggestionBtn('查看尸体')).toBeVisible()
    await expect(a.suggestionBtn('继续前进')).toBeVisible()
    await a.screenshotActions('40-actions-basic')
  })

  test('点击建议 → 文本填入 #input 输入框（不直接发送）', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({ suggestions: ['询问艾琳娜关于瘟疫的事'] })

    await a.suggestionBtn('询问艾琳娜关于瘟疫的事').click()
    await expect(a.inputBox()).toHaveValue('询问艾琳娜关于瘟疫的事')
    // selected 状态
    await expect(a.suggestionBtn('询问艾琳娜关于瘟疫的事')).toHaveClass(/selected/)
  })

  test('主线任务 (★ 前缀) 有特殊 class 和交叉剑 icon', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({ suggestions: ['★ 寻找守护者之印', '其他动作'] })

    const questBtn = a.suggestionBtn('寻找守护者之印')
    await expect(questBtn).toHaveClass(/action-btn-quest/)
    // ra-crossed-swords icon 在按钮里
    await expect(questBtn.locator('i.ra.ra-crossed-swords')).toHaveCount(1)
    // ★ 前缀被剥离（显示的是"寻找守护者之印"而不是"★ 寻找守护者之印"）
    const txt = await questBtn.textContent()
    expect(txt?.trim()).not.toContain('★')
    await a.screenshotActions('41-actions-quest')
  })

  test('object 格式 suggestion + icon 渲染', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({
      suggestions: [
        { text: '购买治疗药水', icon: 'ra-potion' },
        { text: '询问价格', icon: 'ra-chat-bubble' },
        '随便看看',
      ],
    })
    await expect(a.suggestionBtn('购买治疗药水').locator('i.ra.ra-potion')).toHaveCount(1)
    await expect(a.suggestionBtn('询问价格').locator('i.ra.ra-chat-bubble')).toHaveCount(1)
    // 纯字符串不含 i 元素
    await expect(a.suggestionBtn('随便看看').locator('i')).toHaveCount(0)
    await a.screenshotActions('42-actions-icons')
  })

  test('details 按钮展开：点一次显示内容 + 按钮变灰', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({
      details: [{ label: '查看地图', content: '这张地图显示了破晓镇的五个主要建筑...' }],
      suggestions: ['继续前进'],
    })

    const btn = a.detailBtn('查看地图')
    await expect(btn).toBeVisible()
    await btn.click()
    await expect(a.detailExpand()).toHaveText(/这张地图显示了破晓镇/)
    await expect(btn).toHaveClass(/disabled/)
    // 再点一次 onclick=null 不触发额外展开
    await btn.click({ force: true }).catch(() => {})
    await expect(a.detailExpand()).toHaveCount(1)
    await a.screenshotActions('43-actions-detail-expand')
  })

  test('重复调用 → 旧 actions 被移除，不叠加', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({ suggestions: ['第一批 A', '第一批 B'] })
    await a.push({ suggestions: ['第二批 X', '第二批 Y'] })
    // 只有第二批存在
    await expect(a.actionsRoot()).toHaveCount(1)
    await expect(a.suggestionBtn('第一批 A')).toHaveCount(0)
    await expect(a.suggestionBtn('第二批 X')).toBeVisible()
  })

  test('空 suggestions + 非空 details：只渲染 details 行', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    await a.push({ details: [{ label: '任务日志', content: '当前任务：...' }] })
    await expect(a.detailBtn('任务日志')).toBeVisible()
    // suggestion 按钮数 = 0
    const sugCount = await a.page.locator('#messages .action-btn:not(.detail)').count()
    expect(sugCount).toBe(0)
  })

  test('localStorage 持久化：actions 被保存', async ({ page }) => {
    const a = new ActionsPage(page)
    await a.boot()
    const payload = { suggestions: ['恢复测试'] }
    await a.push(payload)
    const saved = await page.evaluate(() => localStorage.getItem('trpg_last_actions'))
    expect(saved).toBeTruthy()
    const parsed = JSON.parse(saved!)
    expect(parsed.suggestions).toEqual(['恢复测试'])
  })
})
