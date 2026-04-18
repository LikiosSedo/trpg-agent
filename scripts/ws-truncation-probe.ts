// 验证 DM 输出不被"吞":
//   1. 走 WS 真 codex 链路,收集所有 dm chunk 拼接成 streamText
//   2. 收集 dm_end.text 作为 authoritativeText
//   3. 对比两者长度 + 最后 20 字
//
// 如果 dm_end.text === undefined → server.ts 转发漏字段(回归 bug 1)
// 如果 streamText 长度远小于 authoritativeText → streaming 丢 chunk
// 如果一致 → 修复生效

import WebSocket from 'ws'

interface TurnResult {
  label: string
  streamText: string
  authoritativeText: string | undefined
  streamBytes: number
  authBytes: number
}

async function runOne(label: string, trigger: () => void): Promise<TurnResult> {
  const ws = new WebSocket('ws://localhost:3008/')
  let streamText = ''
  let authText: string | undefined
  await new Promise<void>(res => ws.once('open', () => res()))
  const done = new Promise<void>(resolve => {
    ws.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf.toString())
        if (msg.type === 'dm') streamText += msg.text
        if (msg.type === 'dm_end') {
          authText = msg.text
          setTimeout(() => resolve(), 500)
        }
      } catch {}
    })
  })
  trigger.call({ ws })
  // @ts-ignore
  const send = (obj: any) => ws.send(JSON.stringify(obj))
  ;(trigger as any).send = send
  // actual trigger dispatched after attaching handlers — simpler: use closure
  await done
  ws.close()
  return {
    label,
    streamText, authoritativeText: authText,
    streamBytes: streamText.length, authBytes: authText?.length ?? -1,
  }
}

async function openingTurn(): Promise<TurnResult> {
  const ws = new WebSocket('ws://localhost:3008/')
  let streamText = ''
  let authText: string | undefined
  await new Promise<void>(res => ws.once('open', () => res()))
  const done = new Promise<void>(resolve => {
    ws.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf.toString())
        if (msg.type === 'dm') streamText += msg.text
        if (msg.type === 'dm_end') { authText = msg.text; setTimeout(() => resolve(), 800) }
      } catch {}
    })
  })
  ws.send(JSON.stringify({ type: 'create', name: 'truncprobe', classId: 'fighter' }))
  await done
  ws.close()
  return { label: 'opening', streamText, authoritativeText: authText, streamBytes: streamText.length, authBytes: authText?.length ?? -1 }
}

async function turnAfterOpening(input: string): Promise<TurnResult> {
  const ws = new WebSocket('ws://localhost:3008/')
  let streamText = ''
  let authText: string | undefined
  let turnCount = 0
  await new Promise<void>(res => ws.once('open', () => res()))
  const done = new Promise<void>(resolve => {
    ws.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf.toString())
        if (msg.type === 'dm') streamText += msg.text
        if (msg.type === 'dm_end') {
          turnCount++
          if (turnCount === 1) {
            // 开场结束,清空 streamText 开始新一轮
            streamText = ''
            authText = undefined
            ws.send(JSON.stringify({ type: 'input', text: input }))
          } else {
            authText = msg.text
            setTimeout(() => resolve(), 800)
          }
        }
      } catch {}
    })
  })
  ws.send(JSON.stringify({ type: 'create', name: 'truncprobe2', classId: 'fighter' }))
  await done
  ws.close()
  return { label: `after-opening: "${input}"`, streamText, authoritativeText: authText, streamBytes: streamText.length, authBytes: authText?.length ?? -1 }
}

function report(r: TurnResult): void {
  console.log(`\n=== [${r.label}] ===`)
  console.log(`  stream bytes:       ${r.streamBytes}`)
  console.log(`  authoritative bytes: ${r.authBytes}`)
  if (r.authoritativeText === undefined) {
    console.log(`  ❌ dm_end.text is undefined — server.ts 没带 text 字段!`)
  } else {
    const diff = r.streamBytes - r.authBytes
    console.log(`  diff (stream - auth): ${diff}  (engine trimToLastSentence 合理砍 ≤3 字尾)`)
    console.log(`  stream tail:  ...${r.streamText.slice(-30)}`)
    console.log(`  auth tail:    ...${r.authoritativeText.slice(-30)}`)
    if (r.authoritativeText.length === 0) console.log(`  ⚠️ auth 为空字符串`)
    else if (Math.abs(diff) > 10) console.log(`  ⚠️ 差异 >10 字,可能有截断问题`)
    else console.log(`  ✅ 长度匹配`)
  }
}

async function main() {
  console.log('[probe] 1/2: 开场叙事')
  report(await openingTurn())
  console.log('\n[probe] 2/2: 开场 + 玩家输入')
  report(await turnAfterOpening('走向碎盾亭酒馆'))
}
main().catch(e => { console.error(e); process.exit(1) })
