#!/usr/bin/env node
/**
 * 破晓镇 TRPG — CLI 入口
 *
 * 薄适配器：只负责 I/O 渲染，所有游戏逻辑在 GameEngine。
 */

import * as readline from 'node:readline'
import chalk from 'chalk'
import { GameEngine, type CommandResult, type TurnEvent } from './engine.js'
import { CLASS_TEMPLATES } from './game-data.js'
import { initItemRegistry } from './game-state.js'

// ─── Readline Helpers ────────────────────────

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout })
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
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

// ─── Render Command Result ─────────────────

function renderCommand(result: CommandResult, engine: GameEngine): void {
  switch (result.type) {
    case 'status':
      console.log('\n' + chalk.cyan(result.data.playerSummary) + '\n')
      break
    case 'inventory':
      console.log('\n' + chalk.cyan('── 背包 ──'))
      if (result.data.weapon) console.log(chalk.yellow(`  [装备] ${result.data.weapon.name}`))
      if (result.data.armor) console.log(chalk.yellow(`  [装备] ${result.data.armor.name}`))
      for (const item of result.data.items) console.log(`  ${item.name} (${item.type})`)
      if (!result.data.items.length && !result.data.weapon && !result.data.armor) console.log('  (空)')
      console.log(chalk.yellow(`  金币: ${result.data.gold}`) + '\n')
      break
    case 'quest':
      console.log('\n' + chalk.cyan('  ══════ 任 务 日 志 ══════'))
      if (!result.data.active.length) {
        console.log(chalk.dim('\n  暂无进行中的任务。'))
        console.log(chalk.dim('  去找冒险者公会的艾琳娜或韩猛接任务。\n'))
      } else {
        for (const q of result.data.active) {
          const doneCount = q.objectives.filter((o: any) => o.done).length
          console.log(`\n  ${chalk.yellow.bold('⚔')} ${chalk.bold(q.name)} ${chalk.dim(`(${doneCount}/${q.objectives.length})`)}`)
          console.log(chalk.dim(`    ${q.desc}`))
          for (const obj of q.objectives) {
            console.log(`    ${obj.done ? chalk.green('✓') : chalk.dim('○')} ${obj.done ? chalk.green(obj.text) : obj.text}`)
          }
          console.log(chalk.yellow(`    奖励: ${q.reward.gold}金 + ${q.reward.xp}XP`))
        }
        console.log()
      }
      if (result.data.completed.length) console.log(chalk.dim(`  已完成: ${result.data.completed.map((n: string) => '✓ ' + n).join('  ')}`))
      if (result.data.nextLevelXp) {
        const pct = Math.min(100, Math.round((result.data.xp / result.data.nextLevelXp) * 100))
        const bar = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)))
        console.log(`  经验: ${bar} ${result.data.xp}/${result.data.nextLevelXp} XP (Lv${result.data.level})`)
      } else {
        console.log(chalk.dim(`  经验: ${result.data.xp} XP (Lv${result.data.level} MAX)`))
      }
      console.log()
      break
    case 'map':
      console.log(result.data.worldOverview)
      const mapLoc = result.data.locations.find((l: any) => l.id === result.data.currentLocation)
      const subName = result.data.currentSubLocation ? result.data.subLocations.find((s: any) => s.isCurrent)?.nameZh : ''
      console.log(chalk.dim(`  当前位置: ${mapLoc?.nameZh ?? result.data.currentLocation}${subName ? ' · ' + subName : ''}`))
      if (result.data.subLocations.length) {
        console.log(chalk.dim('\n  区域内地点:'))
        for (const sl of result.data.subLocations) {
          const npcStr = sl.npcs.length ? chalk.dim(` (${sl.npcs.join('、')})`) : ''
          console.log(`  ${sl.isCurrent ? chalk.yellow('📍') : '  '} ${sl.nameZh}${npcStr}`)
        }
      }
      console.log()
      break
    case 'shop':
      if (!result.data) { console.log(chalk.dim('\n  附近没有商店。\n')); break }
      console.log('\n' + chalk.cyan(`  ── ${result.data.npcName}的商店 ──`))
      console.log(chalk.yellow(`  你的金币: ${result.data.playerGold}`))
      for (const it of result.data.items) {
        console.log(`  ${it.name} (${it.type}) — ${chalk.yellow(it.price + '金')}`)
      }
      console.log(chalk.dim('  对DM说"我要买XX"即可购买。\n'))
      break
    case 'npc_list':
      console.log(engine.dossier.renderList())
      break
    case 'npc_detail':
      console.log(result.text ?? engine.dossier.renderProfile(result.data?.name ?? ''))
      break
    case 'recap':
      console.log('\n' + chalk.cyan('  ── 故事回顾 ──'))
      if (result.data.critical.length) {
        console.log(chalk.yellow('\n  关键事件:'))
        for (const e of result.data.critical) console.log(`  [第${e.turn}轮] ${e.fact}`)
      }
      if (result.data.recent.length) {
        console.log(chalk.dim('\n  近期事件:'))
        for (const e of result.data.recent) console.log(chalk.dim(`  [第${e.turn}轮] ${e.fact}`))
      }
      if (result.data.clues.length) {
        console.log(chalk.blue('\n  已知线索:'))
        for (const c of result.data.clues) console.log(`  • ${c}`)
      }
      console.log()
      break
    case 'chapter':
      if (!result.data) { console.log(chalk.dim('\n  当前存档不支持章节系统。\n')); break }
      console.log('\n' + chalk.cyan(`  ── ${result.data.title} ──`))
      for (const [loc, v] of Object.entries(result.data.exploration) as any) {
        const pct = v.total > 0 ? Math.round(v.found / v.total * 100) : 0
        const bar = chalk.green('█'.repeat(Math.round(pct / 5))) + chalk.dim('░'.repeat(20 - Math.round(pct / 5)))
        console.log(`  ${loc}: ${bar} ${v.found}/${v.total}`)
      }
      if (result.data.discoveries.length) {
        console.log(chalk.dim('\n  已发现:'))
        for (const l of result.data.discoveries) console.log(chalk.dim(`    ✦ ${l}`))
      }
      console.log()
      break
    case 'help':
      console.log()
      for (const c of result.data.commands) console.log(chalk.dim(`  ${c.cmd.padEnd(14)} — ${c.desc}`))
      console.log()
      break
    case 'world':
      console.log(result.text)
      break
    case 'save':
      console.log(chalk.green(`\n  游戏已保存: ${result.savePath}\n`))
      break
    case 'saves':
      if (!result.data.saves.length) { console.log(chalk.dim('\n  暂无存档。\n')); break }
      console.log(chalk.cyan('\n  ── 存档列表 ──'))
      for (const s of result.data.saves) console.log(`  ${chalk.bold(s.file)} — ${s.name} (第${s.turn}轮) ${chalk.dim(s.date)}`)
      console.log(chalk.dim('  用法: /load <存档名>\n'))
      break
    case 'load':
      console.log(result.success ? chalk.green(`\n  ${result.message}\n`) : chalk.red(`\n  ${result.message}\n`))
      break
    case 'quit':
      console.log(chalk.green(`\n  游戏已保存 (${result.savePath})。下次见，冒险者。\n`))
      break
    default:
      if (result.text) console.log(result.text)
      break
  }
}

// ─── Render Turn Event ─────────────────────

function renderTurnEvent(event: TurnEvent): void {
  switch (event.type) {
    case 'dm_text_delta':
      process.stdout.write(event.text)
      break
    case 'dm_end':
      console.log()
      if (event.actions) {
        if (event.actions.details.length)
          console.log(chalk.dim('\n  🔍 ' + event.actions.details.map(d => d.label).join('  |  ')))
        if (event.actions.suggestions.length)
          console.log(chalk.dim('  💡 ' + event.actions.suggestions.join('  |  ')))
      }
      break
    case 'dm_error':
      console.log(chalk.red(`\n  [错误: ${event.message}]`))
      break
    case 'broken_promise':
      console.log(chalk.red(`  💔 ${event.npcName}对你失望了：${event.reason}`))
      break
    case 'safety_block':
      console.log(chalk.red.bold(`\n  ⛔ ${event.reason}`))
      console.log(chalk.red('  游戏已终止。'))
      break
    case 'combat_monster':
      console.log(chalk.hex('#ff8c42')(event.text))
      break
    case 'combat_status':
      console.log(chalk.dim(event.text))
      break
    case 'quest_completed':
      console.log(chalk.green(`\n  [任务完成] ${event.questName}：${event.text}`))
      break
    case 'quest_progress':
      console.log(chalk.yellow(`\n  [任务进度] ${event.questName}：${event.text}`))
      break
    case 'npc_unlock':
      console.log(chalk.cyan(`  🔔 新角色档案解锁: ${event.npcName}`))
      break
    case 'npc_update':
      console.log(event.text)
      break
    case 'npc_unlock':
      console.log(chalk.yellow.bold(`\n  🔔 新角色档案解锁：${event.npcName}`))
      if (event.firstFacts.length) {
        for (const f of event.firstFacts) console.log(chalk.dim(`    · ${f}`))
      }
      console.log(chalk.dim('    已收藏到人物档案\n'))
      break
    case 'npc_speaking':
      console.log(chalk.cyan(`\n  [${event.npcName}]`))
      break
    case 'combat_portraits':
      for (const m of event.monsters) {
        const bar = chalk.red('█'.repeat(Math.round(m.hp / m.maxHp * 10))) + chalk.dim('░'.repeat(10 - Math.round(m.hp / m.maxHp * 10)))
        console.log(chalk.hex('#ff8c42')(`  ${m.name} ${bar} ${m.hp}/${m.maxHp}`))
      }
      break
    case 'audio':
      break // CLI 不播放音频
    case 'auto_save':
      console.log(chalk.dim('\n  [自动存档]'))
      break
    case 'death':
      console.log(chalk.red.bold('\n  ══════════════════════════════════'))
      console.log(chalk.red.bold('    你倒下了……意识逐渐远去。'))
      console.log(chalk.red.bold('  ══════════════════════════════════\n'))
      break
    // sync is silent in CLI
  }
}

// ─── Game Loop ─────────────────────────────

async function gameLoop(rl: readline.Interface, engine: GameEngine) {
  let lastActions: any = null

  // Show prologue
  console.log(engine.getPrologue())
  console.log(chalk.dim('  ─── 游戏开始 ───'))
  console.log()

  // Stream opening
  for await (const event of engine.streamOpening()) {
    renderTurnEvent(event)
    if (event.type === 'dm_end') lastActions = event.actions
  }

  // Main loop
  while (true) {
    const input = (await ask(rl, chalk.bold('\n  ⚔️  你> '))).trim()
    if (!input) continue

    // Check detail match (pre-rendered content from last actions)
    if (lastActions?.details) {
      const detail = lastActions.details.find((d: any) => d.label === input || input === d.label.replace('🔍 ', ''))
      if (detail) {
        console.log(chalk.italic.dim(`\n  ${detail.content}\n`))
        continue
      }
    }

    // Slash commands
    if (input.startsWith('/')) {
      const result = engine.executeCommand(input)
      if (result) {
        renderCommand(result, engine)
        if (result.type === 'quit') break
        continue
      }
      console.log(chalk.red(`  未知命令: ${input}。输入 /help 查看帮助。`))
      continue
    }

    // Game turn
    lastActions = null
    for await (const event of engine.processTurn(input)) {
      renderTurnEvent(event)
      if (event.type === 'dm_end') lastActions = event.actions
      if (event.type === 'safety_block' || event.type === 'death') { rl.close(); return }
    }
  }

  rl.close()
}

// ─── Main ────────────────────────────────────

async function main() {
  showSplash()
  initItemRegistry()

  const rl = createRL()
  try {
    const { name, classId } = await characterCreation(rl)
    const engine = GameEngine.createGame(name, classId)

    const template = CLASS_TEMPLATES[classId]
    console.log()
    console.log(chalk.dim(`  ${name}，${template.nameZh}。HP: ${template.maxHp}。装备: 生锈的短剑。`))

    await gameLoop(rl, engine)
  } catch (err) {
    console.error(chalk.red(`Fatal: ${(err as Error).message}`))
    rl.close()
    process.exit(1)
  }
}

main()
