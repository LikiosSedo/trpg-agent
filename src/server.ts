/**
 * Web Server — Express + WebSocket 适配层
 *
 * 所有游戏逻辑委托给 GameEngine，这里只负责：
 * - HTTP 服务、静态文件、密码认证
 * - WebSocket 连接管理
 * - TurnEvent / CommandResult → WebSocket 消息映射
 */

import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { timingSafeEqual, createHash } from 'crypto'
import { initItemRegistry, getFacts } from './game-state.js'
import { GameEngine, type TurnEvent, type CommandResult } from './engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Strip ANSI escape codes for web output */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// ─── Express + WebSocket Server ───

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

// ─── 访问密码保护 ───

const GAME_PASSWORD = process.env.TRPG_PASSWORD ?? ''
const PASSWORD_ENABLED = GAME_PASSWORD.length > 0

function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex')
}

const PASSWORD_HASH = PASSWORD_ENABLED ? hashPassword(GAME_PASSWORD) : ''

function verifyPassword(input: string): boolean {
  if (!PASSWORD_ENABLED) return true
  const inputHash = hashPassword(input)
  try {
    return timingSafeEqual(Buffer.from(inputHash), Buffer.from(PASSWORD_HASH))
  } catch {
    return false
  }
}

app.use(express.json())
app.post('/api/auth', (req, res) => {
  if (!PASSWORD_ENABLED) {
    res.json({ ok: true })
    return
  }
  const { password } = req.body ?? {}
  if (verifyPassword(password ?? '')) {
    res.json({ ok: true, token: PASSWORD_HASH })
  } else {
    res.status(401).json({ ok: false, error: '密码错误' })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, password: PASSWORD_ENABLED, env: !!process.env.TRPG_API_KEY, clients: wss.clients.size })
})

app.get('/api/ws-test', (_req, res) => {
  res.send(`<html><body style="background:#111;color:#0f0;font-family:monospace;padding:20px">
<h2>WebSocket 诊断</h2>
<div id="log"></div>
<script>
function log(msg) { document.getElementById('log').innerHTML += msg + '<br>'; }
log('连接中...');
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const url = proto + '//' + location.host;
log('URL: ' + url);
try {
  const ws = new WebSocket(url);
  ws.onopen = () => { log('✅ 连接成功'); ws.send(JSON.stringify({type:'ping'})); log('发送 ping...'); };
  ws.onmessage = (e) => { log('收到: ' + e.data); };
  ws.onclose = (e) => { log('❌ 关闭: code=' + e.code + ' reason=' + e.reason); };
  ws.onerror = () => { log('❌ 错误'); };
} catch(e) { log('❌ 异常: ' + e.message); }
</script></body></html>`)
})

app.use(express.static(join(__dirname, '..', 'public')))
app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'))
})

// ─── WebSocket 连接 ───

wss.on('connection', (ws: WebSocket, req) => {
  console.log('[ws] connection from:', req.headers['user-agent']?.slice(0, 50))

  if (PASSWORD_ENABLED) {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`)
    const token = url.searchParams.get('token')
    if (token !== PASSWORD_HASH) {
      ws.close(1008, 'Unauthorized')
      console.log('[server] rejected: invalid token')
      return
    }
  }

  console.log('[server] new player connected (authenticated)')
  let engine: GameEngine | null = null
  let gameStarted = false
  let processing = false  // 并发锁：防止同时处理两条消息

  function send(type: string, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }))
    }
  }

  /** Map TurnEvent stream to WebSocket messages */
  async function streamEvents(events: AsyncGenerator<TurnEvent>) {
    for await (const ev of events) {
      switch (ev.type) {
        case 'dm_text_delta':
          send('dm', { text: ev.text }); break
        case 'dm_end':
          send('dm_end', { combat: ev.combat, pendingMonster: ev.pendingMonster, actions: ev.actions }); break
        case 'dm_error':
          send('error', { text: ev.message }); break
        case 'broken_promise':
          send('system', { text: `💔 ${ev.npcName}对你失望了：${ev.reason}` }); break
        case 'safety_block':
          send('system', { text: `⛔ ${ev.reason}` }); break
        case 'combat_monster':
          send('combat_monster', { text: ev.text }); break
        case 'combat_status':
          send('combat_status', { text: ev.text, ended: ev.ended, result: ev.result }); break
        case 'quest_completed':
          send('system', { text: `✓ 任务完成: ${ev.questName} — ${ev.text}` }); break
        case 'quest_progress':
          send('quest_progress', { quest: ev.questName, text: ev.text, current: ev.current, required: ev.required }); break
        case 'npc_unlock':
          send('npc_card', {
            npcName: ev.npcName,
            portrait: ev.portrait,
            firstFacts: ev.firstFacts,
            title: engine!.dossier.getBaseInfo(ev.npcName)?.title ?? '',
            appearance: engine!.dossier.getBaseInfo(ev.npcName)?.appearance ?? '',
          }); break
        case 'npc_update':
          send('system', { text: ev.text }); break
        case 'npc_speaking':
          send('npc_speaking', { npcName: ev.npcName, portrait: ev.portrait }); break
        case 'combat_portraits':
          send('combat_portraits', { monsters: ev.monsters }); break
        case 'game_over':
          send('game_over', { reason: ev.reason, canContinue: ev.canContinue, continueHint: ev.continueHint }); break
        case 'narrative_warning':
          send('system', { text: ev.text }); break
        case 'audio':
          send('audio', { bgm: ev.bgm, ambient: ev.ambient }); break
        case 'auto_save':
          break // silent
        case 'death':
          send('system', { text: '💀 你倒下了……意识逐渐远去。\n游戏结束。刷新页面重新开始。' })
          gameStarted = false
          break
        case 'sync':
          send('sync', { session: ev.session, dossier: ev.dossier }); break
      }
    }
  }

  /** Map CommandResult to WebSocket message */
  function sendCommandResult(result: CommandResult) {
    switch (result.type) {
      case 'status':
      case 'quest':
      case 'map':
      case 'inventory':
      case 'recap':
      case 'chapter':
      case 'help':
      case 'saves':
        send('panel', { panel: result.type, data: result.data }); break
      case 'npc_list':
        send('panel', { panel: 'npc', data: result.data }); break
      case 'npc_detail':
        send('panel', { panel: 'npc_detail', data: result.data, text: result.text }); break
      case 'shop':
        if (result.data) send('panel', { panel: 'shop', data: result.data })
        else send('system', { text: '附近没有商店。' })
        break
      case 'world':
        send('system', { text: renderWorldGuideText() }); break
      case 'save':
        send('system', { text: `游戏已保存: ${result.savePath}` }); break
      case 'load':
        send('system', { text: result.message! }); break
      case 'quit':
        send('system', { text: '游戏已保存。再见，冒险者！' })
        gameStarted = false
        break
    }
  }

  ws.on('message', async (raw: Buffer) => {
    let msg: any
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      send('error', { text: '消息格式错误' })
      return
    }

    // ── 恢复存档 ──
    if (msg.type === 'resume') {
      try {
        engine = GameEngine.resumeGame(msg.session, msg.dossier, msg.session.dmMessages)
        gameStarted = true
        console.log(`[server] resumed session for ${engine.session.player.name}`)
        send('resumed', {})
      } catch (err) {
        console.error('[server] resume failed:', err)
        send('resume_failed', { text: `恢复失败: ${(err as Error).message.slice(0, 80)}` })
      }
      return
    }

    // ── 角色创建 ──
    if (msg.type === 'create') {
      const { name, classId } = msg
      try {
        engine = GameEngine.createGame(name, classId)
        gameStarted = true
        console.log(`[server] game started for ${name} (${classId})`)
      } catch (err) {
        console.error('[server] game init failed:', err)
        send('error', { text: `游戏初始化失败: ${(err as Error).message.slice(0, 80)}` })
        return
      }

      send('prologue', { text: '破晓镇 · 蚀目之影\n\n' + renderPrologueText() })
      await streamEvents(engine.streamOpening())
      return
    }

    // ── 只读面板查看（不阻塞 DM 响应）──
    if (msg.type === 'view') {
      if (!gameStarted || !engine) return
      const cmd = msg.text?.trim()
      if (cmd) {
        const result = engine.executeCommand(cmd)
        if (result) sendCommandResult(result)
      }
      return
    }

    // ── 游戏输入 ──
    if (msg.type === 'input') {
      if (!gameStarted || !engine) {
        send('error', { text: '游戏未开始。请先创建角色（刷新页面）。' })
        return
      }
      if (processing) {
        send('error', { text: '上一轮还在处理中，请稍候。' })
        return
      }
      processing = true
      const input = msg.text?.trim()
      if (!input) return

      const cmdResult = engine.executeCommand(input)
      if (cmdResult) {
        sendCommandResult(cmdResult)
        return
      }

      try {
        await streamEvents(engine.processTurn(input))
      } finally {
        processing = false
      }
    }
  })

  ws.on('close', () => {
    if (engine && gameStarted) {
      try {
        engine.session.dossierData = engine.dossier.toJSON()
        getFacts().save('autosave')
        console.log('[server] auto-saved on disconnect')
      } catch {}
    }
    console.log('[server] player disconnected')
  })
})

// ─── 纯文本版本的世界指南（去掉 chalk 颜色） ───

function renderPrologueText(): string {
  return `"让我先告诉你，这个世界是什么样的。"

这里是破晓镇——灰脊山脉东麓山谷中的一个小镇。大约五百人在这里生活，靠矿石和贸易过日子。每天清晨，第一缕阳光会照亮镇中心的一座古老石碑，上面刻着无人能读的符文。小镇因此得名。

最近出了事。

三周前，矿道深处传来异响。两名矿工失踪。搜救队进去后也没有回来。矿工们开始拒绝下矿。冒险者公会发布了紧急委托。

而你——一个失去记忆的旅人——恰好在这时来到了这里。

"记住，在这个镇上，每个人都有自己的故事。有些人会帮你，有些人在隐瞒什么。保持警觉，多和人聊天，不要轻信任何人。"`
}

function renderWorldGuideText(): string {
  return `=== 破晓镇 · 世界指南 ===

📍 地理:
  南/东 — 暮色森林 (危险★★☆☆☆)
  北 — 灰脊矿道 (危险★★★★☆) ⚠最近失踪事件
  西 — 碎石荒原 (危险★★★☆☆)

🏛 镇上地点:
  碎盾亭酒馆 · 冒险者公会 · 铁砧铺 · 草药堂 · 镇长府 · 晨光石碑

⚔️ 你该知道的:
  · 你是失忆旅人，有人让你来破晓镇
  · 冒险者公会在招人
  · 和 NPC 聊天获取线索
  · /quest 看任务 /npc 看人物 /status 看状态`
}

// ─── Start ───

initItemRegistry()

const PORT = parseInt(process.env.PORT ?? '3000')
server.listen(PORT, () => {
  console.log(`\n  🏰 破晓镇 Web Server`)
  console.log(`  http://localhost:${PORT}`)
  console.log()
})
