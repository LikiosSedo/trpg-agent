import { Page } from '@playwright/test'

// 顶部 HUD 沙盒 —— window.updateHUD(session) 直调
// session.player.{hp,maxHp,gold}
// session.worldState.{timeOfDay, currentLocation}

export interface HUDSession {
  player: { hp: number; maxHp: number; gold: number }
  worldState?: {
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
    currentLocation?: string
  }
}

export class HUDPage {
  constructor(public page: Page) {}

  async boot() {
    await this.page.goto('/')
    await this.page.waitForFunction(() => typeof (window as any).updateHUD === 'function', null, {
      timeout: 10_000,
    })
    await this.page.evaluate(() => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) { game.style.display = 'flex'; game.style.flexDirection = 'column' }
      // 显示 HUD 栏（默认可能 display:none）
      const hud = document.getElementById('player-hud')
      if (hud) hud.style.display = ''
    })
  }

  async update(session: HUDSession) {
    await this.page.evaluate((s) => (window as any).updateHUD(s), session as any)
  }

  hpEl() { return this.page.locator('#hud-hp') }
  goldEl() { return this.page.locator('#hud-gold') }
  timeEl() { return this.page.locator('#hud-time') }
  locEl() { return this.page.locator('#hud-location') }

  async getHpColor(): Promise<string> {
    return this.hpEl().evaluate((el) => (el as HTMLElement).style.color)
  }

  async screenshotHUD(name: string) {
    await this.page.addStyleTag({
      content: `
        #login-screen, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; }
        body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; }
        #header { padding: 16px !important; }
        #player-hud { font-size: 16px !important; }
      `,
    })
    await this.page.locator('#header').screenshot({ path: `tests/e2e/screenshots/${name}.png`, scale: 'device' })
  }
}
