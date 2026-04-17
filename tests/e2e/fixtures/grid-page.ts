import { Page, expect } from '@playwright/test'
import type { GridScenario } from './scenarios.js'

// 封装对战棋前端的操作 —— 以"无登录、直调前端函数"的方式把 UI 推到任意状态
// 关键思想：public/index.html 的 JS 是顶层全局的，function 声明自动挂 window；
// 所以我们不需要走 WebSocket，直接 page.evaluate(() => window.initCombatGrid(...))。

export class GridPage {
  constructor(public page: Page) {}

  /** 打开主页并跳过登录门槛，直接进入"战棋就绪"状态 */
  async boot(scenario: GridScenario) {
    await this.page.goto('/')
    // 等待脚本加载完成（initCombatGrid 函数可用）
    await this.page.waitForFunction(() => typeof (window as any).initCombatGrid === 'function', null, {
      timeout: 10_000,
    })
    await this.page.waitForLoadState('domcontentloaded')
    // 登录屏遮挡 —— #game-screen 是 display:none，我们直接模拟"登录后"
    await this.page.evaluate(() => {
      const login = document.getElementById('login-screen')
      if (login) login.style.display = 'none'
      const game = document.getElementById('game-screen')
      if (game) {
        game.style.display = 'flex'
        game.style.flexDirection = 'column'
      }
    })
    // 注入场景
    await this.page.evaluate((data) => {
      ;(window as any).initCombatGrid(data)
    }, scenario as any)
    // 等网格渲染完
    await this.page.locator('#combat-grid-container.active').waitFor({ state: 'visible' })
    await this.page.locator('.grid-cell').first().waitFor({ state: 'visible' })
  }

  /** 获取某格元素 */
  cell(x: number, y: number) {
    return this.page.locator(`.grid-cell[data-x="${x}"][data-y="${y}"]`)
  }

  unit(id: string) {
    return this.page.locator(`.grid-unit[data-unit-id="${id}"]`)
  }

  /** 5 个动作按钮 */
  btnAttack() { return this.page.locator('#grid-btn-attack') }
  btnMove()   { return this.page.locator('#grid-btn-move') }
  btnDefend() { return this.page.locator('#grid-btn-defend') }
  btnFlee()   { return this.page.locator('#grid-btn-flee') }
  btnSpell()  { return this.page.locator('#grid-btn-spell') }

  /** 直接读前端当前 mode（gridMode 是 let 声明，不挂 window，得走脚本 eval） */
  async getMode(): Promise<string> {
    // eslint-disable-next-line no-eval
    return this.page.evaluate(() => eval('typeof gridMode !== "undefined" ? gridMode : "unknown"'))
  }

  /** 读 pending flag（let 声明，同上） */
  async getPending(): Promise<boolean> {
    return this.page.evaluate(() => eval('typeof gridActionPending !== "undefined" ? !!gridActionPending : false'))
  }

  /** 写 pending flag（直接赋值 let 变量，需要 eval） */
  async setPending(value: boolean) {
    await this.page.evaluate((v) => { eval(`gridActionPending = ${v ? 'true' : 'false'}`) }, value)
  }

  /** Mock ws（script 作用域里的 let，不挂 window，必须 eval 赋值） */
  async installWsMock() {
    await this.page.evaluate(() => {
      ;(window as any).__wsSent = []
      eval(`ws = { send: function(data) { window.__wsSent.push(data) }, readyState: 1 }`)
    })
  }

  async getWsSent(): Promise<string[]> {
    return this.page.evaluate(() => (window as any).__wsSent ?? [])
  }

  /** 模拟后端 spawn 事件（直接调 handleWsMessage 不现实，就走直接 push） */
  async simulateSpawn(unit: any) {
    await this.page.evaluate((u) => {
      // 复现 handleWsMessage 里 combat_grid_spawn 的分支逻辑
      const gs = (window as any).gridState
      if (!gs || !u || !u.pos) return
      const { x, y } = u.pos
      const valid = Number.isInteger(x) && Number.isInteger(y)
        && x >= 0 && x < gs.width && y >= 0 && y < gs.height
      if (!valid) { (window as any).__lastSpawnIgnored = true; return }
      if (gs.units.find((z: any) => z.id === u.id)) return
      gs.units.push(u)
      ;(window as any).renderCombatGrid()
    }, unit)
  }

  /** 触发 WS 消息：直接调 handleWsMessage 模拟后端推送 */
  async pushWsMessage(msg: any) {
    await this.page.evaluate((m) => {
      const fn = (window as any).handleWsMessage
      if (typeof fn === 'function') fn({ data: JSON.stringify(m) })
    }, msg)
  }

  /** 截整个 viewport（1280×720） —— 背景可能含登录屏残留 */
  async screenshot(name: string) {
    await this.page.screenshot({
      path: `tests/e2e/screenshots/${name}.png`,
      fullPage: false,
    })
  }

  /** 只截战棋区域（网格 + 日志 + 按钮条），2x DPR，Chrome 全部隐藏 —— 视觉审查主力 */
  async screenshotGrid(name: string) {
    await this.hideChrome()
    // container 自适应内容宽度 + 居中 + 足够 padding，locator.screenshot 即为紧凑截图
    await this.page.addStyleTag({
      content: `
        #combat-grid-container.active {
          padding: 24px 28px !important;
          gap: 12px !important;
          width: fit-content !important;
          margin: 24px auto !important;
          background: linear-gradient(180deg, rgba(25, 20, 40, 0.65) 0%, rgba(12, 10, 20, 0.85) 100%) !important;
          border: 1px solid rgba(100, 80, 160, 0.25);
          border-radius: 12px;
          box-shadow: 0 4px 32px rgba(0, 0, 0, 0.6);
        }
        .combat-grid-log { width: 100%; max-width: 420px; }
        .grid-actions { width: 100%; }
      `,
    })
    const locator = this.page.locator('#combat-grid-container')
    await locator.waitFor({ state: 'visible' })
    await locator.screenshot({
      path: `tests/e2e/screenshots/${name}.png`,
      scale: 'device',
      omitBackground: false,
    })
  }

  /** 把登录屏/主标题/HUD 等非战棋元素全部隐藏，让战斗成为焦点 */
  async hideChrome() {
    await this.page.addStyleTag({
      content: `
        #login-screen, #header, #quest-hint-bar, #bgm-toast,
        #combat-hud, #combat-panel, #messages,
        #chud-party, #chud-enemies, #input-container,
        .chud-player, .chud-enemies { display: none !important; }
        body { background: radial-gradient(ellipse at center, #1a1530 0%, #0a0812 70%) !important; }
        #game-screen { padding-top: 20px !important; }
      `,
    })
  }

  /** 当前有多少个 grid-cell 在 DOM 里 */
  async cellCount(): Promise<number> {
    return this.page.locator('.grid-cell').count()
  }

  /** 断言某格有某个 class */
  async expectCellClass(x: number, y: number, cls: string, yes = true) {
    const hasClass = await this.cell(x, y).evaluate((el, c) => el.classList.contains(c), cls)
    expect(hasClass, `cell(${x},${y}) should ${yes ? 'have' : 'not have'} class ${cls}`).toBe(yes)
  }
}
