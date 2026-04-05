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
  /** 完成条件：trigger NPC 在 dossier 中需要解锁的最少 facts 数。未设置时 trigger 即完成（向后兼容） */
  requiredFacts?: number
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
  /** 本章 DM 需要知道的世界秘密（逐章解锁，不在 system prompt 中暴露） */
  dmSecrets?: string
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

    dmSecrets: [
      '【本章DM认知边界——你目前只知道以下信息】',
      '镇上似乎有什么不对劲，但具体是什么还不清楚。矿洞塌方可能不是简单的事故，但没有证据。',
      '卡恩是最近来到镇上的游吟诗人，来历不明，镇民对他的印象各不相同——有人觉得他迷人，有人觉得他神秘。',
      '维克多镇长最近精神似乎不太好，但原因不明。',
      '小莉有某种直觉或感知能力，但具体能看到什么你不清楚。',
      '',
      '你不知道任何关于"暗影教团""虚空棱镜""蚀目者"的信息。不要在叙事中暗示这些概念的存在。',
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
        requiredFacts: 2,
      },
      {
        id: 'ch1_night_event',
        trigger: 'auto',
        requires: ['ch1_guild_direction'],
        facts: [
          '玩家回房歇息。深夜，窗外传来低沉的吟唱声——几秒后又消失了',
          '走廊尽头隐约有脚步声。如果出门查看：走廊空无一人，但窗台上残留着一小摊泥水脚印，方向朝着矿道北面',
          '第二天早上，格雷格在柜台后揉着眼睛。问起夜里的事，他皱眉："……你也听到了？我还以为是做梦。"',
          '小莉在旁边小声说："不是梦。昨晚有人从镇北边走过去，三个人，穿着深色衣服。"',
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

    advanceWhen: ['ch1_guild_direction', 'ch1_night_event'],

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

    dmSecrets: [
      '【本章DM认知边界——在上一章基础上新增以下信息】',
      '暮色森林的动物异常南迁，似乎在躲避矿山方向的什么东西。原因不明。',
      '叶绿的助手最近深夜外出，行为古怪。叶绿在助手物品中发现了一张画着眼睛符号的纸，但不知道这代表什么。',
      '卡恩的行踪有些可疑——陈妈注意到他经常深夜独自外出，去向不明。',
      '维克多镇长精神状态持续恶化。公开场合还能维持体面，但私下显得支离破碎、心不在焉。原因仍不明。',
      '',
      '你开始隐约感觉镇上有某种暗流，但还没有确切证据指向任何组织或阴谋。',
      '不要主动提及"暗影教团""虚空棱镜"等概念——这些你还不知道。',
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
        requiredFacts: 2,
      },
      {
        id: 'ch2_meet_hunter',
        trigger: 'talk:老林',
        requires: ['ch2_forest_quest'],
        facts: [
          '猎人老林蹲在石屋旁磨刀，听到脚步声抬起头，目光警惕',
          '"公会派来的？"他打量你一眼，放下磨刀石',
          '"最近林子不对劲，动物都在往南跑——它们在躲什么东西。往北走小心狼群，比以前凶多了。"',
          '他指了指北面的小径："那条路过去就是狼群的地盘。你要去的话，准备好武器。"',
        ],
        optional: true,
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
        id: 'ch2_forest_combat',
        trigger: 'combat_end',
        requires: ['ch2_enter_forest'],
        facts: [
          '森林中的威胁被击退，周围恢复了短暂的宁静',
          '林间小路重新可以通行，猎人老林的安全得到确认',
          '老林提醒玩家："最近林子不对劲，动物都在往南跑——它们在躲什么东西。矿山那个方向，别去。"',
        ],
      },
      {
        id: 'ch2_report_elena',
        trigger: 'talk:艾琳娜',
        requires: ['ch2_forest_combat'],
        facts: [
          '回到公会报告时，艾琳娜点了点头："……有意思。比我预想的好一些。"',
          '她在任务记录簿上写下几笔，抬头看着玩家："从今天起，你算公会的正式成员了。"',
          '韩猛拍了拍玩家肩膀，语气里多了几分认真："欢迎入队。别死太早。"',
        ],
        requiredFacts: 4,
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

    advanceWhen: ['ch2_report_elena'],

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
      '引导策略：玩家进入矿道后，随着探索自然推进——不需要等玩家说"搜索"，DM应主动描写深入过程中遇到的异象。玩家带着证据回镇上找艾琳娜汇报即可推进。',
    ].join('\n'),

    dmSecrets: [
      '【本章DM认知边界——重大解锁】',
      '暗影教团（自称"蚀目者"信徒）确实存在，在矿道中层有活动痕迹。他们信奉某个被称为"蚀目者"的存在，但教团的最终目标你还不完全清楚。',
      '维克多被教团胁迫——他的女儿索菲亚大约一年前失踪（被教团绑架），至今下落不明。为了女儿的安全，他被迫签了矿道特别勘探许可、压了失踪报告三天、删除了石碑封印记录。壁炉暗格藏着这些被删文件。',
      '卡恩与教团有某种关联，但他的具体角色和真实目的尚不清楚。他似乎在关注镇上的动态。',
      '小莉的灵视能力更具体了——她感觉维克多身上缠着"灰色扭动的东西"（某种被控制或诅咒的痕迹）。她试图感知卡恩时被弹回，像照镜子一样什么都看不到。',
      '格雷格20年前的挚友达里安死在矿洞深处。他当时选择带伤员先撤，没能救回达里安。这段记忆让他对矿洞话题本能回避。达里安留下了一本旧日志，记录了矿道深层的异象。',
      '',
      '你不知道"虚空棱镜"的存在。不要在叙事中提及这个名字或暗示教团在挖掘某种神器。',
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
        requiredFacts: 4,
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
        trigger: 'auto',
        requires: ['ch3_enter_mines'],
        facts: [
          '深入矿道中层时，矿灯照到一个分叉洞室——空气骤然冰冷',
          '墙壁上刻着蚀目者的标记——一只被斜线划过的眼睛',
          '地上有烧焦的蜡烛残留和干涸的暗色液体',
          '这不是自然现象。有人在这里进行过仪式。金属味刺鼻，令人头皮发麻',
        ],
      },
      {
        id: 'ch3_mine_complete',
        trigger: 'talk:艾琳娜',
        requires: ['ch3_cult_traces'],
        facts: [
          '带着教团仪式的证据回到公会，艾琳娜看完后沉默了很久',
          '"……这比我担心的还要糟。"她的语气从未如此严肃',
          '"蚀目者……"她低声重复这个名字，像是在回忆什么尘封的记忆',
          '韩猛握紧了独臂的拳头："那帮人到底想干什么？"',
        ],
        requiredFacts: 6,
      },
    ],

    discoveries: [
      { id: 'ch3_d_victor',     location: 'dawnbreak-town',   trigger: 'talk:维克多', label: '镇长维克多欲言又止，似乎有难言之隐' },
      { id: 'ch3_d_chenma_tip', location: 'dawnbreak-town',   trigger: 'talk:陈妈',  label: '陈妈说陌生人总在月圆前后出现，往矿道方向去' },
      { id: 'ch3_d_kahn_night', location: 'dawnbreak-town',   trigger: 'talk:陈妈',  requires: ['ch3_d_chenma_tip'], label: '陈妈还提到卡恩深夜独自外出' },
      { id: 'ch3_d_crystals',   location: 'greyspine-mines',  trigger: 'search',     label: '发现矿道中的黑色晶体，靠近铁器时会发出嗡鸣' },
      { id: 'ch3_d_cold_zone',  location: 'greyspine-mines',  trigger: 'search',     label: '矿道中层温度骤降区域，墙壁上有微光符文' },
      { id: 'ch3_d_camp',       location: 'greyspine-mines',  trigger: 'search',     label: '发现失踪搜救队的临时营地遗留物' },
      { id: 'ch3_d_journal',    location: 'dawnbreak-town',   trigger: 'talk:格雷格', requires: ['ch3_mine_quest'], label: '格雷格交出达里安的旧日志——记录了矿道深层的异象和远古封印的线索' },
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
      '引导策略：玩家到达荒原后，瞭望塔的发现会自然展开——DM应将瞭望塔描写为荒原中最醒目的地标，引导玩家前往。拿到笔记后回去找艾琳娜即可推进。',
    ].join('\n'),

    dmSecrets: [
      '【本章DM认知边界——全部真相解锁】',
      '暗影教团的最终目标是激活"虚空棱镜"——一件能撕裂位面壁垒的远古神器，藏在矿道最深处的深渊祭坛。',
      '卡恩是教团的执行者，但他不忠于教团，只忠于自己。他的真实计划是篡改激活仪式，让棱镜的力量锚定在自己身上而非教团的"蚀目者"。',
      '教团需要一个灵视者来"看见裂隙"完成最终仪式。卡恩怀疑小莉有灵视能力，一直在暗中观察确认。这就是他留在镇上的真正原因。',
      '维克多壁炉暗格中藏着教团胁迫他签署的全部文件——特别勘探许可、矿道通行记录、被删的石碑封印记载。这些是指控教团的关键物证。',
      '失踪的矿工已经被教团献祭。公会派去的搜救队在矿道中层遭遇了教团的守卫，下落不明。',
      '碎石荒原的兽人被教团的暗影法术激怒和驱动，用来充当外围屏障阻止外人接近矿道。',
      '',
      '卡恩在独处时性格完全不同——简短、冷硬、算计。他公开场合的温暖从容全是伪装。如果玩家在无人处遇到卡恩，可以微妙地展现这个反差。',
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
        requiredFacts: 6,
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
        id: 'ch4_tower_discovery',
        trigger: 'auto',
        requires: ['ch4_enter_wasteland'],
        facts: [
          '穿过荒原到达废弃瞭望塔——塔顶层发现一具冒险者遗体和未完成的调查笔记',
          '笔记详细记录了教团的仪式规律、成员联络方式，以及最终目标——"虚空棱镜"',
          '笔记最后一行字迹潦草："它就在矿道最深处。他们需要一个能看见裂隙的人——"写到这里断了',
        ],
      },
      {
        id: 'ch4_wasteland_complete',
        trigger: 'talk:艾琳娜',
        requires: ['ch4_tower_discovery'],
        facts: [
          '回到公会时，所有人都在等着听报告',
          '艾琳娜看完瞭望塔笔记后沉默良久，终于说："……我200年前在旧文献中读到过这个名字。虚空棱镜。"',
          '"它能撕裂位面壁垒。如果教团拿到它——"她没说完，但所有人都明白了',
          '韩猛站起身，语气决然："不能让他们得逞。我们得在蚀月之前阻止他们。"',
        ],
        requiredFacts: 8,
      },
    ],

    discoveries: [
      { id: 'ch4_d_victor_plea', location: 'dawnbreak-town',      trigger: 'talk:维克多',  label: '维克多私下暗示自己被人控制，恳求帮助' },
      { id: 'ch4_d_xiaoli_warn', location: 'dawnbreak-town',      trigger: 'talk:小莉',    label: '小莉说镇长身上缠着"灰色扭动的东西"' },
      { id: 'ch4_d_kahn_slip',   location: 'dawnbreak-town',      trigger: 'talk:卡恩',    label: '卡恩在某个问题上的回答露出了破绽' },
      { id: 'ch4_d_orc_camp',    location: 'shatterstone-wastes', trigger: 'search',        label: '兽人营地中发现教团标记——兽人被暗中操控' },
      { id: 'ch4_d_tower_notes', location: 'shatterstone-wastes', trigger: 'search',        label: '瞭望塔笔记中详述了"虚空棱镜"和位面裂隙' },
      { id: 'ch4_d_tomb',        location: 'shatterstone-wastes', trigger: 'search',        label: '古战场墓冢中发现石碑碎片，与镇口石碑图案呼应' },
      { id: 'ch4_d_fireplace',   location: 'dawnbreak-town',      trigger: 'talk:维克多',   requires: ['ch4_d_victor_plea'], label: '维克多私下递来半烧毁的文件——教团胁迫他签署的"特别勘探许可"和矿道通行记录' },
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
