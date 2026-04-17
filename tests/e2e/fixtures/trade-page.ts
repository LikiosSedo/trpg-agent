import { Page } from '@playwright/test'

// 交易卡片沙盒 —— window.showTradeProposal 直调
// 卡片渲染到 #messages 内，关键逻辑：
//   - items/totalPrice/canBargain 输入
//   - playerGold 从 getSavedSession()?.player?.gold 读取 → 我们 override 此函数
//   - canAfford = playerGold >= totalPrice 决定确认按钮 disabled
//   - 点击按钮 → ws.send(trade_execute/trade_cancel)

export interface TradeItem {
  name: string
  quantity?: number
  price: number
}
export interface TradePayload {
  npc?: string
  items: TradeItem[]
  totalPrice?: number
  canBargain?: boolean
}

export class TradePage {
  constructor(public page: Page) {}

  async boot(playerGold = 100) {
    await this.page.goto('/')
    await this.page.waitForFunction(() => typeof (window as any).showTradeProposal === 'function', null, {
      timeout: 10_000,
    })
    await this.page.evaluate((gold) => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) { game.style.display = 'flex'; game.style.flexDirection = 'column' }
      // Override getSavedSession：注入可控的 playerGold
      ;(window as any).getSavedSession = () => ({ player: { gold } })
      // Mock ws
      ;(window as any).__wsSent = []
      eval(`ws = { send: function(d) { window.__wsSent.push(d) }, readyState: 1 }`)
    }, playerGold)
  }

  async show(payload: TradePayload) {
    await this.page.evaluate((p) => (window as any).showTradeProposal(p), payload as any)
    await this.card().waitFor()
  }

  card() { return this.page.locator('.trade-proposal-card') }
  header() { return this.page.locator('.trade-proposal-header') }
  itemRow(name: string) { return this.page.locator('.trade-item-row', { hasText: name }) }
  total() { return this.page.locator('.trade-proposal-total') }
  balance() { return this.page.locator('.trade-proposal-balance') }
  btnConfirm() { return this.page.locator('.trade-btn-confirm') }
  btnCancel()  { return this.page.locator('.trade-btn-cancel') }
  btnBargain() { return this.page.locator('.trade-btn-bargain') }

  async getWsSent(): Promise<any[]> {
    const raw = await this.page.evaluate(() => (window as any).__wsSent ?? [])
    return (raw as string[]).map((s) => { try { return JSON.parse(s) } catch { return s } })
  }

  async screenshotTrade(name: string) {
    await this.page.addStyleTag({
      content: `
        #login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; }
        body { background: linear-gradient(180deg, #1a1530 0%, #0a0812 100%) !important; }
        #messages { padding: 24px !important; max-width: 520px; margin: 0 auto; }
      `,
    })
    await this.card().screenshot({ path: `tests/e2e/screenshots/${name}.png`, scale: 'device' })
  }
}
