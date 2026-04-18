// 直接起 WS 客户端验证思考链 —— 不走浏览器
import WebSocket from 'ws'
async function main() {
  const ws = new WebSocket('ws://localhost:3008/')
  const thinking: string[] = []
  let dmText = ''
  await new Promise<void>(resolve => ws.on('open', () => resolve()))
  ws.on('message', (buf) => {
    try {
      const msg = JSON.parse(buf.toString())
      if (msg.type === 'dm_thinking') thinking.push(msg.text)
      if (msg.type === 'dm') dmText += msg.text
    } catch {}
  })
  ws.send(JSON.stringify({ type: 'create', name: 'wspass2', classId: 'fighter' }))
  await new Promise(r => setTimeout(r, 45000))
  const r1 = `[open] dm=${dmText.length}B  thinking events=${thinking.length}  thinking bytes=${thinking.reduce((s, t) => s + t.length, 0)}`
  console.log(r1)
  if (thinking.length > 0) console.log('[open] thinking preview:', thinking.join('').slice(0, 300))
  const tB = thinking.length, dB = dmText.length
  ws.send(JSON.stringify({ type: 'input', text: '看看四周' }))
  await new Promise(r => setTimeout(r, 45000))
  const added = thinking.slice(tB).reduce((s, t) => s + t.length, 0)
  console.log(`[input] dm +${dmText.length - dB}B  thinking events +${thinking.length - tB}  thinking bytes +${added}`)
  if (thinking.length > tB) console.log('[input] thinking preview:', thinking.slice(tB).join('').slice(0, 300))
  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
