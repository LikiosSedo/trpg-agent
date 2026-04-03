/**
 * GameEngine — 所有游戏逻辑的唯一入口
 *
 * CLI 和 Web 是薄适配器，只负责 I/O。
 * 所有命令处理、回合管道、存档管理都在这里。
 */

import type { GameSession } from './types.js'
import { initGameState, getSession, setSession, getFacts, initItemRegistry, advanceTime } from './game-state.js'
import { CLASS_TEMPLATES, createGameSession, createInitialNPCs } from './game-data.js'
import { GameFactStore } from './game-facts.js'
import { DossierManager } from './dossier.js'
import { QuestManager } from './quest-manager.js'
import { ChapterManager } from './chapter-manager.js'
import { checkBrokenPromises, changeTrust } from './trust-system.js'
import { checkSafety } from './safety.js'
import { getEarlyGuidance, checkIdleEvent, resetIdleTracking } from './events.js'
import { initDMAgent, dmRespond, getDMMessages, restoreDMMessages } from './dm-agent.js'
import { consumeActions, type SceneActions } from './tools/set-actions.js'
import { executeMonsterPhase, getCombatSummary } from './combat-manager.js'
import { renderPrologue, renderWorldGuide } from './world-guide.js'
import { WORLD_OVERVIEW, locations } from './data/maps.js'
import { getDefaultSubLocation, getSubLocationName } from './npc-mobility.js'

// ─── 命令结果类型 ──────────────────────────────

export interface CommandResult {
  type: string
  data?: any
  text?: string
  savePath?: string
  success?: boolean
  message?: string
}

// ─── 回合事件类型 ──────────────────────────────

export type TurnEvent =
  | { type: 'broken_promise'; npcName: string; reason: string }
  | { type: 'safety_block'; reason: string }
  | { type: 'dm_text_delta'; text: string }
  | { type: 'dm_end'; combat: boolean; pendingMonster: boolean; actions: SceneActions | null }
  | { type: 'dm_error'; message: string }
  | { type: 'combat_monster'; text: string }
  | { type: 'combat_status'; text: string; ended: boolean; result?: string }
  | { type: 'quest_completed'; questName: string; text: string }
  | { type: 'quest_progress'; questName: string; text: string; current?: number; required?: number }
  | { type: 'npc_unlock'; npcName: string }
  | { type: 'npc_update'; text: string }
  | { type: 'auto_save'; path?: string }
  | { type: 'death' }
  | { type: 'sync'; session: GameSession; dossier: any }

// ─── 默认选项 fallback ──────────────────────────

function buildFallbackActions(session: GameSession): SceneActions {
  const loc = session.worldState.currentLocation
  const subLoc = session.worldState.currentSubLocation
  const npcsHere = session.npcs.filter(n =>
    n.location === loc && (n.subLocation ?? n.homeBase) === subLoc
  )
  const suggestions: string[] = []
  if (npcsHere.length) suggestions.push(`和${npcsHere[0].name}交谈`)
  const area = locations[loc]
  if (area) {
    const otherPois = area.pointsOfInterest.filter(
      (p: any) => p.discovered !== false && p.id !== subLoc
    )
    if (otherPois.length) suggestions.push(`前往${(otherPois[0] as any).nameZh}`)
  }
  suggestions.push('四处看看')
  return { details: [], suggestions: suggestions.slice(0, 3) }
}

// ─── 存档迁移 ──────────────────────────────────

export function migrateSession(session: GameSession): void {
  const defaults = createInitialNPCs()
  for (const npc of session.npcs) {
    if (npc.role === undefined) {
      const def = defaults.find(d => d.name === npc.name)
      if (def) {
        npc.role = def.role
        if (npc.inventory === undefined) npc.inventory = def.inventory ?? []
        if (npc.shopPricing === undefined) npc.shopPricing = def.shopPricing
      }
    }
    if (npc.homeBase === undefined) {
      const def = defaults.find(d => d.name === npc.name)
      if (def) {
        npc.homeBase = def.homeBase
        npc.mobility = def.mobility
        if (npc.subLocation === undefined) npc.subLocation = def.subLocation
      }
    }
  }
  if (session.worldState.currentSubLocation === undefined) {
    session.worldState.currentSubLocation = getDefaultSubLocation(session.worldState.currentLocation)
  }
}

// ─── 重连回顾 ──────────────────────────────────

export function buildResumeRecap(session: GameSession): string {
  const locationNames: Record<string, string> = {
    'dawnbreak-town': '破晓镇', 'twilight-woods': '暮色森林',
    'greyspine-mines': '灰脊矿道', 'shatterstone-wastes': '碎石荒原',
  }
  const loc = locationNames[session.worldState.currentLocation] ?? session.worldState.currentLocation
  const subLocId = session.worldState.currentSubLocation
  const subLocName = subLocId ? getSubLocationName(subLocId) : ''

  const lines: string[] = [
    `[断线重连 — 对话回顾，请基于以下信息延续之前的对话，不要重新开场]`,
    `当前位置: ${loc}${subLocName ? ' · ' + subLocName : ''} | 第${session.turnCount}轮`,
  ]

  const recentEvents = session.events.slice(-5)
  if (recentEvents.length) {
    lines.push(`\n最近发生的事：`)
    for (const e of recentEvents) lines.push(`  - [第${e.turn}轮] ${e.fact}`)
  }

  const recentNpcLogs: string[] = []
  for (const npc of session.npcs) {
    const logs = npc.interactionLog ?? []
    if (logs.length > 0) {
      recentNpcLogs.push(`  ${npc.name}: ${logs.slice(-3).join('；')}`)
    }
  }
  if (recentNpcLogs.length) {
    lines.push(`\n最近的NPC对话：`)
    lines.push(...recentNpcLogs)
  }

  const activeQuests = session.quests.filter(q => q.status === 'active')
  if (activeQuests.length) lines.push(`\n当前任务: ${activeQuests.map(q => q.name).join('、')}`)

  if (session.chapter) {
    const cm = new ChapterManager(session)
    lines.push(`当前章节: ${cm.getChapterTitle()}`)
  }

  return lines.join('\n')
}

// ─── GameEngine ──────────────────────────────────

export class GameEngine {
  session: GameSession
  dossier: DossierManager
  private turnsSinceLastSave = 0
  private justResumed = false

  constructor(session: GameSession, dossier?: DossierManager) {
    this.session = session
    this.dossier = dossier ?? new DossierManager()
  }

  /** 激活全局状态（在每次操作前调用） */
  private activate(): void {
    setSession(this.session)
  }

  // ─── 生命周期 ────────────────────────────

  /** 创建新游戏 */
  static createGame(name: string, classId: string): GameEngine {
    const session = createGameSession(name, classId)
    initGameState(session)
    initDMAgent()

    const engine = new GameEngine(session)

    // 章节自动事件
    if (session.chapter) {
      new ChapterManager(session).processAutoBeats()
    }

    return engine
  }

  /** 从存档恢复 */
  static resumeGame(session: GameSession, dossierData?: any, dmMessages?: any[]): GameEngine {
    migrateSession(session)
    initGameState(session)
    initDMAgent()

    if (dmMessages?.length) {
      restoreDMMessages(dmMessages)
    }

    const dossier = dossierData ? DossierManager.fromJSON(dossierData) : new DossierManager()
    resetIdleTracking()

    const engine = new GameEngine(session, dossier)
    engine.justResumed = !dmMessages?.length
    return engine
  }

  /** 从磁盘加载存档 */
  static loadGame(slotName: string): GameEngine {
    const loaded = GameFactStore.load(slotName)
    const loadedSession = (loaded as any).session as GameSession
    const dossierData = loadedSession.dossierData
    return GameEngine.resumeGame(loadedSession, dossierData)
  }

  // ─── 命令处理 ────────────────────────────

  /** 处理斜杠命令，返回结构化数据。返回 null 表示不是命令。 */
  executeCommand(input: string): CommandResult | null {
    this.activate()
    const session = this.session
    const facts = getFacts()

    if (input === '/status') {
      const p = session.player
      const m = p.abilityModifiers
      return {
        type: 'status',
        data: {
          name: p.name, level: p.level, hp: p.hp, maxHp: p.maxHp,
          gold: p.gold, xp: p.xp, className: CLASS_TEMPLATES[Object.keys(CLASS_TEMPLATES).find(k => CLASS_TEMPLATES[k].nameZh === '' /* fallback */) ?? '']?.nameZh ?? '',
          abilities: {
            STR: { value: p.abilities.STR, mod: m.STR },
            DEX: { value: p.abilities.DEX, mod: m.DEX },
            CON: { value: p.abilities.CON, mod: m.CON },
            INT: { value: p.abilities.INT, mod: m.INT },
            WIS: { value: p.abilities.WIS, mod: m.WIS },
            CHA: { value: p.abilities.CHA, mod: m.CHA },
          },
          equipped: {
            weapon: p.equipped.weapon ? { name: p.equipped.weapon.name, desc: p.equipped.weapon.description } : null,
            armor: p.equipped.armor ? { name: p.equipped.armor.name, desc: p.equipped.armor.description } : null,
          },
          spells: p.spells.map(s => ({
            name: s.name, desc: s.description,
            remaining: s.remaining, max: s.usesPerRest,
            isCantrip: s.usesPerRest === 0,
          })),
          skills: [...p.skills],
          inventory: p.inventory.map(i => ({ name: i.name, type: i.type, desc: i.description })),
          playerSummary: facts.getPlayerSummary(),
        },
      }
    }

    if (input === '/inventory') {
      const p = session.player
      return {
        type: 'inventory',
        data: {
          weapon: p.equipped.weapon ? { name: p.equipped.weapon.name, desc: p.equipped.weapon.description } : null,
          armor: p.equipped.armor ? { name: p.equipped.armor.name, desc: p.equipped.armor.description } : null,
          items: p.inventory.map(i => ({ name: i.name, type: i.type, desc: i.description })),
          gold: p.gold,
        },
      }
    }

    if (input === '/quest') {
      const qm = new QuestManager(session)
      const active = qm.getActiveQuests()
      return {
        type: 'quest',
        data: {
          active: active.map(q => ({
            name: q.name, desc: q.description,
            objectives: q.objectives.map((o, i) => ({
              text: o, done: q.objectivesCompleted[i],
            })),
            reward: q.reward,
          })),
          completed: session.quests.filter(q => q.status === 'completed').map(q => q.name),
          xp: session.player.xp,
          level: session.player.level,
          nextLevelXp: session.player.level < 3 ? (session.player.level === 1 ? 100 : 300) : null,
        },
      }
    }

    if (input === '/map') {
      const currentLoc = locations[session.worldState.currentLocation]
      return {
        type: 'map',
        data: {
          currentLocation: session.worldState.currentLocation,
          worldOverview: WORLD_OVERVIEW,
          locations: Object.values(locations).map(loc => ({
            id: loc.id, nameZh: loc.nameZh, danger: loc.dangerLevel, description: loc.description,
          })),
          currentSubLocation: session.worldState.currentSubLocation,
          subLocations: currentLoc?.pointsOfInterest
            ?.filter((p: any) => p.discovered !== false)
            .map((p: any) => ({
              id: p.id, nameZh: p.nameZh, description: p.description,
              isCurrent: p.id === session.worldState.currentSubLocation,
              npcs: session.npcs
                .filter(n => n.location === session.worldState.currentLocation &&
                  (n.subLocation ?? n.homeBase) === p.id)
                .map(n => n.name),
            })) ?? [],
        },
      }
    }

    if (input === '/shop') {
      const loc = session.worldState.currentLocation
      const shopNpc = session.npcs.find(n =>
        n.shopPricing && (n.inventory ?? []).length > 0 && n.location === loc
      )
      if (!shopNpc) return { type: 'shop', data: null }
      return {
        type: 'shop',
        data: {
          npcName: shopNpc.name,
          playerGold: session.player.gold,
          items: (shopNpc.inventory ?? []).map(i => ({
            name: i.name, type: i.type, description: i.description,
            bonus: i.bonus, price: shopNpc.shopPricing?.[i.name] ?? 0,
          })),
        },
      }
    }

    if (input === '/npc' || input === '/npc ') {
      const trustMap: Record<string, number> = {}
      for (const npc of session.npcs) trustMap[npc.name] = npc.trust
      return {
        type: 'npc_list',
        data: { npcs: this.dossier.toListData(trustMap) },
      }
    }

    if (input.startsWith('/npc ') && input.length > 5) {
      const npcName = input.slice(5).trim()
      const npc = session.npcs.find(n => n.name === npcName)
      const profileData = this.dossier.toProfileData(npcName, npc?.trust ?? 0)
      return {
        type: 'npc_detail',
        data: profileData,
        text: this.dossier.renderProfile(npcName), // CLI fallback
      }
    }

    if (input === '/recap') {
      const events = session.events
      const critical = events.filter(e => e.importance === 'critical')
      const recent = events.slice(-10)
      const npcLogs: Array<{ name: string; logs: string[] }> = []
      for (const npc of session.npcs) {
        if ((npc.interactionLog ?? []).length > 0) {
          npcLogs.push({ name: npc.name, logs: npc.interactionLog! })
        }
      }
      return {
        type: 'recap',
        data: {
          critical: critical.map(e => ({ turn: e.turn, fact: e.fact })),
          recent: recent.map(e => ({ turn: e.turn, fact: e.fact })),
          clues: session.player.clues,
          npcDialogues: npcLogs,
          quests: {
            active: session.quests.filter(q => q.status === 'active').map(q => q.name),
            completed: session.quests.filter(q => q.status === 'completed').map(q => q.name),
          },
        },
      }
    }

    if (input === '/chapter') {
      if (!session.chapter) return { type: 'chapter', data: null }
      const cm = new ChapterManager(session)
      return {
        type: 'chapter',
        data: {
          title: cm.getChapterTitle(),
          exploration: cm.getExploration(),
          discoveries: cm.getDiscoveryLabels(),
        },
      }
    }

    if (input === '/help') {
      return {
        type: 'help',
        data: {
          commands: [
            { cmd: '/status', desc: '查看角色状态' },
            { cmd: '/quest', desc: '查看任务进度' },
            { cmd: '/npc', desc: '查看已知人物' },
            { cmd: '/npc <名>', desc: '查看人物详情' },
            { cmd: '/world', desc: '查看世界指南' },
            { cmd: '/map', desc: '查看地图' },
            { cmd: '/inventory', desc: '查看背包' },
            { cmd: '/shop', desc: '查看附近商店' },
            { cmd: '/recap', desc: '故事回顾' },
            { cmd: '/chapter', desc: '查看章节进度与探索度' },
            { cmd: '/save', desc: '保存游戏' },
            { cmd: '/saves', desc: '查看存档列表' },
            { cmd: '/load <名>', desc: '加载存档' },
            { cmd: '/quit', desc: '退出游戏' },
          ],
        },
      }
    }

    if (input === '/world') {
      return { type: 'world', text: renderWorldGuide() }
    }

    if (input === '/save') {
      session.dossierData = this.dossier.toJSON()
      const path = getFacts().save()
      return { type: 'save', savePath: path }
    }

    if (input === '/saves') {
      return { type: 'saves', data: { saves: GameFactStore.listSaves() } }
    }

    if (input.startsWith('/load')) {
      const slotName = input.slice('/load'.length).trim()
      if (!slotName) {
        return { type: 'saves', data: { saves: GameFactStore.listSaves() } }
      }
      try {
        const loaded = GameFactStore.load(slotName)
        const loadedSession = (loaded as any).session as GameSession
        migrateSession(loadedSession)
        this.session = loadedSession
        initGameState(loadedSession)
        initDMAgent()
        resetIdleTracking()
        this.dossier = loadedSession.dossierData
          ? DossierManager.fromJSON(loadedSession.dossierData)
          : new DossierManager()
        return { type: 'load', success: true, message: `存档已加载: ${slotName}` }
      } catch (err) {
        return { type: 'load', success: false, message: `加载失败: ${(err as Error).message}` }
      }
    }

    if (input === '/quit') {
      session.dossierData = this.dossier.toJSON()
      const path = getFacts().save('web-quit')
      return { type: 'quit', savePath: path }
    }

    // 不是命令
    return null
  }

  // ─── 回合处理 ────────────────────────────

  /** 处理一个游戏回合，返回事件流 */
  async *processTurn(input: string): AsyncGenerator<TurnEvent> {
    this.activate()
    const session = this.session
    const facts = getFacts()

    // 安全检查
    const safety = checkSafety(input)
    if (safety.level === 'block') {
      yield { type: 'safety_block', reason: safety.reason! }
      session.dossierData = this.dossier.toJSON()
      facts.save('quicksave')
      return
    }

    session.turnCount++

    // 检查过期承诺
    const brokenPromises = checkBrokenPromises(session)
    for (const bp of brokenPromises) {
      const result = changeTrust(session, bp)
      if (result.applied) {
        yield { type: 'broken_promise', npcName: bp.npcName, reason: bp.reason }
      }
    }

    // 构建 DM 输入
    const parts: string[] = []

    if (this.justResumed) {
      this.justResumed = false
      const recap = buildResumeRecap(session)
      parts.push(recap)
    }

    if (safety.level === 'warn') parts.push(`[DM安全指令: ${safety.dmInstruction}]`)
    const guidance = getEarlyGuidance(session.turnCount)
    if (guidance) parts.push(guidance)
    const idle = checkIdleEvent(input)
    if (idle) parts.push(idle)
    parts.push(input)

    // DM 流式响应
    let fullText = ''
    try {
      for await (const event of dmRespond(parts.join('\n\n'))) {
        if (event.type === 'text_delta') {
          const text = event.text ?? ''
          yield { type: 'dm_text_delta', text }
          fullText += text
        }
      }
    } catch (err) {
      yield { type: 'dm_error', message: (err as Error).message.slice(0, 100) }
    }

    // DM 结束 + 场景选项
    const dmActions = consumeActions()
    const actions = dmActions ?? buildFallbackActions(session)
    yield {
      type: 'dm_end',
      combat: !!session.combat?.active,
      pendingMonster: !!session.combat?.pendingMonsterTurn,
      actions,
    }

    // 怪物回合
    if (session.combat?.pendingMonsterTurn) {
      const monsterResult = executeMonsterPhase(session)
      if (monsterResult.log.length > 0) {
        yield { type: 'combat_monster', text: monsterResult.log.join('\n') }
      }
      if (monsterResult.ended) {
        yield {
          type: 'combat_status',
          text: monsterResult.result === 'victory' ? '战斗胜利！' : '战斗失败...',
          ended: true, result: monsterResult.result,
        }
        if (session.chapter) {
          new ChapterManager(session).onEvent('combat_end')
        }
      } else {
        const status = getCombatSummary(session)
        if (status) yield { type: 'combat_status', text: status, ended: false }
      }
    } else if (session.combat?.active) {
      const status = getCombatSummary(session)
      if (status) yield { type: 'combat_status', text: status, ended: false }
    }

    // 任务检查
    const qm = new QuestManager(session)
    const { completed: objCompleted, progress: objProgress } = qm.checkCombatObjectives()
    for (const r of objCompleted) {
      yield { type: 'quest_completed', questName: r.questName, text: r.text }
    }
    for (const p of objProgress) {
      yield { type: 'quest_progress', questName: p.questName, text: p.text, current: p.current, required: p.required }
    }

    // NPC 档案更新
    for (const npc of session.npcs) {
      if (input.includes(npc.name) || fullText.includes(npc.name)) {
        const unlock = this.dossier.unlock(npc.name, session.turnCount)
        if (unlock) yield { type: 'npc_unlock', npcName: npc.name }
        const update = this.dossier.onInteraction(npc.name, npc.trust, session.turnCount)
        if (update) yield { type: 'npc_update', text: update }
      }
    }

    // 章节推进
    if (session.chapter) {
      new ChapterManager(session).advanceTurn()
    }

    // DM 消息持久化
    session.dmMessages = getDMMessages()

    // 同步
    yield { type: 'sync', session, dossier: this.dossier.toJSON() }

    // 死亡检测
    if (session.player.hp <= 0) {
      session.dossierData = this.dossier.toJSON()
      facts.save('death-save')
      yield { type: 'death' }
      return
    }

    // 自动存档
    this.turnsSinceLastSave++
    if (this.turnsSinceLastSave >= 5) {
      session.dossierData = this.dossier.toJSON()
      facts.save('autosave')
      this.turnsSinceLastSave = 0
      yield { type: 'auto_save' }
    }
  }

  // ─── DM 开场 ────────────────────────────

  /** 流式发送 DM 开场叙事 */
  async *streamOpening(): AsyncGenerator<TurnEvent> {
    this.activate()
    const session = this.session
    const classZh = Object.values(CLASS_TEMPLATES).find(t =>
      t.abilities.STR === session.player.abilities.STR &&
      t.abilities.INT === session.player.abilities.INT
    )?.nameZh ?? '冒险者'

    const prompt = [
      `新游戏开始。玩家角色: ${session.player.name}，${classZh}。`,
      '请开始第一幕：马车上醒来。简短3-4段。',
    ].join('\n')

    let fullText = ''
    try {
      for await (const event of dmRespond(prompt)) {
        if (event.type === 'text_delta') {
          const text = event.text ?? ''
          yield { type: 'dm_text_delta', text }
          fullText += text
        }
      }
    } catch (err) {
      yield { type: 'dm_error', message: (err as Error).message.slice(0, 100) }
    }

    const actions = consumeActions() ?? buildFallbackActions(session)
    yield { type: 'dm_end', combat: false, pendingMonster: false, actions }

    // 开场 NPC 解锁
    for (const npc of session.npcs) {
      if (fullText.includes(npc.name)) {
        const notice = this.dossier.unlock(npc.name, 0)
        if (notice) yield { type: 'npc_unlock', npcName: npc.name }
      }
    }

    session.dmMessages = getDMMessages()
    yield { type: 'sync', session, dossier: this.dossier.toJSON() }
  }

  // ─── 工具方法 ────────────────────────────

  getPrologue(): string {
    return renderPrologue()
  }

  getWorldGuide(): string {
    return renderWorldGuide()
  }
}
