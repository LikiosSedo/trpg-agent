import { test, expect } from '@playwright/test'
import { GridPage } from '../fixtures/grid-page.js'
import { baseScenario, bossScenario, lowHpScenario } from '../fixtures/scenarios.js'

// 动画关键帧冻结截图 —— 用 animation-delay 负值 + animation-play-state: paused
// 把 CSS 动画钉在特定相位（50% 峰值、shake 中点），从而肉眼/VRT 都能验证效果
//
// 技巧：animation-delay: -Xs; play-state: paused → 立刻跳到时间 X 处并停住

test.describe('动画关键帧快照', () => {
  test('Boss pulse @ 50% 峰值（最大发光）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(bossScenario())
    await g.hideChrome()
    // bossPulse 总时长 2s，50% = 1s，animation-delay: -1s 跳到峰值
    await page.addStyleTag({
      content: `
        .grid-unit.enemy.boss {
          animation: bossPulse 2s ease-in-out infinite !important;
          animation-delay: -1s !important;
          animation-play-state: paused !important;
        }
        #combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }
      `,
    })
    // 验证动画确实冻结在 1s（一半相位）
    const state = await page.locator('.grid-unit.enemy.boss').evaluate((el) => {
      const cs = getComputedStyle(el)
      return { state: cs.animationPlayState, delay: cs.animationDelay }
    })
    expect(state.state).toBe('paused')
    expect(state.delay).toBe('-1s')
    // 截图：shadow 应为峰值（box-shadow 20px rgba(255,150,0,0.8)）
    await page.locator('#combat-grid-container').screenshot({
      path: 'tests/e2e/screenshots/A0-boss-pulse-peak.png',
      scale: 'device',
    })
  })

  test('Boss pulse @ 0% 起始态（最小发光）对照', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(bossScenario())
    await g.hideChrome()
    await page.addStyleTag({
      content: `
        .grid-unit.enemy.boss { animation-play-state: paused !important; animation-delay: 0s !important; }
        #combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }
      `,
    })
    await page.locator('#combat-grid-container').screenshot({
      path: 'tests/e2e/screenshots/A1-boss-pulse-valley.png',
      scale: 'device',
    })
  })

  test('HP critical pulse @ 50%（低亮态）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(lowHpScenario())
    await g.hideChrome()
    await page.addStyleTag({
      content: `
        .grid-hp.critical {
          animation: hpCritical 1s ease-in-out infinite !important;
          animation-delay: -0.5s !important;
          animation-play-state: paused !important;
        }
        #combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }
      `,
    })
    const opacity = await page.locator('.grid-unit[data-unit-id="player"] .grid-hp').evaluate((el) => getComputedStyle(el).opacity)
    // 50% 相位的 opacity = 0.7
    expect(parseFloat(opacity)).toBeCloseTo(0.7, 1)
    await page.locator('#combat-grid-container').screenshot({
      path: 'tests/e2e/screenshots/A2-hp-critical-dim.png',
      scale: 'device',
    })
  })

  test('Shake 动画 @ 最大偏移 (+4px)', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.hideChrome()
    // cellShake 总时长 0.28s，75% = 0.21s，+4px 偏移
    await page.addStyleTag({
      content: `
        .grid-cell.invalid-click {
          animation: cellShake 0.28s ease !important;
          animation-delay: -0.21s !important;
          animation-play-state: paused !important;
          animation-fill-mode: forwards !important;
        }
        #combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }
      `,
    })
    // 触发 shake：点击不可达格
    await g.btnMove().click()
    await g.cell(6, 4).click()
    // shake 类应存在且被 CSS 冻结
    await expect(g.cell(6, 4)).toHaveClass(/invalid-click/)
    await page.locator('#combat-grid-container').screenshot({
      path: 'tests/e2e/screenshots/A3-shake-max-offset.png',
      scale: 'device',
    })
  })

  test('Reachable 高亮 + Attackable 斜纹并存（色盲友好验证）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.hideChrome()
    await g.btnAttack().click()
    await page.addStyleTag({
      content: `
        #combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }
      `,
    })
    // 敌人位置应是斜纹 attackable
    const bg = await g.cell(5, 2).evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(bg).toContain('repeating-linear-gradient')
    await page.locator('#combat-grid-container').screenshot({
      path: 'tests/e2e/screenshots/A4-attack-vs-reach.png',
      scale: 'device',
    })
  })

  test('模拟灰度/色盲滤镜：reachable vs attackable 仍可区分（靠图案）', async ({ page }) => {
    const g = new GridPage(page)
    await g.boot(baseScenario())
    await g.hideChrome()
    await g.btnAttack().click()
    // 对整个页面加灰度滤镜（模拟完全色盲）
    await page.addStyleTag({
      content: `
        body { filter: grayscale(100%) !important; }
        #combat-grid-container.active { padding: 24px !important; width: fit-content !important; margin: 24px auto !important; background: linear-gradient(180deg, rgba(25,20,40,0.65), rgba(12,10,20,0.85)) !important; border: 1px solid rgba(100,80,160,0.25); border-radius: 12px; }
      `,
    })
    // 灰度下斜纹图案依然应存在（因为 bg 是渐变色，即使灰度也会有对比）
    await expect(g.cell(5, 2)).toHaveClass(/attackable/)
    await page.locator('#combat-grid-container').screenshot({
      path: 'tests/e2e/screenshots/A5-grayscale-a11y.png',
      scale: 'device',
    })
  })
})
