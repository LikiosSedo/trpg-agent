import { Page } from '@playwright/test'

// 场景选项 UI（SetActions 工具产物）沙盒 —— 直调 window.showSceneActions() 注入任意选项，
// 断言按钮渲染 + 点击把 suggestion 文本填入 #input 输入框。

export type SuggestionIn = string | { text: string; icon?: string; group?: string }
export interface ActionsPayload {
  details?: Array<{ label: string; content: string }>
  suggestions?: SuggestionIn[]
}

export class ActionsPage {
  constructor(public page: Page) {}

  async boot() {
    await this.page.goto('/')
    await this.page.waitForFunction(() => typeof (window as any).showSceneActions === 'function', null, {
      timeout: 10_000,
    })
    // 同 GridPage：跳过登录屏，直接展示游戏视图
    await this.page.evaluate(() => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) { game.style.display = 'flex'; game.style.flexDirection = 'column' }
      // 确保 messages 可见（showSceneActions 写到 messages 内）
      const msg = document.getElementById('messages')
      if (msg) msg.style.display = 'block'
    })
  }

  async push(payload: ActionsPayload) {
    await this.page.evaluate((p) => (window as any).showSceneActions(p), payload as any)
  }

  actionsRoot() { return this.page.locator('#messages .actions') }
  suggestionBtn(text: string) { return this.page.locator('#messages .actions .action-btn', { hasText: text }) }
  detailBtn(label: string) { return this.page.locator('#messages .actions .action-btn.detail', { hasText: label }) }
  detailExpand() { return this.page.locator('#messages .detail-expand') }
  inputBox() { return this.page.locator('#input') }

  async screenshotActions(name: string) {
    // 隐藏 chrome + 强调 actions 区域
    await this.page.addStyleTag({
      content: `
        #login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container { display: none !important; }
        body { background: linear-gradient(180deg, #1a1530 0%, #0a0812 100%) !important; }
        #messages { padding: 24px !important; }
        .actions { background: rgba(20, 15, 30, 0.7); padding: 16px; border-radius: 10px; border: 1px solid rgba(100, 80, 160, 0.25); box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
      `,
    })
    const loc = this.page.locator('#messages')
    await loc.screenshot({ path: `tests/e2e/screenshots/${name}.png`, scale: 'device' })
  }
}
