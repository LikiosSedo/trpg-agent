/**
 * Tests for ANSI stripping at the WebSocket boundary
 *
 * Run: npx tsx src/strip-ansi.test.ts
 */

import chalk from 'chalk'
import { stripAnsi, stripAnsiDeep } from './server.js'

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  FAIL: ${msg}`)
  }
}

// Force chalk to actually emit ANSI codes (in case it's auto-detected off in test env)
chalk.level = 2

console.log('\n=== stripAnsi: simple cases ===')
{
  const input = chalk.dim('hello')
  assert(input.includes('\x1b['), `chalk emitted ANSI: raw="${JSON.stringify(input)}"`)
  assert(stripAnsi(input) === 'hello', `dim wrapper stripped: got "${stripAnsi(input)}"`)
  console.log(`  chalk.dim('hello'): raw=${JSON.stringify(input)} → stripped="${stripAnsi(input)}"`)
}

console.log('\n=== stripAnsi: nested chalk ===')
{
  const input = chalk.yellow.bold(`你对${chalk.cyan('小莉')}有了新的了解`)
  const stripped = stripAnsi(input)
  assert(!stripped.includes('\x1b'), `no ANSI escape in output`)
  assert(stripped === '你对小莉有了新的了解', `nested chalk fully stripped: got "${stripped}"`)
}

console.log('\n=== stripAnsi: plain string passthrough ===')
{
  assert(stripAnsi('plain text') === 'plain text', 'plain string unchanged')
  assert(stripAnsi('') === '', 'empty string')
}

console.log('\n=== stripAnsiDeep: object recursion ===')
{
  const event = {
    type: 'npc_update',
    text: chalk.dim(`\n  📋 你对${chalk.cyan('小莉')}有了新的了解:`),
    nested: {
      sub: chalk.yellow('颜色'),
    },
    untouched: 42,
  }
  const cleaned = stripAnsiDeep(event)
  assert(cleaned.type === 'npc_update', 'type field unchanged')
  assert(!cleaned.text.includes('\x1b'), `text field stripped: "${cleaned.text}"`)
  assert(cleaned.text.includes('你对小莉有了新的了解'), 'text content preserved')
  assert(!cleaned.nested.sub.includes('\x1b'), `nested.sub stripped: "${cleaned.nested.sub}"`)
  assert(cleaned.nested.sub === '颜色', 'nested content preserved')
  assert(cleaned.untouched === 42, 'non-string field unchanged')
}

console.log('\n=== stripAnsiDeep: array of strings ===')
{
  const data = {
    log: [chalk.green('hit'), chalk.red('miss'), 'plain'],
  }
  const cleaned = stripAnsiDeep(data)
  assert(cleaned.log.length === 3, 'array length preserved')
  assert(cleaned.log[0] === 'hit', `array[0]: "${cleaned.log[0]}"`)
  assert(cleaned.log[1] === 'miss', `array[1]: "${cleaned.log[1]}"`)
  assert(cleaned.log[2] === 'plain', `array[2]: "${cleaned.log[2]}"`)
}

console.log('\n=== stripAnsiDeep: edge cases ===')
{
  assert(stripAnsiDeep(null) === null, 'null passthrough')
  assert(stripAnsiDeep(undefined) === undefined, 'undefined passthrough')
  assert(stripAnsiDeep(0) === 0, 'number passthrough')
  assert(stripAnsiDeep(false) === false, 'boolean passthrough')
  assert(stripAnsiDeep('') === '', 'empty string passthrough')

  // Object with null nested
  const obj = { a: null, b: chalk.dim('x') }
  const res = stripAnsiDeep(obj)
  assert(res.a === null, 'null inside object preserved')
  assert(res.b === 'x', `chalk inside object stripped: "${res.b}"`)
}

console.log('\n=== stripAnsiDeep: immutability ===')
{
  const original = { text: chalk.dim('hello') }
  const originalText = original.text  // capture before
  const cleaned = stripAnsiDeep(original)
  assert(original.text === originalText, 'original object NOT mutated')
  assert(cleaned !== original, 'returns a new object reference')
  assert(cleaned.text === 'hello', `new object has stripped text: "${cleaned.text}"`)
}

console.log('\n=== Regression: the actual bug from screenshot ===')
{
  // The exact pattern that showed up as "[2m  📋 你对小莉有了新的了解:[22m  · [背景]..."
  const buggy = chalk.dim(`\n  📋 你对小莉有了新的了解:`) + chalk.dim(`\n    · [背景] 三年前的雨夜被格雷格收留`)
  const cleaned = stripAnsi(buggy)
  assert(!cleaned.includes('[2m'), `no [2m artifact: "${cleaned}"`)
  assert(!cleaned.includes('[22m'), `no [22m artifact: "${cleaned}"`)
  assert(cleaned.includes('📋 你对小莉有了新的了解'), 'header preserved')
  assert(cleaned.includes('[背景]'), '[背景] tag preserved (literal brackets, not ANSI)')
  console.log(`  cleaned: ${JSON.stringify(cleaned)}`)
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
