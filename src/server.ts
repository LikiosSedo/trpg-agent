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
import { initItemRegistry, getFacts, getRegistry } from './game-state.js'
import { GameEngine, type TurnEvent, type CommandResult } from './engine.js'
import { TransferItemTool } from './tools/transfer-item.js'
import { localize } from './i18n-terms.js'
import { initSessionLogger, logEvent } from './debug-logger.js'

// 必须在任何 console.log 前初始化 —— 这样启动阶段的日志也被捕获
initSessionLogger()

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Strip ANSI escape codes for web output */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * 用于 logEvent 的数据瘦身:
 * - 截断过长字符串
 * - 对 session / dossier / messages 等大对象只留 meta 信息
 * - 保证 JSON.stringify 不产生 > ~2KB 的日志行
 */
function summarize(obj: any, depth = 0): any {
  if (obj == null) return obj
  if (typeof obj === 'string') {
    return obj.length > 200 ? obj.slice(0, 200) + '…[+' + (obj.length - 200) + ']' : obj
  }
  if (typeof obj !== 'object') return obj
  if (depth > 3) return '[…depth]'
  if (Array.isArray(obj)) {
    if (obj.length > 10) return `[Array len=${obj.length}]`
    return obj.map(v => summarize(v, depth + 1))
  }
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    // 已知大字段特殊处理
    if (k === 'session') {
      const s = v as any
      out[k] = {
        player: s?.player?.name,
        level: s?.player?.level,
        location: s?.worldState?.currentLocation,
        turn: s?.turnCount,
        chapter: s?.chapter?.currentChapter,
      }
    } else if (k === 'dossier') {
      out[k] = '[dossier]'
    } else if (k === 'messages' || k === 'dmMessages') {
      out[k] = `[messages len=${(v as any[])?.length ?? '?'}]`
    } else if (k === 'initiative') {
      out[k] = `[initiative len=${(v as any[])?.length ?? '?'}]`
    } else {
      out[k] = summarize(v, depth + 1)
    }
  }
  return out
}

/**
 * 递归剥离对象内所有字符串字段的 ANSI 颜色码。
 * 用于 send() 出口兜底，防止任何用 chalk 写出的 CLI 文本意外推到前端
 * 显示成字面 [2m / [22m 等垃圾字符。
 */
export function stripAnsiDeep(value: any): any {
  if (typeof value === 'string') return stripAnsi(value)
  if (Array.isArray(value)) return value.map(stripAnsiDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(value)) out[k] = stripAnsiDeep(value[k])
    return out
  }
  return value
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

// ─── 调试 API ───

import { runFullDiagnostics, getNPCPanelData } from './debug-api.js'

// 全局 engine 引用（用于调试 API）
let globalEngine: GameEngine | null = null

app.get('/api/debug/diagnostics', (_req, res) => {
  if (!globalEngine) {
    res.status(503).json({ error: '游戏未启动' })
    return
  }
  try {
    const report = runFullDiagnostics(globalEngine, globalEngine.session)
    res.json(report)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/debug/npc-panel', (_req, res) => {
  if (!globalEngine) {
    res.status(503).json({ error: '游戏未启动' })
    return
  }
  try {
    const data = getNPCPanelData(globalEngine, globalEngine.session)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/debug/session', (_req, res) => {
  if (!globalEngine) {
    res.status(503).json({ error: '游戏未启动' })
    return
  }
  try {
    const session = globalEngine.session
    res.json({
      player: {
        name: session.player.name,
        hp: session.player.hp,
        maxHp: session.player.maxHp,
        gold: session.player.gold,
      },
      world: {
        location: session.worldState.currentLocation,
        subLocation: session.worldState.currentSubLocation,
        timeOfDay: session.worldState.timeOfDay,
      },
      chapter: session.chapter ? {
        current: session.chapter.currentChapter,
        completedBeats: session.chapter.completedBeats,
      } : null,
      combat: session.combat?.active ? {
        active: true,
        round: session.combat.round,
        monsters: session.combat.monsters?.length ?? 0,
      } : { active: false },
      npcs: session.npcs.map(n => ({
        name: n.name,
        trust: n.trust,
        location: n.location,
        subLocation: n.subLocation || n.homeBase,
        condition: n.condition,
      })),
      turnCount: session.turnCount,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
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
      ws.send(JSON.stringify({ type, ...stripAnsiDeep(data) }))
      // 日志:WS 出站消息 — 全量记录结构化数据,按需 grep 查看
      try {
        if (type === 'dm') {
          // dm text delta: 高频小 chunk,只记累积长度(完整文本可从前端回放)
          const text = (data as any)?.text ?? ''
          logEvent('ws.send', { type, len: text.length, text })
        } else if (type === 'dm_thinking') {
          // 思考链: 全量保存,排查 DM 决策必需
          const text = (data as any)?.text ?? ''
          logEvent('ws.send', { type, len: text.length, text })
        } else {
          logEvent('ws.send', { type, data: summarize(data) })
        }
      } catch { /* 日志失败不影响主流程 */ }
    }
  }

  /** Map TurnEvent stream to WebSocket messages */
  async function streamEvents(events: AsyncGenerator<TurnEvent>) {
    for await (const ev of events) {
      switch (ev.type) {
        // dm_text_delta 已经在 engine 层做过流式术语替换（StreamingLocalizer），
        // 这里不再 localize 避免对同一 chunk 多次处理（也不必要）。
        case 'dm_text_delta':
          send('dm', { text: ev.text }); break
        case 'dm_end':
          // text 是 engine 端做过"截断修复 + 本地化"的权威文本,前端优先用它
          // (否则前端 fallback 到 streaming 累积的 _fullText,可能因 chunk 抖动被"吞")
          send('dm_end', { combat: ev.combat, pendingMonster: ev.pendingMonster, actions: ev.actions, hasPendingTrade: ev.hasPendingTrade, text: (ev as any).text }); break
        case 'dm_error':
          send('error', { text: ev.message }); break
        case 'broken_promise':
          send('system', { text: `💔 ${ev.npcName}对你失望了：${localize(ev.reason)}` }); break
        case 'safety_block':
          send('system', { text: `⛔ ${localize(ev.reason)}` }); break
        // 以下非流式文本事件：服务端边界统一兜底本地化
        // 绝大多数已在发射点用了中文名，这里是双重保险
        case 'combat_narrative':
          send('combat_narrative', { text: localize(ev.text) }); break
        case 'combat_monster':
          send('combat_monster', { text: localize(ev.text), playerHp: (ev as any).playerHp, playerMaxHp: (ev as any).playerMaxHp, allies: (ev as any).allies }); break
        case 'combat_ally':
          send('combat_ally', { text: localize((ev as any).text) }); break
        case 'combat_status':
          send('combat_status', { text: localize(ev.text), ended: ev.ended, result: ev.result }); break
        case 'combat_init':
          send('combat_init', { monsters: ev.monsters, round: ev.round, initiative: ev.initiative, narrative: ev.narrative ? localize(ev.narrative) : ev.narrative, allies: (ev as any).allies }); break
        case 'combat_action_req':
          send('combat_action_req', { targets: ev.targets, spells: ev.spells, items: ev.items, playerHp: ev.playerHp, playerMaxHp: ev.playerMaxHp, activeEffects: ev.activeEffects, allies: (ev as any).allies }); break
        case 'quest_completed':
          send('system', { text: `✓ 任务完成: ${ev.questName} — ${localize(ev.text)}` }); break
        case 'quest_progress':
          send('quest_progress', { quest: ev.questName, text: localize(ev.text), current: ev.current, required: ev.required }); break
        case 'npc_unlock':
          send('npc_card', {
            npcName: ev.npcName,
            portrait: ev.portrait,
            firstFacts: ev.firstFacts,
            title: engine!.dossier.getBaseInfo(ev.npcName)?.title ?? '',
            appearance: engine!.dossier.getBaseInfo(ev.npcName)?.appearance ?? '',
          }); break
        case 'discovery':
          send('discovery', {
            source: (ev as any).source,
            poi: (ev as any).poi,
            items: (ev as any).items,
            gold: (ev as any).gold,
          }); break
        case 'lair_entrance':
          send('lair_entrance', {
            poi: (ev as any).poi,
            entranceText: (ev as any).entranceText,
            encounterDescription: (ev as any).encounterDescription,
            image: (ev as any).image,
          }); break
        case 'npc_update':
          send('system', { text: localize(ev.text) }); break
        case 'npc_speaking':
          send('npc_speaking', { npcName: ev.npcName, portrait: ev.portrait }); break
        case 'combat_portraits':
          send('combat_portraits', { monsters: ev.monsters }); break
        // 战棋网格事件
        case 'combat_grid_init':
          send('combat_grid_init', { grid: (ev as any).grid }); break
        case 'combat_grid_move':
          send('combat_grid_move', { unitId: (ev as any).unitId, path: (ev as any).path }); break
        case 'combat_grid_spawn':
          send('combat_grid_spawn', { unit: (ev as any).unit }); break
        case 'combat_grid_death':
          send('combat_grid_death', { unitId: (ev as any).unitId }); break
        case 'combat_grid_attack':
          send('combat_grid_attack', ev); break
        case 'combat_grid_end':
          send('combat_grid_end', { result: (ev as any).result, loot: (ev as any).loot }); break
        // 战斗胜利结算弹窗
        case 'combat_loot':
          send('combat_loot', { result: (ev as any).result, loot: (ev as any).loot, monsters: ((ev as any).monsters || []).map((n: string) => localize(n)) }); break
        // 战斗演出 · 角色回合开始/结束(BattleAnimationQueue 用)
        case 'actor_turn_start':
          send('actor_turn_start', ev); break
        case 'actor_turn_end':
          send('actor_turn_end', { actorId: (ev as any).actorId }); break
        case 'game_over':
          send('game_over', { reason: localize(ev.reason), canContinue: ev.canContinue, continueHint: ev.continueHint }); break
        case 'narrative_warning':
          send('system', { text: localize(ev.text) }); break
        case 'system_message':
          send('system_message', { text: localize(ev.text) }); break
        case 'important_warning':
          send('important_warning', { title: ev.title, text: localize(ev.text) }); break
        case 'item_acquired':
          send('item_acquired', { text: localize(ev.text) }); break
        case 'trade_proposal':
          send('trade_proposal', { npc: ev.npc, items: ev.items, totalPrice: ev.totalPrice, canBargain: ev.canBargain }); break
        case 'audio':
          send('audio', { bgm: ev.bgm, ambient: ev.ambient }); break
        case 'dm_thinking':
          send('dm_thinking', { text: ev.text }); break
        case 'auto_save':
          break // silent
        case 'death_pending':
          send('death_pending', {}); break
        case 'death':
          send('death', { epilogue: (ev as any).epilogue })
          gameStarted = false
          break
        case 'sync':
          send('sync', { session: ev.session, dossier: ev.dossier, questHint: (ev as any).questHint }); break
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
      case 'saves':
        send('panel', { panel: result.type, data: result.data }); break
      case 'help':
        send('open_guide', {}); break
      case 'npc_list':
        send('panel', { panel: 'npc', data: result.data }); break
      case 'npc_detail':
        send('panel', { panel: 'npc_detail', data: result.data, text: result.text }); break
      case 'shop':
        if (result.data) send('panel', { panel: 'shop', data: result.data })
        else send('system', { text: '附近没有商店。' })
        break
      case 'world':
        send('open_guide', {}); break
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

    // 日志:WS 入站消息。密码字段不记录,避免明文泄露
    try {
      const safe = { ...msg }
      if (safe.password) safe.password = '***'
      if (safe.token) safe.token = '***'
      logEvent('ws.recv', { type: msg.type, data: summarize(safe) })
    } catch { /* 日志失败不影响主流程 */ }

    // ── 恢复存档 ──
    if (msg.type === 'resume') {
      try {
        engine = GameEngine.resumeGame(msg.session, msg.dossier, msg.session.dmMessages)
        globalEngine = engine  // 更新全局引用
        gameStarted = true
        console.log(`[server] resumed session for ${engine.session.player.name}`)

        // 恢复完整视觉状态（音频、战斗、HUD）
        const snapshot = engine.getStateSnapshot()
        send('resumed', snapshot)
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
        globalEngine = engine  // 更新全局引用
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

    // ── 战斗动作（结构化按钮点击） ──
    if (msg.type === 'combat_action') {
      if (!gameStarted || !engine) return
      if (processing) { send('error', { text: '处理中...' }); return }
      processing = true
      try {
        await streamEvents(engine.processCombatAction(msg))
      } finally {
        processing = false
      }
      return
    }

    // ── 战棋网格动作 ──
    if (msg.type === 'grid_action') {
      if (!gameStarted || !engine) return
      if (processing) { send('error', { text: '处理中...' }); return }
      processing = true
      try {
        await streamEvents(engine.processGridAction(msg))
      } finally {
        processing = false
      }
      return
    }

    // ── 交易执行（玩家点击交易确认卡片） ──
    if (msg.type === 'trade_execute') {
      if (!gameStarted || !engine) return
      if (engine.session.combat?.active) { send('error', { text: '战斗中无法交易。' }); return }
      if (processing) { send('error', { text: '处理中...' }); return }
      processing = true
      try {
        const items = msg.items || [{ name: msg.item, price: msg.gold, quantity: 1 }]
        const npc = msg.npc
        const results: string[] = []
        let allSuccess = true

        // 商店交易只允许注册表中的物品（防止 DM 凭空编造物品）
        const registry = getRegistry()
        const unregistered = items.filter((i: any) => !registry.has(i.name))
        if (unregistered.length > 0) {
          const names = unregistered.map((i: any) => i.name).join('、')
          send('system', { text: `交易失败：「${names}」不是已知商品。` })
          processing = false
          return
        }

        // 价格合理性校验：单价不能低于 shopPricing 的 50%（防止 DM 传离谱低价）
        const shopNpc = engine.session.npcs.find((n: any) => n.name === npc)
        for (const item of items) {
          const basePrice = shopNpc?.shopPricing?.[item.name]
          if (basePrice && item.price < basePrice * 0.5) {
            item.price = Math.ceil(basePrice * 0.5)  // 强制底价 50%
          }
        }

        // 检查总金额
        const totalPrice = items.reduce((s: number, i: any) => s + (i.price * (i.quantity || 1)), 0)
        if (engine.session.player.gold < totalPrice) {
          send('system', { text: `交易失败：金币不足（需要${totalPrice}，拥有${engine.session.player.gold}）` })
          return
        }

        // 逐个物品执行
        for (const item of items) {
          const qty = item.quantity || 1
          for (let i = 0; i < qty; i++) {
            const result = await TransferItemTool.execute({
              transferType: 'buy',
              itemName: item.name,
              sourceId: npc,
              goldAmount: item.price,
              itemType: item.type,
              itemDescription: item.description,
              itemBonus: item.bonus,
              skipNightCheck: true,  // NPC 已通过 ProposeTradeAction 同意，跳过深夜限制
            })
            if (result.isError) { allSuccess = false; results.push(`❌ ${item.name}: ${result.output}`) }
            else { results.push(`✅ ${item.name}`) }
          }
        }

        send('item_acquired', { text: `交易完成：${results.join('、')}` })
        send('sync', { session: engine.session, dossier: engine.dossier.toJSON() })
        engine.clearBargain()
        // 交易确认不触发 DM 叙事——避免等待，直接解锁输入
        send('dm_end', { combat: false, pendingMonster: false, actions: null })
      } finally {
        processing = false
      }
      return
    }

    // ── 取消交易 ──
    if (msg.type === 'trade_cancel') {
      if (!gameStarted || !engine) return
      if (engine.session.combat?.active) return
      engine.clearBargain()
      // 取消交易不触发 DM 叙事——直接解锁输入，玩家继续操作
      send('dm_end', { combat: false, pendingMonster: false, actions: null })
      return
    }

    // ── 砍价输入 ──
    if (msg.type === 'bargain') {
      if (!gameStarted || !engine) return
      if (engine.session.combat?.active) { send('error', { text: '战斗中无法砍价。' }); return }
      if (processing) { send('error', { text: '处理中...' }); return }
      processing = true
      try {
        await streamEvents(engine.processBargain(msg.text?.trim() ?? ''))
      } finally {
        processing = false
      }
      return
    }

    // ── 游戏输入 ──
    if (msg.type === 'input') {
      if (!gameStarted || !engine) {
        send('error', { text: '游戏未开始。请先创建角色（刷新页面）。' })
        return
      }
      // 战斗中禁止非战斗输入（安全网：前端也有守卫）
      if (engine.session.combat?.active) {
        send('error', { text: '战斗中请使用操作按钮。' })
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
      } catch { }
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
