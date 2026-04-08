/**
 * 搜索工具
 *
 * 搜索当前区域寻找隐藏物品、暗门、线索。
 * area/body 类型的物品由代码自动从产出表抽取并发放，DM 只负责叙事描写。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { getSession, getFacts } from '../game-state.js'
import { skillCheck } from '../rules-engine.js'
import { locations } from '../data/maps.js'
import { ChapterManager } from '../chapter-manager.js'
import { LOOT_TABLES, rollLootTable } from '../loot-tables.js'
import { getEffectBonus } from '../effect-manager.js'

export const SearchTool: Tool = {
  name: 'Search',
  description: `搜索当前区域。根据搜索类型触发不同检定:
- "area": Perception 检定，发现隐藏物品/暗门/陷阱
- "body": 搜索倒下的敌人/尸体，获取战利品
- "container": 搜索箱子/抽屉/柜子等容器
- "clue": Investigation 检定，寻找与任务相关的线索
area 和 body 的物品由系统自动从产出表抽取并发放，DM 只负责叙事描写。`,
  inputSchema: z.object({
    type: z.enum(['area', 'body', 'container', 'clue']).describe('搜索类型'),
    target: z.string().optional().describe('搜索目标 (尸体名/容器名)。"area" 和 "clue" 可省略'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()

    // 通知章节系统
    if (session.chapter) {
      new ChapterManager(session).onEvent('search')
    }

    const player = session.player
    const { type, target } = input
    const locId = session.worldState.currentLocation
    const loc = locations[locId]

    // ── body：战后搜刮 NPC ──────────────────────────
    if (type === 'body') {
      const npcName = target ?? ''
      const lootedFlag = `looted_${npcName}`

      // 检查是否已搜过
      if (session.worldState.flags[lootedFlag]) {
        return { output: `${npcName ? npcName : '尸体'}已经搜过了，身上没有新东西了。` }
      }

      // 找到对应 NPC
      const npc = npcName ? session.npcs.find(n => n.name === npcName) : null

      if (!npc) {
        return { output: `未找到目标"${npcName}"。DM根据战斗结果决定掉落物品，如需转移请调用 TransferItem(transferType="loot")。` }
      }

      // 确认 NPC 已昏迷
      if (npc.condition !== 'unconscious') {
        return { output: `${npcName}并未倒下，无法搜刮。` }
      }

      // 从 NPC 库存随机取 60-80%（每件物品 Math.random() < 0.7）
      const takenItems = (npc.inventory ?? []).filter(() => Math.random() < 0.7)

      // 从 NPC 库存中移除被拿走的物品
      if (npc.inventory) {
        const takenSet = new Set(takenItems)
        npc.inventory = npc.inventory.filter(item => !takenSet.has(item))
      }

      // 将拿走的物品加入玩家背包
      for (const item of takenItems) {
        session.player.inventory.push({ ...item })
      }

      // 金币：根据 NPC 角色决定范围
      const goldRanges: Record<string, [number, number]> = {
        herbalist:    [10, 20],
        blacksmith:   [15, 30],
        guild_leader: [20, 40],
        innkeeper:    [8, 18],
        mayor:        [25, 50],
        guard:        [5, 15],
      }
      const role = npc.role ?? 'general'
      const [gMin, gMax] = goldRanges[role] ?? [3, 10]
      const gold = gMin + Math.floor(Math.random() * (gMax - gMin + 1))
      session.player.gold += gold

      // 标记已搜刮
      session.worldState.flags[lootedFlag] = true

      // 输出
      const itemNames = takenItems.map(i => i.name).join('、')
      const itemStr = takenItems.length > 0 ? `物品：${itemNames}` : '没有发现有价值的物品'
      return {
        output: `搜刮${npcName}：${itemStr} + ${gold}金币【系统已完成，禁止重复调用 TransferItem】`,
      }
    }

    // ── container：容器搜索（DM 主导） ───────────────
    if (type === 'container') {
      return { output: `搜索${target ?? '容器'}。DM决定容器内容物。如果发现物品，必须调用 TransferItem(transferType="found", sourceId="environment") 来给予玩家。` }
    }

    // ── area：区域搜索 ───────────────────────────────
    if (type === 'area') {
      // 光源效果：矿道等黑暗区域，火把提供搜索加值
      const darkLocations = ['greyspine-mines']
      const lightBonus = darkLocations.includes(locId) ? getEffectBonus(player, 'light') : 0
      const mod = player.abilityModifiers.WIS + (player.skills.includes('perception') ? 2 : 0) + lightBonus
      // DC 根据场景动态调整
      let dc = 12  // 野外/矿道默认：找隐藏物品（避免卡关）
      const subLoc = session.worldState.currentSubLocation ?? ''
      // 有昏迷 NPC 在场（战后搜刮）→ 几乎自动成功
      const hasUnconsciousNpc = session.npcs.some(n =>
        n.condition === 'unconscious' &&
        n.location === locId &&
        (n.subLocation ?? n.homeBase) === subLoc
      )
      // 有"活跃"的 NPC 在场 → 相当于潜行/扒窃，DC 大幅提高
      // 不区分"搜索"和"偷窃"：有人看着就难，没人看着就简单
      // 活跃 = 意识清醒（重伤、昏迷、康复中都不算"在看"）
      const activeNpcs = session.npcs.filter(n =>
        n.condition !== 'unconscious' &&
        n.condition !== 'wounded' &&
        n.condition !== 'recovering' &&
        n.location === locId &&
        (n.subLocation ?? n.homeBase) === subLoc
      )
      const hasWatcher = activeNpcs.length > 0

      // 夜间影响：潜行更容易（店主看不清），但搜索找物品更难（自己看不清）
      const isNight = session.worldState.timeOfDay === 'night'

      if (hasUnconsciousNpc) dc = 5  // 战后搜刮，东西就在眼前
      // 建筑内搜索（商店、旅店、公会）
      else if (['greenleaf-apothecary', 'sturdy-anvil', 'dawns-rest-inn', 'silver-scale-guild', 'mayor-office'].includes(subLoc)) {
        dc = hasWatcher ? 18 : 8  // 店主看着 = 潜行DC 18；没人 = DC 8
      } else if (hasWatcher) {
        dc += 3  // 野外/矿道有 NPC 同行时略微提高
      }
      // 夜间修正：有 watcher 时 -4（潜行容易），无 watcher 时 +2（看不清）
      const nightMod = isNight ? (hasWatcher ? -4 : +2) : 0
      dc = Math.max(5, dc + nightMod)

      const result = skillCheck(mod, dc)
      const checkLabel = hasWatcher ? '潜行检定(在他人注视下寻找物品)' : '察觉检定(搜索区域)'

      // Discover hidden POIs on success
      const hiddenPois = loc?.pointsOfInterest.filter(p => !p.discovered) ?? []
      let discoveredPoi: { id: string; nameZh: string; description: string } | undefined
      if (result.success && hiddenPois.length > 0) {
        hiddenPois[0].discovered = true
        facts.addEvent(`发现${hiddenPois[0].nameZh}`)
        discoveredPoi = { id: hiddenPois[0].id, nameZh: hiddenPois[0].nameZh, description: hiddenPois[0].description }
      }

      const lightNote = lightBonus > 0 ? `(含火把+${lightBonus}) ` : ''
      const checkLine = `${checkLabel}：d20=${result.roll}, 修正+${mod}${lightNote}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。`

      if (!result.success) {
        // 当着 NPC 的面被发现（潜行失败）→ 标记给 DM 处理反应
        const failedWithWatcher = hasWatcher
          ? `\n[被发现] 玩家试图在${activeNpcs.map(n => n.name).join('、')}面前拿取物品被发现。请根据 NPC 性格叙事反应（警告、驱逐、报警、甚至攻击）。`
          : ''
        return { output: checkLine + failedWithWatcher }
      }

      // 成功：查找产出表
      const tableId = subLoc || locId
      const table = LOOT_TABLES.find(t => t.locationId === tableId)
        ?? LOOT_TABLES.find(t => t.locationId === locId)

      const poiLine = hiddenPois.length > 0
        ? `发现隐藏地点：${hiddenPois[0].nameZh}(${hiddenPois[0].name})——${hiddenPois[0].description}`
        : ''

      if (!table) {
        // 无产出表时回退到 DM 主导
        return {
          output: [
            checkLine,
            poiLine,
            '仔细搜索后……如果发现物品，必须调用 TransferItem(transferType="found", sourceId="environment") 来给予玩家。',
          ].filter(Boolean).join('\n'),
          discoveredPoi,
        }
      }

      // 抽取产出
      const flagKey = tableId
      const loot = rollLootTable(table, session, flagKey)

      if (loot.alreadySearched) {
        return {
          output: [checkLine, poiLine, '这里已经被仔细搜过了，没有新的发现。'].filter(Boolean).join('\n'),
          discoveredPoi,
        }
      }

      // 写入 flags
      for (const flag of loot.flagsToSet) {
        session.worldState.flags[flag] = true
      }

      // 将物品加入玩家背包
      for (const item of loot.items) {
        session.player.inventory.push({ ...item })
      }

      // 加入金币
      session.player.gold += loot.gold

      // 组装输出
      const lootParts: string[] = []
      if (loot.items.length > 0) {
        lootParts.push(`物品：${loot.items.map(i => i.name).join('、')}`)
      }
      if (loot.gold > 0) {
        lootParts.push(`${loot.gold}金币`)
      }
      const lootStr = lootParts.length > 0
        ? `【系统已发放】找到：${lootParts.join(' + ')}。DM只需叙事描述玩家如何发现这些物品，禁止重复调用 TransferItem。`
        : '仔细搜索后未发现有价值的物品。'

      // 把发放的物品/金币结构化暴露出去，供 engine 发出发现弹窗
      const lootGranted = (loot.items.length > 0 || loot.gold > 0)
        ? {
            items: loot.items.map(i => ({ name: i.name, description: i.description })),
            gold: loot.gold,
          }
        : undefined

      return {
        output: [checkLine, poiLine, lootStr].filter(Boolean).join('\n'),
        discoveredPoi,
        lootGranted,
      }
    }

    // ── clue：线索搜索 ──────────────────────────────
    const mod = player.abilityModifiers.INT + (player.skills.includes('investigation') ? 2 : 0)
    const dc = 12
    const result = skillCheck(mod, dc)

    return {
      output: `调查检定(搜索线索)：d20=${result.roll}, 修正+${mod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。DM根据结果提供线索。如果发现物品，必须调用 TransferItem(transferType="found", sourceId="environment") 来给予玩家。`,
    }
  },
}
