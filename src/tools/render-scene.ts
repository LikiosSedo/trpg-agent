/**
 * 🎬 场景渲染工具
 *
 * 将游戏状态渲染为 CLI 文字画面输出给玩家。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { locations } from '../data/maps.js'
import { getSession } from '../game-state.js'

export const RenderSceneTool: Tool = {
  name: 'RenderScene',
  description: `将当前游戏状态渲染为格式化的 CLI 输出。
DM Agent 在每次状态变化后调用此工具，向玩家展示场景。
- "narrative": 叙事场景 (环境描述、NPC对话、事件)
- "combat": 战斗界面 (回合顺序、HP条、战场简图)
- "status": 玩家状态面板 (HP、物品、法术位、任务)
- "map": 当前区域简易地图 (已探索地点、连接关系)
- "loot": 战利品/商店物品列表`,
  inputSchema: z.object({
    type: z.enum(['narrative', 'combat', 'status', 'map', 'loot']).describe('渲染场景类型'),
    title: z.string().optional().describe('场景标题 (显示在顶部)'),
    content: z.string().describe('主要文字内容 (叙述文本/对话/状态信息)'),
    speaker: z.object({
      name: z.string(),
      mood: z.string(),
    }).optional().describe('说话者信息 (NPC 对话时)'),
    combatInfo: z.object({
      round: z.number(),
      currentTurn: z.string(),
      combatants: z.array(z.object({
        name: z.string(),
        hp: z.number(),
        maxHp: z.number(),
        conditions: z.array(z.string()),
      })),
    }).optional().describe('战斗信息 (type 为 "combat" 时)'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    const { type, title, content, speaker, combatInfo } = input
    const lines: string[] = []
    const width = 50

    const border = '═'.repeat(width)
    const thinBorder = '─'.repeat(width)

    if (type === 'map') {
      const session = getSession()
      const locId = session.worldState.currentLocation
      const loc = locations[locId]
      if (loc) {
        lines.push(`╔${border}╗`)
        lines.push(`║ 🗺️  ${loc.nameZh} (${loc.name})`.padEnd(width + 3) + '║')
        lines.push(`╠${border}╣`)
        for (const row of loc.asciiMap.split('\n')) {
          lines.push(`║ ${row}`.padEnd(width + 3) + '║')
        }
        lines.push(`╚${border}╝`)
      }
      if (content) lines.push(content)
      console.log(lines.join('\n'))
      return { output: lines.join('\n') }
    }

    if (type === 'combat' && combatInfo) {
      lines.push(`╔${border}╗`)
      lines.push(`║ ⚔️  第${combatInfo.round}轮 — ${combatInfo.currentTurn}的回合`.padEnd(width + 3) + '║')
      lines.push(`╠${border}╣`)
      for (const c of combatInfo.combatants) {
        const hpBar = hpBarStr(c.hp, c.maxHp, 15)
        const conds = c.conditions.length ? ` [${c.conditions.join(',')}]` : ''
        lines.push(`║ ${c.name}: ${hpBar} ${c.hp}/${c.maxHp}${conds}`.padEnd(width + 3) + '║')
      }
      lines.push(`╠${border}╣`)
      lines.push(`║ ${content}`.padEnd(width + 3) + '║')
      lines.push(`╚${border}╝`)
      console.log(lines.join('\n'))
      return { output: lines.join('\n') }
    }

    if (type === 'status') {
      const session = getSession()
      const p = session.player
      lines.push(`┌${thinBorder}┐`)
      lines.push(`│ 📋 ${p.name} Lv${p.level}`.padEnd(width + 3) + '│')
      lines.push(`│ HP: ${hpBarStr(p.hp, p.maxHp, 15)} ${p.hp}/${p.maxHp}  💰${p.gold}`.padEnd(width + 3) + '│')
      lines.push(`├${thinBorder}┤`)
      if (content) lines.push(`│ ${content}`.padEnd(width + 3) + '│')
      lines.push(`└${thinBorder}┘`)
      console.log(lines.join('\n'))
      return { output: lines.join('\n') }
    }

    // narrative / loot
    if (title) {
      lines.push(`\n  ── ${title} ──`)
    }
    if (speaker) {
      lines.push(`  [${speaker.name}] (${speaker.mood})`)
    }
    lines.push(`  ${content}`)
    console.log(lines.join('\n'))
    return { output: lines.join('\n') }
  },
}

function hpBarStr(current: number, max: number, barLen: number): string {
  const filled = Math.round((current / max) * barLen)
  return '█'.repeat(filled) + '░'.repeat(barLen - filled)
}
