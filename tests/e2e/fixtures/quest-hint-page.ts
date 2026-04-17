import { Page } from '@playwright/test'

// 主线任务条沙盒 —— updateQuestHint(hint)
// hint = { chapter, objective, progress: "N/M", action? }
// 点击条 → 把 hint.action 填入 #input

export interface QuestHint {
  chapter?: string
  objective?: string
  progress?: string
  action?: string
}

export class QuestHintPage {
  constructor(public page: Page) {}

  async boot() {
    await this.page.goto('/')
    await this.page.waitForFunction(() => typeof (window as any).updateQuestHint === 'function', null, {
      timeout: 10_000,
    })
    await this.page.evaluate(() => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) { game.style.display = 'flex'; game.style.flexDirection = 'column' }
    })
  }

  async update(hint: QuestHint | null | undefined) {
    await this.page.evaluate((h) => (window as any).updateQuestHint(h), hint as any)
  }

  bar() { return this.page.locator('#quest-hint-bar') }
  chapter() { return this.page.locator('#quest-hint-chapter') }
  objective() { return this.page.locator('#quest-hint-objective') }
  progress() { return this.page.locator('#quest-hint-progress') }
  dots() { return this.page.locator('#quest-hint-progress .dot') }
  filledDots() { return this.page.locator('#quest-hint-progress .dot.filled') }

  async screenshotQuest(name: string) {
    await this.page.addStyleTag({
      content: `
        #login-screen, #header, #bgm-toast, #combat-hud, #combat-panel, #combat-grid-container, #messages, #input-container, #tab-bar, #panel-sheet, #panel-overlay { display: none !important; }
        body { background: linear-gradient(180deg,#1a1530,#0a0812) !important; padding-top: 20px; }
        #quest-hint-bar { max-width: 520px; margin: 24px auto !important; }
      `,
    })
    await this.bar().screenshot({ path: `tests/e2e/screenshots/${name}.png`, scale: 'device' })
  }
}
