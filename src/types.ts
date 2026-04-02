// ─── 基础类型 ─────────────────────────────────

export interface AbilityScores {
  STR: number
  DEX: number
  CON: number
  INT: number
  WIS: number
  CHA: number
}

export type Ability = keyof AbilityScores

export type Skill =
  | 'athletics' | 'acrobatics' | 'sleight_of_hand' | 'stealth'
  | 'investigation' | 'arcana'
  | 'perception' | 'insight' | 'medicine'
  | 'persuasion' | 'deception' | 'intimidation'

// ─── 物品 ─────────────────────────────────────

export type ItemType = 'weapon' | 'armor' | 'potion' | 'quest' | 'misc'

export interface Item {
  name: string
  type: ItemType
  description: string
  bonus?: number // 武器攻击加值 / 护甲AC加值 / 药水恢复量
}

// ─── 法术 ─────────────────────────────────────

export interface Spell {
  name: string
  description: string
  effect: string
  usesPerRest: number // 0 = 无限 (戏法)
  remaining: number
}

// ─── 怪物 ─────────────────────────────────────

export interface Monster {
  name: string
  hp: number
  dc: number // 命中/闪避难度
  damageDice: string // "1d6+2"
  specialAbility: string
  description: string
  loot: string[]
}

// ─── NPC ──────────────────────────────────────

export interface NPC {
  name: string
  trust: number // -10 ~ 10
  knownFacts: string[] // NPC 掌握的情报
  playerPromises: string[] // 玩家对该 NPC 做过的承诺
  location: string
  mood: string
}

// ─── 任务 ──────────────────────────────────────

export type QuestStatus = 'active' | 'completed' | 'failed'

export interface Quest {
  name: string
  description: string
  status: QuestStatus
  objectives: string[]
}

// ─── 玩家角色 ─────────────────────────────────

export interface PlayerCharacter {
  name: string
  level: number // 1-3
  abilities: AbilityScores
  abilityModifiers: AbilityScores // Math.floor((score - 10) / 2)
  skills: Skill[] // 熟练技能，最多5个
  hp: number
  maxHp: number
  gold: number
  inventory: Item[]
  spells: Spell[]
  clues: string[] // 收集到的线索
  equipped: {
    weapon?: Item
    armor?: Item
  }
}

// ─── 事件 ──────────────────────────────────────

export interface GameEvent {
  turn: number
  fact: string
  importance: 'critical' | 'normal'
}

// ─── 世界状态 ──────────────────────────────────

export interface WorldState {
  currentLocation: string
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
  flags: Record<string, boolean> // 剧情标记，如 "mine_collapse_investigated"
}

// ─── 游戏会话 ──────────────────────────────────

export interface GameSession {
  player: PlayerCharacter
  npcs: NPC[]
  quests: Quest[]
  worldState: WorldState
  events: GameEvent[]
  turnCount: number
}
