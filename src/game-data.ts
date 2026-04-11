/**
 * 共享游戏数据 — 职业模板、NPC 初始数据、会话创建
 *
 * main.ts 和 server.ts 共用，避免数据重复和不一致。
 */

import type { PlayerCharacter, GameSession, NPC, NPCFact, Spell, AbilityScores } from './types.js'
import { createChapterState } from './chapter-manager.js'

// ─── Character Class Templates ───────────────

export interface ClassTemplate {
  nameZh: string
  abilities: AbilityScores
  skills: PlayerCharacter['skills']
  maxHp: number
  spells: Spell[]
}

// 5 级冒险者模板——足够探索世界，不需要刷级
export const CLASS_TEMPLATES: Record<string, ClassTemplate> = {
  fighter: {
    nameZh: '剑士',
    abilities: { STR: 18, DEX: 14, CON: 16, INT: 8, WIS: 12, CHA: 10 },
    skills: ['athletics', 'intimidation'],
    maxHp: 38,
    spells: [
      { name: 'Second Wind', description: '战斗恢复', effect: '恢复1d10+5HP。每次短休息后可用。', usesPerRest: 3, remaining: 3 },
    ],
  },
  mage: {
    nameZh: '法师',
    abilities: { STR: 8, DEX: 14, CON: 12, INT: 18, WIS: 14, CHA: 10 },
    skills: ['arcana', 'investigation'],
    maxHp: 26,
    spells: [
      { name: 'Fire Bolt', description: '投射一团火焰', effect: 'Deal 2d10 fire damage on a ranged spell attack hit.', usesPerRest: 0, remaining: 0 },
      { name: 'Magic Missile', description: '三枚魔法飞弹自动命中', effect: 'Deal 3d4+3 force damage, auto-hit, split among up to 3 targets.', usesPerRest: 4, remaining: 4 },
      { name: 'Shield', description: '魔法护盾', effect: 'Reaction: +5 AC until the start of your next turn.', usesPerRest: 4, remaining: 4 },
      { name: 'Fireball', description: '火球术', effect: 'Deal 8d6 fire damage in 20ft radius. DEX save DC 14 for half.', usesPerRest: 2, remaining: 2 },
      { name: 'Detect Magic', description: '侦测30尺内的魔法', effect: 'Reveal magical auras and identify the school of magic.', usesPerRest: 4, remaining: 4 },
    ],
  },
  ranger: {
    nameZh: '游侠',
    abilities: { STR: 14, DEX: 18, CON: 14, INT: 10, WIS: 16, CHA: 8 },
    skills: ['stealth', 'perception', 'sleight_of_hand'],
    maxHp: 34,
    spells: [
      { name: "Hunter's Mark", description: '猎人印记', effect: '标记目标，对其攻击额外1d6伤害。持续1小时。', usesPerRest: 3, remaining: 3 },
      { name: 'Cure Wounds', description: '治疗伤口', effect: 'Restore 1d8+WIS modifier HP.', usesPerRest: 3, remaining: 3 },
    ],
  },
  cleric: {
    nameZh: '牧师',
    abilities: { STR: 16, DEX: 10, CON: 16, INT: 10, WIS: 18, CHA: 14 },
    skills: ['medicine', 'insight', 'persuasion'],
    maxHp: 36,
    spells: [
      { name: 'Cure Wounds', description: '触摸治疗伤口', effect: 'Restore 2d8+WIS modifier HP to a creature you touch.', usesPerRest: 4, remaining: 4 },
      { name: 'Guiding Bolt', description: '指引之光', effect: 'Deal 4d6 radiant damage. Next attack on target has advantage.', usesPerRest: 3, remaining: 3 },
      { name: 'Shield of Faith', description: '信仰之盾', effect: '+2 AC for 10 minutes.', usesPerRest: 2, remaining: 2 },
      { name: 'Detect Magic', description: '侦测30尺内的魔法', effect: 'Reveal magical auras and identify the school of magic.', usesPerRest: 4, remaining: 4 },
    ],
  },
}

// ─── Ability Modifiers ──────────────────────

export function computeModifiers(abilities: AbilityScores): AbilityScores {
  const mod = (v: number) => Math.floor((v - 10) / 2)
  return {
    STR: mod(abilities.STR),
    DEX: mod(abilities.DEX),
    CON: mod(abilities.CON),
    INT: mod(abilities.INT),
    WIS: mod(abilities.WIS),
    CHA: mod(abilities.CHA),
  }
}

// ─── NPC Init Data ──────────────────────────

export function createInitialNPCs(): NPC[] {
  return [
    {
      name: '格雷格',
      trust: 0,
      knownFacts: [
        { text: '镇上矿洞最近不太平', minChapter: 1 },
        { text: '冒险者公会在招人', minChapter: 1 },
        { text: '二十年前在矿洞里失去了挚友达里安', minChapter: 2 },
        { text: '柜台底下锁着达里安留下的旧日志，记录了矿道深处的异象', minChapter: 3 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '温和',
      role: 'innkeeper',
      inventory: [
        { name: '火把', type: 'misc', description: '普通的火把，可照亮周围区域。', bonus: 0 },
        { name: '火把', type: 'misc', description: '普通的火把，可照亮周围区域。', bonus: 0 },
        { name: '达里安的日志', type: 'quest', description: '一本破旧的日志，记录了20年前矿道深处的发现。封面有烧焦的痕迹。格雷格一直将它锁在柜台底下。' },
      ],
      homeBase: 'shattered-shield-tavern',
      mobility: 'local',
      subLocation: 'shattered-shield-tavern',
    },
    {
      name: '小莉',
      trust: 0,
      knownFacts: [
        { text: '能感知他人身上的异常气息', minChapter: 1 },
        { text: '镇长身上缠着灰色扭动的东西', minChapter: 1 },
        { text: '卡恩让她后背发凉', minChapter: 2 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '好奇',
      role: 'child',
      inventory: [],
      homeBase: 'shattered-shield-tavern',
      mobility: 'stationary',
      subLocation: 'shattered-shield-tavern',
    },
    {
      name: '艾琳娜',
      trust: 0,
      knownFacts: [
        { text: '冒险者公会近期任务激增，人手不够', minChapter: 1 },
        { text: '矿道失踪事件的详细情报', minChapter: 1 },
        { text: '卡恩的文件太完美——有遮蔽', minChapter: 2 },
        { text: '小莉身上有微弱的天赋波动', minChapter: 3 },
        { text: '200年前读到过虚空棱镜的残篇', minChapter: 3 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '冷静',
      role: 'guild_leader',
      inventory: [
        { name: '公会徽章', type: 'quest', description: '冒险者公会的银质徽章，证明持有者是受认可的冒险者。' },
        { name: '矿道通行证', type: 'quest', description: '授权持有者进入灰脊矿道中层的官方文件。' },
      ],
      homeBase: 'adventurer-guild',
      mobility: 'local',
      subLocation: 'adventurer-guild',
    },
    {
      name: '维克多',
      trust: 0,
      knownFacts: [
        { text: '最近精神状态很差，签文件手都在抖', minChapter: 1 },
        { text: '曾经是个好镇长，承诺改善矿工条件', minChapter: 1 },
        { text: '半年前开始回避与人交流', minChapter: 1 },
        { text: '卡恩是教团的传话人', minChapter: 3 },
        { text: '女儿索菲亚被暗影教团绑架', minChapter: 4 },
        { text: '壁炉暗格里藏着石碑的被删记录', minChapter: 4 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '紧张',
      role: 'mayor',
      inventory: [
        { name: '壁炉文件', type: 'quest', description: '半烧毁的文件——教团胁迫维克多签署的"特别勘探许可"和矿道通行记录。边角焦黑，但关键签名和教团标记仍可辨认。' },
      ],
      homeBase: 'mayor-office',
      mobility: 'local',
      subLocation: 'mayor-office',
    },
    {
      name: '卡恩',
      trust: 0,
      knownFacts: [
        { text: '自称来自东方的游吟诗人，琴艺精湛', minChapter: 1 },
        { text: '对破晓镇的历史了如指掌，比本地人还熟', minChapter: 1 },
        { text: '怀疑酒馆帮工女孩是灵视者', minChapter: 3 },
        { text: '维克多被控制的细节', minChapter: 4 },
        { text: '暗影教团的全部计划', minChapter: 4 },
        { text: '独立破译了棱镜激活咒语', minChapter: 4 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '从容',
      role: 'bard',
      inventory: [],
      homeBase: 'town-square',
      mobility: 'roaming',
      subLocation: 'town-square',
    },
    {
      name: '陈妈',
      trust: 0,
      knownFacts: [
        { text: '镇上来往旅客的动向', minChapter: 1 },
        { text: '最近有陌生人频繁出入镇外', minChapter: 1 },
        { text: '卡恩深夜独自外出', minChapter: 2 },
        { text: '那些陌生人总在月圆前后出现，每次都往矿道方向去', minChapter: 3 },
        { text: '去年矿难后镇长变了一个人，以前常来旅店聊天现在连门都不出', minChapter: 2 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '热情',
      role: 'innkeeper',
      inventory: [
        { name: '热汤', type: 'misc', description: '一碗冒着热气的浓汤，喝下后恢复些许精力。' },
      ],
      homeBase: 'dawns-rest-inn',
      mobility: 'local',
      subLocation: 'dawns-rest-inn',
    },
    {
      name: '格罗姆',
      trust: 0,
      knownFacts: [
        { text: '矿石品质近期下降', minChapter: 1 },
        { text: '矿石中出现不明黑色晶体', minChapter: 1 },
        { text: '保留了黑色晶体样本', minChapter: 2 },
        { text: '黑色晶体靠近铁器时会发出微弱嗡鸣像在共振', minChapter: 2 },
        { text: '北方矮人古矿志中有关于虚空矿脉的记载，症状与当前矿道异变惊人相似', minChapter: 3 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '暴躁',
      role: 'blacksmith',
      inventory: [
        { name: '长剑', type: 'weapon', description: '锋利的长剑。造成1d8劈砍伤害。', bonus: 1 },
        { name: '短剑', type: 'weapon', description: '轻便的短剑。造成1d6穿刺伤害。', bonus: 0 },
        { name: '短弓', type: 'weapon', description: '猎用短弓。射程80尺，造成1d6穿刺伤害。', bonus: 0 },
        { name: '皮甲', type: 'armor', description: '柔韧的皮甲。AC+1。', bonus: 1 },
        { name: '锁子甲', type: 'armor', description: '铁链编织的锁子甲。AC+2，略微沉重。', bonus: 2 },
        { name: '麻绳', type: 'misc', description: '50尺结实的麻绳。', bonus: 0 },
        { name: '火把', type: 'misc', description: '普通火把，燃烧1小时，在20尺半径内提供明亮光照。' },
        { name: '火把', type: 'misc', description: '普通火把，燃烧1小时，在20尺半径内提供明亮光照。' },
        { name: '火把', type: 'misc', description: '普通火把，燃烧1小时，在20尺半径内提供明亮光照。' },
        { name: '雷击粉', type: 'misc' as const, description: '雷石研磨的粉末，附着于武器表面。武器附加雷电伤害类型。', damageType: 'lightning' },
        { name: '雷击粉', type: 'misc' as const, description: '雷石研磨的粉末，附着于武器表面。武器附加雷电伤害类型。', damageType: 'lightning' },
      ],
      shopPricing: {
        '长剑': 30,
        '短剑': 15,
        '短弓': 25,
        '皮甲': 20,
        '锁子甲': 50,
        '麻绳': 5,
        '火把': 1,
        '雷击粉': 25,
      },
      homeBase: 'sturdy-anvil',
      mobility: 'local',
      subLocation: 'sturdy-anvil',
    },
    {
      name: '叶绿',
      trust: 0,
      knownFacts: [
        { text: '助手近期行为古怪常深夜外出', minChapter: 1 },
        { text: '助手抽屉里有画着奇怪符号的纸', minChapter: 2 },
        { text: '怀疑助手加入了秘密组织', minChapter: 2 },
        { text: '最近有矿工来求诊说在矿道里听到低语声，回来后频繁做噩梦', minChapter: 1 },
        { text: '助手符号纸上有一个像眼睛被斜线划过的标记', minChapter: 3 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '温和',
      role: 'herbalist',
      inventory: [
        { name: '治疗药水', type: 'potion', description: '红色治疗药水。恢复2d4+2生命值。', bonus: 2 },
        { name: '治疗药水', type: 'potion', description: '红色治疗药水。恢复2d4+2生命值。', bonus: 2 },
        { name: '治疗药水', type: 'potion', description: '红色治疗药水。恢复2d4+2生命值。', bonus: 2 },
        { name: '解毒剂', type: 'potion', description: '浅绿色液体，可以解除普通毒素。', bonus: 0 },
        { name: '解毒剂', type: 'potion', description: '浅绿色液体，可以解除普通毒素。', bonus: 0 },
        { name: '暗影防护药水', type: 'potion', description: '深紫色药水，饮用后1小时内对暗影伤害有抗性。', bonus: 0 },
        { name: '草药绷带', type: 'potion', description: '叶绿手工浸泡过草药的亚麻绷带，包扎伤口可恢复1d4+2生命值。', bonus: 1 },
        { name: '草药绷带', type: 'potion', description: '叶绿手工浸泡过草药的亚麻绷带，包扎伤口可恢复1d4+2生命值。', bonus: 1 },
        { name: '草药绷带', type: 'potion', description: '叶绿手工浸泡过草药的亚麻绷带，包扎伤口可恢复1d4+2生命值。', bonus: 1 },
        { name: '火焰油', type: 'misc' as const, description: '炎石粉和油脂混合的涂层。涂抹在武器上附加火焰伤害类型。', damageType: 'fire' },
        { name: '火焰油', type: 'misc' as const, description: '炎石粉和油脂混合的涂层。涂抹在武器上附加火焰伤害类型。', damageType: 'fire' },
        { name: '银油', type: 'misc' as const, description: '灵银粉末和月光草调制的涂层。武器附加光辉伤害类型。', damageType: 'radiant' },
        { name: '银油', type: 'misc' as const, description: '灵银粉末和月光草调制的涂层。武器附加光辉伤害类型。', damageType: 'radiant' },
        { name: '冰霜油', type: 'misc' as const, description: '寒铁粉与冰泉水调制的涂层。武器附加冰冻伤害类型。', damageType: 'cold' },
        { name: '防火药膏', type: 'potion' as const, description: '防护药膏，一场战斗内对火焰伤害有抗性。' },
        { name: '抗麻痹药剂', type: 'potion' as const, description: '神经强化剂，一场战斗内免疫麻痹状态。' },
      ],
      shopPricing: {
        '治疗药水': 25,
        '解毒剂': 15,
        '暗影防护药水': 40,
        '草药绷带': 8,
        '火焰油': 20,
        '银油': 30,
        '冰霜油': 20,
        '防火药膏': 30,
        '抗麻痹药剂': 35,
      },
      homeBase: 'greenleaf-apothecary',
      mobility: 'local',
      subLocation: 'greenleaf-apothecary',
    },
    {
      name: '韩猛',
      trust: 0,
      knownFacts: [
        { text: '派出调查矿道的小队接连失联', minChapter: 1 },
        { text: '失联小队最后报告中有暗影教团痕迹', minChapter: 2 },
        { text: '公会地下室囤积了应急武器', minChapter: 2 },
        { text: '最后一支失联小队报告矿道中层异常寒冷，墙壁上有会动的符文', minChapter: 3 },
        { text: '艾琳娜私下跟他说过这不是普通的塌方要做最坏准备', minChapter: 3 },
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '焦虑',
      role: 'guild_officer',
      inventory: [],
      homeBase: 'adventurer-guild',
      mobility: 'local',
      subLocation: 'adventurer-guild',
    },
  ]
}

// ─── Game Session Factory ───────────────────

export function createGameSession(name: string, classId: string): GameSession {
  const template = CLASS_TEMPLATES[classId]
  const mods = computeModifiers(template.abilities)

  const player: PlayerCharacter = {
    name,
    level: 5,
    abilities: { ...template.abilities },
    abilityModifiers: mods,
    skills: [...template.skills],
    hp: template.maxHp,
    maxHp: template.maxHp,
    xp: 0,
    gold: 20,
    inventory: [
      { name: '治疗药水', type: 'potion', description: '红色治疗药水。恢复2d4+2生命值。', bonus: 2 },
    ],
    spells: template.spells.map(s => ({ ...s })),
    clues: [],
    equipped: {
      weapon: { name: '短剑 +1', type: 'weapon', description: '一把短剑，轻便趁手。造成1d6+1穿刺伤害。', bonus: 1 },
    },
  }

  return {
    player,
    npcs: createInitialNPCs(),
    quests: [],
    worldState: {
      currentLocation: 'dawnbreak-town',
      currentSubLocation: 'dawn-stele',  // 马车停在镇口石碑旁，玩家从这里开始
      timeOfDay: 'night',
      flags: {},
    },
    events: [],
    turnCount: 0,
    combat: null,
    chapter: createChapterState(),
  }
}
