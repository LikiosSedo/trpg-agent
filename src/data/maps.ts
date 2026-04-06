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
      description: '镇长维克多·黑石的办公室，暗中收受商会贿赂。',
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
      description: '前佣兵格雷格·铁拳头经营的酒馆，冒险者聚集之处。帮工小莉拥有灵视能力。',
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
      description: '废弃多年，现在是6-8只哥布林和1只大地精头领的临时营地。',
      position: { x: 3, y: 3 },
      discovered: false,
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
      description: '教团成员的秘密集会点，墙壁上绘有蚀目者符号。',
      position: { x: 7, y: 11 },
      discovered: false,
    },
    {
      id: 'abyss-altar',
      name: 'Abyss Altar',
      nameZh: '深渊祭坛',
      description: '矿道最深处的天然溶洞，暗影教团在此挖掘虚空棱镜。主线最终战场。',
      position: { x: 6, y: 14 },
      discovered: false,
    },
    {
      id: 'void-prism',
      name: 'Void Prism Chamber',
      nameZh: '虚空棱镜室',
      description: '棱镜所在的密室，暗影能量会削弱普通光源。',
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
  monsterPool: ['Orc Warrior', 'Ghoul', 'Skeleton', 'Eclipsed Beast'],
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
      description: '约十二人的兽人战团驻扎于此，萨满受到暗影能量影响变得异常好斗。',
      position: { x: 4, y: 4 },
      discovered: false,
    },
    {
      id: 'ancient-barrow',
      name: 'Ancient Barrow',
      nameZh: '古战场墓冢',
      description: '半塌陷的地下墓穴，亡灵开始不安分。深处有与晨光石碑同材质的碎片。',
      position: { x: 9, y: 9 },
      discovered: false,
    },
    {
      id: 'ruined-watchtower',
      name: 'Ruined Watchtower',
      nameZh: '废弃瞭望塔',
      description: '可俯瞰四周的石塔。顶层有被杀冒险者的未完成调查笔记。',
      position: { x: 4, y: 13 },
      discovered: false,
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
