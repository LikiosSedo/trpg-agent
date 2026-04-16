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

export type DamageType =
  | 'slashing' | 'piercing' | 'bludgeoning'  // 物理
  | 'fire' | 'cold' | 'lightning'             // 元素
  | 'radiant' | 'necrotic'                    // 特殊

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
  damageType?: DamageType       // 武器伤害类型 / 涂层附加类型
  bonusDamageType?: DamageType  // 次要伤害类型（如灵银长剑的 radiant）
  weaponType?: 'melee' | 'ranged'  // 近战用 STR，远程用 DEX
  armorWeight?: 'light' | 'medium' | 'heavy'  // 甲种
  maxDex?: number                  // 重甲/中甲限制 DEX 加值上限
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
  /** 战棋射程（曼哈顿距离格数），0=自身，1=相邻，不填=非战斗法术 */
  gridRange?: number
  /** 战棋 AoE 半径（曼哈顿距离），如 Fireball gridRadius=2 */
  gridRadius?: number
}

// ─── 怪物 ─────────────────────────────────────

export interface Monster {
  name: string          // 英文规则 ID（用于查表、kills_X flag）
  nameZh?: string       // 中文显示名（给 DM/玩家看）
  hp: number
  dc: number // 命中/闪避难度 (用作 AC)
  damageDice: string // "1d6+2"
  specialAbility: string
  description: string
  loot: string[]
  vulnerability?: DamageType[]  // 弱点：受到该类型伤害 ×2
  resistance?: DamageType[]     // 抗性：受到该类型伤害 ×0.5
  immunity?: DamageType[]       // 免疫：该类型伤害无效
  discoveryHints?: {
    npc?: string                // 哪个 NPC 知道弱点信息
    npcMinTrust?: number        // 需要多少信任度才告知
    location?: string           // 哪个位置可搜索到情报
    skillCheck?: { skill: string; dc: number }
  }
}

/** 怪物图鉴条目 —— 记录玩家对每种怪物的了解程度 */
export interface BestiaryEntry {
  encountered: boolean          // 是否遭遇过
  weaknessKnown: boolean        // 是否知道弱点
  resistanceKnown: boolean      // 是否知道抗性
  immunityKnown: boolean        // 是否知道免疫
  notes: string[]               // 从 NPC/探索/战斗中获取的情报
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
  nonlethal?: boolean   // 是否为无辜NPC（击败后会恢复）
  vulnerability?: DamageType[]
  resistance?: DamageType[]
  immunity?: DamageType[]
  /** 战棋网格位置（grid 模式） */
  pos?: { x: number; y: number }
  moveSpeed?: number
  attackRange?: number
}

/** 战斗中的 NPC 同伴运行时实例 */
export interface AllyInstance {
  id: string            // NPC 名（唯一）
  name: string          // 显示名
  hp: number
  maxHp: number
  ac: number
  attackMod: number
  damageDice: string
  specialAbility: string
  combatBehavior: string  // 'subdue' | 'kill' | etc.
  allyRole?: 'tank' | 'dps' | 'support' | 'control'
  allyAbility?: {
    name: string        // 技能名（如"铁壁守护"）
    effect: string      // 效果类型标识（如"taunt"）
    description: string
    cooldown?: number   // 冷却回合数
  }
  damageType?: DamageType  // 同伴攻击的默认伤害类型
  /** 战棋网格位置（grid 模式） */
  pos?: { x: number; y: number }
  moveSpeed?: number
  attackRange?: number
}

/** 先攻序列中的一个条目 */
export interface InitiativeEntry {
  id: string
  name: string
  initiative: number
  isPlayer: boolean
  isAlly?: boolean      // true = 友方 NPC 同伴
}

/** 当前战斗的完整状态 */
export interface CombatState {
  active: boolean
  round: number
  initiativeOrder: InitiativeEntry[]
  monsters: MonsterInstance[]
  allies: AllyInstance[]  // 友方 NPC 同伴
  log: string[]         // 当前回合的战斗日志
  pendingMonsterTurn?: boolean  // 玩家回合结束后，等待怪物回合执行
  phase?: CombatPhase           // 当前战斗阶段
  playerDefending?: boolean     // 防御姿态时 AC+2
  /** 战棋网格（P1 新增，null 时走旧的文字战斗流程） */
  grid?: import('./combat-grid.js').CombatGrid
  /** 玩家的网格属性 */
  playerGridStats?: { moveSpeed: number; attackRange: number; pos: { x: number; y: number } }
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
  /** 最近一次 dialogue 通道获得正向信任的回合。用于对话通道 +1 的冷却(trust-system.ts) */
  lastDialogueTrustTurn?: number
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
  bestiary?: Record<string, BestiaryEntry>  // 怪物图鉴
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

export interface TrustBlockedBeat {
  beatId: string
  npc: string                   // 被门控的 NPC 名
  currentTrust: number          // 当前信任度
  requiredTrust: number         // 需要的信任度
}

export interface ChapterState {
  currentChapter: string        // 当前章节 id
  completedBeats: string[]      // 已触发的 beat ids
  discoveries: string[]         // 已发现的 discovery ids
  idleTurns: number             // 自上次触发 beat 以来的空闲轮数
  nudgeIndex: number            // 当前 nudge 提示索引
  pendingFacts?: string[]       // auto beat 触发后暂存的 facts，下轮注入 DM prompt 后清空
  trustBlockedBeats?: TrustBlockedBeat[]  // 本轮因信任不足被阻挡的 beats（供 Talk 工具注入"欲言又止"提示）
}

// ─── DM Journal（Phase 6: 存档级叙事札记） ──────

/**
 * DM 札记条目 —— 由 DM 主动记录的"本次冒险独有的叙事锚点"。
 *
 * 和其他系统的区别:
 *   - events      → 机械状态变化(自动,代码写入)
 *   - quests      → 结构化任务进度
 *   - player.clues→ 玩家拾取的事实线索
 *   - dmJournal   → DM 决定记录的叙事细节(承诺/抉择/揭示/备忘)
 *
 * 价值:札记会被注入到 [游戏状态] 上下文 + Phase 4 归档快照,
 *       所以会跨压缩、跨 session 持续影响 DM 叙事。
 */
export interface DMJournalEntry {
  /** 记录时的 turnCount */
  turn: number
  /** 记录时的章节 id（例 'ch2'） */
  chapter: string
  /**
   * 札记类型:
   *   - decision:   玩家做出了一个影响后续剧情走向的选择
   *   - revelation: 本次叙事中透露了一个只有这个存档才知道的关键信息
   *   - promise:    玩家向 NPC 做出的承诺(和 trust-system 的结构化 promise 互补)
   *   - note:       DM 希望 10 轮后仍然记得的叙事细节/玩家立场
   */
  type: 'decision' | 'revelation' | 'promise' | 'note'
  /** 札记内容(最多 300 字符,超出截断) */
  content: string
  /** 自由标签,供未来检索 */
  tags?: string[]
}

// ─── NPC 记忆（NPC "灵魂"系统） ──────────────────

/** NPC 对某次互动的记忆 */
export interface NPCInteractionMemory {
  turn: number
  chapter: string
  /** 一句话概括（最多 60 字） */
  summary: string
  /** 互动类型 */
  type: 'talk' | 'witness' | 'combat' | 'gift' | 'quest'
  /** 玩家透露的信息 */
  playerRevealed?: string[]
  /** NPC 透露的信息 */
  npcRevealed?: string[]
  /** 互动氛围 */
  mood?: string
}

/** 单个 NPC 的完整记忆库 */
export interface NPCMemoryStore {
  /** NPC 对玩家的印象（最多 3 条，每次提取整体替换） */
  impressions: string[]
  /** 互动记忆（FIFO，保留首条 + 最近 N 条） */
  interactions: NPCInteractionMemory[]
  /** 玩家未兑现的承诺（从 trust-system 同步） */
  unfulfilledPromises: string[]
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
  dmJournal?: DMJournalEntry[]  // Phase 6: DM 札记（追加型叙事锚点）
  interactionNpc?: string       // 当前正在交互的 NPC（对话/交易状态绑定）
  timeAccum?: number            // 加权时间累积值（达到阈值自动推进时段）
  npcHostileCooldowns?: Map<string, number>  // NPC 敌对响应冷却记录（npcName -> 触发回合数）
  party?: string[]       // 当前队伍中的 NPC 名（最多 2 名战斗型 NPC）
  npcMemories?: Record<string, NPCMemoryStore>  // NPC "灵魂"记忆（互动历史、印象、承诺）
}
