#!/usr/bin/env node
/**
 * publish-assets.mjs — 一键发布资源到 GitHub Release
 *
 * 把"改完 mp3 → 部署到 Render"的流程从 6 步压缩到 2 步:
 *
 *   npm run publish-assets        # 一条命令完成所有机械步骤
 *   git commit -am "assets: ..."  # 你只决定要不要提交
 *
 * 这个脚本会做的事:
 *   1. 读 assets-manifest.json，自动推算下一个版本号 (v1 → v2)
 *   2. 用固定的 tar 命令打包 audio-pack 和 portraits-pack 到 /tmp
 *   3. 计算 sha256
 *   4. 用 gh CLI 在 GitHub 创建新 release 上传 tarball
 *   5. 重写 assets-manifest.json (version / release / 每个 pack 的 url+sha256+size)
 *   6. 显示 git diff assets-manifest.json
 *   7. 不自动 git commit/push —— 你最后决定
 *
 * 用法:
 *   npm run publish-assets                       # 自动 next version
 *   npm run publish-assets -- --version v5       # 显式指定版本
 *   npm run publish-assets -- --dry-run          # 只打包计算 sha,不上传不改 manifest
 *   npm run publish-assets -- --notes "..."      # 自定义 release notes
 *   npm run publish-assets -- --skip-clean-check # 跳过 working tree 清洁性检查
 *
 * 前置:
 *   - gh CLI 已安装并 gh auth login
 *   - public/audio/ 和 public/portraits/ 是当前要发布的状态
 */

import { readFile, writeFile, stat, unlink, readdir } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST_PATH = join(ROOT, 'assets-manifest.json')
const FILELIST_PATH = join(ROOT, 'assets-filelist.json')

// ─── pack 配置（与 fetch-assets 解压结构对称）──────────
//
// 每个 pack 是一个 tarball，从 ROOT 打包，解压回 ROOT。
// tarExcludes 用 tar --exclude，把 .md 文档留在 git 里。
const PACKS_CONFIG = [
  {
    name: 'audio',
    sourceDir: 'public/audio',
    tarExcludes: ['*.md'],
  },
  {
    name: 'portraits',
    sourceDir: 'public/portraits',
    tarExcludes: ['*.md'],
  },
]

// ─── 解析参数 ──────────────────────────────────────────

const argv = process.argv.slice(2)
const opts = {
  version: null,
  dryRun: false,
  notes: null,
  skipCleanCheck: false,
}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--version') opts.version = argv[++i]
  else if (a === '--dry-run') opts.dryRun = true
  else if (a === '--notes') opts.notes = argv[++i]
  else if (a === '--skip-clean-check') opts.skipCleanCheck = true
  else if (a === '--help' || a === '-h') {
    console.log(`用法: node scripts/publish-assets.mjs [options]
  --version vN          显式指定版本（不指定则自动 +1）
  --dry-run             只打包+计算 sha，不上传不改 manifest
  --notes "..."         自定义 release notes
  --skip-clean-check    跳过 git 工作区清洁性检查
  -h, --help            显示帮助`)
    process.exit(0)
  } else {
    console.error(`未知参数: ${a}`)
    process.exit(2)
  }
}

// ─── 工具 ──────────────────────────────────────────────

function log(...args) {
  console.log('[publish-assets]', ...args)
}
function warn(...args) {
  console.warn('[publish-assets]', ...args)
}
function die(msg) {
  console.error(`[publish-assets] ✗ ${msg}`)
  process.exit(1)
}

function run(cmd, args, { capture = false, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    encoding: 'utf-8',
  })
  if (res.error) {
    if (allowFail) return { ok: false, stdout: '', stderr: res.error.message }
    die(`${cmd} 启动失败: ${res.error.message}`)
  }
  if (res.status !== 0) {
    if (allowFail) return { ok: false, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
    die(`${cmd} ${args.join(' ')} 退出码 ${res.status}\n${res.stderr ?? ''}`)
  }
  return { ok: true, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

async function sha256OfFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function bumpVersion(v) {
  // v1 → v2, v12 → v13
  const m = v.match(/^v(\d+)$/)
  if (!m) die(`不能识别的 version 格式: ${v}（期望 vN，例如 v1、v2）`)
  return `v${parseInt(m[1], 10) + 1}`
}

// ─── 前置检查 ──────────────────────────────────────────

log('开始发布流程')

// gh CLI 可用？
const ghCheck = run('gh', ['auth', 'status'], { capture: true, allowFail: true })
if (!ghCheck.ok) {
  die('gh CLI 未安装或未认证。请先 `brew install gh && gh auth login`')
}
log('✓ gh CLI 可用')

// 读 manifest
let manifest
try {
  manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'))
} catch (err) {
  die(`读 ${MANIFEST_PATH} 失败: ${err.message}`)
}

const oldVersion = manifest.version
const newVersion = opts.version ?? bumpVersion(oldVersion)
const newRelease = `assets-${newVersion}`

log(`版本: ${oldVersion} → ${newVersion} (release tag: ${newRelease})`)

// 检查 working tree 是否干净（资源相关）
if (!opts.skipCleanCheck) {
  const status = run('git', ['status', '--porcelain', 'public/audio', 'public/portraits'], { capture: true })
  if (status.stdout.trim()) {
    warn('public/audio 或 public/portraits 工作区有未提交改动:')
    console.warn(status.stdout)
    warn('这通常是好事 —— 你正在打包未提交的新资源。但如果是误改请先 reset。')
    warn('继续？(--skip-clean-check 可跳过此提示)')
  }
}

// 检查 release 是否已存在
const existCheck = run('gh', ['release', 'view', newRelease], { capture: true, allowFail: true })
if (existCheck.ok) {
  die(`release ${newRelease} 已存在。请用 --version 指定下一个未用的版本号。`)
}
log(`✓ release ${newRelease} 不存在，可以创建`)

// ─── 打包 + sha + 文件清单 ────────────────────────────

const builtPacks = []  // { name, version, tmpFile, sha256, size, fileList }
for (const cfg of PACKS_CONFIG) {
  const tarFile = `/tmp/${cfg.name}-pack-${newVersion}.tar.gz`
  log(`打包 ${cfg.name} → ${tarFile}`)

  // 验证 sourceDir 存在
  try {
    await stat(join(ROOT, cfg.sourceDir))
  } catch {
    die(`${cfg.sourceDir} 不存在，无法打包`)
  }

  // 扫描 sourceDir 生成 fileList（path + size）
  // 用于 verify-assets / pre-commit hook 检测漏 publish 的资源改动
  const fileList = await scanPackFiles(cfg.sourceDir, cfg.tarExcludes)
  log(`  ${cfg.name}: 扫描到 ${fileList.length} 个文件`)

  // 删旧的同名 tarball（防止上次中断的残留）
  await unlink(tarFile).catch(() => {})

  // tar czf <out> --exclude=... <source>
  const tarArgs = ['czf', tarFile]
  for (const ex of cfg.tarExcludes) {
    tarArgs.push(`--exclude=${ex}`)
  }
  tarArgs.push(cfg.sourceDir)

  run('tar', tarArgs)

  // 算 sha256 + size
  const sha = await sha256OfFile(tarFile)
  const { size } = await stat(tarFile)
  const sizeMb = (size / 1024 / 1024).toFixed(1)
  log(`  ${cfg.name}: ${sizeMb} MB, sha256=${sha.slice(0, 16)}...`)

  builtPacks.push({
    name: cfg.name,
    tmpFile: tarFile,
    sha256: sha,
    size,
    fileList,
  })
}

// ─── dry-run 在这里停止 ────────────────────────────────

if (opts.dryRun) {
  log('--dry-run: 不上传，不改 manifest')
  log('打包结果:')
  for (const p of builtPacks) {
    console.log(`  ${p.name}: ${p.tmpFile}  sha256=${p.sha256}`)
  }
  log('删除临时文件...')
  for (const p of builtPacks) await unlink(p.tmpFile).catch(() => {})
  log('✓ dry-run 完成')
  process.exit(0)
}

// ─── gh release create ────────────────────────────────

log(`创建 release ${newRelease} 并上传 ${builtPacks.length} 个 pack...`)

const notes = opts.notes ?? defaultNotes(newVersion, builtPacks)
const ghArgs = [
  'release', 'create', newRelease,
  '--title', `Assets ${newVersion}`,
  '--notes', notes,
]
for (const p of builtPacks) ghArgs.push(p.tmpFile)

const ghResult = run('gh', ghArgs, { capture: true, allowFail: true })
if (!ghResult.ok) {
  warn('gh release create 失败:')
  console.error(ghResult.stderr)
  log('保留 tarball 以便重试: ')
  for (const p of builtPacks) console.log(`  ${p.tmpFile}`)
  process.exit(1)
}
log(`✓ release 已创建: ${ghResult.stdout.trim()}`)

// ─── 拉取真实 download URL ────────────────────────────

const assetsJson = run('gh', [
  'release', 'view', newRelease,
  '--json', 'assets',
  '--jq', '.assets[] | {name: .name, url: .url, size: .size}',
], { capture: true })

const remoteAssets = assetsJson.stdout
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

// 把 remoteAssets 按 name 索引
const urlByName = new Map()
for (const a of remoteAssets) urlByName.set(a.name, a.url)

// ─── 重写 manifest ────────────────────────────────────

const newManifest = { ...manifest, version: newVersion, release: newRelease }

// 写 manifest（不含 fileList，保持 manifest 小巧）
newManifest.packs = manifest.packs.map((oldPack) => {
  const built = builtPacks.find((b) => b.name === oldPack.name)
  if (!built) {
    warn(`manifest 里有 pack "${oldPack.name}" 但 PACKS_CONFIG 没定义，保持原样`)
    return oldPack
  }
  const tarFileName = `${oldPack.name}-pack-${newVersion}.tar.gz`
  const url = urlByName.get(tarFileName)
  if (!url) die(`找不到上传后的 ${tarFileName} URL，release 可能损坏`)
  // 移除任何旧版残留的 fileList 字段（前一版方案曾把 fileList 写在 manifest 里）
  const { fileList: _drop, ...rest } = oldPack
  return {
    ...rest,           // 保留 verifyPath 等字段，丢掉 fileList
    url,
    sha256: built.sha256,
    size: built.size,
  }
})

await writeFile(MANIFEST_PATH, JSON.stringify(newManifest, null, 2) + '\n')
log(`✓ assets-manifest.json 已更新（不含 fileList）`)

// 写 filelist 单独文件（让 git diff manifest 时不被 1600 行 fileList 淹没）
const fileListData = {
  version: newVersion,
  description: '资源文件清单 — 由 publish-assets / verify-assets 维护。verify-assets 用它做 path+size 对比。manifest 故意不内嵌此清单，以保持 git diff 干净。',
  packs: builtPacks.map((b) => ({
    name: b.name,
    fileList: b.fileList,
  })),
}
await writeFile(FILELIST_PATH, JSON.stringify(fileListData, null, 2) + '\n')
log(`✓ assets-filelist.json 已更新（${builtPacks.reduce((n, b) => n + b.fileList.length, 0)} 个文件）`)

// ─── 清理临时文件 ──────────────────────────────────────

for (const p of builtPacks) await unlink(p.tmpFile).catch(() => {})

// ─── 显示 diff + 提示 ──────────────────────────────────

console.log()
log('manifest 改动:')
const diff = run('git', ['diff', '--no-color', MANIFEST_PATH], { capture: true })
console.log(diff.stdout || '(无 diff，可能 manifest 未追踪)')

console.log()
log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
log('下一步: review 上面的 diff，如果 OK 就提交 + 推送:')
log('')
log(`    git add assets-manifest.json`)
log(`    git commit -m "assets: bump to ${newVersion}"`)
log(`    git push`)
log('')
log('Auto-Deploy 触发后 Render 会自动拉新 release。')
log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

// ─── 资源扫描（生成 fileList）────────────────────────
//
// 扫描 sourceDir 下所有非 excludes 文件，返回 [{path, size}] 数组（按 path 字典序）。
// 这份清单写入 manifest.packs[].fileList，供 verify-assets / pre-commit hook 检测
// "改了资源但忘了 publish" 的场景。

async function scanPackFiles(sourceDir, tarExcludes) {
  const result = []
  const sourceAbs = join(ROOT, sourceDir)

  // 把 tarExcludes（如 ['*.md']）展开成简单的 fnmatch 谓词
  const isExcluded = (filename) => {
    for (const pat of tarExcludes) {
      // 当前只支持 *.ext 这种 glob，避免引入 minimatch
      if (pat.startsWith('*.')) {
        const ext = pat.slice(1)
        if (filename.endsWith(ext)) return true
      } else if (filename === pat) {
        return true
      }
    }
    return false
  }

  async function walk(curAbs, curRel) {
    let entries
    try {
      entries = await readdir(curAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const childAbs = join(curAbs, ent.name)
      const childRel = curRel ? `${curRel}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        await walk(childAbs, childRel)
      } else if (ent.isFile()) {
        if (isExcluded(ent.name)) continue
        const st = await stat(childAbs)
        result.push({ path: `${sourceDir}/${childRel}`, size: st.size })
      }
    }
  }

  await walk(sourceAbs, '')
  result.sort((a, b) => a.path.localeCompare(b.path))
  return result
}

// ─── 默认 release notes ──────────────────────────────

function defaultNotes(version, packs) {
  const lines = [
    `Asset pack ${version} for trpg-agent.`,
    '',
    'Contents:',
  ]
  for (const p of packs) {
    const sizeMb = (p.size / 1024 / 1024).toFixed(1)
    lines.push(`- **${p.name}-pack-${version}.tar.gz** — ${sizeMb} MB`)
    lines.push(`  - sha256: \`${p.sha256}\``)
  }
  lines.push('')
  lines.push('Distributed via GitHub Release rather than committed to git, fetched by `scripts/fetch-assets.mjs` at install time. See repo README for details.')
  return lines.join('\n')
}
