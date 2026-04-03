#!/usr/bin/env node
/**
 * 破晓镇 TRPG — 主入口
 *
 * 角色创建 → 开场叙事 → 游戏循环
 */

import * as readline from 'node:readline'
import { readFileSync } from 'node:fs'
import chalk from 'chalk'
import type { GameSession, NPC } from './types.js'
import { initGameState, getSession, getFacts, initItemRegistry } from './game-state.js'
import { CLASS_TEMPLATES, createGameSession } from './game-data.js'
import { GameFactStore } from './game-facts.js'
import { checkSafety } from './safety.js'
import { DossierManager } from './dossier.js'
import { renderPrologue, renderWorldGuide } from './world-guide.js'

// ─── Dossier (全局) ─────────────────────────
let dossier = new DossierManager()

import { initDMAgent, dmRespond } from './dm-agent.js'
import { WORLD_OVERVIEW } from './data/maps.js'
import { getEarlyGuidance, checkIdleEvent, resetIdleTracking } from './events.js'
import { QuestManager } from './quest-manager.js'

// CLASS_TEMPLATES and createGameSession imported from game-data.ts

// ─── Readline Helpers ────────────────────────

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout })
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

// ─── Slash Commands ──────────────────────────

function handleSlashCommand(cmd: string): boolean {
  const session = getSession()
  const facts = getFacts()

  switch (cmd) {
    case '/status': {
      console.log()
      console.log(chalk.cyan(facts.getPlayerSummary()))
      console.log()
      return true
    }
    case '/inventory': {
      const p = session.player
      console.log()
      console.log(chalk.cyan('── 背包 ──'))
      if (p.equipped.weapon) console.log(chalk.yellow(`  [装备] ${p.equipped.weapon.name}`))
      if (p.equipped.armor) console.log(chalk.yellow(`  [装备] ${p.equipped.armor.name}`))
      if (p.inventory.length === 0) {
        console.log('  (空)')
      } else {
        for (const item of p.inventory) {
          console.log(`  ${item.name} (${item.type})`)
        }
      }
      console.log(chalk.yellow(`  金币: ${p.gold}`))
      console.log()
      return true
    }
    case '/map': {
      console.log(WORLD_OVERVIEW)
      console.log(chalk.dim(`  当前位置: ${session.worldState.currentLocation}`))
      console.log()
      return true
    }
    case '/save': {
      session.dossierData = dossier.toJSON()
      const savePath = facts.save()
      console.log(chalk.green(`\n  游戏已保存: ${savePath}\n`))
      return true
    }
    case '/saves': {
      const saves = GameFactStore.listSaves()
      if (saves.length === 0) {
        console.log(chalk.dim('\n  暂无存档。\n'))
      } else {
        console.log(chalk.cyan('\n  ── 存档列表 ──'))
        for (const s of saves) {
          console.log(`  ${chalk.bold(s.file)} — ${s.name} (第${s.turn}轮) ${chalk.dim(s.date)}`)
        }
        console.log(chalk.dim('  用法: /load <存档名>\n'))
      }
      return true
    }
    case '/npc':
    case '/npc ': {
      console.log(dossier.renderList())
      return true
    }
    case '/quest': {
      const qm = new QuestManager(session)
      const active = qm.getActiveQuests()
      console.log()
      console.log(chalk.cyan('  ══════ 任 务 日 志 ══════'))
      if (active.length === 0) {
        console.log(chalk.dim('\n  暂无进行中的任务。'))
        console.log(chalk.dim('  去找冒险者公会的艾琳娜或韩猛接任务。\n'))
      } else {
        for (const q of active) {
          const doneCount = q.objectivesCompleted.filter(Boolean).length
          console.log()
          console.log(`  ${chalk.yellow.bold('⚔')} ${chalk.bold(q.name)} ${chalk.dim(`(${doneCount}/${q.objectives.length})`)}`)
          console.log(chalk.dim(`    ${q.description}`))
          for (let i = 0; i < q.objectives.length; i++) {
            const done = q.objectivesCompleted[i]
            console.log(`    ${done ? chalk.green('✓') : chalk.dim('○')} ${done ? chalk.green(q.objectives[i]) : q.objectives[i]}`)
          }
          console.log(chalk.yellow(`    奖励: ${q.reward.gold}金 + ${q.reward.xp}XP`))
        }
        console.log()
      }
      const completed = session.quests.filter(q => q.status === 'completed')
      if (completed.length > 0) {
        console.log(chalk.dim(`  已完成: ${completed.map(q => '✓ ' + q.name).join('  ')}`))
      }
      const nextLvl = session.player.level < 3 ? (session.player.level === 1 ? 100 : 300) : null
      if (nextLvl) {
        const pct = Math.min(100, Math.round((session.player.xp / nextLvl) * 100))
        const bar = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)))
        console.log(`  经验: ${bar} ${session.player.xp}/${nextLvl} XP (Lv${session.player.level})`)
      } else {
        console.log(chalk.dim(`  经验: ${session.player.xp} XP (Lv${session.player.level} MAX)`))
      }
      console.log()
      return true
    }
    case '/world': {
      console.log(renderWorldGuide())
      return true
    }
    case '/help': {
      console.log()
      console.log(chalk.dim('  /status    — 查看角色状态'))
      console.log(chalk.dim('  /quest     — 查看任务日志'))
      console.log(chalk.dim('  /inventory — 查看背包'))
      console.log(chalk.dim('  /npc       — 查看已知人物档案'))
      console.log(chalk.dim('  /npc <名>  — 查看角色详细档案'))
      console.log(chalk.dim('  /world     — 查看世界指南'))
      console.log(chalk.dim('  /map       — 查看世界地图'))
      console.log(chalk.dim('  /save      — 手动存档'))
      console.log(chalk.dim('  /saves     — 列出所有存档'))
      console.log(chalk.dim('  /load      — 读取存档（/load <名称>）'))
      console.log(chalk.dim('  /quit      — 保存并退出'))
      console.log()
      return true
    }
    default:
      return false
  }
}

// ─── Splash Screen ───────────────────────────

function showSplash() {
  console.log()
  console.log(chalk.yellow('  ╔═════════════════════════════════════════════╗'))
  console.log(chalk.yellow('  ║                                             ║'))
  console.log(chalk.yellow('  ║') + chalk.bold.white('       破 晓 镇  ·  蚀 目 之 影             ') + chalk.yellow('║'))
  console.log(chalk.yellow('  ║') + chalk.dim('       Dawnbreak: Shadow of the Eclipsed Eye  ') + chalk.yellow('║'))
  console.log(chalk.yellow('  ║                                             ║'))
  console.log(chalk.yellow('  ║') + chalk.dim('           A CLI TRPG powered by Claude        ') + chalk.yellow('║'))
  console.log(chalk.yellow('  ║                                             ║'))
  console.log(chalk.yellow('  ╚═════════════════════════════════════════════╝'))
  console.log()
}

// ─── Character Creation ──────────────────────

async function characterCreation(rl: readline.Interface): Promise<{ name: string; classId: string }> {
  console.log(chalk.dim('  雨夜。一辆货运马车在泥泞的山路上颠簸前行。'))
  console.log(chalk.dim('  你在车上醒来，浑身湿透，头痛欲裂。'))
  console.log(chalk.dim('  记忆模糊——只记得自己的名字，以及"有人让我去破晓镇"。'))
  console.log()

  const name = (await ask(rl, chalk.bold('  你叫什么名字? '))).trim() || '无名旅人'
  console.log()

  console.log(chalk.dim('  你隐约记得自己曾经是……'))
  console.log()
  console.log(`  ${chalk.bold('[1]')} ${chalk.red('剑士')}  — 力量与勇气，近战为主 (STR 16, CON 14)`)
  console.log(`  ${chalk.bold('[2]')} ${chalk.blue('法师')}  — 奥术知识，远程法术 (INT 16, WIS 14)`)
  console.log(`  ${chalk.bold('[3]')} ${chalk.green('游侠')} — 敏捷与感知，潜行侦察 (DEX 16, WIS 14)`)
  console.log(`  ${chalk.bold('[4]')} ${chalk.yellow('牧师')} — 信仰与治疗，支援作战 (WIS 16, CON 14)`)
  console.log()

  let classId = ''
  while (!classId) {
    const choice = (await ask(rl, chalk.bold('  选择职业 [1-4]: '))).trim()
    const map: Record<string, string> = { '1': 'fighter', '2': 'mage', '3': 'ranger', '4': 'cleric' }
    classId = map[choice] ?? ''
    if (!classId) console.log(chalk.red('  请输入 1-4'))
  }

  return { name, classId }
}

// ─── Game Loop ───────────────────────────────

async function gameLoop(rl: readline.Interface, classId: string) {
  const session = getSession()
  const facts = getFacts()
  const classZh = CLASS_TEMPLATES[classId]?.nameZh ?? '冒险者'

  // ── 说书人开场 ──
  console.log(renderPrologue())

  // ── Opening scene ──
  console.log(chalk.dim('  ─── 游戏开始 ───'))
  console.log()

  const openingPrompt = [
    `新游戏开始。玩家角色: ${session.player.name}，${classZh}。`,
    '',
    '请开始第一幕：马车上醒来。',
    '',
    '场景要求：',
    '- 玩家在颠簸的货运马车上醒来，浑身湿透，头痛欲裂',
    '- 赶车的老头把玩家捡上来的，简单说几句话',
    '- 马车在破晓镇牌坊前停下，雨很大',
    '- 远处能看到几点灯火，唯一明亮的是碎盾亭酒馆',
    '- 引导玩家下车进镇',
    '- 不要问玩家名字和职业（已在角色创建中完成）',
    '- 第一次输出不要太长，3-4段即可',
  ].join('\n')

  const openingResponse = await sendToDM(openingPrompt)

  // 开场 DM 回复中提到的 NPC 自动解锁档案（如格雷格）
  for (const npc of session.npcs) {
    if (openingResponse.includes(npc.name)) {
      const notice = dossier.unlock(npc.name, 0)
      if (notice) console.log(notice)
    }
  }

  // ── Main loop ──
  let turnsSinceLastSave = 0

  while (true) {
    const input = (await ask(rl, chalk.bold('\n  ⚔️  你> '))).trim()

    if (!input) continue

    if (input === '/quit') {
      session.dossierData = dossier.toJSON()
      const path = facts.save('quicksave')
      console.log(chalk.green(`\n  游戏已保存 (${path})。下次见，冒险者。\n`))
      break
    }

    if (input.startsWith('/load')) {
      const slotName = input.slice('/load'.length).trim()
      if (!slotName) {
        // 列出存档供选择
        const saves = GameFactStore.listSaves()
        if (saves.length === 0) {
          console.log(chalk.red('\n  暂无存档。\n'))
        } else {
          console.log(chalk.cyan('\n  ── 可用存档 ──'))
          for (const s of saves) {
            console.log(`  ${chalk.bold(s.file)} — ${s.name} (第${s.turn}轮)`)
          }
          console.log(chalk.dim('  用法: /load <存档名>\n'))
        }
      } else {
        try {
          const loaded = GameFactStore.load(slotName)
          const loadedSession = loaded['session'] as GameSession
          initGameState(loadedSession)
          initDMAgent()
          resetIdleTracking()
          dossier = loadedSession.dossierData
            ? DossierManager.fromJSON(loadedSession.dossierData)
            : new DossierManager()
          console.log(chalk.green(`\n  存档已加载: ${slotName}\n`))
        } catch (err) {
          console.log(chalk.red(`\n  加载失败: ${(err as Error).message}\n`))
        }
      }
      continue
    }

    if (input.startsWith('/npc ') && input.length > 5) {
      const npcName = input.slice(5).trim()
      console.log(dossier.renderProfile(npcName))
      continue
    }
    if (input.startsWith('/')) {
      if (!handleSlashCommand(input)) {
        console.log(chalk.red(`  未知命令: ${input}。输入 /help 查看帮助。`))
      }
      continue
    }

    // Safety check
    const safety = checkSafety(input)
    if (safety.level === 'block') {
      console.log()
      console.log(chalk.red.bold(`  ⛔ ${safety.reason}`))
      console.log(chalk.red('  游戏已终止。'))
      facts.save('quicksave')
      break
    }

    session.turnCount++

    // ── 构建 DM 输入：安全指令 + 早期引导 + 防卡事件 ──
    const parts: string[] = []

    if (safety.level === 'warn') {
      parts.push(`[DM安全指令: ${safety.dmInstruction}]`)
    }

    const guidance = getEarlyGuidance(session.turnCount)
    if (guidance) {
      parts.push(guidance)
    }

    const idleEvent = checkIdleEvent(input)
    if (idleEvent) {
      parts.push(idleEvent)
    }

    parts.push(input)
    const dmInput = parts.join('\n\n')
    const dmResponse = await sendToDM(dmInput)
    parseTrustChanges(dmResponse, session.npcs)

    // ── 战斗胜利后检查任务目标 ──
    const qm = new QuestManager(session)
    const { completed: objCompleted, progress: objProgress } = qm.checkCombatObjectives()
    for (const r of objCompleted) {
      console.log(chalk.green(`\n  [任务完成] ${r.questName}：完成 "${r.text}"`))
    }
    for (const p of objProgress) {
      console.log(chalk.yellow(`\n  [任务进度] ${p.questName}：${p.text}`))
    }

    // NPC 档案更新 — 检测玩家输入或 DM 回复中提到的 NPC
    for (const npc of session.npcs) {
      if (input.includes(npc.name) || dmInput.includes(npc.name) || dmResponse.includes(npc.name)) {
        // 首次遇见 → 解锁档案
        const unlockNotice = dossier.unlock(npc.name, session.turnCount)
        if (unlockNotice) console.log(unlockNotice)

        // 根据信任度揭示新信息
        const updateNotice = dossier.onInteraction(npc.name, npc.trust, session.turnCount)
        if (updateNotice) console.log(updateNotice)
      }
    }

    // Auto-save every 5 turns
    turnsSinceLastSave++
    if (turnsSinceLastSave >= 5) {
      session.dossierData = dossier.toJSON()
      facts.save('autosave')
      console.log(chalk.dim('\n  [自动存档]'))
      turnsSinceLastSave = 0
    }

    // Check death
    if (session.player.hp <= 0) {
      console.log()
      console.log(chalk.red.bold('  ══════════════════════════════════'))
      console.log(chalk.red.bold('    你倒下了……意识逐渐远去。'))
      console.log(chalk.red.bold('  ══════════════════════════════════'))
      console.log()
      facts.save('save.json')
      break
    }
  }

  rl.close()
}

/**
 * Send input to DM agent and print the response.
 * Tool outputs are printed by the tools themselves (console.log in execute).
 * Text responses from the DM are printed here.
 */
async function sendToDM(input: string): Promise<string> {
  let fullText = ''
  try {
    for await (const event of dmRespond(input)) {
      if (event.type === 'text_delta') {
        const text = event.text ?? ''
        process.stdout.write(text)
        fullText += text
      }
    }
    console.log()
  } catch (err) {
    console.log(chalk.red(`\n  [错误: ${(err as Error).message.slice(0, 80)}]`))
  }
  return fullText
}

/** Parse [信任变化:NPC名:+N:原因] annotations from DM output and update NPC trust */
function parseTrustChanges(text: string, npcs: NPC[]): void {
  const pattern = /\[信任变化:(.+?):([+-]\d+):(.+?)\]/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const [, npcName, deltaStr, reason] = match
    const delta = parseInt(deltaStr, 10)
    const npc = npcs.find(n => n.name === npcName)
    if (npc) {
      npc.trust += delta
      console.log(chalk.dim(`  [${npcName} 信任度 ${delta > 0 ? '+' : ''}${delta} → ${npc.trust}：${reason}]`))
    }
  }
}

// ─── Main ────────────────────────────────────

async function main() {
  showSplash()

  const rl = createRL()

  try {
    const { name, classId } = await characterCreation(rl)
    const session = createGameSession(name, classId)

    initGameState(session)
    initItemRegistry()
    // 存一个初始存档（Claude SDK 模式下 game-cmd.ts 需要读取）
    getFacts().save('autosave')
    initDMAgent()

    const template = CLASS_TEMPLATES[classId]
    console.log()
    console.log(chalk.dim(`  ${name}，${template.nameZh}。HP: ${template.maxHp}。装备: 生锈的短剑。`))

    await gameLoop(rl, classId)
  } catch (err) {
    console.error(chalk.red(`Fatal: ${(err as Error).message}`))
    rl.close()
    process.exit(1)
  }
}

main()
