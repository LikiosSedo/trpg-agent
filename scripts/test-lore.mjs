#!/usr/bin/env node
/**
 * Lore System 冒烟测试 — 零 LLM 调用
 *
 * 覆盖面:
 *   1. Frontmatter 解析(字符串/数字/数组/布尔/带引号)
 *   2. LoreStore.list 返回可见条目 + 章节门控
 *   3. LoreStore.read 按 id/name/alias 命中
 *   4. LoreStore.read 模糊匹配
 *   5. LoreStore.grep 跨文件关键词搜索
 *   6. 章节门控:低章节查不到高章节条目
 *   7. Per-turn 限流 + reset
 *   8. 缺失目录 fail-soft
 *   9. parseChapterNumber 各种输入
 *
 * 运行:
 *   node scripts/test-lore.mjs
 */

import { parseFrontmatter } from '../src/lore/frontmatter.ts'
import {
  LoreStore,
  getLoreStore,
  resetLoreStore,
  parseChapterNumber,
} from '../src/lore/index.ts'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

let passed = 0
let failed = 0

function assert(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function group(name, fn) {
  console.log(`\n── ${name} ──`)
  fn()
}

// ══════════════════════════════════════════
// Group 1: parseFrontmatter
// ══════════════════════════════════════════
group('Group 1: frontmatter 解析', () => {
  const text1 = `---
name: 格雷格
type: character
aliases: [格雷格, 老格]
chapter_visible: 2
tags: [mercenary]
---

# 正文标题

这是正文。`
  const r1 = parseFrontmatter(text1)
  assert('字符串字段', r1.frontmatter.name === '格雷格')
  assert('type 字段', r1.frontmatter.type === 'character')
  assert('数字字段', r1.frontmatter.chapter_visible === 2)
  assert('行内数组', Array.isArray(r1.frontmatter.aliases) && r1.frontmatter.aliases.length === 2)
  assert('body 去除 frontmatter', r1.body.startsWith('# 正文标题'))

  const text2 = `---
name: "带引号的名字"
active: true
---

内容`
  const r2 = parseFrontmatter(text2)
  assert('带引号字符串', r2.frontmatter.name === '带引号的名字')
  assert('布尔 true', r2.frontmatter.active === true)

  const text3 = `没有 frontmatter 的纯文本`
  const r3 = parseFrontmatter(text3)
  assert('无 frontmatter 时返回空对象', Object.keys(r3.frontmatter).length === 0)
  assert('无 frontmatter 时 body == 原文', r3.body === text3)
})

// ══════════════════════════════════════════
// Group 2: parseChapterNumber
// ══════════════════════════════════════════
group('Group 2: parseChapterNumber', () => {
  assert("'ch1' → 1", parseChapterNumber('ch1') === 1)
  assert("'ch2' → 2", parseChapterNumber('ch2') === 2)
  assert("'ch10' → 10", parseChapterNumber('ch10') === 10)
  assert('undefined → 1', parseChapterNumber(undefined) === 1)
  assert("'xxx' → 1", parseChapterNumber('xxx') === 1)
})

// ══════════════════════════════════════════
// Group 3: LoreStore.list + 章节门控
// ══════════════════════════════════════════
group('Group 3: LoreStore.list + 章节门控', () => {
  resetLoreStore()
  const store = new LoreStore(join(projectRoot, 'lore'))

  // Ch1: darian-death(ch2) 不应该出现
  const ch1Entries = store.list({ currentChapter: 1 })
  const ch1Ids = ch1Entries.map(e => e.id)
  assert('Ch1 能看到格雷格', ch1Ids.includes('greg'))
  assert('Ch1 能看到小莉', ch1Ids.includes('xiaoli'))
  assert('Ch1 能看到艾琳娜', ch1Ids.includes('elena'))
  assert('Ch1 能看到碎盾亭', ch1Ids.includes('shattered-shield-tavern'))
  assert('Ch1 看不到达里安之死(ch_visible=2)', !ch1Ids.includes('darian-death'))

  // Ch2: 全部可见
  const ch2Entries = store.list({ currentChapter: 2 })
  const ch2Ids = ch2Entries.map(e => e.id)
  assert('Ch2 能看到达里安之死', ch2Ids.includes('darian-death'))
  assert('Ch2 总条目数 >= Ch1', ch2Entries.length >= ch1Entries.length)

  // 按 type 过滤
  const chars = store.list({ currentChapter: 2, type: 'character' })
  assert(
    '按 type=character 过滤',
    chars.length === 3 && chars.every(e => e.type === 'character'),
    `实际: ${chars.length} 个, types=${chars.map(e => e.type).join(',')}`,
  )

  const places = store.list({ currentChapter: 2, type: 'place' })
  assert('按 type=place 过滤', places.length === 1 && places[0].id === 'shattered-shield-tavern')
})

// ══════════════════════════════════════════
// Group 4: LoreStore.read
// ══════════════════════════════════════════
group('Group 4: LoreStore.read', () => {
  const store = new LoreStore(join(projectRoot, 'lore'))

  // 按 id
  const byId = store.read({ query: 'greg', currentChapter: 1 })
  assert('按 id 命中', byId !== null && byId.id === 'greg')

  // 按 name(frontmatter.name)
  const byName = store.read({ query: '格雷格·铁拳头', currentChapter: 1 })
  assert('按全名命中', byName !== null && byName.id === 'greg')

  // 按 alias
  const byAlias = store.read({ query: '老格', currentChapter: 1 })
  assert('按别名命中', byAlias !== null && byAlias.id === 'greg')

  // 模糊匹配
  const fuzzy = store.read({ query: '铁拳头', currentChapter: 1 })
  assert('模糊匹配命中', fuzzy !== null && fuzzy.id === 'greg')

  // 章节门控:ch1 查 darian-death 应该返回 null
  const gated = store.read({ query: '达里安之死', currentChapter: 1 })
  assert('章节门控挡住 ch2 条目(ch1 查询)', gated === null)

  // ch2 能查到
  const ungated = store.read({ query: '达里安之死', currentChapter: 2 })
  assert('章节满足时能查到', ungated !== null && ungated.id === 'darian-death')

  // 找不到时返回 null
  const missing = store.read({ query: '完全不存在的名字', currentChapter: 5 })
  assert('不存在时返回 null', missing === null)
})

// ══════════════════════════════════════════
// Group 5: LoreStore.grep
// ══════════════════════════════════════════
group('Group 5: LoreStore.grep', () => {
  const store = new LoreStore(join(projectRoot, 'lore'))

  // '达里安' 应该在 greg / elena / darian-death / tavern 里都出现
  const hits = store.grep({ query: '达里安', currentChapter: 2 })
  const ids = hits.map(h => h.id)
  assert('grep 命中多个条目', hits.length >= 3, `实际命中: ${hits.length} 个`)
  assert('grep 命中 darian-death', ids.includes('darian-death'))
  assert('grep 命中 greg', ids.includes('greg'))

  // Ch1 时 darian-death 本身不可见,但 greg 里提到达里安的行仍应命中
  const ch1Hits = store.grep({ query: '达里安', currentChapter: 1 })
  const ch1Ids = ch1Hits.map(h => h.id)
  assert('Ch1 grep 不命中被门控的条目', !ch1Ids.includes('darian-death'))
  assert('Ch1 grep 仍能命中 greg 里的达里安', ch1Ids.includes('greg'))

  // 每个命中至少有 1 个 snippet
  assert('每个命中都带 snippet', hits.every(h => h.snippets.length > 0))

  // 空查询
  const empty = store.grep({ query: '', currentChapter: 2 })
  assert('空查询返回空数组', empty.length === 0)

  // 无命中
  const none = store.grep({ query: '绝对不存在的关键词xyz123', currentChapter: 2 })
  assert('无命中返回空数组', none.length === 0)
})

// ══════════════════════════════════════════
// Group 6: per-turn 限流
// ══════════════════════════════════════════
group('Group 6: per-turn 限流', () => {
  const store = new LoreStore(join(projectRoot, 'lore'))

  // 前 5 次都应该允许
  const results = []
  for (let i = 0; i < 5; i++) {
    results.push(store.checkAndIncrementCall())
  }
  assert('前 5 次都 allowed', results.every(r => r.allowed))
  assert('第 5 次 remaining = 0', results[4].remaining === 0)

  // 第 6 次应该被拒
  const sixth = store.checkAndIncrementCall()
  assert('第 6 次被拒', !sixth.allowed)

  // reset 后应恢复
  store.resetTurnCounter()
  const afterReset = store.checkAndIncrementCall()
  assert('reset 后又能调用', afterReset.allowed && afterReset.remaining === 4)
})

// ══════════════════════════════════════════
// Group 7: fail-soft(目录不存在)
// ══════════════════════════════════════════
group('Group 7: 目录不存在 fail-soft', () => {
  // 抑制 warn 输出
  const origWarn = console.warn
  const origLog = console.log
  console.warn = () => {}
  console.log = () => {}

  const badStore = new LoreStore('/tmp/this-lore-dir-definitely-does-not-exist-xyz')
  const list = badStore.list({ currentChapter: 1 })
  const read = badStore.read({ query: 'anything', currentChapter: 1 })
  const grep = badStore.grep({ query: 'anything', currentChapter: 1 })

  console.warn = origWarn
  console.log = origLog

  assert('list 返回空数组', list.length === 0)
  assert('read 返回 null', read === null)
  assert('grep 返回空数组', grep.length === 0)
})

// ══════════════════════════════════════════
// Group 8: 必需字段缺失的文件被跳过
// ══════════════════════════════════════════
group('Group 8: 单例 getLoreStore()', () => {
  resetLoreStore()
  const s1 = getLoreStore()
  const s2 = getLoreStore()
  assert('单例返回同一实例', s1 === s2)
  resetLoreStore()
  const s3 = getLoreStore()
  assert('reset 后新实例', s3 !== s1)
})

// ══════════════════════════════════════════
// 汇总
// ══════════════════════════════════════════
console.log(`\n══════════════════════════════════════════`)
console.log(`  通过: ${passed}  失败: ${failed}`)
console.log(`══════════════════════════════════════════`)
process.exit(failed > 0 ? 1 : 0)
