/**
 * 👁️ 观察工具
 *
 * 获取当前场景的详细信息，或检查特定目标。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { locations, connections } from '../data/maps.js'
import { getSession } from '../game-state.js'

export const LookTool: Tool = {
  name: 'Look',
  description: `观察环境或检查特定目标。
- 无目标: 返回当前地点的完整描述、可见 NPC、出口、物品
- 指定目标: 返回该目标的详细信息 (可能触发察觉检定)
- 战斗中: 返回战场态势、各单位位置和状态`,
  inputSchema: z.object({
    target: z.string().optional().describe('观察目标 (NPC名/物品名/方向)。省略则观察整个场景'),
    detailed: z.boolean().optional().describe('是否仔细检查 (可能触发 Investigation 检定)'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    const session = getSession()
    const locId = session.worldState.currentLocation
    const loc = locations[locId]
    if (!loc) return { output: `当前位置未知：${locId}`, isError: true }

    // Looking at a specific target
    if (input.target) {
      const npc = session.npcs.find(n => n.name === input.target && n.location === locId)
      if (npc) {
        return { output: `NPC：${npc.name}，心情${npc.mood}，信任度${npc.trust}/10。位于${loc.nameZh}。` }
      }
      const poi = loc.pointsOfInterest.find(p => p.name === input.target || p.nameZh === input.target || p.id === input.target)
      if (poi) {
        return { output: `兴趣点：${poi.nameZh}(${poi.name})。${poi.description}` }
      }
      // 目标不在注册表中 — 标记降级，让 engine 注入 POI 上下文给 DM
      const knownPois = loc.pointsOfInterest
        .filter((p: any) => p.discovered)
        .map((p: any) => p.nameZh)
        .join('、')
      return {
        output: `在${loc.nameZh}未找到精确匹配"${input.target}"。已知地点：${knownPois || '无'}。`,
        notFound: true,
      }
    }

    // General look
    const exits = connections
      .filter(c => c.from === locId || c.to === locId)
      .map(c => {
        const targetId = c.from === locId ? c.to : c.from
        const target = locations[targetId]
        return `${target?.nameZh ?? targetId}(${c.known ? '已知' : '未知路径'})`
      })

    const pois = loc.pointsOfInterest
      .filter(p => p.discovered)
      .map(p => `${p.nameZh}(${p.name})`)

    const npcsHere = session.npcs
      .filter(n => n.location === locId)
      .map(n => `${n.name}(${n.mood})`)

    const lines = [
      `地点：${loc.nameZh}(${loc.name})。${loc.description}`,
      `危险等级：${loc.dangerLevel}。时间：${session.worldState.timeOfDay}。`,
      pois.length ? `可见兴趣点：${pois.join('、')}。` : '',
      npcsHere.length ? `在场NPC：${npcsHere.join('、')}。` : '',
      exits.length ? `出口：${exits.join('、')}。` : '',
    ]

    return { output: lines.filter(Boolean).join('\n') }
  },
}
