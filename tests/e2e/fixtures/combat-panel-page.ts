import { Page } from '@playwright/test'

// 旧战斗面板沙盒（#combat-panel: 攻击/法术/物品/防御/逃跑）
// 这是非战棋战斗（不走 combat_grid_* 事件的场景）的 UI 入口
// 核心函数：combatAttack/Spell/Item/Defend/Flee → sendCombatAction → ws.send
// 关键 let 变量（script 作用域，不挂 window，需 eval）：
//   combatTargets, combatSpells, combatItems, combatSelectedTarget, sending

export interface CombatTarget {
  id: string; name: string; hp: number; maxHp: number
}
export interface CombatSpell {
  name: string; isBuff?: boolean; isCantrip?: boolean; remaining?: number; max?: number
}
export interface CombatItem {
  name: string; desc?: string
}

export class CombatPanelPage {
  constructor(public page: Page) {}

  async boot() {
    await this.page.goto('/')
    await this.page.waitForFunction(() => typeof (window as any).sendCombatAction === 'function', null, {
      timeout: 10_000,
    })
    await this.page.evaluate(() => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) { game.style.display = 'flex'; game.style.flexDirection = 'column' }
      // 显示 combat-panel（默认可能隐藏）
      const cp = document.getElementById('combat-panel')
      if (cp) cp.style.display = 'block'
    })
    await this.installWsMock()
  }

  /** mock script-scope `ws` + `sending`，记录 send 调用 */
  async installWsMock() {
    await this.page.evaluate(() => {
      ;(window as any).__wsSent = []
      eval(`ws = { send: function(d) { window.__wsSent.push(d) }, readyState: 1 }`)
      eval(`sending = false`)
    })
  }

  async setState(opts: {
    targets?: CombatTarget[]
    spells?: CombatSpell[]
    items?: CombatItem[]
    selectedTargetId?: string
  }) {
    await this.page.evaluate((o) => {
      if (o.targets !== undefined) eval(`combatTargets = ${JSON.stringify(o.targets)}`)
      if (o.spells !== undefined) eval(`combatSpells = ${JSON.stringify(o.spells)}`)
      if (o.items !== undefined) eval(`combatItems = ${JSON.stringify(o.items)}`)
      if (o.selectedTargetId !== undefined) eval(`combatSelectedTarget = ${JSON.stringify(o.selectedTargetId)}`)
    }, opts as any)
  }

  async resetSending() {
    await this.page.evaluate(() => eval(`sending = false`))
  }

  async getWsSent(): Promise<any[]> {
    const raw = await this.page.evaluate(() => (window as any).__wsSent ?? [])
    return (raw as string[]).map((s) => {
      try { return JSON.parse(s) } catch { return s }
    })
  }

  async clearWsSent() {
    await this.page.evaluate(() => { (window as any).__wsSent = [] })
  }

  selector() { return this.page.locator('#combat-selector.show') }
  selectorTitle() { return this.page.locator('#combat-selector .combat-selector-title') }
  selectorItem(text: string) {
    return this.page.locator('#combat-selector .combat-selector-item', { hasText: text })
  }

  btnAttack() { return this.page.locator('#btn-attack') }
  btnSpell() { return this.page.locator('#btn-spell') }
  btnItem() { return this.page.locator('#btn-item') }
  btnDefend() { return this.page.locator('#btn-defend') }
  btnFlee() { return this.page.locator('#btn-flee') }

  async screenshotPanel(name: string) {
    await this.page.addStyleTag({
      content: `
        #login-screen, #header, #quest-hint-bar, #bgm-toast, #combat-hud, #combat-grid-container, #messages, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; }
        body { background: linear-gradient(180deg, #1a1530 0%, #0a0812 100%) !important; }
        #combat-panel { position: static !important; padding: 24px !important; }
      `,
    })
    const loc = this.page.locator('#combat-panel')
    await loc.screenshot({ path: `tests/e2e/screenshots/${name}.png`, scale: 'device' })
  }
}
