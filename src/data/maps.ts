// World map data for Dawnbreak (破晓镇) and surrounding areas

export interface PointOfInterest {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  /** Grid position on the area's 16x16 map */
  position: { x: number; y: number };
  /** Whether this POI is initially visible to players */
  discovered: boolean;
  /** Is this the default entry point when entering the area? */
  isDefault?: boolean;
  /** Short arrival text */
  arrivalText?: string;
  /** Combat encounter bound to this POI (triggered when player engages) */
  encounter?: {
    monsters: string[];
    /** Whether this encounter has been discovered/triggered */
    discovered: boolean;
    /** Flavour text shown when the encounter is revealed */
    description: string;
    /** Atmospheric text shown at the lair entrance before player confirms entry */
    entranceText?: string;
  };
}

export interface Location {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  dangerLevel: 'safe' | 'low' | 'medium' | 'high' | 'deadly';
  /** Challenge rating range for encounters in this area */
  crRange: [number, number];
  /** Monster indices from SRD data that appear here */
  monsterPool: string[];
  /** 16x16 ASCII map template. Legend: # wall/rock, . floor/path, T tree, ~ water, * POI, @ entrance */
  asciiMap: string;
  pointsOfInterest: PointOfInterest[];
}

export interface Connection {
  from: string;
  to: string;
  description: string;
  /** Travel time in minutes (game time) */
  travelTime: number;
  /** Whether this path is known to the party from the start */
  known: boolean;
}

// ──────────────────────────────────────────────
// Locations
// ──────────────────────────────────────────────

export const dawnbreakTown: Location = {
  id: 'dawnbreak-town',
  name: 'Dawnbreak Town',
  nameZh: '破晓镇',
  description: '坐落于灰脊山脉东麓山谷的矿业小镇，约五百人居住。',
  dangerLevel: 'safe',
  crRange: [0, 0],
  monsterPool: [],
  asciiMap: [
    '################',
    '#..............#',
    '#..###..###..#.#',
    '#..#*#..#*#..#.#',
    '#..###..###....#',
    '#.......*......#',
    '#..###.....###.#',
    '#..#*#..*..#*#.#',
    '#..###.....###.#',
    '#..............#',
    '#..###..###....#',
    '#..#*#..#*#..#.#',
    '#..###..###..#.#',
    '#..............#',
    '#......@.......#',
    '################',
  ].join('\n'),
  pointsOfInterest: [
    {
      id: 'town-square',
      name: 'Town Square',
      nameZh: '镇中广场',
      description: '破晓镇的中心广场，晨光石碑矗立其中。几条道路从这里通向镇上各处。',
      position: { x: 7, y: 14 },
      discovered: true,
      isDefault: true,
      arrivalText: '你来到破晓镇中心的广场，四周是低矮的石墙建筑。',
    },
    {
      id: 'dawn-stele',
      name: 'Dawn Stele',
      nameZh: '晨光石碑',
      description: '镇中心的古代石碑，刻有无人能读的符文。每日第一缕阳光照亮碑面，因此得名破晓镇。',
      position: { x: 7, y: 5 },
      discovered: true,
      arrivalText: '古老的石碑在月光下泛着淡淡银灰色的光。',
    },
    {
      id: 'dawns-rest-inn',
      name: "Dawn's Rest Inn",
      nameZh: '破晓旅店',
      description: '冒险者常驻之处，老板娘陈妈消息灵通。',
      position: { x: 3, y: 3 },
      discovered: true,
      arrivalText: '推开旅店木门，暖意和饭菜香扑面而来。',
    },
    {
      id: 'sturdy-anvil',
      name: 'The Sturdy Anvil',
      nameZh: '铁砧铺',
      description: '矮人铁匠格罗姆经营，出售武器护甲。',
      position: { x: 8, y: 3 },
      discovered: true,
      arrivalText: '叮叮当当的锤打声从铁匠铺中传来。',
    },
    {
      id: 'greenleaf-apothecary',
      name: 'Greenleaf Apothecary',
      nameZh: '草药堂',
      description: '半精灵药剂师叶绿经营，出售药水和草药。',
      position: { x: 3, y: 7 },
      discovered: true,
      arrivalText: '草药堂门口挂着几束晾晒的药草，空气中弥漫着淡淡的草木香。',
    },
    {
      id: 'adventurer-guild',
      name: 'Adventurer Guild Branch',
      nameZh: '冒险者公会分部',
      description: '由退役战士"独臂"韩猛管理，发布任务、提供情报。',
      position: { x: 7, y: 7 },
      discovered: true,
      arrivalText: '公会大门上刻着交叉的剑与盾徽记。',
    },
    {
      id: 'mayor-office',
      name: "Mayor's Office",
      nameZh: '镇长府',
      description: '镇长维克多·黑石的办公室，破晓镇的行政中心。门口卫兵神情冷漠，门窗常常紧闭。',
      position: { x: 3, y: 11 },
      discovered: true,
      arrivalText: '镇长府大门紧闭，门口站着一个无精打采的卫兵。',
    },
    {
      id: 'silver-scale-guild',
      name: 'Silver Scale Guild Hall',
      nameZh: '银鳞商会',
      description: '控制矿石贸易的商会总部，会长卢银舟富甲一方。',
      position: { x: 8, y: 11 },
      discovered: true,
      arrivalText: '商会大厅富丽堂皇，与镇上其他建筑格格不入。',
    },
    {
      id: 'shattered-shield-tavern',
      name: 'The Shattered Shield Tavern',
      nameZh: '碎盾亭酒馆',
      description: '前佣兵格雷格·铁拳头经营的酒馆，冒险者聚集之处。一个名叫小莉的小女孩时常在此忙碌。',
      position: { x: 12, y: 7 },
      discovered: true,
      arrivalText: '碎盾亭的招牌在风中吱呀作响，暖黄灯光从窗内透出。',
    },
  ],
};

export const twilightWoods: Location = {
  id: 'twilight-woods',
  name: 'Twilight Woods',
  nameZh: '暮色森林',
  description: '镇子南面和东面环绕的茂密森林，越往深处光线越暗。',
  dangerLevel: 'medium',
  crRange: [0.25, 3],
  monsterPool: ['Wolf', 'Giant Spider', 'Cockatrice', 'Goblin'],
  asciiMap: [
    'TTTTTTTTTTTTTTTT',
    'TT..TTT.TTTTTTT.',
    'T....TT..TTTTTT.',
    'T..*..T...TTTTT.',
    'TT....TT..T..TT.',
    'TTT..TTT......T.',
    'TTTT.TTTT..T..T.',
    'TTT..TTTT.TTT.TT',
    'TT....TTT.TTTTTT',
    'T..*...TT..TTTTT',
    'T......TT...TTTT',
    'TT..T.TTT.~.TTTT',
    'TTT.T.TTTT.~.TTT',
    'TTTT..TTTT..*.TT',
    'TTTTT@TTTTTTTTT.',
    'TTTTTTTTTTTTTTTT',
  ].join('\n'),
  pointsOfInterest: [
    {
      id: 'forest-entrance',
      name: 'Forest Entrance',
      nameZh: '森林入口',
      description: '暮色森林边缘，古木参天，阳光透过枝叶洒下斑驳光影。',
      position: { x: 5, y: 14 },
      discovered: true,
      isDefault: true,
      arrivalText: '踏入森林边缘，光线骤然暗淡，空气变得潮湿。',
    },
    {
      id: 'old-lumber-camp',
      name: 'Old Lumber Camp',
      nameZh: '旧伐木场',
      description: '废弃多年的伐木场，残破的木屋间散落着新鲜的篝火灰烬，似乎有什么生物在此扎营。',
      position: { x: 3, y: 3 },
      discovered: false,
      encounter: {
        monsters: ['Spider Matriarch', 'Giant Spider', 'Giant Spider'],
        discovered: false,
        description: '旧伐木场被巨大的暗紫色蛛网覆盖，空气中弥漫着令人作呕的甜腥味。蛛网中心坐着一只比马还大的蜘蛛女王。',
        entranceText: '越深入伐木场，空气越发沉重。暗紫色蛛网从断裂的屋梁垂落，每走一步都能感到脚下的黏腻。前方黑暗中传来沉重的呼吸声——有什么巨大的东西在等待着你。',
      },
    },
    {
      id: 'hunter-stone-house',
      name: "Hunter's Stone House",
      nameZh: '猎人石屋',
      description: '隐居猎人"老林"的住所，了解森林中异常的动物迁徙。',
      position: { x: 3, y: 9 },
      discovered: false,
    },
    {
      id: 'moon-pool',
      name: 'Moon Pool',
      nameZh: '月池',
      description: '终年不冻的水潭，水面映着月光。周围有被践踏的痕迹和烧焦的草地。',
      position: { x: 12, y: 13 },
      discovered: false,
    },
  ],
};

export const greyspineMines: Location = {
  id: 'greyspine-mines',
  name: 'Greyspine Mines',
  nameZh: '灰脊矿道',
  description: '镇子北面山体中的矿道网络，分为上层、中层和下层。',
  dangerLevel: 'high',
  crRange: [0.5, 2],
  monsterPool: ['Skeleton', 'Shadow', 'Ghoul', 'Mimic', 'Giant Spider'],
  asciiMap: [
    '################',
    '###...####...###',
    '##.....##.....##',
    '#.......*......#',
    '##.....##.....##',
    '###...####...###',
    '####.######.####',
    '####..####..####',
    '#####..##..#####',
    '######....######',
    '######.##.######',
    '#####..*..#####.',
    '####......####..',
    '####..##..####..',
    '####..*.*.####..',
    '################',
  ].join('\n'),
  pointsOfInterest: [
    {
      id: 'upper-mines',
      name: 'Upper Mine Shafts',
      nameZh: '上层矿道',
      description: '仍有矿工作业，但产量骤降。偶尔能听到深处回音。',
      position: { x: 8, y: 3 },
      discovered: true,
      isDefault: true,
      arrivalText: '矿道入口处冷风扑面，生锈的铁轨向黑暗深处延伸。',
    },
    {
      id: 'abandoned-barracks',
      name: 'Abandoned Barracks',
      nameZh: '废弃矿工宿舍',
      description: '废弃的矿工宿舍，墙壁上绘着诡异的眼形符号，地面散落着烧尽的烛芯。',
      position: { x: 7, y: 11 },
      discovered: false,
    },
    {
      id: 'abyss-altar',
      name: 'Abyss Altar',
      nameZh: '深渊祭坛',
      description: '矿道最深处的天然溶洞，空气中弥漫着令人窒息的压迫感，深处隐约传来低沉的嗡鸣。',
      position: { x: 6, y: 14 },
      discovered: false,
      encounter: {
        monsters: ['Shadow Weaver', 'Shadow'],
        discovered: false,
        description: '祭坛前的空气扭曲变形，一团有意识的活体黑暗盘踞在虚空符文上方。暗影编织者的两只光芒暗淡的眼睛在黑暗中转向你。',
        entranceText: '矿道尽头的溶洞散发着刺骨的寒意。虚空符文在黑暗中闪烁幽蓝微光，每靠近一步，胸口的压迫感就重一分。祭坛深处，黑暗本身似乎在注视着你。',
      },
    },
    {
      id: 'void-prism',
      name: 'Void Prism Chamber',
      nameZh: '虚空棱镜室',
      description: '幽闭的石室，中央悬浮着一颗扭曲光线的黑色晶体，周围的火光异常黯淡。',
      position: { x: 8, y: 14 },
      discovered: false,
    },
  ],
};

export const shatterstoneWastes: Location = {
  id: 'shatterstone-wastes',
  name: 'Shatterstone Wastes',
  nameZh: '碎石荒原',
  description: '镇子西面的干燥荒原，遍布碎裂灰色岩石，地形崎岖，常有浓雾。',
  dangerLevel: 'medium',
  crRange: [0.5, 3],
  monsterPool: ['Orc Warrior', 'Ghoul', 'Skeleton'],
  asciiMap: [
    '................',
    '..##..........#.',
    '.####...##..###.',
    '.####..####.##..',
    '..##...#*##.....',
    '........##......',
    '...##...........',
    '..####.....##...',
    '..####....####..',
    '...##.....#*##..',
    '..........####..',
    '....##.....##...',
    '...####.........',
    '...#*##...@.....',
    '....##..........',
    '................',
  ].join('\n'),
  pointsOfInterest: [
    {
      id: 'wastes-entrance',
      name: 'Wasteland Entrance',
      nameZh: '荒原入口',
      description: '干燥的空气扑面而来，碎裂的灰色岩石如骨骼般从黄沙中刺出。',
      position: { x: 10, y: 13 },
      discovered: true,
      isDefault: true,
      arrivalText: '踏上荒原，脚下碎石嘎吱作响，远处隐约可见烟柱。',
    },
    {
      id: 'orc-camp',
      name: 'Orc War Camp',
      nameZh: '兽人营地',
      description: '兽人战团的营地，篝火常燃。萨满的举止异常焦躁，吼叫声中带着压抑的怨怒。',
      position: { x: 4, y: 4 },
      discovered: false,
    },
    {
      id: 'ancient-barrow',
      name: 'Ancient Barrow',
      nameZh: '古战场墓冢',
      description: '半塌陷的地下墓穴，亡灵的低语在通道中回荡。深处似乎藏着古老的东西。',
      position: { x: 9, y: 9 },
      discovered: false,
    },
    {
      id: 'ruined-watchtower',
      name: 'Ruined Watchtower',
      nameZh: '废弃瞭望塔',
      description: '可俯瞰四周的石塔，顶层散落着潮湿的纸张和暗褐色的污渍。',
      position: { x: 4, y: 13 },
      discovered: false,
      encounter: {
        monsters: ['Eclipsed Beast'],
        discovered: false,
        description: '废弃瞭望塔的阴影中，一个庞大的暗影实体缓缓浮现。周围的光线被吞噬，连星光都暗淡了下来。蚀日兽——虚空棱镜的守护者——已经注意到了你。',
        entranceText: '石塔入口处的空气冰冷异常。每上一层台阶，火把的光芒就暗淡几分，像是被某种力量吞噬。塔顶传来低沉的嗡鸣，脚下的石板在微微震颤。',
      },
    },
  ],
};

// ──────────────────────────────────────────────
// All locations indexed by ID
// ──────────────────────────────────────────────

export const locations: Record<string, Location> = {
  [dawnbreakTown.id]: dawnbreakTown,
  [twilightWoods.id]: twilightWoods,
  [greyspineMines.id]: greyspineMines,
  [shatterstoneWastes.id]: shatterstoneWastes,
};

// ──────────────────────────────────────────────
// Connections between areas
// ──────────────────────────────────────────────

export const connections: Connection[] = [
  {
    from: 'dawnbreak-town',
    to: 'twilight-woods',
    description: '南门出镇，沿林间小道进入暮色森林。',
    travelTime: 15,
    known: true,
  },
  {
    from: 'dawnbreak-town',
    to: 'greyspine-mines',
    description: '北门出镇，沿矿道铁轨步行上山。',
    travelTime: 20,
    known: true,
  },
  {
    from: 'dawnbreak-town',
    to: 'shatterstone-wastes',
    description: '西门出镇，穿过干涸河床进入荒原。',
    travelTime: 30,
    known: true,
  },
  {
    from: 'twilight-woods',
    to: 'shatterstone-wastes',
    description: '森林西缘有一条隐蔽小径通往荒原，需要DC 15 生存检定才能发现。',
    travelTime: 45,
    known: false,
  },
  {
    from: 'twilight-woods',
    to: 'greyspine-mines',
    description: '森林北面山脚有一个隐蔽的矿道侧入口，被藤蔓覆盖。',
    travelTime: 40,
    known: false,
  },
];

// ──────────────────────────────────────────────
// World overview map (rough positioning)
// ──────────────────────────────────────────────

/**
 * Overview ASCII map showing relative positions of all areas.
 *
 * ```
 *          N
 *          |
 *    ┌─────────────┐
 *    │  灰脊矿道    │
 *    │ (Greyspine)  │
 *    └──────┬───────┘
 *           │
 *  ┌────────┼────────┐
 *  │        │        │
 *  │  碎石   │  破晓镇 │
 *  │  荒原 ──┤(Dawn-  │
 *  │(Waste) │ break) │
 *  │        │        │
 *  └────────┼────────┘
 *           │
 *    ┌──────┴───────┐
 *    │  暮色森林     │
 *    │ (Twilight)   │
 *    └──────────────┘
 * ```
 */
// ──────────────────────────────────────────────
// 战棋地形模板 — 7×5 格，0=空地 1=障碍 2=困难地形
// 每个区域 2 套模板，战斗时随机选一个
// ──────────────────────────────────────────────

export const COMBAT_TERRAINS: Record<string, number[][][]> = {
  'twilight-woods': [
    // 蛛巢：两侧岩壁，中央交战区开阔
    [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 2, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 2, 0, 0, 0, 2, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ],
    // 林间空地：外围灌木，中央有倒木
    [
      [0, 0, 0, 2, 0, 0, 0],
      [2, 0, 0, 0, 0, 0, 2],
      [0, 0, 1, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 2, 0, 0, 0, 2, 0],
    ],
  ],
  'greyspine-mines': [
    // 窄道：四角堵死，中间通道
    [
      [1, 0, 0, 0, 0, 0, 1],
      [0, 0, 1, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 1, 0, 0],
      [1, 0, 0, 0, 0, 0, 1],
    ],
    // 溶洞：两侧石柱，中央有碎石
    [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 2, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ],
  ],
  'shatterstone-wastes': [
    // 荒野：散布碎石，视野开阔
    [
      [0, 2, 0, 0, 0, 2, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [2, 0, 0, 0, 0, 0, 2],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 2, 0, 0, 0, 2, 0],
    ],
    // 废墟：残墙掩体
    [
      [0, 0, 1, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 2, 0, 0, 0, 2, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ],
  ],
  'dawnbreak-town': [
    // 广场：几乎全空
    [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 2, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ],
    // 酒馆内：桌椅掩体
    [
      [1, 0, 0, 0, 0, 0, 1],
      [0, 0, 1, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 1, 0, 0],
      [1, 0, 0, 0, 0, 0, 1],
    ],
  ],
}

/** 注册表中最长地名长度（区域名 + POI名），供规则层判断输入是否为纯目的地 */
export const MAX_LOCATION_NAME_LENGTH = Math.max(
  ...Object.values(locations).flatMap(loc =>
    [loc.nameZh, ...loc.pointsOfInterest.map((p: any) => p.nameZh)]
  ).map(n => n.length)
)

// ─── POI 发现状态: session-scoped, 不污染 module ─────────────────
//
// 历史 bug (修复于 2026-04-18): tools/search.ts 直接 mutate
// `loc.pointsOfInterest[i].discovered = true`,这是 module-level 共享对象,
// 改动会持续到 server 重启,导致"开新游戏后地图仍显示上局发现的隐藏 POI"。
//
// 修复设计:
// - POI_INITIAL_DISCOVERED 在模块加载时 snapshot 一次,作为 immutable 默认状态
// - 玩家发现 POI 通过 markPoiDiscovered → 写入 session.worldState.flags
// - 所有 .discovered 读取改 isPoiDiscovered(session, poi) — 综合 snapshot + flag
// - 即使 module 数据因任何原因被 mutate,helper 只信任 snapshot,新 session 干净
const POI_INITIAL_DISCOVERED: ReadonlySet<string> = (() => {
  const set = new Set<string>()
  for (const loc of Object.values(locations)) {
    for (const poi of loc.pointsOfInterest ?? []) {
      if (poi.discovered === true) set.add(poi.id)
    }
  }
  return set
})()

interface SessionLike { worldState: { flags: Record<string, any> } }

export function isPoiDiscovered(session: SessionLike, poi: { id: string }): boolean {
  if (POI_INITIAL_DISCOVERED.has(poi.id)) return true
  return !!session.worldState.flags[`poi_discovered_${poi.id}`]
}

export function markPoiDiscovered(session: SessionLike, poiId: string): void {
  session.worldState.flags[`poi_discovered_${poiId}`] = true
}

export const WORLD_OVERVIEW = `
     ████████████████
     █  灰脊矿道    █
     █  Greyspine   █
     ████████┬███████
             │
  ████████   │   ████████
  █ 碎石  █──┼──█ 破晓镇 █
  █ 荒原  █  │  █Dawnbreak█
  ████████   │   ████████
             │
     ████████┴███████
     █  暮色森林    █
     █  Twilight    █
     ████████████████
`;
