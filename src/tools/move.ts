/**
 * 🚶 移动工具
 *
 * 在地点之间移动，或在战斗中移动位置。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { locations, connections } from '../data/maps.js'
import { getSession, getFacts } from '../game-state.js'

export const MoveTool: Tool = {
  name: 'Move',
  description: `移动玩家到指定地点或战斗格。
- 探索模式: 在相连的 Location 之间移动
- 战斗模式: 在战斗网格上移动 (最多 30ft / 6 格)
移动时会触发地点描述更新。如果目标地点有危险，可能触发检定。`,
  inputSchema: z.object({
    destination: z.string().describe('目标地点 ID 或方向 ("north", "south", "east", "west", 或具体地点名)'),
    mode: z.enum(['explore', 'combat']).describe('"explore" 地点间移动, "combat" 战斗中移动'),
    combatPosition: z.object({
      x: z.number(),
      y: z.number(),
    }).optional().describe('战斗模式下的目标坐标'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const { destination, mode } = input
    const current = session.worldState.currentLocation

    if (mode === 'combat') {
      return { output: `战斗移动：玩家移至坐标(${input.combatPosition?.x ?? '?'},${input.combatPosition?.y ?? '?'})。` }
    }

    // Find connection (bidirectional)
    const conn = connections.find(
      c => (c.from === current && c.to === destination) ||
           (c.to === current && c.from === destination),
    )
    if (!conn) {
      const loc = locations[current]
      const available = connections
        .filter(c => c.from === current || c.to === current)
        .map(c => c.from === current ? c.to : c.from)
      return {
        output: `无法从${loc?.nameZh ?? current}到达${destination}。可前往：${available.join(', ') || '无'}。`,
        isError: true,
      }
    }

    const dest = locations[destination]
    if (!dest) return { output: `未知地点：${destination}`, isError: true }

    session.worldState.currentLocation = destination
    facts.addEvent(`移动至${dest.nameZh}(${dest.id})`)

    // 到达后自动描述新地点（减少玩家操作摩擦）
    const npcsHere = session.npcs.filter(n => n.location === destination).map(n => n.name)
    const poiList = dest.pointsOfInterest?.map((p: any) => p.nameZh ?? p.name) ?? []

    return {
      output: [
        `移动：${locations[current]?.nameZh ?? current} → ${dest.nameZh}。${conn.description}`,
        `你来到了${dest.nameZh}。${dest.description}`,
        npcsHere.length ? `你看到了：${npcsHere.join('、')}。` : '',
        poiList.length ? `附近有：${poiList.join('、')}。` : '',
        `（可以 Talk 对话、Look 仔细观察、Search 搜索、或继续移动）`,
      ].filter(Boolean).join('\n'),
    }
  },
}
