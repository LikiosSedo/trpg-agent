#!/usr/bin/env node
/**
 * DM Journal 冒烟测试(Phase 6)— 零 LLM 调用
 *
 * 覆盖面:
 *   1. appendJournal 基本写入 + 状态更新
 *   2. 空内容拒绝
 *   3. 单条内容超长截断(300 字符)
 *   4. 每 turn 写入上限(2 条)
 *   5. resetJournalTurnCounter 恢复配额
 *   6. getRecentJournal 返回最近 N 条
 *   7. formatJournalForPrompt 格式化输出
 *   8. 归档快照集成:buildArchivalSnapshot 包含 journal
 *   9. tags 字段保留
 *
 * 运行:
 *   node --import tsx scripts/test-dm-journal.mjs
 */

import {
  appendJournal,
  getRecentJournal,
  formatJournalForPrompt,
  resetJournalTurnCounter,
  MAX_CONTENT_LENGTH,
  MAX_WRITES_PER_TURN,
  _getWritesThisTurn,
} from '../src/dm-journal.ts'
import { buildArchivalSnapshot } from '../src/agent/index.ts'

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

/** 造一个最小可用的 session,只包含 journal 测试需要的字段 */
function makeSession(overrides = {}) {
  return {
    player: { name: '测试玩家', level: 1, hp: 10, maxHp: 10, gold: 0, abilityModifiers: {}, equipped: {}, clues: [] },
    npcs: [],
    quests: [],
    worldState: { currentLocation: 'dawnbreak-town', timeOfDay: 'evening', flags: {} },
    events: [],
    turnCount: 5,
    combat: null,
    chapter: { currentChapter: 'ch2', completedBeats: [], discoveries: [], idleTurns: 0, nudgeIndex: 0 },
    dmJournal: [],
    ...overrides,
  }
}

// ══════════════════════════════════════════
// Group 1: 基本写入
// ══════════════════════════════════════════
group('Group 1: appendJournal 基本写入', () => {
  resetJournalTurnCounter()
  const s = makeSession()

  const r1 = appendJournal(s, {
    type: 'decision',
    content: '玩家选择拒绝帮助艾琳娜调查矿洞,坚持先处理小镇日常',
  })
  assert('写入成功', r1.ok === true)
  assert('返回 entry', r1.entry !== undefined)
  assert('entry.turn 正确', r1.entry.turn === 5)
  assert('entry.chapter 正确', r1.entry.chapter === 'ch2')
  assert('entry.type 正确', r1.entry.type === 'decision')
  assert('session.dmJournal 长度 1', s.dmJournal.length === 1)
  assert('剩余次数 = MAX - 1', r1.remaining === MAX_WRITES_PER_TURN - 1)
})

// ══════════════════════════════════════════
// Group 2: 空内容拒绝
// ══════════════════════════════════════════
group('Group 2: 空内容拒绝', () => {
  resetJournalTurnCounter()
  const s = makeSession()

  const r1 = appendJournal(s, { type: 'note', content: '' })
  assert('空字符串拒绝', !r1.ok && r1.reason === 'empty_content')
  assert('未写入 session', s.dmJournal.length === 0)

  const r2 = appendJournal(s, { type: 'note', content: '   \n\t  ' })
  assert('纯空白拒绝', !r2.ok && r2.reason === 'empty_content')

  // 空内容不消耗配额
  assert('空内容不消耗配额', _getWritesThisTurn() === 0)
})

// ══════════════════════════════════════════
// Group 3: 超长内容截断
// ══════════════════════════════════════════
group('Group 3: 超长内容截断', () => {
  resetJournalTurnCounter()
  const s = makeSession()

  const longContent = 'A'.repeat(MAX_CONTENT_LENGTH + 100)
  const r1 = appendJournal(s, { type: 'note', content: longContent })
  assert('超长内容仍然成功写入', r1.ok)
  assert('内容被截断', r1.entry.content.length === MAX_CONTENT_LENGTH)
  assert('末尾有省略号', r1.entry.content.endsWith('…'))
})

// ══════════════════════════════════════════
// Group 4: 每 turn 写入上限
// ══════════════════════════════════════════
group('Group 4: 每 turn 写入上限', () => {
  resetJournalTurnCounter()
  const s = makeSession()

  // 写满配额
  for (let i = 0; i < MAX_WRITES_PER_TURN; i++) {
    const r = appendJournal(s, { type: 'note', content: `第 ${i + 1} 条` })
    assert(`第 ${i + 1} 次写入成功`, r.ok)
  }

  // 下一次应被拒
  const over = appendJournal(s, { type: 'note', content: '超出配额' })
  assert('超出配额被拒', !over.ok && over.reason === 'rate_limit')
  assert('remaining === 0', over.remaining === 0)
  assert('超出后 session 未新增', s.dmJournal.length === MAX_WRITES_PER_TURN)
})

// ══════════════════════════════════════════
// Group 5: resetTurnCounter 恢复配额
// ══════════════════════════════════════════
group('Group 5: resetTurnCounter 恢复配额', () => {
  resetJournalTurnCounter()
  const s = makeSession()

  // 写满
  for (let i = 0; i < MAX_WRITES_PER_TURN; i++) {
    appendJournal(s, { type: 'note', content: `x${i}` })
  }
  const blocked = appendJournal(s, { type: 'note', content: 'blocked' })
  assert('写满后被拒', !blocked.ok)

  // Reset
  resetJournalTurnCounter()
  const afterReset = appendJournal(s, { type: 'note', content: 'after reset' })
  assert('reset 后又能写', afterReset.ok)
  assert('session 追加成功', s.dmJournal.length === MAX_WRITES_PER_TURN + 1)
})

// ══════════════════════════════════════════
// Group 6: getRecentJournal
// ══════════════════════════════════════════
group('Group 6: getRecentJournal', () => {
  resetJournalTurnCounter()
  const s = makeSession({ dmJournal: [] })

  // 手动塞 15 条(绕过限流)
  for (let i = 0; i < 15; i++) {
    s.dmJournal.push({
      turn: i,
      chapter: 'ch1',
      type: 'note',
      content: `entry ${i}`,
    })
  }

  const last5 = getRecentJournal(s, 5)
  assert('最近 5 条长度正确', last5.length === 5)
  assert('最近 5 条起点正确', last5[0].content === 'entry 10')
  assert('最近 5 条终点正确', last5[4].content === 'entry 14')

  const all = getRecentJournal(s, 100)
  assert('count > 总数时返回全部', all.length === 15)

  const empty = getRecentJournal(makeSession({ dmJournal: [] }), 5)
  assert('空 journal 返回空数组', empty.length === 0)

  const noField = getRecentJournal(makeSession({ dmJournal: undefined }), 5)
  assert('undefined journal 返回空数组', noField.length === 0)
})

// ══════════════════════════════════════════
// Group 7: formatJournalForPrompt
// ══════════════════════════════════════════
group('Group 7: formatJournalForPrompt', () => {
  const empty = formatJournalForPrompt([])
  assert('空数组返回空字符串', empty === '')

  const entries = [
    { turn: 3, chapter: 'ch1', type: 'decision', content: '玩家拒绝了艾琳娜' },
    { turn: 5, chapter: 'ch2', type: 'promise', content: '承诺保护小莉', tags: ['greg', 'xiaoli'] },
  ]
  const out = formatJournalForPrompt(entries)
  assert('包含标题', out.startsWith('DM 札记:'))
  assert('包含 turn', out.includes('Turn 3'))
  assert('包含章节', out.includes('ch2'))
  assert('包含类型', out.includes('decision'))
  assert('包含 tag', out.includes('#greg'))
  assert('包含 content', out.includes('承诺保护小莉'))

  const custom = formatJournalForPrompt(entries, '自定义标题')
  assert('自定义标题生效', custom.startsWith('自定义标题:'))
})

// ══════════════════════════════════════════
// Group 8: 归档快照集成
// ══════════════════════════════════════════
group('Group 8: buildArchivalSnapshot 集成', () => {
  const s = makeSession()
  s.dmJournal = [
    { turn: 10, chapter: 'ch2', type: 'decision', content: '玩家站队了维克多,拒绝了公会' },
    { turn: 12, chapter: 'ch2', type: 'revelation', content: '透露了达里安日志的存在' },
  ]

  const snap = buildArchivalSnapshot(s, { keepRecentTurns: 12, availableToolNames: [] })
  assert('快照包含 DM 札记标题', snap.includes('DM 札记'))
  assert('快照包含 decision 条目', snap.includes('玩家站队了维克多'))
  assert('快照包含 revelation 条目', snap.includes('达里安日志'))

  // 没有 journal 时不应该出现札记标题
  const sEmpty = makeSession({ dmJournal: [] })
  const snapEmpty = buildArchivalSnapshot(sEmpty, { keepRecentTurns: 12 })
  assert('空 journal 时快照不含札记标题', !snapEmpty.includes('DM 札记'))
})

// ══════════════════════════════════════════
// Group 9: tags 字段保留
// ══════════════════════════════════════════
group('Group 9: tags 字段保留', () => {
  resetJournalTurnCounter()
  const s = makeSession()

  const r = appendJournal(s, {
    type: 'promise',
    content: '承诺下次回来时带药草给叶绿',
    tags: ['yelu', 'herb'],
  })
  assert('tags 被保留', Array.isArray(r.entry.tags) && r.entry.tags.length === 2)
  assert('tags 内容正确', r.entry.tags[0] === 'yelu')

  // 空 tags 数组应该被省略(undefined),避免污染 snapshot 格式
  resetJournalTurnCounter()
  const r2 = appendJournal(makeSession(), {
    type: 'note',
    content: 'no tags',
    tags: [],
  })
  assert('空 tags 数组被省略', r2.entry.tags === undefined)
})

// ══════════════════════════════════════════
console.log(`\n══════════════════════════════════════════`)
console.log(`  通过: ${passed}  失败: ${failed}`)
console.log(`══════════════════════════════════════════`)
process.exit(failed > 0 ? 1 : 0)
