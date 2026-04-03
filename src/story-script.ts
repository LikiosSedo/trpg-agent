/**
 * 结构化剧本 — 章节 × 事件 × 发现
 *
 * 世界真相是硬编码的拓扑图，LLM 只负责润色叙事。
 * 每章有若干 Beat（关键剧情点）和 Discovery（可探索内容）。
 * Beat 全部完成 → 章节推进 → 世界状态更新。
 * 章节内时间冻结，玩家可自由探索。
 */

// ─── 类型定义 ──────────────────────────────────

export interface Beat {
  id: string
  /** 触发条件：'auto' | 'talk:NPC名' | 'arrive:地点id' | 'quest:任务名' | 'search' | 'combat_end' */
  trigger: string
  /** 前置 beat id 列表，全部完成才能触发本 beat */
  requires?: string[]
  /** DM 必须传达的硬编码真相（注入 prompt） */
  facts: string[]
  /** true = 非必须，不影响章节推进 */
  optional?: boolean
}

export interface Discovery {
  id: string
  /** 所在区域 */
  location: string
  /** 触发方式，格式同 Beat.trigger */
  trigger: string
  /** 前置条件（beat 或 discovery id） */
  requires?: string[]
  /** 简短描述（UI 显示 + 回顾用） */
  label: string
}

export interface ChapterDef {
  id: string
  title: string
  /** 注入 DM prompt 的世界背景（本章视角） */
  worldContext: string
  beats: Beat[]
  discoveries: Discovery[]
  /** 推进条件：这些 beat id 全部完成 */
  advanceWhen: string[]
  /** 防卡提示 */
  nudge: {
    /** 多少轮没触发新 beat 后开始提示 */
    afterIdleTurns: number
    /** 递进式提示（注入 DM prompt，NPC 口吻） */
    hints: string[]
  }
  /** 章节推进时的世界变化 */
  onAdvance?: {
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
    flags?: Record<string, any>
  }
  /** 下一章 id（undefined = 最终章） */
  nextChapter?: string
}

// ─── 章节数据 ──────────────────────────────────

export const CHAPTERS: ChapterDef[] = [
  // ═══════════════════════════════════════════════
  // 第一章：夜至破晓
  // ═══════════════════════════════════════════════
  {
    id: 'ch1',
    title: '第一章：夜至破晓',
    worldContext: [
      '当前章节背景：玩家刚乘马车抵达破晓镇，深夜时分。',
      '镇上大部分建筑已熄灯，只有碎盾亭酒馆还亮着暖黄灯光。',
      '玩家是外来冒险者，初来乍到不认识任何人。',
      '本章核心：让玩家在酒馆落脚，认识格雷格和小莉，了解镇上出了事，得到前往冒险者公会的方向。',
      '叙事要求：场景从马车到达开始，自然引导到酒馆内部。每次回应必须承接上一轮的场景和玩家选择，禁止跳切。',
      '',
      '开场场景要素（第一轮必须包含）：',
      '- 深夜，一辆颠簸的马车在破晓镇口缓缓停下',
      '- 远处碎盾亭酒馆透出暖黄灯光，是镇上唯一还亮着灯的地方',
      '- 镇口有一块古旧石碑，月光下依稀可辨几个字',
      '- 车夫催促玩家下车，说不在这过夜',
    ].join('\n'),

    beats: [
      {
        id: 'ch1_meet_greg',
        trigger: 'talk:格雷格',
        facts: [
          '格雷格从柜台后抬头打量玩家——六尺二的身躯微微前倾，右眉旧疤在火光下显得深沉',
          '他手里仍在擦拭一只木杯，声音低沉如砂纸磨木',
          '他推过一碗热汤，简短问玩家来历',
          '"深夜进镇的，要么是赶路的傻子，要么是来找活干的冒险者。你是哪种？"',
        ],
      },
      {
        id: 'ch1_xiaoli',
        trigger: 'talk:格雷格',
        requires: ['ch1_meet_greg'],
        facts: [
          '小莉端着盘子从厨房出来，走过玩家身边时突然停住',
          '她歪头盯着玩家看了几秒，灰色眼睛里闪过什么',
          '"你身上有……奇怪的味道。"她压低声音说，然后被格雷格轻声叫走："小莉，别吓人。"',
          '小莉走开时回头又看了玩家一眼',
        ],
        optional: true,
      },
      {
        id: 'ch1_guild_direction',
        trigger: 'talk:格雷格',
        requires: ['ch1_meet_greg'],
        facts: [
          '格雷格提到镇上矿洞最近不太平，三周前有人失踪了',
          '"要是来找活干的，明天去冒险者公会找艾琳娜。她会把该知道的都告诉你。"',
          '他指了指东边的方向',
          '格雷格提供免费住宿——"后头有空房，今晚先歇着"',
        ],
      },
    ],

    discoveries: [
      { id: 'ch1_d_greg',       location: 'dawnbreak-town', trigger: 'talk:格雷格',  label: '认识了酒馆老板格雷格' },
      { id: 'ch1_d_xiaoli',     location: 'dawnbreak-town', trigger: 'talk:小莉',    label: '认识了帮工女孩小莉，她似乎能感知到什么' },
      { id: 'ch1_d_chenma',     location: 'dawnbreak-town', trigger: 'talk:陈妈',    label: '和旅店老板娘陈妈聊天，得知镇上近况' },
      { id: 'ch1_d_monument',   location: 'dawnbreak-town', trigger: 'search',       label: '观察了镇口石碑上模糊的古老文字' },
      { id: 'ch1_d_notice',     location: 'dawnbreak-town', trigger: 'search',       label: '看到酒馆墙上贴着冒险者公会招募告示' },
    ],

    advanceWhen: ['ch1_guild_direction'],

    nudge: {
      afterIdleTurns: 8,
      hints: [
        '格雷格把擦好的杯子放回架上，不经意地说："镇上最近不太平，矿洞那边出了事。"他顿了顿，"你要是闲着没事……算了，喝你的汤吧。"',
        '小莉端着一杯热茶放在玩家桌上，小声说："老格之前当过冒险者的，他知道很多事。你多跟他聊聊。"',
        '格雷格从柜台后走出来，将杯子倒扣在架上："听着——你看起来不像在这待一晚就走的人。镇东有冒险者公会，找艾琳娜，她在找人手。"',
      ],
    },

    onAdvance: {
      timeOfDay: 'morning',
    },
    nextChapter: 'ch2',
  },

  // ═══════════════════════════════════════════════
  // 第二章：公会试炼
  // ═══════════════════════════════════════════════
  {
    id: 'ch2',
    title: '第二章：公会试炼',
    worldContext: [
      '当前章节背景：清晨，玩家在碎盾亭过了一夜。',
      '冒险者公会在镇东，会长艾琳娜正在寻找能手。',
      '镇上其他设施开放——铁砧铺(格罗姆)、草药堂(叶绿)、旅店(陈妈)。',
      '游吟诗人卡恩可能在镇上某处出没。',
      '本章核心：在公会接受评估，被派去暮色森林完成试炼任务，证明实力后回来报告。',
      '叙事要求：承接上一章的酒馆过夜。清晨醒来时简短描写（不要重复昨晚场景）。每次行动必须有因果衔接。',
    ].join('\n'),

    beats: [
      {
        id: 'ch2_meet_elena',
        trigger: 'talk:艾琳娜',
        facts: [
          '艾琳娜坐在公会大厅深处的桌前，银白侧辫，琥珀色眼睛带着疲倦',
          '她抬头看了玩家一眼，极慢地开口，字字精选',
          '"……你是格雷格介绍来的？"她微微歪头',
          '她不急不慢地评估玩家——问了几个看似随意的问题',
        ],
      },
      {
        id: 'ch2_forest_quest',
        trigger: 'talk:艾琳娜',
        requires: ['ch2_meet_elena'],
        facts: [
          '艾琳娜分配任务：去暮色森林处理近期骚扰猎人的狼群，顺便确认猎人老林的安全',
          '"森林边缘不算太危险，但别大意。"她的食指在桌面上轻轻敲了两下',
          '她建议先去铁砧铺找格罗姆看看装备——"别拿着生锈的铁片就往森林跑"',
          '韩猛在一旁补充了简要的森林地形信息',
        ],
      },
      {
        id: 'ch2_enter_forest',
        trigger: 'arrive:twilight-woods',
        facts: [
          '暮色森林入口处古木参天，树冠遮蔽了大部分阳光',
          '空气中弥漫着潮湿的泥土气息和腐叶的味道',
          '远处隐约传来狼嚎，脚下的落叶中有新鲜的爪印',
        ],
        optional: true,
      },
      {
        id: 'ch2_trial_complete',
        trigger: 'quest:森林试炼',
        facts: [
          '森林试炼完成，玩家证明了自己的基础战斗能力',
          '回到公会报告时，艾琳娜点了点头："……有意思。比我预想的好一些。"',
          '韩猛拍了拍玩家肩膀，语气里多了几分认真',
        ],
      },
    ],

    discoveries: [
      { id: 'ch2_d_elena',     location: 'dawnbreak-town',  trigger: 'talk:艾琳娜', label: '认识了公会会长艾琳娜，高等精灵，行事谨慎' },
      { id: 'ch2_d_hanmeng',   location: 'dawnbreak-town',  trigger: 'talk:韩猛',   label: '公会管理员韩猛提到派出的调查小队失联了' },
      { id: 'ch2_d_grom',      location: 'dawnbreak-town',  trigger: 'talk:格罗姆',  label: '矮人铁匠格罗姆展示了矿道中发现的黑色晶体' },
      { id: 'ch2_d_yelv',      location: 'dawnbreak-town',  trigger: 'talk:叶绿',   label: '药剂师叶绿提到助手最近行为古怪，深夜外出' },
      { id: 'ch2_d_kahn',      location: 'dawnbreak-town',  trigger: 'talk:卡恩',   label: '遇到游吟诗人卡恩，友善健谈但问很多问题' },
      { id: 'ch2_d_forest_hut', location: 'twilight-woods', trigger: 'search',       label: '在森林深处发现猎人石屋，有近期过夜痕迹' },
      { id: 'ch2_d_moonpool',  location: 'twilight-woods',  trigger: 'search',       label: '发现月池边有仪式残留痕迹和奇怪符号' },
    ],

    advanceWhen: ['ch2_trial_complete'],

    nudge: {
      afterIdleTurns: 10,
      hints: [
        '韩猛在公会门口拦住一个路过的冒险者低声交谈了几句，表情凝重。他注意到玩家在看，冲你点了下头："有空的话，进来聊聊。"',
        '小莉跑来递了张纸条："老格让我给你的——上面写着\'公会，快去\'。"她歪头看着你，"他从来不写纸条的。"',
        '格罗姆在铁砧铺门口朝你喊："嘿，新来的！听说公会在招人手，你还杵在这干嘛？艾琳娜可不喜欢等人！"',
      ],
    },

    onAdvance: {
      timeOfDay: 'afternoon',
      flags: { forestTrialDone: true },
    },
    nextChapter: 'ch3',
  },

  // ═══════════════════════════════════════════════
  // 第三章：矿道阴影
  // ═══════════════════════════════════════════════
  {
    id: 'ch3',
    title: '第三章：矿道阴影',
    worldContext: [
      '当前章节背景：玩家完成森林试炼，获得公会信任。',
      '艾琳娜决定派玩家调查矿道——失踪矿工和搜救队两周未归。',
      '世界变化：卡恩开始更频繁地在镇上出没。维克多压力增大，偶尔欲言又止。',
      '陈妈提到最近有陌生人在月圆前后出没，都往矿道方向去。',
      '本章核心：深入矿道，发现暗影教团的存在和活动痕迹，收集证据。',
      '叙事要求：营造矿道的压迫感和恐惧。越深入越诡异。发现教团痕迹时要有冲击力。',
    ].join('\n'),

    beats: [
      {
        id: 'ch3_mine_quest',
        trigger: 'talk:艾琳娜',
        facts: [
          '艾琳娜神情比以往更凝重，食指反复敲着桌面',
          '"矿道的情况……比我告诉你的更严重。"她压低声音',
          '失踪的不只是矿工——公会派去的搜救队也失联了',
          '韩猛补充：最后一支小队报告矿道中层异常寒冷，墙壁上有会动的符文',
        ],
      },
      {
        id: 'ch3_enter_mines',
        trigger: 'arrive:greyspine-mines',
        facts: [
          '矿道入口处冷风扑面，比外面温度低了不止一个档次',
          '上层还有矿工留下的工具和半满的矿车，但人已经全撤了',
          '矿道壁上有新鲜的抓痕，不像是人类留下的',
        ],
      },
      {
        id: 'ch3_cult_traces',
        trigger: 'search',
        requires: ['ch3_enter_mines'],
        facts: [
          '在矿道中层的一个分叉洞室发现暗影教团的仪式痕迹',
          '墙壁上刻着蚀目者的标记——一只被斜线划过的眼睛',
          '地上有烧焦的蜡烛残留和干涸的暗色液体',
          '空气中弥漫着不自然的寒气，金属味刺鼻',
        ],
      },
      {
        id: 'ch3_mine_complete',
        trigger: 'quest:矿道调查',
        facts: [
          '矿道调查揭示了触目惊心的真相——有组织在利用矿道进行某种仪式',
          '带着证据回到公会，艾琳娜看完后沉默了很久',
          '"……这比我担心的还要糟。"她的语气从未如此严肃',
          '韩猛握紧了独臂的拳头',
        ],
      },
    ],

    discoveries: [
      { id: 'ch3_d_victor',     location: 'dawnbreak-town',   trigger: 'talk:维克多', label: '镇长维克多欲言又止，似乎有难言之隐' },
      { id: 'ch3_d_chenma_tip', location: 'dawnbreak-town',   trigger: 'talk:陈妈',  label: '陈妈说陌生人总在月圆前后出现，往矿道方向去' },
      { id: 'ch3_d_kahn_night', location: 'dawnbreak-town',   trigger: 'talk:陈妈',  requires: ['ch3_d_chenma_tip'], label: '陈妈还提到卡恩深夜独自外出' },
      { id: 'ch3_d_crystals',   location: 'greyspine-mines',  trigger: 'search',     label: '发现矿道中的黑色晶体，靠近铁器时会发出嗡鸣' },
      { id: 'ch3_d_cold_zone',  location: 'greyspine-mines',  trigger: 'search',     label: '矿道中层温度骤降区域，墙壁上有微光符文' },
      { id: 'ch3_d_camp',       location: 'greyspine-mines',  trigger: 'search',     label: '发现失踪搜救队的临时营地遗留物' },
    ],

    advanceWhen: ['ch3_mine_complete'],

    nudge: {
      afterIdleTurns: 10,
      hints: [
        '韩猛在公会里来回踱步，看到玩家走进来立刻迎上来："任务怎么还没开始？矿道那边等不了太久了。"',
        '艾琳娜难得主动找到玩家："我需要你尽快去矿道看看。每多耽搁一天，找到幸存者的希望就少一分。"',
        '格罗姆拦住玩家："小子，你拿着我的装备不去矿道蹲着干嘛？听说里面有古怪，正需要你这样的去看看。"他把一块黑色晶体塞进你手里，"拿着这个对比——矿道里应该还有更多。"',
      ],
    },

    onAdvance: {
      timeOfDay: 'evening',
      flags: { mineInvestigated: true, cultDiscovered: true },
    },
    nextChapter: 'ch4',
  },

  // ═══════════════════════════════════════════════
  // 第四章：荒原真相
  // ═══════════════════════════════════════════════
  {
    id: 'ch4',
    title: '第四章：荒原真相',
    worldContext: [
      '当前章节背景：教团的存在已经确认。公会进入高度戒备状态。',
      '艾琳娜怀疑碎石荒原的兽人异常和教团有关——兽人可能被教团利用或驱动。',
      '世界变化：维克多变得更加不安，可能私下尝试向玩家求助。',
      '卡恩表面仍然友善，但玩家可能注意到他总在恰好的时间出现在恰好的地方。',
      '小莉告诉格雷格她看到维克多身上缠着"灰色扭动的东西"。',
      '本章核心：调查荒原兽人与教团的联系，找到关键证据，为最终对决做准备。',
      '叙事要求：营造大幕将启的紧迫感。NPC开始主动分享更多秘密（信任度应该已经较高）。',
    ].join('\n'),

    beats: [
      {
        id: 'ch4_wasteland_quest',
        trigger: 'talk:艾琳娜',
        facts: [
          '艾琳娜摊开一张旧地图，标出碎石荒原的几个关键位置',
          '"荒原的兽人最近异常好斗。不像是领地争端——更像被什么东西激怒了。"',
          '她推测和矿道中的教团活动有关联',
          '"去调查兽人营地和东北的废弃瞭望塔。之前有冒险者在那留下了调查笔记。"',
        ],
      },
      {
        id: 'ch4_enter_wasteland',
        trigger: 'arrive:shatterstone-wastes',
        facts: [
          '碎石荒原寸草不生，破碎的岩石如骨骼般从黄沙中刺出',
          '远处隐约可见兽人的篝火烟柱',
          '空气干燥灼热，和矿道中的寒气形成鲜明对比',
        ],
        optional: true,
      },
      {
        id: 'ch4_wasteland_complete',
        trigger: 'quest:荒原侦察',
        facts: [
          '荒原调查拼凑出了令人不安的全貌——教团的影响远比想象中广',
          '废弃瞭望塔的笔记揭示了教团的最终目标："虚空棱镜"',
          '回到公会时，所有人都在等着听报告',
          '艾琳娜看完笔记后沉默良久，终于说："……我200年前在旧文献中读到过这个名字。"',
        ],
      },
    ],

    discoveries: [
      { id: 'ch4_d_victor_plea', location: 'dawnbreak-town',      trigger: 'talk:维克多',  label: '维克多私下暗示自己被人控制，恳求帮助' },
      { id: 'ch4_d_xiaoli_warn', location: 'dawnbreak-town',      trigger: 'talk:小莉',    label: '小莉说镇长身上缠着"灰色扭动的东西"' },
      { id: 'ch4_d_kahn_slip',   location: 'dawnbreak-town',      trigger: 'talk:卡恩',    label: '卡恩在某个问题上的回答露出了破绽' },
      { id: 'ch4_d_orc_camp',    location: 'shatterstone-wastes', trigger: 'search',        label: '兽人营地中发现教团标记——兽人被暗中操控' },
      { id: 'ch4_d_tower_notes', location: 'shatterstone-wastes', trigger: 'search',        label: '瞭望塔笔记中详述了"虚空棱镜"和位面裂隙' },
      { id: 'ch4_d_tomb',        location: 'shatterstone-wastes', trigger: 'search',        label: '古战场墓冢中发现石碑碎片，与镇口石碑图案呼应' },
    ],

    advanceWhen: ['ch4_wasteland_complete'],

    nudge: {
      afterIdleTurns: 10,
      hints: [
        '韩猛带来消息："荒原方向传来异动，兽人似乎在集结。再不去看看，可能就来不及了。"',
        '艾琳娜破例走出公会大厅找到玩家："我不会求人。但现在……我需要你尽快去荒原。时间不多了。"',
        '格雷格在打烊后把玩家叫到一边："听着——我这辈子逃过一次。那次我失去了挚友。别像我一样犹豫太久。"',
      ],
    },

    onAdvance: {
      timeOfDay: 'night',
      flags: { wastelandDone: true, prismKnown: true },
    },
    // 最终章结束，暂无 nextChapter
  },
]

// ─── 查询工具 ──────────────────────────────────

const chapterMap = new Map(CHAPTERS.map(c => [c.id, c]))

export function getChapter(id: string): ChapterDef | undefined {
  return chapterMap.get(id)
}

export function getFirstChapterId(): string {
  return CHAPTERS[0].id
}
