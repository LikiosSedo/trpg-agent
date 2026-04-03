/**
 * 共享游戏数据 — 职业模板、NPC 初始数据、会话创建
 *
 * main.ts 和 server.ts 共用，避免数据重复和不一致。
 */

import type { PlayerCharacter, GameSession, NPC, Spell, AbilityScores } from './types.js'

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
    },
    {
      name: '小莉',
      trust: 0,
      knownFacts: ['能感知他人身上的异常气息', '镇长身上缠着灰色扭动的东西', '卡恩让她后背发凉'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '好奇',
    },
    {
      name: '艾琳娜',
      trust: 0,
      knownFacts: ['矿道失踪事件的详细情报', '卡恩的文件太完美——有遮蔽', '小莉身上有微弱的天赋波动', '200年前读到过虚空棱镜的残篇'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '冷静',
    },
    {
      name: '维克多',
      trust: 0,
      knownFacts: ['女儿索菲亚被暗影教团绑架', '壁炉暗格里藏着石碑的被删记录', '卡恩是教团的传话人'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '紧张',
    },
    {
      name: '卡恩',
      trust: 0,
      knownFacts: ['暗影教团的全部计划', '维克多被控制的细节', '怀疑酒馆帮工女孩是灵视者', '独立破译了棱镜激活咒语'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '从容',
    },
    {
      name: '陈妈',
      trust: 0,
      knownFacts: ['镇上来往旅客的动向', '最近有陌生人频繁出入镇外', '卡恩深夜独自外出'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '热情',
    },
    {
      name: '格罗姆',
      trust: 0,
      knownFacts: ['矿石品质近期下降', '矿石中出现不明黑色晶体', '保留了黑色晶体样本'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '暴躁',
    },
    {
      name: '叶绿',
      trust: 0,
      knownFacts: ['助手近期行为古怪常深夜外出', '助手抽屉里有画着奇怪符号的纸', '怀疑助手加入了秘密组织'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '温和',
    },
    {
      name: '韩猛',
      trust: 0,
      knownFacts: ['派出调查矿道的小队接连失联', '失联小队最后报告中有暗影教团痕迹', '公会地下室囤积了应急武器'],
      playerPromises: [],
      interactionLog: [],
      location: 'dawnbreak-town',
      mood: '焦虑',
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
      timeOfDay: 'night',
      flags: {},
    },
    events: [],
    turnCount: 0,
    combat: null,
  }
}
