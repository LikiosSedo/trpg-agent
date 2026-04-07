#!/usr/bin/env node
/**
 * fetch-assets.mjs — 下载并解压 trpg-agent 的资源包
 *
 * 由 npm install 通过 postinstall 钩子触发，也可以手动 `npm run fetch-assets`。
 *
 * 工作流程：
 *   1. 读 assets-manifest.json
 *   2. 对每个 pack，如果 verifyPath 文件已存在且不是 --force 模式 → skip
 *   3. 否则：从 url 流式下载到临时文件 → sha256 校验 → 系统 tar 解压
 *
 * 设计原则：
 *   - 0 第三方依赖（纯 Node 内置 + 系统 tar）
 *   - 失败不阻塞 npm install（postinstall 永远 exit 0），只打 warning
 *   - SKIP_ASSETS=1 环境变量可完全跳过（供 dev 不需要资源时）
 *   - --force 强制重新下载所有 pack
 *
 * 见 README.md "资源" 章节。
 */

import { readFile, stat, unlink } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST_PATH = join(ROOT, 'assets-manifest.json')

const argv = new Set(process.argv.slice(2))
const FORCE = argv.has('--force')
const QUIET = argv.has('--quiet')
const SKIP = process.env.SKIP_ASSETS === '1' || process.env.SKIP_ASSETS === 'true'

// ─── 严格模式 ────────────────────────────────────────────
//
// 严格模式下，任何 pack 失败 → exit 1，让 build/CI/deploy 整体失败、触发告警。
// 非严格模式（默认 / 本地 dev）→ exit 0，只打 warning，不打断 npm install。
//
// 触发严格模式的条件（任一）:
//   1. 显式开关 STRICT_ASSETS=1
//   2. RENDER=true   ← Render 平台自动设置，部署时一定开严格
//   3. CI=true       ← Render / GitHub Actions / GitLab / CircleCI 等通用 CI 标志
//
// 设计目的：本地开发不希望网络抖动打断 npm install，但 production 部署必须
// 在 fetch 失败时立刻 fail 而不是"build 成功 but 容器启动后 mp3 全 404"。
const STRICT =
  process.env.STRICT_ASSETS === '1' ||
  process.env.STRICT_ASSETS === 'true' ||
  process.env.RENDER === 'true' ||
  process.env.CI === 'true'

function log(...args) {
  if (!QUIET) console.log('[fetch-assets]', ...args)
}
function warn(...args) {
  console.warn('[fetch-assets]', ...args)
}

if (STRICT) {
  log(`严格模式 ON (RENDER=${process.env.RENDER ?? '-'} CI=${process.env.CI ?? '-'} STRICT_ASSETS=${process.env.STRICT_ASSETS ?? '-'})`)
}

if (SKIP) {
  log('SKIP_ASSETS 已设置，跳过资源下载。游戏可以启动但 BGM/立绘可能缺失。')
  process.exit(0)
}

let manifest
try {
  manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'))
} catch (err) {
  warn(`读取 ${MANIFEST_PATH} 失败：${err.message}`)
  if (STRICT) {
    warn('严格模式下 manifest 不可读 → exit 1')
    process.exit(1)
  }
  warn('postinstall 退出 0，npm install 继续。')
  process.exit(0)
}

let allOk = true
for (const pack of manifest.packs ?? []) {
  try {
    await fetchPack(pack)
  } catch (err) {
    warn(`pack "${pack.name}" 失败：${err.message}`)
    allOk = false
  }
}

if (!allOk) {
  warn('')
  warn('部分资源未能下载。')
  if (STRICT) {
    warn('严格模式下 deploy 必须 fail，否则容器启动后 mp3/png 全部 404。')
    warn('排查方向：')
    warn('  1. 检查 GitHub release 是否还在: https://github.com/LikiosSedo/trpg-agent/releases')
    warn('  2. 确认 manifest sha256 与 release asset 一致')
    warn('  3. 检查网络/防火墙是否能访问 github.com')
    process.exit(1)
  }
  warn('游戏可以启动但 BGM/立绘可能缺失。')
  warn('网络好转后可手动重试：')
  warn('    npm run fetch-assets')
  warn('    npm run fetch-assets -- --force   # 强制重新下载')
  // 非严格模式不阻塞 npm install
  process.exit(0)
}

log('✓ 所有资源就绪')

// ─── functions ──────────────────────────────────────────

async function fetchPack(pack) {
  // 已存在则跳过（除非 --force）
  if (!FORCE && pack.verifyPath) {
    const verifyAbs = join(ROOT, pack.verifyPath)
    try {
      await stat(verifyAbs)
      log(`${pack.name}: 跳过（${pack.verifyPath} 已存在；--force 强制重下）`)
      return
    } catch {
      /* 文件不存在，继续下载 */
    }
  }

  log(`${pack.name}: 下载中 ${formatSize(pack.size)} ← ${pack.url}`)
  const tmpFile = join(ROOT, `.fetch-${pack.name}.tar.gz`)

  // 用全局 fetch（Node 18+ 内置）流式下载到临时文件
  const res = await fetch(pack.url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} ← ${pack.url}`)
  }
  if (!res.body) {
    throw new Error(`response body 为空 ← ${pack.url}`)
  }

  const out = createWriteStream(tmpFile)
  try {
    await pipeline(Readable.fromWeb(res.body), out)
  } catch (err) {
    await unlink(tmpFile).catch(() => {})
    throw new Error(`下载流失败：${err.message}`)
  }

  // sha256 校验
  const actual = await sha256OfFile(tmpFile)
  if (actual !== pack.sha256) {
    await unlink(tmpFile).catch(() => {})
    throw new Error(
      `sha256 不匹配。\n  期望: ${pack.sha256}\n  实际: ${actual}\n  ` +
      `(可能是 release 被替换或下载损坏，请检查 manifest 与 release tag 是否一致)`
    )
  }
  log(`${pack.name}: sha256 ✓`)

  // 系统 tar 解压
  await runTar(['xzf', tmpFile, '-C', ROOT])
  await unlink(tmpFile).catch(() => {})
  log(`${pack.name}: 解压完成`)
}

async function sha256OfFile(path) {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', (err) => reject(new Error(`系统 tar 启动失败：${err.message}`)))
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar 退出码 ${code}`))
    })
  })
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
