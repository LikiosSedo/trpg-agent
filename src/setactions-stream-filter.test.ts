/**
 * Tests for SetActionsStreamFilter
 *
 * Run: npx tsx src/setactions-stream-filter.test.ts
 */

import { SetActionsStreamFilter, parseSetActionsBlock } from './setactions-stream-filter.js'

let passed = 0
let failed = 0

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++ }
  else { failed++; console.error(`  FAIL: ${msg}`) }
}

function runStream(chunks: string[]): { fullOutput: string; blocks: string[] } {
  const filter = new SetActionsStreamFilter()
  let fullOutput = ''
  const blocks: string[] = []
  for (const chunk of chunks) {
    const r = filter.feed(chunk)
    fullOutput += r.output
    blocks.push(...r.detectedBlocks)
  }
  const tail = filter.flush()
  fullOutput += tail.output
  blocks.push(...tail.detectedBlocks)
  return { fullOutput, blocks }
}

// ─── Test 1: 无 setactions 块,纯文本应该原样通过 ────
{
  const chunks = ['这是', '一段', '普通叙事', '文本。']
  const r = runStream(chunks)
  assert(r.fullOutput === '这是一段普通叙事文本。', `纯文本原样通过,实际: ${r.fullOutput}`)
  assert(r.blocks.length === 0, '纯文本不应有 block')
}

// ─── Test 2: 整段单 chunk 的 setactions 块应该被完整剥离 ────
{
  const single = '前面叙事。\n<setactions>{"details":[],"suggestions":["a","b"]}</setactions>\n后面'
  const r = runStream([single])
  assert(r.fullOutput === '前面叙事。\n\n后面', `单 chunk 剥离,实际: ${JSON.stringify(r.fullOutput)}`)
  assert(r.blocks.length === 1, 'block 应该被捕获 1 次')
  assert(r.blocks[0] === '{"details":[],"suggestions":["a","b"]}', `block 内容,实际: ${r.blocks[0]}`)
}

// ─── Test 3: 块跨多个 chunk 的极端切分 ────
{
  // 模拟真实流式:每次 1-2 字符
  const text = '叙事<setactions>{"details":[],"suggestions":["x"]}</setactions>尾'
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += 1) chunks.push(text[i])
  const r = runStream(chunks)
  assert(r.fullOutput === '叙事尾', `单字符切分剥离,实际: ${JSON.stringify(r.fullOutput)}`)
  assert(r.blocks.length === 1 && r.blocks[0] === '{"details":[],"suggestions":["x"]}', 'block 内容正确')
}

// ─── Test 4: 不闭合的块(DM 没写完)→ 保留 detectedBlock 以便 parse ────
{
  const chunks = ['叙事。', '<setactions>{"details":[]'] // 缺少闭合
  const r = runStream(chunks)
  assert(r.fullOutput === '叙事。', `不闭合块:前面文本保留`)
  assert(r.blocks.length === 1 && r.blocks[0].includes('details'), 'flush 时返回残留 block')
}

// ─── Test 5: SAFE_KEEP 缓冲确保跨 chunk 的 '<' 不被误输出 ────
{
  // 模拟: chunk1 以 '<' 结尾, chunk2 是 'setactions>...'
  const r = runStream(['叙事内容。<', 'setactions>{"suggestions":["a"]}</setactions>'])
  assert(r.fullOutput === '叙事内容。', `跨 chunk '<' 被正确缓冲,实际: ${JSON.stringify(r.fullOutput)}`)
  assert(r.blocks.length === 1, 'block 正确捕获')
}

// ─── Test 6: 大小写不敏感 ────
{
  const r = runStream(['前<SETACTIONS>{"suggestions":["a"]}</SETACTIONS>后'])
  assert(r.fullOutput === '前后', `大写标签剥离,实际: ${JSON.stringify(r.fullOutput)}`)
  assert(r.blocks.length === 1, '大写 block 捕获')
}

// ─── Test 7: parseSetActionsBlock 各种输入 ────
{
  const a = parseSetActionsBlock('{"details":[],"suggestions":["a"]}')
  assert(a && a.suggestions[0] === 'a', 'parse 纯 JSON')

  const b = parseSetActionsBlock('```json\n{"suggestions":["x"]}\n```')
  assert(b && b.suggestions[0] === 'x', 'parse markdown fence')

  const c = parseSetActionsBlock('  前缀垃圾\n{"suggestions":["y"]}\n后缀垃圾  ')
  assert(c && c.suggestions[0] === 'y', 'parse 带前后垃圾')

  const d = parseSetActionsBlock('not json at all')
  assert(d === null, '非 JSON 返回 null')

  const e = parseSetActionsBlock('')
  assert(e === null, '空输入返回 null')
}

// ─── Test 8: 两个 setactions 块(罕见但可能) ────
{
  const r = runStream([
    '段1<setactions>{"suggestions":["a"]}</setactions>段2<setactions>{"suggestions":["b"]}</setactions>段3',
  ])
  assert(r.fullOutput === '段1段2段3', `两个块剥离,实际: ${JSON.stringify(r.fullOutput)}`)
  assert(r.blocks.length === 2, '捕获两个 block')
  assert(r.blocks[0].includes('"a"') && r.blocks[1].includes('"b"'), 'block 内容分别正确')
}

// ─── Test 9: 现实日志还原 —— 测试我们真实遇到的那个 payload ────
{
  const realCase = `车夫已经开始催促："快点，我还得在天亮前赶到下一个驿站。"

<setactions>
{
  "details": [
    {
      "label": "打量镇口石碑",
      "content": "石碑表面风化严重..."
    }
  ],
  "suggestions": [
    "下车前往那间亮灯的酒馆",
    "询问车夫关于这个镇子的事"
  ]
}
</setactions>`
  const r = runStream([realCase])
  assert(!r.fullOutput.includes('<setactions>'), '真实 payload: 输出不含 XML 标签')
  assert(!r.fullOutput.includes('"details"'), '真实 payload: 输出不含 JSON 字段')
  assert(r.fullOutput.includes('车夫已经开始催促'), '真实 payload: 叙事保留')
  assert(r.blocks.length === 1, '真实 payload: 1 个 block')

  const parsed = parseSetActionsBlock(r.blocks[0])
  assert(parsed !== null, '真实 payload: block JSON 可 parse')
  assert(parsed?.details?.[0]?.label === '打量镇口石碑', '真实 payload: details 字段正确')
  assert(parsed?.suggestions?.length === 2, '真实 payload: suggestions 长度正确')
}

// ─── 汇总 ────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
