# 战棋 UI 沙盒测试

Playwright 端到端测试，覆盖战棋 (combat grid) 前端的渲染、交互、边界、移动端布局。

## 设计理念

**沙盒模式**：不走 WebSocket，不登录，直接在浏览器里调 `window.initCombatGrid(scenario)` 把 UI 推到任意预设状态。这样每个测试用例都是独立的"积木"，可以自由组合场景 + 交互 + 断言。

**端口 3008**：测试专用，绝不碰主游戏会话的 3000 端口。`playwright.config.ts` 里 `webServer` 会自动启动 `PORT=3008 tsx src/server.ts`。

## 跑测试

```bash
npm run test:e2e                # 跑全部（headless）
npm run test:e2e:headed         # 带浏览器窗口看着跑
npm run test:e2e:ui             # Playwright UI 模式（交互式调试）

# 单 spec
npx playwright test tests/e2e/specs/grid-init.spec.ts

# 单测试
npx playwright test -g "基础场景渲染"

# 看报告
npx playwright show-report tests/e2e/report
```

## 目录结构

```
tests/e2e/
├── fixtures/
│   ├── scenarios.ts            # 战棋场景积木（basic / wall / boss / ranged / lowHp / crowded / mobile）
│   ├── grid-page.ts            # GridPage：战棋 UI 封装
│   ├── actions-page.ts         # ActionsPage：场景选项 (SetActions) UI 封装
│   ├── inventory-page.ts       # InventoryPage：背包面板封装
│   └── combat-panel-page.ts    # CombatPanelPage：旧战斗面板（非网格）封装
├── specs/
│   ├── grid-init.spec.ts           # 战棋初始化 + 渲染（6）
│   ├── grid-interactions.spec.ts   # 战棋点击/mode/取消/shake（6）
│   ├── grid-edge-cases.spec.ts     # 战棋 spawn 边界/pending/清理（6）
│   ├── grid-mobile.spec.ts         # 战棋移动端（2）
│   ├── scene-actions.spec.ts       # SetActions 渲染/点击/主线/details/持久化（8）
│   ├── inventory.spec.ts           # 背包装备/物品/数量/空态/HTML 转义（7）
│   ├── combat-panel.spec.ts        # 旧战斗面板 攻击/法术/物品/防御/逃跑 selector（12）
│   └── vrt.spec.ts                 # 视觉回归 baseline（6）
├── screenshots/                    # 手动审查用截图（gitignore）
├── specs/*.spec.ts-snapshots/      # VRT baseline（提交）
└── report/                         # HTML 报告（gitignore）
```

**共 47 个 e2e spec + 6 张 VRT baseline + 25 个单测（trust-system）+ 既有后端测试。**

## VRT 工作流

```bash
# 首次生成/重置基线
npx playwright test tests/e2e/specs/vrt.spec.ts --update-snapshots

# 常规对比
npx playwright test tests/e2e/specs/vrt.spec.ts

# 失败后查看 diff（打开 HTML 报告）
npx playwright show-report tests/e2e/report
```

## 加新场景

1. 在 `fixtures/scenarios.ts` 里导出一个返回 `GridScenario` 的函数
2. 在 spec 里 `import` 并 `await g.boot(yourScenario())`

例：测 2×2 boss 占位：
```ts
export function twoByTwoBossScenario(): GridScenario {
  return { width: 7, height: 5, terrain: emptyTerrain(),
    units: [
      { id: 'player', side: 'player', pos: { x: 1, y: 2 }, moveSpeed: 3, attackRange: 1 },
      // boss 占 (5,1)(6,1)(5,2)(6,2) —— 未来设计
      { id: 'boss', side: 'enemy', pos: { x: 5, y: 1 }, moveSpeed: 1, attackRange: 1, hp: 80, maxHp: 80 },
    ]
  }
}
```

## 加新交互

`GridPage` 暴露了：
- `boot(scenario)` — 初始化 UI
- `cell(x,y)`, `unit(id)`, `btnAttack/Move/Defend/Flee/Spell()` — locator
- `getMode()`, `getPending()` — 读前端运行时变量
- `pushWsMessage(msg)` — 模拟后端推送（`combat_grid_move`, `combat_grid_death`, `combat_grid_end` 等）
- `simulateSpawn(unit)` — 重现 `combat_grid_spawn` 的边界检查逻辑
- `expectCellClass(x,y,cls,yes?)` — 断言 CSS class
- `screenshot(name)` — 落盘到 `tests/e2e/screenshots/`

## 常见坑

- **CI 环境**：`playwright.config.ts` 的 `webServer.reuseExistingServer = !process.env.CI`。本地会复用已起的 3008；CI 会每次新启。
- **登录门槛**：`GridPage.boot()` 会强制把 `#game-screen` 设为 flex、隐藏 `#login-screen`，不需要真正登录。
- **`let` vs `function`**：前端 `let gridMode` 不挂 `window`，要通过 `eval()` 读；`function initCombatGrid` 挂 `window`，直接调。
- **并发**：`fullyParallel = false`，因为所有测试共享同一 server（3008），并发会导致 state 污染。单 worker 顺序跑即可。

## 未来扩展

- [ ] 视觉回归测试 (VRT)：用 `screenshot()` 落盘基线后加 `toHaveScreenshot()` 对比
- [ ] 真 WS 模式：有的场景需要验证服务端回传的序列化正确，可以切 `baseURL + 真登录` 流程
- [ ] a11y 测试：加 `@axe-core/playwright` 扫色盲/对比度/键盘导航
- [ ] 动画时序：引入 `fake timers` 或 `page.clock` 断言 600ms 死亡动画时序
