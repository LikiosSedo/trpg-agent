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

// ─── 效果系统 ───────────────────────────────────

export type EffectType =
  | 'ac_bonus'        // AC 加值（Shield、Shield of Faith）
  | 'attack_bonus'    // 攻击加值
  | 'damage_bonus'    // 伤害加值（Hunter's Mark）
  | 'resistance'      // 伤害抗性：受到特定伤害减半（暗影防护药水）
  | 'poison_immunity' // 毒素免疫（解毒剂）
  | 'perception_bonus'// 察觉加值（Detect Magic）
  | 'light'           // 光源（火把）——矿道/暗处搜索加值

export interface ActiveEffect {
  id: string             // 唯一标识，如 'shield_1712345678'
  name: string           // 显示名："Shield" / "暗影防护"
  type: EffectType
  value: number          // 效果强度：+5 AC / +1d6 伤害 / 减半(0.5)
  remainingTurns: number // >0: 剩余回合数, -1: 持续到手动移除（装备效果）
  source: 'spell' | 'potion' | 'equipment' | 'environment'
  /** 抗性/伤害加值适用的伤害类型（如 'necrotic', 'poison'），不填=通用 */
  damageType?: string
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
  dc: number // 命中/闪避难度 (用作 AC)
  damageDice: string // "1d6+2"
  specialAbility: string
  description: string
  loot: string[]
}

// ─── 战斗状态 ─────────────────────────────────

export type CombatPhase = 'init' | 'player_turn' | 'monster_turn' | 'ended'

/** 战斗中的怪物运行时实例 */
export interface MonsterInstance {
  id: string            // 唯一 id，如 "Goblin" 或 "Goblin_2"
  name: string          // 怪物模板名
  hp: number
  maxHp: number
  ac: number            // 来自 Monster.dc
  attackMod: number     // 能力修正 + 熟练(+2)
  damageDice: string
  specialAbility: string
  loot: string[]
  conditions: string[]  // 状态效果，如 'paralyzed'
}

/** 先攻序列中的一个条目 */
export interface InitiativeEntry {
  id: string
  name: string
  initiative: number
  isPlayer: boolean
}

/** 当前战斗的完整状态 */
export interface CombatState {
  active: boolean
  round: number
  initiativeOrder: InitiativeEntry[]
  monsters: MonsterInstance[]
  log: string[]         // 当前回合的战斗日志
  pendingMonsterTurn?: boolean  // 玩家回合结束后，等待怪物回合执行
  phase?: CombatPhase           // 当前战斗阶段
  playerDefending?: boolean     // 防御姿态时 AC+2
}

// ─── 信任系统 ─────────────────────────────────

export interface TrustThresholds {
  curt: number       // 冷淡阈值（默认 -2）
  hostile: number    // 敌对阈值（默认 -5）
  avoidance: number  // 回避阈值（默认 -6）
  combat: number     // 战斗阈值（默认 -8）
}

export interface TrackedPromise {
  text: string
  madeTurn: number
  deadlineTurn: number
  fulfilled: boolean
}

// ─── NPC ──────────────────────────────────────

export type NPCMobility = 'stationary' | 'local' | 'roaming'

export type NPCRole = 'blacksmith' | 'herbalist' | 'guild_leader' | 'guild_officer'
                     | 'innkeeper' | 'mayor' | 'bard' | 'child' | 'general' | 'guard'

/** NPC 情报条目：每条情报有章节门控 */
export interface NPCFact {
  text: string
  minChapter: number  // 1-4，NPC 在此章节才"知道/想起"这条信息
}

export interface NPC {
  name: string
  trust: number // -10 ~ 10
  knownFacts: NPCFact[] // NPC 掌握的情报（按重要度排序，章节+信任双重门控）
  playerPromises: string[] // 玩家对该 NPC 做过的承诺
  interactionLog: string[] // 交互摘要（最近10条，供不在场时回顾）
  location: string
  mood: string
  role?: NPCRole
  inventory?: Item[]
  shopPricing?: Record<string, number> // item name -> gold price
  subLocation?: string          // 当前所在子地点 POI id
  homeBase?: string             // 默认驻留子地点 POI id
  mobility?: NPCMobility        // 移动能力
  trackedPromises?: TrackedPromise[]
  permanentGrudge?: boolean
  condition?: 'normal' | 'wounded' | 'unconscious' | 'recovering'
  conditionTurn?: number
}

// ─── 任务 ──────────────────────────────────────

export type QuestStatus = 'active' | 'completed' | 'failed'

export interface Quest {
  name: string
  description: string
  status: QuestStatus
  objectives: string[]
  objectivesCompleted: boolean[]
  reward: { gold: number; xp: number }
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
  xp: number
  gold: number
  inventory: Item[]
  spells: Spell[]
  clues: string[] // 收集到的线索
  equipped: {
    weapon?: Item
    armor?: Item
  }
  activeEffects?: ActiveEffect[]
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
  currentSubLocation?: string   // 当前子地点 POI id
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'
  flags: Record<string, string | number | boolean> // 剧情标记 + 运行时数值
}

// ─── 章节状态 ──────────────────────────────────

export interface ChapterState {
  currentChapter: string        // 当前章节 id
  completedBeats: string[]      // 已触发的 beat ids
  discoveries: string[]         // 已发现的 discovery ids
  idleTurns: number             // 自上次触发 beat 以来的空闲轮数
  nudgeIndex: number            // 当前 nudge 提示索引
  pendingFacts?: string[]       // auto beat 触发后暂存的 facts，下轮注入 DM prompt 后清空
}

// ─── 游戏会话 ──────────────────────────────────

export interface GameSession {
  player: PlayerCharacter
  npcs: NPC[]
  quests: Quest[]
  worldState: WorldState
  events: GameEvent[]
  turnCount: number
  combat: CombatState | null
  dossierData?: Record<string, any>
  chapter?: ChapterState        // 章节系统（新游戏有，旧存档可能没有）
  dmMessages?: any[]            // DM Agent 对话历史（持久化到 localStorage）
  interactionNpc?: string       // 当前正在交互的 NPC（对话/交易状态绑定）
  timeAccum?: number            // 加权时间累积值（达到阈值自动推进时段）
}
