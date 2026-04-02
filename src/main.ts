#!/usr/bin/env node
/**
 * 破晓镇 TRPG — 主入口
 *
 * 角色创建 → 开场叙事 → 游戏循环
 */

import * as readline from 'node:readline'
import { readFileSync } from 'node:fs'
import chalk from 'chalk'
import type { PlayerCharacter, GameSession, NPC, Spell, AbilityScores } from './types.js'
import { initGameState, getSession, getFacts } from './game-state.js'
import { GameFactStore } from './game-facts.js'
import { checkSafety } from './safety.js'
import { DossierManager } from './dossier.js'

// ─── Dossier (全局) ─────────────────────────
let dossier = new DossierManager()

import { initDMAgent, dmRespond } from './dm-agent.js'
import { WORLD_OVERVIEW } from './data/maps.js'

// ─── Character Class Templates ───────────────

interface ClassTemplate {
  nameZh: string
  abilities: AbilityScores
  skills: PlayerCharacter['skills']
  maxHp: number
  spells: Spell[]
}

const CLASS_TEMPLATES: Record<string, ClassTemplate> = {
  fighter: {
    nameZh: '剑士',
    abilities: { STR: 16, DEX: 12, CON: 14, INT: 8, WIS: 10, CHA: 10 },
    skills: ['athletics', 'intimidation'],
    maxHp: 12,
    spells: [],
  },
  mage: {
    nameZh: '法师',
    abilities: { STR: 8, DEX: 12, CON: 10, INT: 16, WIS: 14, CHA: 10 },
    skills: ['arcana', 'investigation'],
    maxHp: 8,
    spells: [
      { name: 'Fire Bolt', description: '投射一团火焰', effect: 'Deal 1d10 fire damage on a ranged spell attack hit.', usesPerRest: 0, remaining: 0 },
      { name: 'Magic Missile', description: '三枚魔法飞弹自动命中', effect: 'Deal 3d4+3 force damage, auto-hit, split among up to 3 targets.', usesPerRest: 3, remaining: 3 },
      { name: 'Shield', description: '魔法护盾', effect: 'Reaction: +5 AC until the start of your next turn.', usesPerRest: 3, remaining: 3 },
      { name: 'Detect Magic', description: '侦测30尺内的魔法', effect: 'Reveal magical auras and identify the school of magic.', usesPerRest: 3, remaining: 3 },
    ],
  },
  ranger: {
    nameZh: '游侠',
    abilities: { STR: 12, DEX: 16, CON: 12, INT: 10, WIS: 14, CHA: 8 },
    skills: ['stealth', 'perception'],
    maxHp: 10,
    spells: [],
  },
  cleric: {
    nameZh: '牧师',
    abilities: { STR: 14, DEX: 10, CON: 14, INT: 10, WIS: 16, CHA: 12 },
    skills: ['medicine', 'insight'],
    maxHp: 10,
    spells: [
      { name: 'Cure Wounds', description: '触摸治疗伤口', effect: 'Restore 1d8+WIS modifier HP to a creature you touch.', usesPerRest: 3, remaining: 3 },
      { name: 'Detect Magic', description: '侦测30尺内的魔法', effect: 'Reveal magical auras and identify the school of magic.', usesPerRest: 3, remaining: 3 },
    ],
  },
}

function computeModifiers(abilities: AbilityScores): AbilityScores {
  const mod = (v: number) => Math.floor((v - 10) / 2)
  return {
    STR: mod(abilities.STR),
    DEX: mod(abilities.DEX),
    CON: mod(abilities.CON),
    INT: mod(abilities.INT),
    WIS: mod(abilities.WIS),
    CHA: mod(abilities.CHA),
  }
}

// ─── NPC Init Data ───────────────────────────

function createInitialNPCs(): NPC[] {
  return [
    {
      name: '格雷格',
      trust: 0,
      knownFacts: ['镇上矿洞最近不太平', '冒险者公会在招人', '二十年前在矿洞里失去了挚友达里安'],
      playerPromises: [],
      location: 'dawnbreak-town',
      mood: '温和',
    },
    {
      name: '小莉',
      trust: 0,
      knownFacts: ['能感知他人身上的异常气息', '镇长身上缠着灰色扭动的东西', '卡恩让她后背发凉'],
      playerPromises: [],
      location: 'dawnbreak-town',
      mood: '好奇',
    },
    {
      name: '艾琳娜',
      trust: 0,
      knownFacts: ['矿道失踪事件的详细情报', '卡恩的文件太完美——有遮蔽', '小莉身上有微弱的天赋波动', '200年前读到过虚空棱镜的残篇'],
      playerPromises: [],
      location: 'dawnbreak-town',
      mood: '冷静',
    },
    {
      name: '维克多',
      trust: 0,
      knownFacts: ['女儿索菲亚被暗影教团绑架', '壁炉暗格里藏着石碑的被删记录', '卡恩是教团的传话人'],
      playerPromises: [],
      location: 'dawnbreak-town',
      mood: '紧张',
    },
    {
      name: '卡恩',
      trust: 0,
      knownFacts: ['暗影教团的全部计划', '维克多被控制的细节', '怀疑酒馆帮工女孩是灵视者', '独立破译了棱镜激活咒语'],
      playerPromises: [],
      location: 'dawnbreak-town',
      mood: '从容',
    },
  ]
}

// ─── Game Session Factory ────────────────────

function createGameSession(name: string, classId: string): GameSession {
  const template = CLASS_TEMPLATES[classId]
  const mods = computeModifiers(template.abilities)

  const player: PlayerCharacter = {
    name,
    level: 1,
    abilities: { ...template.abilities },
    abilityModifiers: mods,
    skills: [...template.skills],
    hp: template.maxHp,
    maxHp: template.maxHp,
    gold: 0,
    inventory: [],
    spells: template.spells.map(s => ({ ...s })),
    clues: [],
    equipped: {
      weapon: { name: '生锈的短剑', type: 'weapon', description: '一把锈迹斑斑的短剑，勉强能用。Deals 1d6 piercing damage.', bonus: 0 },
    },
  }

  return {
    player,
    npcs: createInitialNPCs(),
    quests: [],
    worldState: {
      currentLocation: 'dawnbreak-town',
      timeOfDay: 'night',
      flags: {},
    },
    events: [],
    turnCount: 0,
  }
}

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
    case '/help': {
      console.log()
      console.log(chalk.dim('  /status    — 查看角色状态'))
      console.log(chalk.dim('  /inventory — 查看背包'))
      console.log(chalk.dim('  /npc       — 查看已知人物档案'))
      console.log(chalk.dim('  /npc <名>  — 查看角色详细档案'))
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

  // ── Opening scene ──
  console.log()
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

  await sendToDM(openingPrompt)

  // 开场自动解锁格雷格（第一个遇到的 NPC）
  const gregNotice = dossier.unlock('格雷格', 0)
  if (gregNotice) console.log(gregNotice)

  // ── Main loop ──
  let turnsSinceLastSave = 0

  while (true) {
    const input = (await ask(rl, chalk.bold('\n  ⚔️  你> '))).trim()

    if (!input) continue

    if (input === '/quit') {
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
          initGameState(loaded['session'])
          initDMAgent()
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
    const dmInput = safety.level === 'warn'
      ? `[DM安全指令: ${safety.dmInstruction}]\n\n${input}`
      : input
    await sendToDM(dmInput)

    // NPC 档案更新 — 检测 DM 回复中提到的 NPC
    for (const npc of session.npcs) {
      if (input.includes(npc.name) || dmInput.includes(npc.name)) {
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
async function sendToDM(input: string) {
  try {
    for await (const event of dmRespond(input)) {
      if (event.type === 'text_delta') {
        process.stdout.write(event.text ?? '')
      }
    }
    console.log()
  } catch (err) {
    console.log(chalk.red(`\n  [错误: ${(err as Error).message.slice(0, 80)}]`))
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
