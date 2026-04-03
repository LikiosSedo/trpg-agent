/**
 * Web Server — 把 CLI TRPG 变成 Web 游戏
 *
 * Express 提供前端页面，WebSocket 处理实时游戏交互。
 * 游戏引擎完全复用，只是 I/O 从 readline 换成 WebSocket。
 */

import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { GameSession } from './types.js'
import { initGameState, getSession, getFacts, setSession } from './game-state.js'
import { CLASS_TEMPLATES, createGameSession } from './game-data.js'
import { initDMAgent, dmRespond } from './dm-agent.js'
import { DossierManager } from './dossier.js'
import { GameFactStore } from './game-facts.js'
import { renderPrologue, renderWorldGuide } from './world-guide.js'
import { QuestManager } from './quest-manager.js'
import { checkSafety } from './safety.js'
import { getEarlyGuidance, checkIdleEvent, resetIdleTracking } from './events.js'
import { WORLD_OVERVIEW, locations } from './data/maps.js'
import { executeMonsterPhase, getCombatSummary } from './combat-manager.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Strip ANSI escape codes for web output */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// CLASS_TEMPLATES and createGameSession imported from game-data.ts

// ─── Express + WebSocket Server ───

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

// ─── 访问密码保护 ───
// 密码通过环境变量 TRPG_PASSWORD 设置，不写在代码中
// 使用 timing-safe comparison 防止时序攻击
import { timingSafeEqual, createHash } from 'crypto'

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

// 密码验证 API（POST，不是 GET，防止浏览器历史泄露）
app.use(express.json())
app.post('/api/auth', (req, res) => {
  if (!PASSWORD_ENABLED) {
    res.json({ ok: true })
    return
  }
  const { password } = req.body ?? {}
  if (verifyPassword(password ?? '')) {
    // 返回一个 session token（密码的 hash，有效期内免重复输入）
    res.json({ ok: true, token: PASSWORD_HASH })
  } else {
    res.status(401).json({ ok: false, error: '密码错误' })
  }
})

// 健康检查 + 诊断
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, password: PASSWORD_ENABLED, env: !!process.env.TRPG_API_KEY, clients: wss.clients.size })
})

// WebSocket 测试页面
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

// 每个 WebSocket 连接 = 一个独立的游戏会话
wss.on('connection', (ws: WebSocket, req) => {
  console.log('[ws] connection from:', req.headers['user-agent']?.slice(0, 50))
  // WebSocket 连接时验证 token（从 URL query 传入）
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
  let dossier = new DossierManager()
  let connSession: GameSession | null = null
  let gameStarted = false

  // 发消息给前端
  function send(type: string, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }))
    }
  }

  // 发送 DM 消息
  async function sendToDM(input: string): Promise<string> {
    let fullText = ''
    try {
      for await (const event of dmRespond(input)) {
        if (event.type === 'text_delta') {
          const text = event.text ?? ''
          send('dm', { text })
          fullText += text
        }
      }
    } catch (err) {
      send('error', { text: (err as Error).message.slice(0, 100) })
    }
    send('dm_end', {
      combat: !!connSession?.combat?.active,
      pendingMonster: !!connSession?.combat?.pendingMonsterTurn,
    })
    return fullText
  }

  // 发送系统消息
  function sysMsg(text: string) {
    send('system', { text })
  }

  ws.on('message', async (raw: Buffer) => {
    let msg: any
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      send('error', { text: '消息格式错误' })
      return
    }

    // 会话隔离：处理消息前，把全局 session 切换到当前连接的 session
    if (connSession) setSession(connSession)

    // 恢复存档（从客户端 localStorage）
    if (msg.type === 'resume') {
      try {
        connSession = msg.session
        setSession(connSession)
        initDMAgent()
        dossier = msg.dossier ? DossierManager.fromJSON(msg.dossier) : new DossierManager()
        resetIdleTracking()
        gameStarted = true
        console.log(`[server] resumed session for ${connSession.player.name}`)
        send('resumed', {})
      } catch (err) {
        console.error('[server] resume failed:', err)
        send('resume_failed', { text: `恢复失败: ${(err as Error).message.slice(0, 80)}` })
      }
      return
    }

    // 角色创建
    if (msg.type === 'create') {
      const { name, classId } = msg
      const template = CLASS_TEMPLATES[classId]
      if (!template) { send('error', { text: '无效职业' }); return }

      try {
        connSession = createGameSession(name, classId)
        setSession(connSession)
        initDMAgent()
        dossier = new DossierManager()
        getFacts().save('autosave')
        gameStarted = true
        console.log(`[server] game started for ${name} (${classId})`)
      } catch (err) {
        console.error('[server] game init failed:', err)
        send('error', { text: `游戏初始化失败: ${(err as Error).message.slice(0, 80)}` })
        return
      }

      // 发送说书人序幕
      send('prologue', { text: '破晓镇 · 蚀目之影\n\n' + renderPrologueText() })

      // DM 开场
      const opening = `新游戏开始。玩家角色: ${name}，${template.nameZh}。\n请开始第一幕：马车上醒来。简短3-4段。`
      const response = await sendToDM(opening)

      // 检测 NPC 解锁
      for (const npc of connSession.npcs) {
        if (response.includes(npc.name)) {
          const notice = dossier.unlock(npc.name, 0)
          if (notice) sysMsg(`🔔 新角色档案解锁: ${npc.name}`)
        }
      }

      // 同步初始存档到客户端
      send('sync', { session: connSession, dossier: dossier.toJSON() })
      return
    }

    // 游戏指令
    if (msg.type === 'input') {
      if (!gameStarted) {
        send('error', { text: '游戏未开始。请先创建角色（刷新页面）。' })
        return
      }
      const input = msg.text?.trim()
      if (!input) return

      const session = getSession()
      const facts = getFacts()

      // Slash 命令
      if (input === '/status') {
        const p = session.player
        const m = p.abilityModifiers
        const atkMod = p.equipped.weapon ? m.STR + 2 + (p.equipped.weapon.bonus ?? 0) : 0
        const damageDice = p.equipped.weapon?.description.match(/\d+d\d+/)?.[0] ?? '?'
        send('panel', { panel: 'status', data: {
          name: p.name,
          level: p.level,
          hp: p.hp,
          maxHp: p.maxHp,
          gold: p.gold,
          xp: p.xp,
          nextLevelXp: p.level === 1 ? 100 : p.level === 2 ? 300 : null,
          abilities: {
            STR: { value: p.abilities.STR, mod: m.STR },
            DEX: { value: p.abilities.DEX, mod: m.DEX },
            CON: { value: p.abilities.CON, mod: m.CON },
            INT: { value: p.abilities.INT, mod: m.INT },
            WIS: { value: p.abilities.WIS, mod: m.WIS },
            CHA: { value: p.abilities.CHA, mod: m.CHA },
          },
          equipped: {
            weapon: p.equipped.weapon ? { name: p.equipped.weapon.name, attackMod: atkMod, damage: damageDice } : null,
            armor: p.equipped.armor ? { name: p.equipped.armor.name, ac: p.equipped.armor.bonus ?? 0 } : null,
          },
          spells: p.spells.map(s => ({
            name: s.name,
            desc: s.description,
            remaining: s.remaining,
            max: s.usesPerRest,
            isCantrip: s.usesPerRest === 0,
          })),
          skills: p.skills as string[],
          actions: (() => {
            const a = ['weapon(武器攻击)']
            if (p.spells.some(s => s.remaining > 0 || s.usesPerRest === 0)) a.push('spell(施法)')
            a.push('flee(逃跑)')
            return a
          })(),
        }})
        return
      }
      if (input === '/quest') {
        const qm = new QuestManager(session)
        const active = qm.getActiveQuests()
        const completed = session.quests.filter(q => q.status === 'completed').map(q => q.name)
        const monsterMap: Record<string, string> = {
          '狼': 'Wolf', '哥布林': 'Goblin', '骷髅': 'Skeleton',
          '巨型蜘蛛': 'Giant Spider', '暗影': 'Shadow', '食尸鬼': 'Ghoul', '兽人战士': 'Orc Warrior',
        }
        send('panel', { panel: 'quest', data: {
          active: active.map(q => ({
            name: q.name,
            desc: q.description,
            objectives: q.objectives.map((obj, i) => {
              const done = q.objectivesCompleted[i]
              let progress: { current: number; required: number } | undefined
              if (!done) {
                const killMatch = obj.match(/击杀(\d+)只(.+?)(\s*\[.+\])?$/)
                if (killMatch) {
                  const required = Number(killMatch[1])
                  const monsterNameEn = monsterMap[killMatch[2]]
                  const kills = monsterNameEn ? Number(session.worldState.flags[`kills_${monsterNameEn}`] ?? 0) : 0
                  progress = { current: kills, required }
                }
              }
              return { text: obj, done, progress }
            }),
            reward: { gold: q.reward.gold, xp: q.reward.xp },
          })),
          completed,
          xp: session.player.xp,
          level: session.player.level,
          nextLevelXp: session.player.level === 1 ? 100 : session.player.level === 2 ? 300 : null,
        }})
        return
      }
      if (input === '/save') {
        session.dossierData = dossier.toJSON()
        const savePath = facts.save('web-save')
        sysMsg(`游戏已保存: ${savePath}`)
        return
      }
      if (input.startsWith('/load')) {
        const slotName = input.slice('/load'.length).trim()
        if (!slotName) {
          const saves = GameFactStore.listSaves()
          if (saves.length === 0) { sysMsg('暂无存档。'); return }
          let list = '── 存档列表 ──\n'
          for (const s of saves) list += `  ${s.file} — ${s.name} (第${s.turn}轮) ${s.date}\n`
          list += '用法: /load <存档名>'
          sysMsg(list)
        } else {
          try {
            const loaded = GameFactStore.load(slotName)
            const loadedSession = (loaded as any).session as GameSession
            connSession = loadedSession
            setSession(connSession)
            initDMAgent()
            resetIdleTracking()
            dossier = loadedSession.dossierData
              ? DossierManager.fromJSON(loadedSession.dossierData)
              : new DossierManager()
            sysMsg(`存档已加载: ${slotName}`)
          } catch (err) {
            sysMsg(`加载失败: ${(err as Error).message}`)
          }
        }
        return
      }
      if (input === '/map') {
        send('panel', { panel: 'map', data: {
          currentLocation: session.worldState.currentLocation,
          locations: Object.values(locations).map(loc => ({
            id: loc.id,
            nameZh: loc.nameZh,
            danger: loc.dangerLevel,
            description: loc.description,
          })),
        }})
        return
      }
      if (input === '/npc' || input === '/npc ') {
        const trustMap: Record<string, number> = {}
        for (const npc of session.npcs) trustMap[npc.name] = npc.trust
        send('panel', { panel: 'npc_list', data: {
          npcs: dossier.toListData(trustMap),
        }})
        return
      }
      if (input.startsWith('/npc ') && input.length > 5) {
        const npcName = input.slice(5).trim()
        const npcData = session.npcs.find(n => n.name.includes(npcName) || npcName.includes(n.name))
        const profileData = dossier.toProfileData(npcName, npcData?.trust)
        if (profileData) {
          send('panel', { panel: 'npc_detail', data: profileData })
        } else {
          sysMsg(`未找到 "${npcName}" 的档案。输入 /npc 查看已知角色。`)
        }
        return
      }
      if (input === '/world') {
        sysMsg(renderWorldGuideText()); return
      }
      if (input === '/inventory') {
        const p = session.player
        send('panel', { panel: 'inventory', data: {
          weapon: p.equipped.weapon ? { name: p.equipped.weapon.name, desc: p.equipped.weapon.description } : null,
          armor: p.equipped.armor ? { name: p.equipped.armor.name, desc: p.equipped.armor.description } : null,
          items: p.inventory.map(i => ({ name: i.name, type: i.type, desc: i.description })),
          gold: p.gold,
        }})
        return
      }
      if (input === '/saves') {
        send('panel', { panel: 'saves', data: {
          saves: GameFactStore.listSaves(),
        }})
        return
      }
      if (input === '/quit') {
        session.dossierData = dossier.toJSON()
        getFacts().save('web-quit')
        sysMsg('游戏已保存。再见，冒险者！')
        gameStarted = false
        return
      }
      if (input === '/help') {
        send('panel', { panel: 'help', data: {
          commands: [
            { cmd: '/status', desc: '查看角色状态' },
            { cmd: '/quest', desc: '查看任务进度' },
            { cmd: '/npc', desc: '查看已知人物' },
            { cmd: '/npc <名>', desc: '查看人物详情' },
            { cmd: '/world', desc: '查看世界指南' },
            { cmd: '/map', desc: '查看地图' },
            { cmd: '/inventory', desc: '查看背包' },
            { cmd: '/save', desc: '保存游戏' },
            { cmd: '/saves', desc: '查看存档列表' },
            { cmd: '/load <名>', desc: '加载存档' },
            { cmd: '/quit', desc: '退出游戏' },
          ],
        }})
        return
      }

      // 安全检查
      const safety = checkSafety(input)
      if (safety.level === 'block') {
        sysMsg(`⛔ ${safety.reason}`); return
      }

      session.turnCount++

      // 构建 DM 输入
      const parts: string[] = []
      if (safety.level === 'warn') parts.push(`[DM安全指令: ${safety.dmInstruction}]`)
      const guidance = getEarlyGuidance(session.turnCount)
      if (guidance) parts.push(guidance)
      const idle = checkIdleEvent(input)
      if (idle) parts.push(idle)
      parts.push(input)

      const response = await sendToDM(parts.join('\n\n'))

      // 怪物回合分段发送（玩家回合已由 DM 叙事完成）
      if (session.combat?.pendingMonsterTurn) {
        const monsterResult = executeMonsterPhase(session)
        if (monsterResult.log.length > 0) {
          send('combat_monster', { text: monsterResult.log.join('\n') })
        }
        if (!monsterResult.ended) {
          const status = getCombatSummary(session)
          if (status) send('combat_status', { text: status, ended: false })
        } else {
          send('combat_status', {
            text: monsterResult.result === 'victory' ? '战斗胜利！' : '战斗失败...',
            ended: true,
            result: monsterResult.result,
          })
        }
      } else if (session.combat?.active) {
        // 战斗中但无待处理怪物回合（如逃跑失败后）
        const status = getCombatSummary(session)
        if (status) send('combat_status', { text: status, ended: false })
      }

      // 任务检查
      const qm = new QuestManager(session)
      const { completed: objCompleted, progress: objProgress } = qm.checkCombatObjectives()
      for (const r of objCompleted) sysMsg(`✓ 任务完成: ${r.questName} — ${r.text}`)
      for (const p of objProgress) {
        send('quest_progress', { quest: p.questName, text: p.text, current: p.current, required: p.required })
      }

      // NPC 档案更新
      for (const npc of session.npcs) {
        if (input.includes(npc.name) || response.includes(npc.name)) {
          const unlock = dossier.unlock(npc.name, session.turnCount)
          if (unlock) sysMsg(`🔔 档案解锁: ${npc.name}`)
          const update = dossier.onInteraction(npc.name, npc.trust, session.turnCount)
          if (update) sysMsg(update.replace(/chalk\.\w+\(`([^`]*)`\)/g, '$1'))
        }
      }

      // 同步存档到客户端 localStorage
      send('sync', { session: connSession, dossier: dossier.toJSON() })

      // 死亡检测
      if (session.player.hp <= 0) {
        sysMsg('💀 你倒下了……意识逐渐远去。\n游戏结束。刷新页面重新开始。')
        session.dossierData = dossier.toJSON()
        facts.save('death-save')
        gameStarted = false  // 停止接受后续输入
        return
      }

      // 自动存档
      if (session.turnCount % 5 === 0) {
        session.dossierData = dossier.toJSON()
        facts.save('autosave')
      }
    }
  })

  ws.on('close', () => {
    // 断线自动存档
    if (connSession && gameStarted) {
      try {
        connSession.dossierData = dossier.toJSON()
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

const PORT = parseInt(process.env.PORT ?? '3000')
server.listen(PORT, () => {
  console.log(`\n  🏰 破晓镇 Web Server`)
  console.log(`  http://localhost:${PORT}`)
  console.log()
})
