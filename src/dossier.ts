/**
 * NPC 档案系统 — 成长型角色资料卡
 *
 * 设计原则:
 * 1. 首次遇见 → 解锁基础档案（画像 + 外貌）
 * 2. 每次交互 → 根据信任度揭示预定义的信息层
 * 3. 信息揭示是确定性的（不依赖 LLM）
 * 4. 支持序列化（存档/读档）
 */

import chalk from 'chalk'

// ─── ASCII 人物画像 ───────────────────────────
// 每个角色有独特的视觉标识

const PORTRAITS: Record<string, string[]> = {
  '格雷格': [
    '      ╭━━━━━╮      ',
    '     ╭┃ ◣ ◢ ┃╮     ',
    '     ┃┃  ▬  ┃┃     ',
    '     ╰┃ ╭─╮ ┃╯     ',
    '      ╰━┥▓┝━╯      ',
    '     ╭──┴─┴──╮     ',
    '     │ ▓▓▓▓▓ │     ',
    '     │ 围 裙  │     ',
    '     ╰───────╯     ',
  ],
  '小莉': [
    '       ╭━━━╮       ',
    '      ╭┃•̀ •́┃╮      ',
    '      ┃┃ ◡ ┃┃      ',
    '      ╰┃   ┃╯      ',
    '       ╰┬─┬╯       ',
    '       ╭┴─┴╮       ',
    '       │   │       ',
    '       │ ♡ │       ',
    '       ╰───╯       ',
  ],
  '艾琳娜': [
    '     ⋮╭━━━━━╮      ',
    '    ⋮╭┃ ◈ ◈ ┃╮     ',
    '     ┃┃  ─  ┃┃     ',
    '     ╰┃     ┃╯⋎    ',
    '      ╰━┬─┬━╯      ',
    '    ╭───┴─┴───╮    ',
    '    │ ░ 斗篷 ░ │    ',
    '    │    ⚔    │    ',
    '    ╰─────────╯    ',
  ],
  '维克多': [
    '      ╭▓▓▓▓▓╮      ',
    '      ┃° _ °┃      ',
    '      ┃  ~  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │ ┃   ┃ │     ',
    '     │ 礼 服  │     ',
    '     │   ◇   │     ',
    '     ╰───────╯     ',
  ],
  '卡恩': [
    '     ~╭━━━━━╮~     ',
    '      ┃⊙   ⊙┃      ',
    '      ┃  ▽  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │  ♪♫   │     ',
    '     │ 琴 师  │     ',
    '     │  ♩    │     ',
    '     ╰───────╯     ',
  ],
  '陈妈': [
    '      ╭━━━━━╮      ',
    '      ┃ ◠ ◠ ┃      ',
    '      ┃  ─  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │ ┃   ┃ │     ',
    '     │ 旅 店  │     ',
    '     │  ☕   │     ',
    '     ╰───────╯     ',
  ],
  '格罗姆': [
    '      ╭━━━━━╮      ',
    '     ╭┃ ▪ ▪ ┃╮     ',
    '     ┃┃ ═══ ┃┃     ',
    '     ╰┃  ▬  ┃╯     ',
    '      ╰━┥█┝━╯      ',
    '    ╭───┴─┴───╮    ',
    '    │ ▓▓▓▓▓▓▓ │    ',
    '    │  铁 匠   │    ',
    '    ╰─────────╯    ',
  ],
  '叶绿': [
    '     ⋮╭━━━━━╮      ',
    '      ┃ ◡ ◡ ┃      ',
    '      ┃  ◡  ┃      ',
    '      ╰┬───┬╯⋎    ',
    '     ╭──┴─┴──╮     ',
    '     │ ░ ░ ░ │     ',
    '     │ 药 师  │     ',
    '     │  ❀    │     ',
    '     ╰───────╯     ',
  ],
  '韩猛': [
    '      ╭━━━━━╮      ',
    '      ┃ ◣ ◢ ┃      ',
    '      ┃  ▬  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │ ┃     │     ',
    '     │ 独 臂  │     ',
    '     │  ⚔    │     ',
    '     ╰───────╯     ',
  ],
}

// ─── 信息揭示层（每个 NPC 预定义） ──────────
// 按信任度门槛排列，交互时自动解锁

interface RevelationLayer {
  trustRequired: number   // 需要的最低信任度（使用真实范围 -10~+10）
  minChapter: number      // 最早在哪个章节可以被揭示（1-4）
  fact: string
  category: '性格' | '背景' | '关系' | '秘密' | '线索'
}

/**
 * 信任阈值与 getGatedFacts 五档对齐：
 *   0   = 初遇即可观察到（外貌、表面性格）
 *   1   = 稍有接触（表面了解，闲聊几句）
 *   3   = 深入了解（成为朋友级别）
 *   5   = 核心秘密（挚友/关键转折后）
 *   7   = 全部情报（完全信任）
 *
 * minChapter 与 game-data.ts 的 NPCFact.minChapter 设计一致：
 *   NPC 在该章节才"知道/经历/愿意回忆"这条信息。
 */
const REVELATION_LAYERS: Record<string, RevelationLayer[]> = {
  // ── 格雷格：酒馆老板，Ch1 温厚老板，Ch2 才触及往事，Ch3 揭开达里安秘密 ──
  '格雷格': [
    { trustRequired: 0, minChapter: 1, fact: '说话时总在擦同一个已经干净的杯子', category: '性格' },
    { trustRequired: 0, minChapter: 1, fact: '碎盾亭酒馆老板，经营十六年', category: '背景' },
    { trustRequired: 1, minChapter: 1, fact: '左手小指是银质假指套——从不解释原因', category: '背景' },
    { trustRequired: 1, minChapter: 1, fact: '口头禅是"听着——"，说完会停顿确认你在听', category: '性格' },
    { trustRequired: 3, minChapter: 1, fact: '年轻时是银月佣兵团的突击手', category: '背景' },
    { trustRequired: 3, minChapter: 1, fact: '不自在时会下意识摩挲假指套', category: '性格' },
    { trustRequired: 5, minChapter: 2, fact: '20年前挚友达里安死在矿洞里，他选了带伤员先撤', category: '秘密' },
    { trustRequired: 5, minChapter: 2, fact: '吧台后墙上挂着达里安的旧佩剑', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '在矿洞中层曾看到墙壁上移动的符号和一股"拉"他往深处的力量', category: '秘密' },
    { trustRequired: 7, minChapter: 3, fact: '保留着达里安日记本最后几页，上面画着类似蚀目者的符号', category: '秘密' },
    { trustRequired: 7, minChapter: 3, fact: '达里安日记中提到矿道最深处有一块"会唱歌的棱形石头"——他认为那就是虚空棱镜', category: '线索' },
  ],
  // ── 小莉：孩子，Ch1 天真表象，Ch2 灵视能力浮现，Ch3 梦境线索 ──
  '小莉': [
    { trustRequired: 0, minChapter: 1, fact: '头发是格雷格用厨刀剪的，歪歪扭扭', category: '背景' },
    { trustRequired: 0, minChapter: 1, fact: '说话语速偏快，会突然停住像在听什么', category: '性格' },
    { trustRequired: 1, minChapter: 1, fact: '三年前的雨夜被格雷格收留，记不清自己从哪来', category: '背景' },
    { trustRequired: 1, minChapter: 1, fact: '口头禅"我觉得……不太对"（会压低声音）', category: '性格' },
    { trustRequired: 3, minChapter: 1, fact: '能感知到人身上的异常气息——某种直觉天赋', category: '秘密' },
    { trustRequired: 3, minChapter: 2, fact: '看卡恩时感觉像"照镜子被弹回来"', category: '线索' },
    { trustRequired: 3, minChapter: 2, fact: '感觉维克多身上缠着"灰色扭动的东西"', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '脖子后面有一个银色的远古印记', category: '秘密' },
    { trustRequired: 5, minChapter: 2, fact: '靠近晨光石碑时印记会微微发热，她觉得石碑在"叫她"', category: '线索' },
    { trustRequired: 7, minChapter: 3, fact: '曾在梦里看到矿道深处一块发紫光的棱形石头，醒来后鼻血不止', category: '线索' },
  ],
  // ── 艾琳娜：公会长，Ch1 职业面孔，Ch2 发现卡恩可疑，Ch3 揭示自己追踪棱镜的真正目的 ──
  '艾琳娜': [
    { trustRequired: 0, minChapter: 1, fact: '说话极慢，每个字像精挑细选', category: '性格' },
    { trustRequired: 0, minChapter: 1, fact: '发尾系着一颗褪色翡翠珠——已故朋友的遗物', category: '背景' },
    { trustRequired: 1, minChapter: 1, fact: '口头禅"……有意思"，通常意味着发现了矛盾或谎言', category: '性格' },
    { trustRequired: 1, minChapter: 1, fact: '340岁的高等精灵，左耳尖有缺损被头发遮住', category: '背景' },
    { trustRequired: 3, minChapter: 1, fact: '真正愤怒时不提高音量，而是变得极其礼貌', category: '性格' },
    { trustRequired: 3, minChapter: 1, fact: '每周二四教小莉读书识字', category: '关系' },
    { trustRequired: 5, minChapter: 2, fact: '用占卜法术检测过卡恩，被某种力量弹开了', category: '线索' },
    { trustRequired: 5, minChapter: 3, fact: '来到破晓镇不是偶然——她在追踪200年前的虚空棱镜线索', category: '秘密' },
    { trustRequired: 7, minChapter: 3, fact: '200年前她目睹虚空棱镜在另一座城市被激活，整座城在一夜间消失——她是唯一幸存者', category: '秘密' },
    { trustRequired: 7, minChapter: 3, fact: '她推算出教团每隔约200年尝试一次激活，这次的时间窗口就在最近几周内', category: '线索' },
  ],
  // ── 维克多：被胁迫的镇长，Ch1 只看到表面崩溃，Ch2 发现女儿失踪，Ch3 被胁迫细节，Ch4 核心证据 ──
  '维克多': [
    { trustRequired: 0, minChapter: 1, fact: '签文件时手在发抖', category: '性格' },
    { trustRequired: 0, minChapter: 1, fact: '面容憔悴，眼下浓重黑眼圈', category: '背景' },
    { trustRequired: 1, minChapter: 1, fact: '曾经是个好镇长，承诺改善矿工安全条件', category: '背景' },
    { trustRequired: 3, minChapter: 1, fact: '半年前开始回避与人交流，眼神总往门口瞟', category: '线索' },
    { trustRequired: 3, minChapter: 2, fact: '女儿索菲亚一年前失踪，对外称"去远方亲戚家"', category: '秘密' },
    { trustRequired: 5, minChapter: 2, fact: '教团通过一只黑色乌鸦传递纸条给他指令，每次月圆前三天会来', category: '线索' },
    { trustRequired: 5, minChapter: 3, fact: '被暗影教团胁迫——他们绑架了索菲亚', category: '秘密' },
    { trustRequired: 5, minChapter: 3, fact: '教团要求他签署开放矿道深层的许可、压下失踪报告、并销毁石碑上的封印记载', category: '秘密' },
    { trustRequired: 5, minChapter: 3, fact: '最后一次收到的纸条上说：如果再有冒险者进入矿道中层，索菲亚会"回来一只手"', category: '秘密' },
    { trustRequired: 7, minChapter: 4, fact: '壁炉暗格里藏着被他删除的石碑封印记录', category: '秘密' },
    { trustRequired: 7, minChapter: 4, fact: '索菲亚失踪前曾告诉他在矿道入口看到"穿黑袍的人在画圈"——他当时没当回事', category: '秘密' },
  ],
  // ── 卡恩：教团卧底，Ch1 完美伪装，Ch2 细微破绽，Ch3 重大线索，Ch4 真相 ──
  '卡恩': [
    { trustRequired: 0, minChapter: 1, fact: '弹琴技艺精湛，常在酒馆演奏吸引客人', category: '背景' },
    { trustRequired: 0, minChapter: 1, fact: '说话温和有礼，笑容从未到达眼睛', category: '性格' },
    { trustRequired: 1, minChapter: 1, fact: '自称来自东方，文件"完美得太可疑"', category: '线索' },
    { trustRequired: 3, minChapter: 1, fact: '出手极其阔绰，不像一般游吟诗人', category: '线索' },
    { trustRequired: 3, minChapter: 2, fact: '指甲修剪得比镇长夫人还整齐——不像风餐露宿的人', category: '线索' },
    { trustRequired: 3, minChapter: 2, fact: '对破晓镇的历史了如指掌，包括一些连本地人都不知道的细节——像是提前做过功课', category: '线索' },
    { trustRequired: 5, minChapter: 3, fact: '从不饮酒，只是假装抿一口——格雷格调的酒被他原封不动留在桌上', category: '线索' },
    { trustRequired: 5, minChapter: 3, fact: '琴箱有隐藏夹层，里面的东西散发微弱暗影能量', category: '秘密' },
    { trustRequired: 7, minChapter: 4, fact: '暗影教团高阶执行者，计划在仪式中篡夺虚空棱镜的力量', category: '秘密' },
    { trustRequired: 7, minChapter: 4, fact: '独自在月池旁练习过一段晦涩的咏唱——那是他私自修改过的棱镜激活咒文', category: '秘密' },
  ],
  // ── 陈妈：旅店大妈，Ch1 热情八卦，Ch2 发现卡恩和镇长异常，Ch3 月圆规律和紫光 ──
  '陈妈': [
    { trustRequired: 0, minChapter: 1, fact: '说话爽利，手脚麻利，对旅客既热情又精明', category: '性格' },
    { trustRequired: 0, minChapter: 1, fact: '破晓旅店老板娘，经营二十余年', category: '背景' },
    { trustRequired: 1, minChapter: 1, fact: '消息灵通，镇上大小事都瞒不过她', category: '背景' },
    { trustRequired: 3, minChapter: 1, fact: '年轻时丈夫死于矿难，独自拉扯旅店和两个孩子', category: '背景' },
    { trustRequired: 3, minChapter: 1, fact: '丈夫出事那天本不该下矿——是临时被叫去替班的，她一直觉得那次"矿难"不简单', category: '秘密' },
    { trustRequired: 5, minChapter: 2, fact: '最近注意到有些"陌生面孔"频繁出入镇外', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '那些陌生人总在月圆前后出现，而且她注意到他们左手腕上都戴着一样的黑绳', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '曾在夜里看到卡恩独自往暮色森林方向走', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '去年镇长突然不来旅店了，之前他每周五都来喝一杯——她觉得镇长像是被什么东西吓住了', category: '关系' },
    { trustRequired: 7, minChapter: 3, fact: '有一次深夜失眠散步到矿道入口附近，看到地面上有一圈淡紫色的光在旋转，吓得跑回了旅店', category: '秘密' },
  ],
  // ── 格罗姆：矮人铁匠，Ch1 矿石异常，Ch2 黑晶体研究，Ch3 古矿志+锻造 ──
  '格罗姆': [
    { trustRequired: 0, minChapter: 1, fact: '矮人铁匠，锤子比他脑袋还大', category: '背景' },
    { trustRequired: 0, minChapter: 1, fact: '说话直来直去，不喜欢拐弯抹角', category: '性格' },
    { trustRequired: 1, minChapter: 1, fact: '从北方矮人堡垒迁来，据说是为了追随某条矿脉', category: '背景' },
    { trustRequired: 3, minChapter: 1, fact: '对矿石品质极为敏感，最近发现矿道出产的矿石"味道不对"', category: '线索' },
    { trustRequired: 3, minChapter: 1, fact: '黑色晶体靠近铁器时会发出微弱嗡鸣，像是某种共振——他从没在任何矿石上见过这种反应', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '矿石中夹杂着一种他从未见过的黑色晶体碎片', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '北方矮人古矿志中记载过"虚空矿脉"——矿石变黑、工匠做噩梦、矿道自行延伸——和现在的情况惊人相似', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '悄悄保留了几块黑色晶体样本，怀疑跟矿道深处的异变有关', category: '秘密' },
    { trustRequired: 7, minChapter: 3, fact: '古矿志最后一页写着：虚空矿脉的尽头都会有一件"棱形神器"，矮人先祖称之为"深渊之眼"', category: '线索' },
    { trustRequired: 7, minChapter: 3, fact: '[NPC应主动提出] 他秘密锻造了注入银粉的特殊武器——银能灼伤暗影生物。如果玩家带回一块暗影晶体，他愿意为玩家锻造一把银刃武器', category: '秘密' },
  ],
  // ── 叶绿：草药师，Ch1 助手异常+矿工噩梦，Ch2 符号发现，Ch3 净化仪式 ──
  '叶绿': [
    { trustRequired: 0, minChapter: 1, fact: '半精灵药剂师，总是带着草药的清香', category: '背景' },
    { trustRequired: 0, minChapter: 1, fact: '温柔耐心，对每位病人都仔细问诊', category: '性格' },
    { trustRequired: 1, minChapter: 1, fact: '草药堂传承三代，她是最年轻的堂主', category: '背景' },
    { trustRequired: 3, minChapter: 1, fact: '最近她的助手行为越来越古怪，常常深夜外出', category: '线索' },
    { trustRequired: 3, minChapter: 1, fact: '近几周有好几个矿工来求诊，都说在矿道里听到低语声，回来后频繁做同样的噩梦——梦见一只巨大的眼睛', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '在助手的抽屉里发现过一张画着奇怪符号的纸', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '助手符号纸上有一个"眼睛被斜线划过"的标记——和做噩梦的矿工描述的梦中图案一模一样', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '怀疑助手加入了某种秘密组织，但不敢声张', category: '秘密' },
    { trustRequired: 7, minChapter: 3, fact: '她祖母留下的药典中记载了一种用银莲花和月光露调配的药剂，能暂时抵御暗影侵蚀', category: '秘密' },
    { trustRequired: 7, minChapter: 3, fact: '[NPC应主动提出] 药典记载了古老的净化仪式——在晨光石碑前以银莲花为引可以封印位面裂隙。她愿意教玩家这个仪式，但需要先找到银莲花', category: '秘密' },
  ],
  // ── 韩猛：公会军官，Ch1 小队失联，Ch2 教团痕迹，Ch3 核心情报+地图 ──
  '韩猛': [
    { trustRequired: 0, minChapter: 1, fact: '退役战士，右臂在一次讨伐中失去', category: '背景' },
    { trustRequired: 0, minChapter: 1, fact: '嗓门大，脾气火爆，但对新手冒险者格外照顾', category: '性格' },
    { trustRequired: 1, minChapter: 1, fact: '艾琳娜的老部下，是她推荐他来管理公会分部的', category: '关系' },
    { trustRequired: 3, minChapter: 1, fact: '最近派出去调查矿道的小队接连失联，他很焦虑', category: '线索' },
    { trustRequired: 3, minChapter: 1, fact: '三支小队失联的模式一样：到矿道中层后联络中断，最后一条消息都提到"异常寒冷"', category: '线索' },
    { trustRequired: 5, minChapter: 2, fact: '偷偷在公会地下室囤积了一批武器，以防"最坏的情况"', category: '秘密' },
    { trustRequired: 5, minChapter: 2, fact: '最后一支小队的斥候在失联前传回一张速写——墙壁上密密麻麻的符文在移动，像活物一样', category: '线索' },
    { trustRequired: 5, minChapter: 3, fact: '从失联小队最后的报告中发现了暗影教团的蛛丝马迹', category: '秘密' },
    { trustRequired: 5, minChapter: 3, fact: '艾琳娜私下告诉他这不是普通塌方，让他做好"撤离全镇"的最坏准备', category: '关系' },
    { trustRequired: 7, minChapter: 3, fact: '[NPC应主动提出] 失联队长临终前塞给他一张手绘的矿道下层地图。他一直在等一个值得信赖的人把地图交出去', category: '秘密' },
  ],
}

// ─── 档案条目 ─────────────────────────────────

export interface DossierEntry {
  name: string
  title: string
  appearance: string
  discovered: Array<{ fact: string; category: string; turn: number }>
  relationship: string
  firstMet: number
}

const BASE_INFO: Record<string, { name: string; title: string; appearance: string }> = {
  '格雷格': { name: '格雷格·铁拳头', title: '碎盾亭酒馆老板', appearance: '六尺二，右眉旧疤，左手银质假指套。围着发白的皮围裙。' },
  '小莉': { name: '小莉', title: '酒馆帮工女孩', appearance: '12岁，黑色短发剪得歪歪扭扭，深灰色大眼睛。' },
  '艾琳娜': { name: '艾琳娜·银叶', title: '冒险者公会会长', appearance: '银白长发侧辫，琥珀色瞳，墨绿皮甲灰色斗篷。' },
  '维克多': { name: '维克多·黑石', title: '破晓镇镇长', appearance: '50岁灰发绅士，深色礼服，浓重黑眼圈。' },
  '卡恩': { name: '「旅者」卡恩', title: '游吟诗人', appearance: '年轻俊朗，衣着考究，指甲异常整齐。' },
  '陈妈': { name: '陈妈', title: '破晓旅店老板娘', appearance: '四十多岁，圆脸利落短发，围着花围裙，笑起来很爽朗。' },
  '格罗姆': { name: '格罗姆·铁砧', title: '铁砧铺矮人铁匠', appearance: '矮壮结实，络腮胡编成两条辫子，手臂粗如小腿。' },
  '叶绿': { name: '叶绿', title: '草药堂药剂师', appearance: '半精灵，浅绿色眼瞳，总带着淡淡的草药香气。' },
  '韩猛': { name: '「独臂」韩猛', title: '冒险者公会分部管理员', appearance: '魁梧的独臂战士，右袖空荡，但左手足以掰断桌腿。' },
}

// ─── 档案管理器 ───────────────────────────────

export class DossierManager {
  private entries = new Map<string, DossierEntry>()

  /** 首次遇见 NPC — 解锁档案，显示画像 */
  unlock(name: string, turn: number, chapterNum: number = 1): string | null {
    if (this.entries.has(name)) return null
    const base = BASE_INFO[name]
    if (!base) return null

    this.entries.set(name, {
      ...base,
      discovered: [],
      relationship: '陌生人',
      firstMet: turn,
    })

    // 自动揭示信任度0的信息
    this.revealByTrust(name, 0, turn, chapterNum)

    // 返回解锁通知
    const portrait = PORTRAITS[name]
    let notice = '\n'
    notice += chalk.yellow.bold('  🔔 新角色档案已解锁！\n')
    notice += chalk.yellow('  ┌────────────────────────────────────┐\n')
    notice += chalk.yellow(`  │ ${chalk.bold.white(base.name.padEnd(34))} │\n`)
    notice += chalk.yellow(`  │ ${chalk.dim(base.title.padEnd(34))} │\n`)
    if (portrait) {
      notice += chalk.yellow('  ├────────────────────────────────────┤\n')
      for (const line of portrait) {
        notice += chalk.yellow('  │') + chalk.cyan(line.padEnd(36)) + chalk.yellow('│\n')
      }
    }
    notice += chalk.yellow('  └────────────────────────────────────┘')
    return notice
  }

  /** 和 NPC 交互后调用 — 根据信任度+章节揭示新信息 */
  onInteraction(name: string, trust: number, turn: number, chapterNum: number = 1): string | null {
    const entry = this.entries.get(name)
    if (!entry) return null

    const newFacts = this.revealByTrust(name, trust, turn, chapterNum)
    if (newFacts.length === 0) return null

    // 更新关系描述
    if (trust <= -2) entry.relationship = '敌对'
    else if (trust < 0) entry.relationship = '冷淡'
    else if (trust === 0) entry.relationship = '陌生人'
    else if (trust <= 2) entry.relationship = '熟人'
    else if (trust <= 4) entry.relationship = '朋友'
    else entry.relationship = '挚友'

    let notice = chalk.dim(`\n  📋 你对${name}有了新的了解:`)
    for (const f of newFacts) {
      notice += chalk.dim(`\n    · [${f.category}] ${f.fact}`)
    }
    return notice
  }

  private revealByTrust(name: string, trust: number, turn: number, chapterNum: number = 4): Array<{ fact: string; category: string }> {
    const entry = this.entries.get(name)
    if (!entry) return []
    const layers = REVELATION_LAYERS[name] ?? []
    const knownFacts = new Set(entry.discovered.map(d => d.fact))
    const newFacts: Array<{ fact: string; category: string }> = []

    for (const layer of layers) {
      // 双重门控：章节 + 信任度
      if (layer.minChapter <= chapterNum && layer.trustRequired <= trust && !knownFacts.has(layer.fact)) {
        entry.discovered.push({ fact: layer.fact, category: layer.category, turn })
        newFacts.push({ fact: layer.fact, category: layer.category })
      }
    }
    return newFacts
  }

  /** 列出已解锁的 NPC */
  renderList(): string {
    if (this.entries.size === 0) {
      return chalk.dim('  你还没有遇到任何值得记录的人物。\n  继续探索吧！')
    }
    let output = chalk.cyan('\n  ── 人物档案 ──\n')
    for (const [name, entry] of this.entries) {
      const total = (REVELATION_LAYERS[name] ?? []).length
      const known = entry.discovered.length
      const pct = total > 0 ? Math.round((known / total) * 100) : 0
      const bar = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)))
      output += `  ${chalk.bold(entry.name)} — ${chalk.dim(entry.title)}\n`
      output += `    关系: ${entry.relationship} | 了解度: ${bar} ${pct}% (${known}/${total})\n\n`
    }
    output += chalk.dim('  输入 /npc <名字> 查看详细档案\n')
    return output
  }

  /** 完整档案卡 (trust: NPC当前信任度, 用于显示信任条) */
  renderProfile(name: string, trust?: number): string {
    // 模糊匹配
    const key = Array.from(this.entries.keys()).find(k => k.includes(name) || name.includes(k))
    const entry = key ? this.entries.get(key) : undefined
    if (!entry) return chalk.red(`  未找到 "${name}" 的档案。输入 /npc 查看已知角色。`)

    const portrait = PORTRAITS[key!]
    const layers = REVELATION_LAYERS[key!] ?? []
    const total = layers.length
    const known = entry.discovered.length
    const pct = total > 0 ? Math.round((known / total) * 100) : 0

    let out = '\n'
    out += chalk.yellow('  ╔════════════════════════════════════════╗\n')
    out += chalk.yellow('  ║ ') + chalk.bold.white(entry.name.padEnd(38)) + chalk.yellow(' ║\n')
    out += chalk.yellow('  ║ ') + chalk.dim(entry.title.padEnd(38)) + chalk.yellow(' ║\n')
    out += chalk.yellow('  ╠════════════════════════════════════════╣\n')

    // 画像
    if (portrait) {
      for (const line of portrait) {
        out += chalk.yellow('  ║ ') + chalk.cyan(line.padEnd(38)) + chalk.yellow(' ║\n')
      }
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
    }

    // 外貌
    out += chalk.yellow('  ║ ') + chalk.white('外貌').padEnd(38) + chalk.yellow(' ║\n')
    const appLines = entry.appearance.match(/.{1,36}/g) ?? [entry.appearance]
    for (const line of appLines) {
      out += chalk.yellow('  ║  ') + line.padEnd(37) + chalk.yellow(' ║\n')
    }

    // 状态
    out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
    const bar = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)))
    out += chalk.yellow('  ║ ') + `关系: ${entry.relationship}`.padEnd(38) + chalk.yellow(' ║\n')
    // 信任度条 (-10 ~ +10，映射到10格显示)
    if (trust !== undefined) {
      const t = Math.max(-10, Math.min(10, trust))
      const filled = Math.max(0, Math.round((t + 10) / 2))  // -10→0格, 0→5格, 10→10格
      const trustBar = '▓'.repeat(filled) + '░'.repeat(10 - filled)
      const sign = t > 0 ? '+' : ''
      out += chalk.yellow('  ║ ') + `信任: ${trustBar} ${sign}${t}`.padEnd(38) + chalk.yellow(' ║\n')
    }
    out += chalk.yellow('  ║ ') + `了解: ${bar} ${pct}%`.padEnd(38) + chalk.yellow(' ║\n')
    out += chalk.yellow('  ║ ') + chalk.dim(`初遇: 第${entry.firstMet}轮`).padEnd(47) + chalk.yellow(' ║\n')

    // 已知信息（按类别分组）
    if (entry.discovered.length > 0) {
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
      const categories = ['性格', '背景', '关系', '线索', '秘密']
      for (const cat of categories) {
        const facts = entry.discovered.filter(d => d.category === cat)
        if (facts.length === 0) continue
        out += chalk.yellow('  ║ ') + chalk.bold(`[${cat}]`).padEnd(41) + chalk.yellow(' ║\n')
        for (const f of facts) {
          const lines = f.fact.match(/.{1,34}/g) ?? [f.fact]
          out += chalk.yellow('  ║  ') + `· ${lines[0]}`.padEnd(37) + chalk.yellow(' ║\n')
          for (let i = 1; i < lines.length; i++) {
            out += chalk.yellow('  ║    ') + lines[i].padEnd(35) + chalk.yellow(' ║\n')
          }
        }
      }
    } else {
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
      out += chalk.yellow('  ║ ') + chalk.dim('（暂无更多信息，继续交流吧）').padEnd(47) + chalk.yellow(' ║\n')
    }

    // 未解锁提示
    const locked = total - known
    if (locked > 0) {
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
      out += chalk.yellow('  ║ ') + chalk.dim(`🔒 还有 ${locked} 条信息待解锁`).padEnd(47) + chalk.yellow(' ║\n')
    }

    out += chalk.yellow('  ╚════════════════════════════════════════╝')
    return out
  }

  /** 获取 NPC 的初始展示信息（首次解锁时用） */
  getFirstFacts(name: string): string[] {
    const base = BASE_INFO[name]
    if (!base) return []
    const layers = REVELATION_LAYERS[name] ?? []
    // 返回信任度0就能看到的事实
    return layers.filter(l => l.trustRequired === 0).map(l => l.fact)
  }

  /** 获取 NPC 的基本信息（标题、外貌描述） */
  getBaseInfo(name: string): { title: string; appearance: string } | null {
    const base = BASE_INFO[name]
    if (!base) return null
    return { title: base.title, appearance: base.appearance }
  }

  /** Structured list data for panel rendering */
  toListData(trustMap: Record<string, number>): Array<{
    key: string; name: string; title: string; trust: number;
    totalLayers: number; knownLayers: number; unlocked: boolean
  }> {
    return Array.from(this.entries).map(([key, entry]) => ({
      key,            // 短名（和 session.npcs[].name 一致）
      name: entry.name, // 全名（显示用）
      title: entry.title,
      trust: trustMap[key] ?? 0,
      totalLayers: (REVELATION_LAYERS[key] ?? []).length,
      knownLayers: entry.discovered.length,
      unlocked: true,
    }))
  }

  /** Structured profile data for panel rendering */
  toProfileData(name: string, trust?: number): {
    key: string; name: string; title: string; appearance: string; trust: number;
    discovered: Array<{ fact: string; category: string }>;
    portrait: string[]; locked: number
  } | null {
    // 精确匹配优先，fuzzy 兜底
    let key = this.entries.has(name) ? name : Array.from(this.entries.keys()).find(k => k.includes(name) || name.includes(k))
    const entry = key ? this.entries.get(key) : undefined
    if (!entry || !key) return null

    const total = (REVELATION_LAYERS[key] ?? []).length
    const known = entry.discovered.length

    return {
      key,
      name: entry.name,
      title: entry.title,
      appearance: entry.appearance,
      trust: trust ?? 0,
      discovered: entry.discovered.map(d => ({ fact: d.fact, category: d.category })),
      portrait: PORTRAITS[key!] ?? [],
      locked: total - known,
    }
  }

  /** 获取 NPC 已解锁的 facts 数量（用于 beat requiredFacts 检查） */
  getUnlockedFactCount(name: string): number {
    const entry = this.entries.get(name)
    return entry ? entry.discovered.length : 0
  }

  isUnlocked(name: string): boolean { return this.entries.has(name) }
  listUnlocked(): string[] { return Array.from(this.entries.keys()) }

  toJSON(): Record<string, DossierEntry> { return Object.fromEntries(this.entries) }

  static fromJSON(data: Record<string, DossierEntry>): DossierManager {
    const dm = new DossierManager()
    for (const [name, entry] of Object.entries(data)) {
      dm.entries.set(name, entry)
    }
    return dm
  }
}
