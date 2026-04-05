/**
 * 调试 API 系统
 *
 * 提供可编程的调试接口，让 AI 助手可以自动化测试和诊断问题
 */

import type { GameEngine } from './engine.js'
import type { GameSession } from './types.js'

export interface DebugReport {
  timestamp: string
  checks: DebugCheck[]
  summary: {
    total: number
    passed: number
    failed: number
    warnings: number
  }
}

export interface DebugCheck {
  category: string
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  details?: any
}

/**
 * NPC 名称匹配系统诊断
 */
export function diagnoseNPCNameMatching(engine: GameEngine, session: GameSession): DebugCheck[] {
  const checks: DebugCheck[] = []

  // 检查 1: session.npcs 和 dossier 的一致性
  const dossierKeys = new Set(engine['dossier'].listUnlocked())
  const sessionNPCNames = session.npcs.map(n => n.name)

  for (const npcName of sessionNPCNames) {
    if (dossierKeys.has(npcName)) {
      checks.push({
        category: 'npc-matching',
        name: `NPC "${npcName}" key consistency`,
        status: 'pass',
        message: `session.npcs[].name 和 dossier key 一致`,
      })
    } else {
      checks.push({
        category: 'npc-matching',
        name: `NPC "${npcName}" key consistency`,
        status: 'warn',
        message: `session.npcs 中有 "${npcName}"，但 dossier 未解锁`,
      })
    }
  }

  // 检查 2: 位置信息完整性
  for (const npc of session.npcs) {
    const hasLocation = !!npc.location
    const hasSubLocation = !!(npc.subLocation || npc.homeBase)

    if (hasLocation && hasSubLocation) {
      checks.push({
        category: 'npc-location',
        name: `NPC "${npc.name}" location data`,
        status: 'pass',
        message: `位置: ${npc.location}/${npc.subLocation || npc.homeBase}`,
        details: {
          location: npc.location,
          subLocation: npc.subLocation || npc.homeBase,
          mobility: npc.mobility,
        },
      })
    } else {
      checks.push({
        category: 'npc-location',
        name: `NPC "${npc.name}" location data`,
        status: 'fail',
        message: `位置信息不完整`,
        details: { location: npc.location, subLocation: npc.subLocation, homeBase: npc.homeBase },
      })
    }
  }

  // 检查 3: 当前位置的 NPC
  const playerLoc = session.worldState.currentLocation
  const playerSub = session.worldState.currentSubLocation
  const npcsHere = session.npcs.filter(n =>
    n.location === playerLoc && (n.subLocation || n.homeBase) === playerSub
  )

  checks.push({
    category: 'npc-location',
    name: 'NPCs at current location',
    status: npcsHere.length > 0 ? 'pass' : 'warn',
    message: `当前位置 ${playerLoc}/${playerSub} 有 ${npcsHere.length} 个 NPC`,
    details: {
      playerLocation: playerLoc,
      playerSubLocation: playerSub,
      npcsHere: npcsHere.map(n => n.name),
    },
  })

  return checks
}

/**
 * 信任系统诊断
 */
export function diagnoseTrustSystem(session: GameSession): DebugCheck[] {
  const checks: DebugCheck[] = []

  for (const npc of session.npcs) {
    const trust = npc.trust ?? 0
    const inRange = trust >= -10 && trust <= 10

    checks.push({
      category: 'trust-system',
      name: `NPC "${npc.name}" trust value`,
      status: inRange ? 'pass' : 'fail',
      message: `信任度: ${trust} ${inRange ? '(正常范围)' : '(超出范围 -10~10)'}`,
      details: {
        trust,
        interactionCount: npc.interactionLog?.length ?? 0,
        promises: npc.playerPromises?.length ?? 0,
      },
    })
  }

  return checks
}

/**
 * 章节系统诊断
 */
export function diagnoseChapterSystem(session: GameSession): DebugCheck[] {
  const checks: DebugCheck[] = []

  if (!session.chapter) {
    checks.push({
      category: 'chapter-system',
      name: 'Chapter state',
      status: 'warn',
      message: '章节系统未初始化',
    })
    return checks
  }

  checks.push({
    category: 'chapter-system',
    name: 'Current chapter',
    status: 'pass',
    message: `当前章节: ${session.chapter.currentChapter}`,
    details: {
      chapter: session.chapter.currentChapter,
      completedBeats: session.chapter.completedBeats,
      beatCount: session.chapter.completedBeats.length,
    },
  })

  return checks
}

/**
 * 战斗系统诊断
 */
export function diagnoseCombatSystem(session: GameSession): DebugCheck[] {
  const checks: DebugCheck[] = []

  if (!session.combat?.active) {
    checks.push({
      category: 'combat-system',
      name: 'Combat state',
      status: 'pass',
      message: '当前不在战斗中',
    })
    return checks
  }

  checks.push({
    category: 'combat-system',
    name: 'Combat state',
    status: 'pass',
    message: `战斗进行中 (回合 ${session.combat.round})`,
    details: {
      round: session.combat.round,
      monsters: session.combat.monsters?.length ?? 0,
      playerHp: session.player.hp,
      playerMaxHp: session.player.maxHp,
    },
  })

  return checks
}

/**
 * 完整系统诊断
 */
export function runFullDiagnostics(engine: GameEngine, session: GameSession): DebugReport {
  const checks: DebugCheck[] = [
    ...diagnoseNPCNameMatching(engine, session),
    ...diagnoseTrustSystem(session),
    ...diagnoseChapterSystem(session),
    ...diagnoseCombatSystem(session),
  ]

  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'pass').length,
    failed: checks.filter(c => c.status === 'fail').length,
    warnings: checks.filter(c => c.status === 'warn').length,
  }

  return {
    timestamp: new Date().toISOString(),
    checks,
    summary,
  }
}

/**
 * 获取 NPC 面板数据（用于验证前端渲染）
 */
export function getNPCPanelData(engine: GameEngine, session: GameSession) {
  const trustMap: Record<string, number> = {}
  for (const npc of session.npcs) trustMap[npc.name] = npc.trust

  const unlockedNames = new Set(engine['dossier'].listUnlocked())
  const npcLocations: Record<string, any> = {}

  for (const npc of session.npcs) {
    if (!unlockedNames.has(npc.name)) continue
    const sub = npc.subLocation ?? npc.homeBase ?? ''
    npcLocations[npc.name] = {
      location: npc.location,
      subLocation: sub,
    }
  }

  return {
    npcs: engine['dossier'].toListData(trustMap).map(n => ({
      ...n,
      condition: session.npcs.find(npc => npc.name === n.key)?.condition ?? 'normal',
    })),
    npcLocations,
    playerLocation: session.worldState.currentLocation,
    playerSubLocation: session.worldState.currentSubLocation,
  }
}
