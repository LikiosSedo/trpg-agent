/**
 * 共享游戏数据 — 职业模板、NPC 初始数据、会话创建
 *
 * main.ts 和 server.ts 共用，避免数据重复和不一致。
 */

import type { PlayerCharacter, GameSession, NPC, Spell, AbilityScores } from './types.js'
import { createChapterState } from './chapter-manager.js'

// ─── Character Class Templates ───────────────

export interface ClassTemplate {
  nameZh: string
  abilities: AbilityScores
  skills: PlayerCharacter['skills']
  maxHp: number
  spells: Spell[]
}

export const CLASS_TEMPLATES: Record<string, ClassTemplate> = {
  fighter: {
    nameZh: '剑士',
    abilities: { STR: 16, DEX: 12, CON: 14, INT: 8, WIS: 10, CHA: 10 },
    skills: ['athletics', 'intimidation'],
    maxHp: 12,
    spells: [],
  },
  mage: {
    nameZh: '法师',
    abilities: { STR: 8, DEX: 12, CON: 10, INT: 16, WIS: 14, CHA: 10 },
    skills: ['arcana', 'investigation'],
    maxHp: 8,
    spells: [
      { name: 'Fire Bolt', description: '投射一团火焰', effect: 'Deal 1d10 fire damage on a ranged spell attack hit.', usesPerRest: 0, remaining: 0 },
      { name: 'Magic Missile', description: '三枚魔法飞弹自动命中', effect: 'Deal 3d4+3 force damage, auto-hit, split among up to 3 targets.', usesPerRest: 3, remaining: 3 },
      { name: 'Shield', description: '魔法护盾', effect: 'Reaction: +5 AC until the start of your next turn.', usesPerRest: 3, remaining: 3 },
      { name: 'Detect Magic', description: '侦测30尺内的魔法', effect: 'Reveal magical auras and identify the school of magic.', usesPerRest: 3, remaining: 3 },
    ],
  },
  ranger: {
    nameZh: '游侠',
    abilities: { STR: 12, DEX: 16, CON: 12, INT: 10, WIS: 14, CHA: 8 },
    skills: ['stealth', 'perception'],
    maxHp: 10,
    spells: [],
  },
  cleric: {
    nameZh: '牧师',
    abilities: { STR: 14, DEX: 10, CON: 14, INT: 10, WIS: 16, CHA: 12 },
    skills: ['medicine', 'insight'],
    maxHp: 10,
    spells: [
      { name: 'Cure Wounds', description: '触摸治疗伤口', effect: 'Restore 1d8+WIS modifier HP to a creature you touch.', usesPerRest: 3, remaining: 3 },
      { name: 'Detect Magic', description: '侦测30尺内的魔法', effect: 'Reveal magical auras and identify the school of magic.', usesPerRest: 3, remaining: 3 },
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
      knownFacts: ['镇上矿洞最近不太平', '冒险者公会在招人', '二十年前在矿洞里失去了挚友达里安'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '温和',
      role: 'innkeeper',
      inventory: [
        { name: '火把', type: 'misc', description: '普通的火把，可照亮周围区域。', bonus: 0 },
        { name: '火把', type: 'misc', description: '普通的火把，可照亮周围区域。', bonus: 0 },
      ],
      homeBase: 'shattered-shield-tavern',
      mobility: 'local',
      subLocation: 'shattered-shield-tavern',
    },
    {
      name: '小莉',
      trust: 0,
      knownFacts: ['能感知他人身上的异常气息', '镇长身上缠着灰色扭动的东西', '卡恩让她后背发凉'],
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
      knownFacts: ['矿道失踪事件的详细情报', '卡恩的文件太完美——有遮蔽', '小莉身上有微弱的天赋波动', '200年前读到过虚空棱镜的残篇'],
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
      knownFacts: ['女儿索菲亚被暗影教团绑架', '壁炉暗格里藏着石碑的被删记录', '卡恩是教团的传话人'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '紧张',
      role: 'mayor',
      inventory: [
        { name: '达里安的日志', type: 'quest', description: '一本破旧的日志，记录了20年前矿道深处的发现。封面有烧焦的痕迹。' },
      ],
      homeBase: 'mayor-office',
      mobility: 'local',
      subLocation: 'mayor-office',
    },
    {
      name: '卡恩',
      trust: 0,
      knownFacts: ['暗影教团的全部计划', '维克多被控制的细节', '怀疑酒馆帮工女孩是灵视者', '独立破译了棱镜激活咒语'],
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
        '镇上来往旅客的动向',
        '最近有陌生人频繁出入镇外',
        '卡恩深夜独自外出',
        '那些陌生人总在月圆前后出现，每次都往矿道方向去',
        '去年矿难后镇长变了一个人，以前常来旅店聊天现在连门都不出',
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
        '矿石品质近期下降',
        '矿石中出现不明黑色晶体',
        '保留了黑色晶体样本',
        '黑色晶体靠近铁器时会发出微弱嗡鸣像在共振',
        '北方矮人古矿志中有关于虚空矿脉的记载，症状与当前矿道异变惊人相似',
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '暴躁',
      role: 'blacksmith',
      inventory: [
        { name: 'Longsword', type: 'weapon', description: '锋利的长剑。Deals 1d8 slashing damage.', bonus: 1 },
        { name: 'Shortsword', type: 'weapon', description: '轻便的短剑。Deals 1d6 piercing damage.', bonus: 0 },
        { name: 'Shortbow', type: 'weapon', description: '猎用短弓。Deals 1d6 piercing damage at range.', bonus: 0 },
        { name: 'Leather Armor', type: 'armor', description: '柔韧的皮甲。AC+1.', bonus: 1 },
        { name: 'Chain Shirt', type: 'armor', description: '铁链编织的锁子甲。AC+2，略微沉重。', bonus: 2 },
        { name: '麻绳', type: 'misc', description: '50尺结实的麻绳。', bonus: 0 },
      ],
      shopPricing: {
        'Longsword': 30,
        'Shortsword': 15,
        'Shortbow': 25,
        'Leather Armor': 20,
        'Chain Shirt': 50,
        '麻绳': 5,
      },
      homeBase: 'sturdy-anvil',
      mobility: 'local',
      subLocation: 'sturdy-anvil',
    },
    {
      name: '叶绿',
      trust: 0,
      knownFacts: [
        '助手近期行为古怪常深夜外出',
        '助手抽屉里有画着奇怪符号的纸',
        '怀疑助手加入了秘密组织',
        '最近有矿工来求诊说在矿道里听到低语声，回来后频繁做噩梦',
        '助手符号纸上有一个像眼睛被斜线划过的标记',
      ],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '温和',
      role: 'herbalist',
      inventory: [
        { name: 'Healing Potion', type: 'potion', description: '红色治疗药水。恢复2d4+2生命值。', bonus: 2 },
        { name: 'Healing Potion', type: 'potion', description: '红色治疗药水。恢复2d4+2生命值。', bonus: 2 },
        { name: 'Healing Potion', type: 'potion', description: '红色治疗药水。恢复2d4+2生命值。', bonus: 2 },
        { name: '解毒剂', type: 'potion', description: '浅绿色液体，可以解除普通毒素。', bonus: 0 },
        { name: '解毒剂', type: 'potion', description: '浅绿色液体，可以解除普通毒素。', bonus: 0 },
        { name: '暗影防护药水', type: 'potion', description: '深紫色药水，饮用后1小时内对暗影伤害有抗性。', bonus: 0 },
      ],
      shopPricing: {
        'Healing Potion': 25,
        '解毒剂': 15,
        '暗影防护药水': 40,
      },
      homeBase: 'greenleaf-apothecary',
      mobility: 'local',
      subLocation: 'greenleaf-apothecary',
    },
    {
      name: '韩猛',
      trust: 0,
      knownFacts: [
        '派出调查矿道的小队接连失联',
        '失联小队最后报告中有暗影教团痕迹',
        '公会地下室囤积了应急武器',
        '最后一支失联小队报告矿道中层异常寒冷，墙壁上有会动的符文',
        '艾琳娜私下跟他说过这不是普通的塌方要做最坏准备',
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
    level: 1,
    abilities: { ...template.abilities },
    abilityModifiers: mods,
    skills: [...template.skills],
    hp: template.maxHp,
    maxHp: template.maxHp,
    xp: 0,
    gold: 0,
    inventory: [],
    spells: template.spells.map(s => ({ ...s })),
    clues: [],
    equipped: {
      weapon: { name: '生锈的短剑', type: 'weapon', description: '一把锈迹斑斑的短剑，勉强能用。Deals 1d6 piercing damage.', bonus: 0 },
    },
  }

  return {
    player,
    npcs: createInitialNPCs(),
    quests: [],
    worldState: {
      currentLocation: 'dawnbreak-town',
      currentSubLocation: 'town-square',
      timeOfDay: 'night',
      flags: {},
    },
    events: [],
    turnCount: 0,
    combat: null,
    chapter: createChapterState(),
  }
}
