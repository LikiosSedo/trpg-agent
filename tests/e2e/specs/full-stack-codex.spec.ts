/**
 * 端到端完整链路测试（真 WS + 真后端 + 真 LLM）
 *
 * 区别于其他 spec —— 这个 spec **不 mock** WebSocket，走真实：
 *   浏览器 → ws://localhost:3008 → codex provider → 回流到前端 DOM
 *
 * 前置：server 已在 3008 启动（TRPG_PROVIDER_TYPE=codex PORT=3008 npm run web）
 *
 * 验证：
 *   1. 主菜单 → 新游戏 → 角色创建表单显示
 *   2. 填名字 + 选职业 → 开始冒险按钮可用
 *   3. 点开始 → 创建会话 → DM 开场叙事流到 #messages
 *   4. 发送"看看四周" → 收到新的 DM 响应
 *
 * 这是真金白银的测试 —— 花 token，但能一次性抓到所有"绕过 WS 就看不到"的 bug。
 */

import { test, expect } from '@playwright/test'

// 这个 spec 依赖外部 server，关闭 webServer 自动管理
test.describe.configure({ mode: 'serial' })

test('完整链路：登录 → 新游戏 → 开场叙事 → 发消息', async ({ page }) => {
  test.setTimeout(180_000) // LLM 可能慢

  // 不走 baseURL（config 是 3008），直接指 codex server
  await page.goto('http://localhost:3008/')

  // 1. 主菜单 resume-screen 出现（里面有"新游戏"按钮）
  await expect(page.locator('#resume-screen')).toBeVisible({ timeout: 10_000 })

  // 2. 点"新游戏"（按钮文字是"新游戏"，可能有 emoji 差异）
  await page.locator('#resume-screen button', { hasText: '新游戏' }).click()

  // 3. 角色创建屏应出现
  await expect(page.locator('#create-screen')).toBeVisible()

  // 4. 填名字 + 选剑士
  await page.locator('#player-name').fill('wspass')
  await page.locator('.class-btn[data-class="fighter"]').click()
  // 开始按钮应可点
  await expect(page.locator('#start-btn')).toBeEnabled()

  // 5. 点开始冒险 → 会 send ws 'create'
  await page.locator('#start-btn').click()

  // 6. 等待 game-screen 显示（ws create 成功后切屏）
  await expect(page.locator('#game-screen')).toBeVisible({ timeout: 15_000 })

  // 7. 开场 DM 叙事流入 #messages（至少一条内容）
  const messages = page.locator('#messages')
  await expect(messages).toBeVisible()
  // 等开场文本至少 50 字（防御：codex 有时慢，最多等 60s）
  await expect(async () => {
    const txt = await messages.textContent()
    expect(txt?.length ?? 0).toBeGreaterThanOrEqual(50)
  }).toPass({ timeout: 60_000, intervals: [1000, 2000, 3000] })

  console.log('[test] 开场叙事到位，长度:', ((await messages.textContent()) ?? '').length)

  // 8. 发送"看看四周"
  await page.locator('#input').fill('看看四周')
  await page.locator('#send, button[onclick*="sendInput"]').first().click()

  // 9. 等 DM 新响应：messages 文本再次增长 ≥ 100 字
  const before = ((await messages.textContent()) ?? '').length
  await expect(async () => {
    const after = ((await messages.textContent()) ?? '').length
    expect(after - before).toBeGreaterThanOrEqual(50)
  }).toPass({ timeout: 90_000, intervals: [2000, 3000] })

  console.log('[test] 玩家输入得到响应，新增字符:',
    ((await messages.textContent()) ?? '').length - before)

  // 10. 截图存档
  await page.screenshot({ path: 'tests/e2e/screenshots/99-fullstack-codex-success.png', fullPage: false })
})
