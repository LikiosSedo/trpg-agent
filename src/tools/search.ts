/**
 * 🔍 搜索工具
 *
 * 搜索当前区域寻找隐藏物品、暗门、线索。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession, getFacts } from '../game-state.js'
import { skillCheck } from '../rules-engine.js'
import { locations } from '../data/maps.js'

export const SearchTool: Tool = {
  name: 'Search',
  description: `搜索当前区域。根据搜索类型触发不同检定:
- "area": Perception 检定，发现隐藏物品/暗门/陷阱
- "body": 搜索倒下的敌人/尸体，获取战利品
- "container": 搜索箱子/抽屉/柜子等容器
- "clue": Investigation 检定，寻找与任务相关的线索
DM 根据检定结果决定发现什么。`,
  inputSchema: z.object({
    type: z.enum(['area', 'body', 'container', 'clue']).describe('搜索类型'),
    target: z.string().optional().describe('搜索目标 (尸体名/容器名)。"area" 和 "clue" 可省略'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const player = session.player
    const { type, target } = input
    const locId = session.worldState.currentLocation
    const loc = locations[locId]

    if (type === 'body') {
      return { output: `搜索${target ?? '尸体'}。DM根据战斗结果决定掉落物品。` }
    }

    if (type === 'container') {
      return { output: `搜索${target ?? '容器'}。DM决定容器内容物。` }
    }

    if (type === 'area') {
      const mod = player.abilityModifiers.WIS + (player.skills.includes('perception') ? 2 : 0)
      const dc = 15
      const result = skillCheck(mod, dc)

      // Discover hidden POIs on success
      const hiddenPois = loc?.pointsOfInterest.filter(p => !p.discovered) ?? []
      if (result.success && hiddenPois.length > 0) {
        hiddenPois[0].discovered = true
        facts.addEvent(`发现${hiddenPois[0].nameZh}`)
      }

      return {
        output: [
          `察觉检定(搜索区域)：d20=${result.roll}, 修正+${mod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。`,
          result.success && hiddenPois.length > 0
            ? `发现隐藏地点：${hiddenPois[0].nameZh}(${hiddenPois[0].name})——${hiddenPois[0].description}`
            : result.success ? '仔细搜索后未发现新事物。' : '',
        ].filter(Boolean).join('\n'),
      }
    }

    // clue
    const mod = player.abilityModifiers.INT + (player.skills.includes('investigation') ? 2 : 0)
    const dc = 12
    const result = skillCheck(mod, dc)

    return {
      output: `调查检定(搜索线索)：d20=${result.roll}, 修正+${mod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。DM根据结果提供线索。`,
    }
  },
}
