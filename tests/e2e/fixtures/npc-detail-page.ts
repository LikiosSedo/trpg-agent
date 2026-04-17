import { Page } from '@playwright/test'

// NPC 详情卡沙盒 —— 链路：handleWsMessage({type:'panel', panel:'npc_detail'}) → renderNPCDetailPanel
// 关键断言：
//   - 名字 / 头衔 渲染
//   - 信任度指针位置（trust -10~+10 → 0%~100%）
//   - 立绘有/无时的 fallback
//   - 已知情报按 category 分组
//   - 未解锁情报提示（locked > 0）

export interface NPCFact { fact: string; category?: string }
export interface NPCDetailPayload {
  name: string
  key?: string
  title?: string
  trust?: number
  appearance?: string
  discovered?: NPCFact[]
  locked?: number
}

export class NPCDetailPage {
  constructor(public page: Page) {}

  async boot() {
    await this.page.goto('/')
    await this.page.waitForFunction(() => typeof (window as any).renderNPCDetailPanel === 'function', null, {
      timeout: 10_000,
    })
    await this.page.evaluate(() => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) { game.style.display = 'flex'; game.style.flexDirection = 'column' }
    })
  }

  async show(data: NPCDetailPayload) {
    await this.page.evaluate((d) => {
      const fn = (window as any).handleWsMessage
      fn({ data: JSON.stringify({ type: 'panel', panel: 'npc_detail', title: '人物详情', data: d }) })
    }, data)
    await this.page.locator('#panel-sheet.open').waitFor()
  }

  panelBody() { return this.page.locator('#panel-body') }
  trustPointer() { return this.panelBody().locator('div[style*="background:#e6b800"]') }
  trustText() { return this.panelBody().locator('span:has-text("信任度")') }
  sectionTitle(text: string) { return this.panelBody().locator('.panel-card-title', { hasText: text }) }
  factItem(fact: string) { return this.panelBody().locator('.recap-item.clue', { hasText: fact }) }

  /** 读信任度指针的 left 百分比（渲染后算出） */
  async getTrustPointerLeft(): Promise<string> {
    return this.trustPointer().evaluate((el) => (el as HTMLElement).style.left)
  }

  async screenshotNPC(name: string) {
    await this.page.addStyleTag({
      content: `
        #login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar { display: none !important; }
        body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; }
        #panel-sheet { position: static !important; max-height: none !important; transform: none !important; }
      `,
    })
    await this.page.locator('#panel-sheet').screenshot({ path: `tests/e2e/screenshots/${name}.png`, scale: 'device' })
  }
}
