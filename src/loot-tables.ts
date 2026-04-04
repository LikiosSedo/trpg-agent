/**
 * 场景产出表 — 区域搜索和战后搜刮的物品抽样逻辑
 */

import type { ItemType, Item, GameSession } from './types.js'

// ─── 数据结构 ────────────────────────────────────

export interface LootEntry {
  name: string
  type: ItemType
  description: string
  bonus?: number
  probability: number       // 0-1
  quantity: [number, number] // [min, max]
  condition?: string        // 'chapter>=N' | 'beat_done:beatId' | 'npc_unconscious:npcName' | 'flag:flagName'
  oneTime?: boolean         // 只能获取一次（基于 flag 防重复）
}

export interface LocationLootTable {
  locationId: string
  items: LootEntry[]
  gold?: [number, number]   // [min, max]
  maxItemsPerSearch: number
  repeatable: boolean       // false = 只能搜索一次
}

// ─── 条件解析 ────────────────────────────────────

export function evaluateCondition(condition: string, session: GameSession): boolean {
  // chapter>=N
  const chapterMatch = condition.match(/^chapter>=(\d+)$/)
  if (chapterMatch) {
    const required = parseInt(chapterMatch[1], 10)
    const currentChapterId = session.chapter?.currentChapter ?? 'ch1'
    const chapterNum = parseInt(currentChapterId.replace(/\D/g, ''), 10) || 1
    return chapterNum >= required
  }

  // beat_done:beatId
  const beatMatch = condition.match(/^beat_done:(.+)$/)
  if (beatMatch) {
    const beatId = beatMatch[1]
    return session.chapter?.completedBeats.includes(beatId) ?? false
  }

  // npc_unconscious:npcName
  const npcMatch = condition.match(/^npc_unconscious:(.+)$/)
  if (npcMatch) {
    const npcName = npcMatch[1]
    return session.npcs.some(n => n.name === npcName && n.condition === 'unconscious')
  }

  // flag:flagName
  const flagMatch = condition.match(/^flag:(.+)$/)
  if (flagMatch) {
    const flagName = flagMatch[1]
    const val = session.worldState.flags[flagName]
    return val !== undefined && val !== false && val !== 0 && val !== ''
  }

  return true
}

// ─── 产出抽样 ────────────────────────────────────

export interface LootResult {
  items: Item[]
  gold: number
  alreadySearched: boolean
  flagsToSet: string[]
}

export function rollLootTable(
  table: LocationLootTable,
  session: GameSession,
  flagKey: string
): LootResult {
  const flags = session.worldState.flags

  // 检查是否已搜索过（不可重复的地点）
  if (!table.repeatable && flags[`searched_${flagKey}`]) {
    return { items: [], gold: 0, alreadySearched: true, flagsToSet: [] }
  }

  const flagsToSet: string[] = []

  // 标记已搜索（不可重复地点）
  if (!table.repeatable) {
    flagsToSet.push(`searched_${flagKey}`)
  }

  // 筛选可抽的物品
  const eligible = table.items.filter(entry => {
    // 检查条件
    if (entry.condition && !evaluateCondition(entry.condition, session)) return false
    // 检查 oneTime 是否已拿过
    if (entry.oneTime && flags[`got_${flagKey}_${entry.name}`]) return false
    return true
  })

  // 按概率抽取
  const rolled: LootEntry[] = []
  for (const entry of eligible) {
    if (Math.random() < entry.probability) {
      rolled.push(entry)
    }
  }

  // 限制最大件数（随机打乱后取前 N 件）
  const shuffled = rolled.sort(() => Math.random() - 0.5)
  const selected = shuffled.slice(0, table.maxItemsPerSearch)

  // 展开数量
  const items: Item[] = []
  for (const entry of selected) {
    const qty = entry.quantity[0] + Math.floor(Math.random() * (entry.quantity[1] - entry.quantity[0] + 1))
    for (let i = 0; i < qty; i++) {
      const item: Item = {
        name: entry.name,
        type: entry.type,
        description: entry.description,
      }
      if (entry.bonus !== undefined) item.bonus = entry.bonus
      items.push(item)
    }
    // 记录 oneTime flag
    if (entry.oneTime) {
      flagsToSet.push(`got_${flagKey}_${entry.name}`)
    }
  }

  // 抽取金币
  let gold = 0
  if (table.gold) {
    const [min, max] = table.gold
    gold = min + Math.floor(Math.random() * (max - min + 1))
  }

  return { items, gold, alreadySearched: false, flagsToSet }
}

// ─── 产出表定义 ─────────────────────────────────

export const LOOT_TABLES: LocationLootTable[] = [
  // ── 草药堂 ──────────────────────────────────────
  {
    locationId: 'greenleaf-apothecary',
    items: [
      {
        name: '治疗药水',
        type: 'potion',
        description: '一瓶发光的红色液体。饮用后恢复2d4+2生命值。',
        bonus: 2,
        probability: 0.7,
        quantity: [1, 2],
      },
      {
        name: '解毒剂',
        type: 'potion',
        description: '苦涩的草药疗方，可解除毒素并在1小时内赋予毒素抗性。',
        probability: 0.5,
        quantity: [1, 1],
      },
      {
        name: '暗影防护药水',
        type: 'potion',
        description: '叶绿调制的闪亮银色液体。饮用后10分钟内对死灵伤害有抗性。',
        probability: 0.3,
        quantity: [1, 1],
        condition: 'chapter>=3',
      },
      {
        name: '助手的符文纸',
        type: 'quest',
        description: '一张画着蚀目者标记的奇异符文纸，是叶绿助手留下的重要线索。',
        probability: 0.8,
        quantity: [1, 1],
        condition: 'chapter>=2',
        oneTime: true,
      },
    ],
    gold: [8, 20],
    maxItemsPerSearch: 3,
    repeatable: false,
  },

  // ── 铁砧铺 ──────────────────────────────────────
  {
    locationId: 'sturdy-anvil',
    items: [
      {
        name: '短剑',
        type: 'weapon',
        description: '轻便的刺击武器，深受盗贼喜爱。造成1d6穿刺伤害。',
        bonus: 0,
        probability: 0.3,
        quantity: [1, 1],
      },
      {
        name: '麻绳',
        type: 'misc',
        description: '50尺坚韧的麻绳。可用于攀爬、捆绑或即兴陷阱。',
        probability: 0.6,
        quantity: [1, 1],
      },
      {
        name: '黑色晶体样本',
        type: 'quest',
        description: '从矿石中取出的黑色晶体，靠近铁器时会发出微弱嗡鸣，像在共振。是格罗姆一直暗中调查的关键样本。',
        probability: 0.8,
        quantity: [1, 1],
        condition: 'chapter>=2',
        oneTime: true,
      },
    ],
    gold: [10, 25],
    maxItemsPerSearch: 2,
    repeatable: false,
  },

  // ── 暮色森林 ────────────────────────────────────
  {
    locationId: 'twilight-woods',
    items: [
      {
        name: '蜘蛛丝',
        type: 'misc',
        description: '从巨型蜘蛛网上采集的一束极为坚韧的蛛丝。',
        probability: 0.4,
        quantity: [1, 2],
      },
      {
        name: '药用草叶',
        type: 'misc',
        description: '暮色森林中采集的草药叶片，叶绿或其他草药师可用于配制药剂。',
        probability: 0.5,
        quantity: [1, 3],
      },
      {
        name: '仪式蜡烛残留',
        type: 'quest',
        description: '暮色森林中发现的仪式蜡烛残烬，蜡油上刻有蚀目者教团的符文印记。',
        probability: 0.7,
        quantity: [1, 1],
        condition: 'chapter>=2',
        oneTime: true,
      },
    ],
    gold: [0, 5],
    maxItemsPerSearch: 2,
    repeatable: true,
  },

  // ── 灰脊矿道上层 ────────────────────────────────
  {
    locationId: 'upper-mines',
    items: [
      {
        name: '火把',
        type: 'misc',
        description: '普通火把，燃烧1小时，在20尺半径内提供明亮光照。',
        probability: 0.7,
        quantity: [1, 3],
      },
      {
        name: '麻绳',
        type: 'misc',
        description: '50尺坚韧的麻绳。可用于攀爬、捆绑或即兴陷阱。',
        probability: 0.5,
        quantity: [1, 1],
      },
      {
        name: '矿工日记残页',
        type: 'quest',
        description: '矿道上层发现的残破日记页，记载了矿工目睹矿壁出现会动的符文、听到低语声的异常经历。',
        probability: 0.6,
        quantity: [1, 1],
        condition: 'chapter>=3',
        oneTime: true,
      },
      {
        name: '骨骼碎片',
        type: 'misc',
        description: '一块附魔骨骸碎片，隐约散发着残余的死灵能量。',
        probability: 0.3,
        quantity: [1, 1],
      },
    ],
    gold: [3, 12],
    maxItemsPerSearch: 2,
    repeatable: true,
  },

  // ── 灰脊矿道中层（废弃兵营） ─────────────────────
  {
    locationId: 'abandoned-barracks',
    items: [
      {
        name: '治疗药水',
        type: 'potion',
        description: '一瓶发光的红色液体。饮用后恢复2d4+2生命值。',
        bonus: 2,
        probability: 0.5,
        quantity: [1, 2],
      },
      {
        name: '矿道钥匙',
        type: 'quest',
        description: '一把沉重的铁钥匙，可开启通往灰脊矿道中层的封闭铁门。',
        probability: 0.7,
        quantity: [1, 1],
        condition: 'chapter>=3',
        oneTime: true,
      },
      {
        name: '暗影水晶',
        type: 'misc',
        description: '一块吸收周围光线的暗色水晶。散发出令人不安的寒意。',
        probability: 0.4,
        quantity: [1, 1],
        condition: 'chapter>=3',
      },
      {
        name: '搜救队营地遗物',
        type: 'quest',
        description: '搜救队遗留在矿道中层兵营的物品——一个刻有公会徽记的水壶和一份潦草的求救字条，暗示他们曾被困于此。',
        probability: 0.8,
        quantity: [1, 1],
        condition: 'chapter>=3',
        oneTime: true,
      },
    ],
    gold: [8, 20],
    maxItemsPerSearch: 3,
    repeatable: false,
  },

  // ── 碎盾亭酒馆 ────────────────────────────────
  {
    locationId: 'shattered-shield-tavern',
    items: [
      { name: '火把', type: 'misc', description: '普通火把，燃烧1小时。', probability: 0.6, quantity: [1, 2] },
      { name: '麻绳', type: 'misc', description: '50尺坚韧的麻绳。', probability: 0.35, quantity: [1, 1] },
      { name: '达里安的日志', type: 'quest', description: '一本破旧的日志，记录了20年前矿道深处的发现。封面有烧焦的痕迹。', probability: 0.85, quantity: [1, 1], condition: 'beat_done:ch3_mine_quest', oneTime: true },
    ],
    gold: [0, 5],
    maxItemsPerSearch: 2,
    repeatable: false,
  },

  // ── 冒险者公会 ────────────────────────────────
  {
    locationId: 'adventurer-guild',
    items: [
      { name: '火把', type: 'misc', description: '普通火把，燃烧1小时。', probability: 0.7, quantity: [1, 3] },
      { name: '公会任务告示', type: 'misc', description: '公告板上的最新悬赏任务列表，标注了几个近期失联的矿工名字。', probability: 0.9, quantity: [1, 1], oneTime: true },
      { name: '矿道通行证', type: 'quest', description: '授权持有者进入灰脊矿道中层的官方文件。', probability: 0.6, quantity: [1, 1], condition: 'beat_done:ch2_report_elena', oneTime: true },
    ],
    gold: [0, 8],
    maxItemsPerSearch: 2,
    repeatable: false,
  },

  // ── 镇长府 ────────────────────────────────────
  {
    locationId: 'mayor-office',
    items: [
      { name: '壁炉半烧文件', type: 'quest', description: '半烧毁的文件——教团胁迫维克多签署的"特别勘探许可"和矿道通行记录。', probability: 0.85, quantity: [1, 1], condition: 'chapter>=4', oneTime: true },
      { name: '镇长私人日记', type: 'quest', description: '维克多记录了女儿索菲亚失踪前后的情绪变化，某些名字被划掉。', probability: 0.5, quantity: [1, 1], condition: 'chapter>=3', oneTime: true },
      { name: '石碑拓片', type: 'quest', description: '维克多私藏的晨光石碑被删去的铭文拓印。', probability: 0.7, quantity: [1, 1], condition: 'chapter>=4', oneTime: true },
    ],
    gold: [10, 25],
    maxItemsPerSearch: 2,
    repeatable: false,
  },

  // ── 破晓旅店 ──────────────────────────────────
  {
    locationId: 'dawns-rest-inn',
    items: [
      { name: '火把', type: 'misc', description: '普通火把。', probability: 0.5, quantity: [1, 2] },
      { name: '陌生人的留言', type: 'misc', description: '塞在桌缝里的折叠纸片，写着"月圆之夜，北门，子时"。', probability: 0.5, quantity: [1, 1], condition: 'chapter>=3', oneTime: true },
    ],
    gold: [0, 8],
    maxItemsPerSearch: 1,
    repeatable: true,
  },

  // ── 银鳞商会 ──────────────────────────────────
  {
    locationId: 'silver-scale-guild',
    items: [
      { name: '矿产账册', type: 'quest', description: '记录了过去六个月矿石产量骤降及异常交易记录，某些条目被涂改。', probability: 0.7, quantity: [1, 1], condition: 'chapter>=3', oneTime: true },
    ],
    gold: [12, 25],
    maxItemsPerSearch: 1,
    repeatable: false,
  },

  // ── 碎石荒原 ──────────────────────────────────
  {
    locationId: 'shatterstone-wastes',
    items: [
      { name: '骨骼碎片', type: 'misc', description: '一块附魔骨骸碎片，散发残余的死灵能量。', probability: 0.5, quantity: [1, 2] },
      { name: '食尸鬼爪', type: 'misc', description: '食尸鬼断爪，带有麻痹残留物。', probability: 0.4, quantity: [1, 1] },
      { name: '教团控制符文', type: 'quest', description: '绑在兽人萨满颈上的符文牌，刻有蚀目者标记。', probability: 0.8, quantity: [1, 1], condition: 'chapter>=4', oneTime: true },
      { name: '古代文书残页', type: 'quest', description: '墓冢中的文书残页，记载了虚空棱镜被封印的经过。', probability: 0.65, quantity: [1, 1], condition: 'chapter>=4', oneTime: true },
    ],
    gold: [5, 15],
    maxItemsPerSearch: 2,
    repeatable: true,
  },

  // ── 灰脊矿道下层（深渊祭坛） ─────────────────
  {
    locationId: 'abyss-altar',
    items: [
      { name: '暗影防护药水', type: 'potion', description: '银色液体，饮用后10分钟内对死灵伤害有抗性。', probability: 0.6, quantity: [1, 2] },
      { name: '暗影精华', type: 'misc', description: '封存于玻璃小瓶内的凝缩暗影。', probability: 0.5, quantity: [1, 2] },
      { name: '教团仪式手册', type: 'quest', description: '蚀目者仪式的完整步骤手册，记录了虚空棱镜的激活方法。', probability: 0.85, quantity: [1, 1], condition: 'chapter>=4', oneTime: true },
      { name: '虚空碎片', type: 'quest', description: '结晶虚空能量碎片，散发黑暗力量的脉动。', probability: 0.5, quantity: [1, 1], condition: 'chapter>=4', oneTime: true },
    ],
    gold: [20, 50],
    maxItemsPerSearch: 3,
    repeatable: false,
  },
]
