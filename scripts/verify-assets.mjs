#!/usr/bin/env node
/**
 * verify-assets.mjs — 校验本地资源是否与 manifest 一致
 *
 * 用法:
 *   npm run verify-assets              # 校验,问题时 exit 1
 *   npm run verify-assets -- --quiet   # 静默模式（pre-commit hook 用）
 *   npm run verify-assets -- --rebuild # 把当前工作区扫描结果写回 manifest fileList
 *                                      # 用于 backfill v1（manifest 还没有 fileList 时）
 *
 * 校验内容:
 *   - 每个 pack 的 verifyPath 文件存在
 *   - manifest.packs[].fileList 里的每个文件存在 + size 匹配
 *   - 工作区里有 manifest 不知道的额外文件（提示可能漏 publish）
 *
 * 限制:
 *   - 不校验文件内容 sha,因为 tar 打包带 mtime 不确定性,无法跨次复现
 *   - 改内容但字节数刚好相同的情况检测不到（几乎不可能发生）
 *
 * 与 publish-assets.mjs 的关系:
 *   publish-assets 写 fileList → verify-assets 读 fileList 对比
 */

import { readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST_PATH = join(ROOT, 'assets-manifest.json')
const FILELIST_PATH = join(ROOT, 'assets-filelist.json')

const argv = new Set(process.argv.slice(2))
const REBUILD = argv.has('--rebuild')
const QUIET = argv.has('--quiet')

// 与 publish-assets.mjs 的 PACKS_CONFIG 保持一致
const PACKS_CONFIG = [
  { name: 'audio', sourceDir: 'public/audio', tarExcludes: ['*.md'] },
  { name: 'portraits', sourceDir: 'public/portraits', tarExcludes: ['*.md'] },
]

function log(...args) {
  if (!QUIET) console.log('[verify-assets]', ...args)
}
function warn(...args) {
  console.warn('[verify-assets]', ...args)
}

let manifest
try {
  manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'))
} catch (err) {
  warn(`读 ${MANIFEST_PATH} 失败: ${err.message}`)
  process.exit(2)
}

// 读外置 fileList（assets-filelist.json）。manifest 故意不内嵌它，
// 以保持 git diff manifest 时干净。fileList 不存在时进入降级模式。
let fileListByPack = new Map()  // packName → [{path, size}]
let fileListMissing = false
try {
  const filelistData = JSON.parse(await readFile(FILELIST_PATH, 'utf-8'))
  for (const p of filelistData.packs ?? []) {
    if (Array.isArray(p.fileList)) fileListByPack.set(p.name, p.fileList)
  }
} catch {
  fileListMissing = true
}

// 扫描每个 pack 的实际文件
const scanResults = new Map()
for (const cfg of PACKS_CONFIG) {
  const files = await scanPackFiles(cfg.sourceDir, cfg.tarExcludes)
  scanResults.set(cfg.name, files)
}

// ─── --rebuild 模式：把扫描结果写回 assets-filelist.json ────
if (REBUILD) {
  // 同时清理 manifest 里残留的 fileList 字段（前一版方案曾内嵌）
  let manifestChanged = false
  const newManifest = { ...manifest }
  newManifest.packs = manifest.packs.map((pack) => {
    if ('fileList' in pack) {
      manifestChanged = true
      const { fileList: _drop, ...rest } = pack
      return rest
    }
    return pack
  })
  if (manifestChanged) {
    await writeFile(MANIFEST_PATH, JSON.stringify(newManifest, null, 2) + '\n')
    log(`✓ 清理 manifest 里残留的 fileList 字段`)
  }

  // 写新 fileList 到独立文件
  const totalFiles = [...scanResults.values()].reduce((n, arr) => n + arr.length, 0)
  const filelistData = {
    version: manifest.version,
    description: '资源文件清单 — 由 publish-assets / verify-assets 维护。verify-assets 用它做 path+size 对比。manifest 故意不内嵌此清单，以保持 git diff 干净。',
    packs: PACKS_CONFIG.map((cfg) => ({
      name: cfg.name,
      fileList: scanResults.get(cfg.name) ?? [],
    })),
  }
  await writeFile(FILELIST_PATH, JSON.stringify(filelistData, null, 2) + '\n')
  log(`✓ 已重写 assets-filelist.json (${totalFiles} 个文件)`)
  log('请 review 后 commit:')
  log('    git diff assets-manifest.json assets-filelist.json')
  log('    git add assets-manifest.json assets-filelist.json')
  log('    git commit -m "assets: backfill filelist"')
  process.exit(0)
}

// ─── verify 模式 ──────────────────────────────────────
let allOk = true
let missingFileListWarning = false

for (const pack of manifest.packs) {
  const scanned = scanResults.get(pack.name)
  if (!scanned) {
    warn(`${pack.name}: PACKS_CONFIG 没定义此 pack，跳过`)
    continue
  }

  // 1) verifyPath 文件存在
  if (pack.verifyPath) {
    try {
      await stat(join(ROOT, pack.verifyPath))
    } catch {
      warn(`${pack.name}: ✗ verifyPath ${pack.verifyPath} 不存在`)
      warn(`    → 跑 \`npm run fetch-assets\` 拉资源`)
      allOk = false
      continue
    }
  }

  // 2) fileList 详细对比 — 优先用外置 assets-filelist.json,
  //    兼容旧版内嵌在 manifest 的 pack.fileList
  const externalFileList = fileListByPack.get(pack.name)
  const expectedList = externalFileList ?? pack.fileList
  if (Array.isArray(expectedList) && expectedList.length > 0) {
    const expected = new Map(expectedList.map((f) => [f.path, f.size]))
    const actual = new Map(scanned.map((f) => [f.path, f.size]))

    const missing = []
    const sizeMismatch = []
    const extra = []

    for (const [path, size] of expected) {
      const actualSize = actual.get(path)
      if (actualSize === undefined) {
        missing.push(path)
      } else if (actualSize !== size) {
        sizeMismatch.push({ path, expected: size, actual: actualSize })
      }
    }
    for (const [path] of actual) {
      if (!expected.has(path)) extra.push(path)
    }

    if (missing.length === 0 && sizeMismatch.length === 0 && extra.length === 0) {
      log(`${pack.name}: ✓ ${expected.size} 文件全部匹配`)
    } else {
      if (missing.length) {
        warn(`${pack.name}: ✗ ${missing.length} 个文件缺失:`)
        missing.slice(0, 5).forEach((p) => warn(`    - ${p}`))
        if (missing.length > 5) warn(`    ... 以及另外 ${missing.length - 5} 个`)
        allOk = false
      }
      if (sizeMismatch.length) {
        warn(`${pack.name}: ✗ ${sizeMismatch.length} 个文件大小不匹配:`)
        sizeMismatch.slice(0, 5).forEach((m) =>
          warn(`    - ${m.path}  期望 ${m.expected} 字节, 实际 ${m.actual} 字节`)
        )
        if (sizeMismatch.length > 5) warn(`    ... 以及另外 ${sizeMismatch.length - 5} 个`)
        allOk = false
      }
      if (extra.length) {
        warn(`${pack.name}: ⚠ ${extra.length} 个工作区文件不在 manifest（新增？未发布？）:`)
        extra.slice(0, 5).forEach((p) => warn(`    + ${p}`))
        if (extra.length > 5) warn(`    ... 以及另外 ${extra.length - 5} 个`)
        allOk = false
      }
    }
  } else {
    // 没有 fileList（filelist 文件缺失 + manifest 里也没有），降级模式
    log(`${pack.name}: ✓ verifyPath 存在 (没有 fileList，跳过详细对比)`)
    missingFileListWarning = true
  }
}

if (missingFileListWarning) {
  log('')
  log('提示: 当前没有 assets-filelist.json，详细校验已跳过。')
  log(`    跑 \`node scripts/verify-assets.mjs --rebuild\` 生成 fileList，`)
  log('    然后 commit。下次 verify 就能做完整对比。')
}

if (!allOk) {
  warn('')
  warn('部分资源与 manifest 不一致。可能的原因:')
  warn('  1. 你改了资源但忘了 `npm run publish-assets`')
  warn('  2. fetch-assets 没下载完整 → `npm run fetch-assets -- --force`')
  warn('  3. 你刚加了新资源,需要先 publish 进 manifest')
  process.exit(1)
}

log('✓ 所有资源与 manifest 一致')
process.exit(0)

// ─── 工具：扫描 pack 内所有非 .md 文件 ───────────────
//
// 与 publish-assets.mjs 的 scanPackFiles 完全等价（保持双脚本独立运行）。

async function scanPackFiles(sourceDir, tarExcludes) {
  const result = []
  const sourceAbs = join(ROOT, sourceDir)

  const isExcluded = (filename) => {
    for (const pat of tarExcludes) {
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
