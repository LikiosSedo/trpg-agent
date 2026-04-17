import { defineConfig, devices } from '@playwright/test'

// 战棋 UI 沙盒测试配置
// 端口 3008（用户授权的测试端口，绝不碰 3000 生产会话）
// 启动方式：tsx src/server.ts 以 PORT=3008 起一个独立实例
export default defineConfig({
  testDir: './tests/e2e/specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // 共享 server，顺序跑避免状态污染
  reporter: [['list'], ['html', { outputFolder: 'tests/e2e/report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3008',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 760, height: 900 },
        deviceScaleFactor: 2, // 2x DPR → 截图更清晰
      },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        isMobile: false,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'PORT=3008 DISABLE_ANTHROPIC=1 tsx src/server.ts',
    url: 'http://localhost:3008',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
