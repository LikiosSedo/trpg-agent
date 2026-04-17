// 单测：trimToLastSentence 对中英文引号的处理
// 2026-04-17 codex 测试发现：中文弯引号 "…" 结尾的完整句子被误判为"不完整"并被切掉引号

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// trimToLastSentence 未 export —— 通过 dynamic 内联同样的逻辑测
// 更稳的办法：把它 export 出来，测试使用。暂时复制逻辑测 regex 部分。

// 把引号字符定义清楚（避免 test 文件里出现错字符）
const ZH_DOUBLE_RIGHT = '\u201D' // 中文右双引号 "
const ZH_DOUBLE_LEFT = '\u201C'  // 中文左双引号 "
const ZH_SINGLE_RIGHT = '\u2019' // 中文右单引号 '
const ZH_SINGLE_LEFT = '\u2018'  // 中文左单引号 '

// 和 engine.ts trimToLastSentence 里第一个 regex 保持一致
const endRegex = /[。！？…」』"'\u201C\u201D\u2018\u2019）\n]$/

describe('trim-sentence · 正常结尾识别', () => {
  it('中文句号', () => assert.ok(endRegex.test('他走了。')))
  it('中文问号', () => assert.ok(endRegex.test('是吗？')))
  it('中文叹号', () => assert.ok(endRegex.test('真的！')))
  it('省略号', () => assert.ok(endRegex.test('好吧…')))
  it('ASCII 双引号（kimi 风格）', () => assert.ok(endRegex.test('他说"走。"')))
  it('中文右双引号（codex 风格）— 回归 bug', () => {
    // 这是 2026-04-17 codex 真实数据：
    // "着。深夜还在镇上乱转，不是什么好主意。""
    // 修复前会判为"不完整"被切掉引号
    const s = '不是什么好主意。' + ZH_DOUBLE_RIGHT
    assert.ok(endRegex.test(s), '中文弯引号结尾必须被识别为完整句')
  })
  it('中文右单引号', () => {
    const s = '好吧。' + ZH_SINGLE_RIGHT
    assert.ok(endRegex.test(s))
  })
  it('中文左双引号也算合法结尾（罕见但保险）', () => {
    const s = '他说：' + ZH_DOUBLE_LEFT
    assert.ok(endRegex.test(s))
  })
})

describe('trim-sentence · 不完整应触发截断', () => {
  it('ASCII 字母结尾', () => assert.equal(endRegex.test('He walked'), false))
  it('中文字符结尾（无标点）', () => assert.equal(endRegex.test('他走了'), false))
  it('逗号结尾', () => assert.equal(endRegex.test('他走了，'), false))
})
