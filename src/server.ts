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
import { WORLD_OVERVIEW } from './data/maps.js'

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

app.use(express.static(join(__dirname, '..', 'public')))

// 每个 WebSocket 连接 = 一个独立的游戏会话
wss.on('connection', (ws: WebSocket) => {
  console.log('[server] new player connected')
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
    return fullText
  }

  // 发送系统消息
  function sysMsg(text: string) {
    send('system', { text })
  }

  ws.on('message', async (raw: Buffer) => {
    const msg = JSON.parse(raw.toString())

    // 会话隔离：处理消息前，把全局 session 切换到当前连接的 session
    if (connSession) setSession(connSession)

    // 角色创建
    if (msg.type === 'create') {
      const { name, classId } = msg
      const template = CLASS_TEMPLATES[classId]
      if (!template) { send('error', { text: '无效职业' }); return }

      connSession = createGameSession(name, classId)
      setSession(connSession)
      initDMAgent()
      dossier = new DossierManager()
      getFacts().save('autosave')
      gameStarted = true

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
      return
    }

    // 游戏指令
    if (msg.type === 'input' && gameStarted) {
      const input = msg.text?.trim()
      if (!input) return

      const session = getSession()
      const facts = getFacts()

      // Slash 命令
      if (input === '/status') {
        sysMsg(facts.getPlayerSummary()); return
      }
      if (input === '/quest') {
        const qm = new QuestManager(session)
        const active = qm.getActiveQuests()
        if (active.length === 0) { sysMsg('暂无任务。去找冒险者公会接任务。'); return }
        for (const q of active) {
          const done = q.objectivesCompleted.filter(Boolean).length
          sysMsg(`⚔ ${q.name} (${done}/${q.objectives.length})\n${q.objectives.map((o, i) => `  ${q.objectivesCompleted[i] ? '✓' : '○'} ${o}`).join('\n')}\n  奖励: ${q.reward.gold}金 + ${q.reward.xp}XP`)
        }
        sysMsg(`经验: ${session.player.xp} XP (Lv${session.player.level})`)
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
        sysMsg(WORLD_OVERVIEW.trim() + `\n\n当前位置: ${session.worldState.currentLocation}`)
        return
      }
      if (input === '/npc' || input === '/npc ') {
        if (dossier.listUnlocked().length > 0) {
          sysMsg(stripAnsi(dossier.renderList()))
        } else {
          sysMsg('暂无已知人物。')
        }
        return
      }
      if (input.startsWith('/npc ') && input.length > 5) {
        const npcName = input.slice(5).trim()
        sysMsg(stripAnsi(dossier.renderProfile(npcName)))
        return
      }
      if (input === '/world') {
        sysMsg(renderWorldGuideText()); return
      }
      if (input === '/inventory') {
        const p = session.player
        const items = p.inventory.map(i => `  ${i.name}`).join('\n') || '  (空)'
        sysMsg(`🎒 背包:\n${p.equipped.weapon ? `  [装备] ${p.equipped.weapon.name}\n` : ''}${p.equipped.armor ? `  [装备] ${p.equipped.armor.name}\n` : ''}${items}\n  💰 ${p.gold} 金币`)
        return
      }
      if (input === '/help') {
        sysMsg('命令: /status /quest /npc /npc <名> /world /map /inventory /save /load /help'); return
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

      // 任务检查
      const qm = new QuestManager(session)
      const objResults = qm.checkCombatObjectives()
      for (const r of objResults) sysMsg(`✓ 任务进度: ${r.questName} — ${r.text}`)

      // NPC 档案更新
      for (const npc of session.npcs) {
        if (input.includes(npc.name) || response.includes(npc.name)) {
          const unlock = dossier.unlock(npc.name, session.turnCount)
          if (unlock) sysMsg(`🔔 档案解锁: ${npc.name}`)
          const update = dossier.onInteraction(npc.name, npc.trust, session.turnCount)
          if (update) sysMsg(update.replace(/chalk\.\w+\(`([^`]*)`\)/g, '$1'))
        }
      }

      // 死亡检测
      if (session.player.hp <= 0) {
        sysMsg('💀 你倒下了……意识逐渐远去。')
      }

      // 自动存档
      if (session.turnCount % 5 === 0) {
        session.dossierData = dossier.toJSON()
        facts.save('autosave')
      }
    }
  })

  ws.on('close', () => console.log('[server] player disconnected'))
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
