import { Page } from '@playwright/test'

// 库存面板沙盒 —— 走 handleWsMessage({type:'panel', panel:'inventory', data:...})
// 链路：panel case → renderInventoryPanel(data) → openPanel('inventory', title, html)
// 测试：装备区、物品区、数量 ×N、空背包、更新覆盖

export interface InvItem {
  name: string
  quantity?: number
  description?: string
  type?: string
}
export interface InvEquip {
  name: string
  slot?: string
  type?: string
}
export interface InventoryPayload {
  items?: InvItem[]
  equipment?: InvEquip[]
}

export class InventoryPage {
  constructor(public page: Page) {}

  async boot() {
    await this.page.goto('/')
    await this.page.waitForFunction(() => typeof (window as any).openPanel === 'function', null, {
      timeout: 10_000,
    })
    await this.page.evaluate(() => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) { game.style.display = 'flex'; game.style.flexDirection = 'column' }
    })
  }

  /** 打开库存面板（走 WS 消息分派，最接近真实调用路径） */
  async showInventory(data: InventoryPayload) {
    await this.page.evaluate((d) => {
      const fn = (window as any).handleWsMessage
      fn({ data: JSON.stringify({ type: 'panel', panel: 'inventory', title: '背包', data: d }) })
    }, data)
    await this.page.locator('#panel-sheet.open').waitFor()
  }

  panelTitle() { return this.page.locator('#panel-title') }
  panelBody() { return this.page.locator('#panel-body') }
  itemRow(name: string) {
    return this.page.locator('#panel-body .item-row', { hasText: name })
  }
  sectionTitle(text: string) {
    return this.page.locator('#panel-body .panel-card-title', { hasText: text })
  }
  async closePanel() {
    await this.page.evaluate(() => (window as any).closePanel())
  }

  async screenshotPanel(name: string) {
    await this.page.addStyleTag({
      content: `
        #login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar { display: none !important; }
        body { background: linear-gradient(180deg, #1a1530 0%, #0a0812 100%) !important; }
        #panel-sheet { position: static !important; max-height: none !important; transform: none !important; }
      `,
    })
    const loc = this.page.locator('#panel-sheet')
    await loc.screenshot({ path: `tests/e2e/screenshots/${name}.png`, scale: 'device' })
  }
}
