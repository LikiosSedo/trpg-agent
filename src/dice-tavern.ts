#!/usr/bin/env node
/**
 * 🎲 破晓酒馆 · 骰子赌局
 *
 * 一个用 open-claude-cli Agent SDK 驱动的酒馆小游戏。
 * 你和酒馆老板格雷格玩骰子，赌金币，还能作弊（如果你够胆）。
 *
 * 运行: npm run play
 */

import { Agent } from 'open-claude-cli/engine'
import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import * as readline from 'node:readline'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const config = JSON.parse(readFileSync(join(homedir(), '.occ', 'config.json'), 'utf-8'))

// ═══════════════════════════════════
//  游戏状态
// ═══════════════════════════════════

const game = {
  playerGold: 30,
  gregGold: 100,
  playerDrunk: 0,     // 0-5, 影响察觉力
  gregDrunk: 0,        // 0-5, 醉了更容易被骗
  gregMood: 'neutral' as string,
  gregSuspicion: 0,    // 0-10, 怀疑玩家作弊
  roundsPlayed: 0,
  cheatsDetected: 0,
  playerWins: 0,
  gregWins: 0,
}

// ═══════════════════════════════════
//  工具
// ═══════════════════════════════════

const NarrateTool: Tool = {
  name: 'Narrate',
  description: '以旁白视角描述场景、动作、气氛。用于非对话内容。',
  inputSchema: z.object({
    text: z.string().describe('旁白文字，第三人称'),
  }),
  isConcurrencySafe: true, isReadOnly: true,
  async execute(input: any) {
    console.log(`\n  📜 ${input.text}`)
    return { output: 'ok' }
  },
}

const GregSpeakTool: Tool = {
  name: 'GregSpeak',
  description: '格雷格说话。必须用这个工具让格雷格开口。',
  inputSchema: z.object({
    text: z.string().describe('格雷格的台词'),
    mood: z.enum(['grin', 'laugh', 'suspicious', 'angry', 'drunk', 'nervous', 'whisper']),
  }),
  isConcurrencySafe: true, isReadOnly: true,
  async execute(input: any) {
    const emoji: Record<string, string> = {
      grin: '😏', laugh: '😂', suspicious: '🤨', angry: '😡',
      drunk: '🍺', nervous: '😰', whisper: '🤫',
    }
    game.gregMood = input.mood
    console.log(`\n  ${emoji[input.mood] || '😐'} 格雷格: "${input.text}"`)
    return { output: 'ok' }
  },
}

const RollDiceTool: Tool = {
  name: 'RollDice',
  description: '公平掷骰子。双方各掷指定骰子，比大小。返回真实随机结果。',
  inputSchema: z.object({
    dice: z.string().describe('骰子类型，如 "2d6"'),
    bet: z.number().describe('本轮赌注(金币)'),
    playerModifier: z.number().optional().describe('玩家修正值（作弊时用）'),
  }),
  isConcurrencySafe: false, isReadOnly: false,
  async execute(input: any) {
    const m = input.dice.match(/(\d+)d(\d+)/)
    if (!m) return { output: '无效骰子', isError: true }
    const [, count, sides] = m.map(Number)

    // 掷骰子
    const playerRolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1)
    const gregRolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1)

    let playerTotal = playerRolls.reduce((a, b) => a + b, 0) + (input.playerModifier || 0)
    const gregTotal = gregRolls.reduce((a, b) => a + b, 0)

    // 醉酒影响格雷格的判断（醉了手抖，-1 per drunk level）
    const gregPenalty = Math.floor(game.gregDrunk / 2)
    const adjustedGregTotal = Math.max(gregTotal - gregPenalty, count)

    const playerWins = playerTotal > adjustedGregTotal
    const tie = playerTotal === adjustedGregTotal
    const bet = Math.min(input.bet, game.playerGold, game.gregGold)

    if (!tie) {
      if (playerWins) {
        game.playerGold += bet
        game.gregGold -= bet
        game.playerWins++
      } else {
        game.playerGold -= bet
        game.gregGold += bet
        game.gregWins++
      }
    }

    game.roundsPlayed++

    const display = [
      ``,
      `  ┌─────────── 🎲 第${game.roundsPlayed}轮 ─────────────┐`,
      `  │  赌注: ${bet} 金币                      │`,
      `  │                                        │`,
      `  │  你:     ${playerRolls.join('+')}${input.playerModifier ? ` (+${input.playerModifier}🃏)` : ''} = ${playerTotal}`.padEnd(49) + '│',
      `  │  格雷格: ${gregRolls.join('+')}${gregPenalty > 0 ? ` (-${gregPenalty}🍺)` : ''} = ${adjustedGregTotal}`.padEnd(49) + '│',
      `  │                                        │`,
      `  │  ${tie ? '⚖️  平局！' : playerWins ? '🎉 你赢了！' : '💀 你输了...'}`.padEnd(48) + '│',
      `  │  你: ${game.playerGold}金  格雷格: ${game.gregGold}金`.padEnd(48) + '│',
      `  └────────────────────────────────────────┘`,
    ].join('\n')
    console.log(display)

    return {
      output: JSON.stringify({
        playerRolls, gregRolls, playerTotal, gregTotal: adjustedGregTotal,
        result: tie ? 'tie' : playerWins ? 'player_wins' : 'greg_wins',
        bet, playerGold: game.playerGold, gregGold: game.gregGold,
        modifier: input.playerModifier || 0,
      })
    }
  },
}

const CheatCheckTool: Tool = {
  name: 'CheatCheck',
  description: '格雷格的察觉检定——检测玩家是否在作弊。DC基于格雷格的醉酒程度。',
  inputSchema: z.object({
    reason: z.string().describe('为什么怀疑'),
  }),
  isConcurrencySafe: true, isReadOnly: false,
  async execute(input: any) {
    // 格雷格的察觉: d20, DC = 10 + 玩家醉酒(更难被察觉) - 格雷格醉酒(更难发现)
    const roll = Math.floor(Math.random() * 20) + 1
    const dc = 10 + game.playerDrunk - game.gregDrunk
    const detected = roll >= dc

    if (detected) {
      game.gregSuspicion = Math.min(10, game.gregSuspicion + 3)
      game.cheatsDetected++
    }

    console.log(`\n  🔍 [察觉检定] d20=${roll} vs DC${dc} → ${detected ? '❌ 发现了！' : '✅ 没注意到'}`)

    return {
      output: JSON.stringify({
        roll, dc, detected,
        suspicion: game.gregSuspicion,
        reason: input.reason,
      })
    }
  },
}

const DrinkTool: Tool = {
  name: 'Drink',
  description: '喝酒。增加醉酒度。可以给玩家或格雷格喝。灌格雷格酒会让他更容易被骗。',
  inputSchema: z.object({
    who: z.enum(['player', 'greg', 'both']),
    type: z.enum(['beer', 'spirits']).describe('麦酒(+1醉) 或 烈酒(+2醉)'),
  }),
  isConcurrencySafe: false, isReadOnly: false,
  async execute(input: any) {
    const amount = input.type === 'spirits' ? 2 : 1

    if (input.who === 'player' || input.who === 'both') {
      game.playerDrunk = Math.min(5, game.playerDrunk + amount)
    }
    if (input.who === 'greg' || input.who === 'both') {
      game.gregDrunk = Math.min(5, game.gregDrunk + amount)
    }

    const cost = input.type === 'spirits' ? 8 : 3
    if (input.who === 'greg' || input.who === 'both') {
      game.playerGold -= Math.min(cost, game.playerGold)
    }

    const bar = (level: number) => '🟩'.repeat(level) + '⬜'.repeat(5 - level)
    console.log(`\n  🍻 干杯！(${input.type === 'spirits' ? '烈酒' : '麦酒'})`)
    console.log(`  你的醉意:     ${bar(game.playerDrunk)} ${game.playerDrunk}/5`)
    console.log(`  格雷格醉意:   ${bar(game.gregDrunk)} ${game.gregDrunk}/5`)

    return {
      output: JSON.stringify({
        playerDrunk: game.playerDrunk,
        gregDrunk: game.gregDrunk,
        playerGold: game.playerGold,
      })
    }
  },
}

const GameStatusTool: Tool = {
  name: 'GameStatus',
  description: '查看当前游戏状态（金币、醉酒度、战绩、怀疑度）。每轮前先看。',
  inputSchema: z.object({}),
  isConcurrencySafe: true, isReadOnly: true,
  async execute() {
    return { output: JSON.stringify(game, null, 2) }
  },
}

// ═══════════════════════════════════
//  DM Agent
// ═══════════════════════════════════

const dm = new Agent({
  provider: { model: config.model, apiKey: config.apiKey, baseUrl: config.baseUrl, type: 'openai' },
  tools: [NarrateTool, GregSpeakTool, RollDiceTool, CheatCheckTool, DrinkTool, GameStatusTool],
  systemPrompt: `你是一个TRPG的DM（地下城主），正在主持一场酒馆骰子赌局。

## 场景
破晓酒馆，暴雨之夜。玩家和酒馆老板格雷格在玩骰子赌金币。

## 你的角色
- 用 Narrate 描述场景和气氛（第三人称旁白）
- 用 GregSpeak 让格雷格说话（他是你操控的NPC）
- 用 RollDice 执行骰子赌局
- 每轮先 GameStatus 看状态

## 格雷格的性格
- 赢钱时：得意嘚瑟，嘲笑玩家
- 输钱时：不爽但硬撑，会提高赌注想翻本
- 被灌酒后：话变多，开始吹嘘当年冒险
- 发现作弊：暴怒，但如果醉了可能看花眼（误判）
- 醉酒度4+：开始胡言乱语，可能自己提出奇怪的赌法

## 骰子规则
- 默认 2d6 比大小
- 赌注由格雷格或玩家提议
- 平局重来
- 任何一方金币归零则游戏结束

## 作弊系统
- 如果玩家暗示要作弊（偷换骰子、藏牌等），用 RollDice 的 playerModifier 加成
- 每次作弊后，格雷格可能用 CheatCheck 做察觉检定
- 怀疑度到 8+ 格雷格会翻脸
- 玩家可以灌格雷格酒降低他的察觉力（Drink tool）

## 行为规则
1. 每次先 GameStatus 看状态
2. 一次回复同时用 Narrate + GregSpeak + 其他工具，营造沉浸感
3. 如果玩家没明确说要干什么，让格雷格主动推进（提议赌注、聊天等）
4. 保持有趣！格雷格是个有故事的人
5. 适时描述酒馆的环境细节（暴雨、壁炉、老猫等）`,
  maxTurns: 8,
  apiThrottleMs: 1500,
})

// ═══════════════════════════════════
//  游戏循环
// ═══════════════════════════════════

console.log()
console.log('╔═══════════════════════════════════════════╗')
console.log('║  🎲 破晓酒馆 · 骰子赌局                  ║')
console.log('║  powered by open-claude-cli Agent SDK     ║')
console.log('╚═══════════════════════════════════════════╝')
console.log()
console.log('  暴风雨在窗外咆哮。你推开酒馆的门，')
console.log('  看到一个壮实的中年人在擦酒杯。')
console.log('  桌上放着两颗骰子和一堆金币。')
console.log()
console.log(`  💰 你: ${game.playerGold}金  格雷格: ${game.gregGold}金`)
console.log()
console.log('  提示: 你可以正常玩骰子，也可以...')
console.log('  - 灌格雷格酒（降低他的察觉力）')
console.log('  - 尝试作弊（偷换骰子、藏骰子等）')
console.log('  - 聊天套情报')
console.log('  - /quit 退出  /status 看状态')
console.log()

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

// 格雷格先开口
let firstTurn = true

function prompt() {
  rl.question('🗡️  你> ', async (input) => {
    const trimmed = input.trim()
    if (trimmed === '/quit') {
      console.log(`\n  📊 战绩: ${game.playerWins}胜${game.gregWins}负 | 金币: ${game.playerGold}`)
      console.log('  你起身离开，消失在暴雨中...\n')
      rl.close()
      return
    }
    if (trimmed === '/status') {
      const bar = (n: number) => '🟩'.repeat(n) + '⬜'.repeat(5 - n)
      console.log(`\n  💰 你:${game.playerGold}金 格雷格:${game.gregGold}金`)
      console.log(`  🏆 ${game.playerWins}胜${game.gregWins}负 (${game.roundsPlayed}轮)`)
      console.log(`  🍺 你:${bar(game.playerDrunk)} 格雷格:${bar(game.gregDrunk)}`)
      console.log(`  🔍 怀疑度: ${game.gregSuspicion}/10`)
      if (game.cheatsDetected > 0) console.log(`  ⚠️ 被抓到作弊: ${game.cheatsDetected}次`)
      console.log()
      prompt()
      return
    }

    if (game.playerGold <= 0) {
      console.log('\n  💸 你身无分文了...格雷格把你赶出了酒馆。\n')
      rl.close()
      return
    }
    if (game.gregGold <= 0) {
      console.log('\n  🎉 格雷格输光了！他气得砸了一个酒杯。你带着战利品消失在夜色中。\n')
      rl.close()
      return
    }

    const msg = firstTurn
      ? `玩家走到桌前坐下。${trimmed ? `玩家: "${trimmed}"` : '他看了看桌上的骰子。'}`
      : `玩家: "${trimmed}"`
    firstTurn = false

    try {
      for await (const e of dm.run(msg)) {
        // 工具输出已在 execute 中 console.log
      }
    } catch (err) {
      console.log(`\n  ⚠️ [${(err as Error).message.slice(0, 50)}]`)
    }

    console.log()
    prompt()
  })
}

prompt()
