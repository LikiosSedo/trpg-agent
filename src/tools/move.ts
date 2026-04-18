/**
 * 🚶 移动工具
 *
 * 在地点之间移动，或在战斗中移动位置。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import { locations, connections, isPoiDiscovered } from '../data/maps.js'
import { getSession, getFacts, advanceTime } from '../game-state.js'
import { ChapterManager } from '../chapter-manager.js'
import { findSubLocationArea, moveNPC } from '../npc-mobility.js'
import { evaluateResponse } from '../trust-system.js'

export const MoveTool: Tool = {
  name: 'Move',
  description: `移动玩家到指定地点或战斗格。
- 探索模式: 在相连的 Location 之间移动
- 战斗模式: 在战斗网格上移动 (最多 30ft / 6 格)
移动时会触发地点描述更新。如果目标地点有危险，可能触发检定。`,
  inputSchema: z.object({
    destination: z.string().describe('目标地点 ID 或方向 ("north", "south", "east", "west", 或具体地点名)'),
    mode: z.enum(['explore', 'combat']).describe('"explore" 地点间移动, "combat" 战斗中移动'),
    combatPosition: z.object({
      x: z.number(),
      y: z.number(),
    }).optional().describe('战斗模式下的目标坐标'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const { destination, mode } = input
    const current = session.worldState.currentLocation

    if (mode === 'combat') {
      return { output: `战斗移动：玩家移至坐标(${input.combatPosition?.x ?? '?'},${input.combatPosition?.y ?? '?'})。` }
    }

    // Check if destination is an area (精确 → 模糊匹配中文名)
    let destKey = destination
    let destArea = locations[destination]
    if (!destArea) {
      const entry = Object.entries(locations).find(
        ([, v]: [string, any]) => v.nameZh === destination || destination.includes(v.nameZh) || v.nameZh.includes(destination)
      )
      if (entry) { destKey = entry[0]; destArea = entry[1] }
    }

    if (destArea) {
      // ── Inter-area movement ──
      const conn = connections.find(
        c => (c.from === current && c.to === destKey) ||
             (c.to === current && c.from === destKey),
      )
      if (!conn) {
        const loc = locations[current]
        const available = connections
          .filter(c => c.from === current || c.to === current)
          .map(c => c.from === current ? c.to : c.from)
        return {
          output: `无法从${loc?.nameZh ?? current}到达${destArea.nameZh}。可前往：${available.join(', ') || '无'}。`,
          isError: true,
        }
      }

      session.worldState.currentLocation = destKey
      // 记录进入区域时间（用于剧情保底遭遇计时）
      session.worldState.flags[`area_entry_turn_${destKey}`] = session.turnCount
      // Set sub-location to area's default entrance
      const defaultPoi = destArea.pointsOfInterest.find((p: any) => p.isDefault)
      session.worldState.currentSubLocation = defaultPoi?.id ?? destArea.pointsOfInterest[0]?.id
      // 区域间移动推进时间 & 重置累积
      const newTime = advanceTime()
      session.timeAccum = 0
      facts.addEvent(`移动至${destArea.nameZh}（现在是${newTime}）`)

      // 通知章节系统
      if (session.chapter) {
        new ChapterManager(session).onEvent('arrive', destKey)
      }

      const npcsHere = session.npcs.filter(n => n.location === destKey &&
        (!n.subLocation || n.subLocation === session.worldState.currentSubLocation))
        .map(n => n.name)

      // NPC 回避检查：低信任 NPC 在玩家到达时离开
      const avoidingNpcs: string[] = []
      for (const npcName of npcsHere) {
        const avoidNpc = session.npcs.find(n => n.name === npcName)
        if (avoidNpc && avoidNpc.condition !== 'unconscious' && avoidNpc.condition !== 'recovering') {
          const resp = evaluateResponse(avoidNpc)
          if (resp.type === 'avoidance' && resp.moveAway) {
            // 如果 homeBase 就是玩家当前位置，逃到广场
            const dest = (avoidNpc.homeBase === session.worldState.currentSubLocation)
              ? 'town-square'
              : (avoidNpc.homeBase ?? 'town-square')
            moveNPC(avoidNpc, dest, session)
            avoidingNpcs.push(npcName)
          }
        }
      }
      const remainingNpcs = npcsHere.filter(n => !avoidingNpcs.includes(n))
      const avoidMsg = avoidingNpcs.length
        ? `${avoidingNpcs.join('、')}看到你后匆匆离开了。` : ''

      const subLocs = destArea.pointsOfInterest
        .filter((p: any) => isPoiDiscovered(session, p) && p.id !== session.worldState.currentSubLocation)
        .map((p: any) => p.nameZh)

      // 区域遭遇检测（有冷却机制防止连续战斗）
      let encounterWarning = ''
      const encounterCooldownKey = `encounter_cooldown_${destKey}`
      const lastEncounterTurn = Number(session.worldState.flags[encounterCooldownKey] ?? 0)
      const cooldownTurns = 3  // 战斗后 3 轮内不再触发遭遇
      const onCooldown = session.turnCount - lastEncounterTurn < cooldownTurns

      if (destArea.monsterPool.length > 0 && destArea.dangerLevel !== 'safe' && !onCooldown) {
        const threshold = 0.3
        if (Math.random() < threshold) {
          const pool = destArea.monsterPool
          const count = Math.random() < 0.4 ? 2 : 1
          const picked: string[] = []
          for (let i = 0; i < count; i++) {
            picked.push(pool[Math.floor(Math.random() * pool.length)])
          }
          encounterWarning = `[遭遇] 你在前进途中遭遇了${picked.join('和')}！系统将自动触发战斗。`
          session.worldState.flags['pending_encounter'] = picked.join(',')
          session.worldState.flags[encounterCooldownKey] = session.turnCount
        }
      }

      return {
        output: [
          `移动：${locations[current]?.nameZh ?? current} → ${destArea.nameZh}。${conn.description}`,
          defaultPoi?.arrivalText ?? `你来到了${destArea.nameZh}。`,
          remainingNpcs.length ? `你看到了：${remainingNpcs.join('、')}。` : '',
          avoidMsg,
          subLocs.length ? `可前往：${subLocs.join('、')}。` : '',
          encounterWarning,
        ].filter(Boolean).join('\n'),
      }
    }

    // ── Intra-area movement ──
    const currentArea = locations[current]
    if (!currentArea) return { output: `当前位置未知`, isError: true }

    // Find the POI in current area (精确匹配 → 模糊匹配)
    const dest = destination.toLowerCase()
    const targetPoi = currentArea.pointsOfInterest.find(
      (p: any) => p.id === destination || p.nameZh === destination || p.name === destination
    ) ?? currentArea.pointsOfInterest.find(
      (p: any) => dest.includes(p.nameZh) || dest.includes(p.id) || p.nameZh.includes(dest)
    )

    if (targetPoi) {
      if (!isPoiDiscovered(session, targetPoi)) {
        return { output: `你还没有发现这个地方。`, isError: true }
      }

      session.worldState.currentSubLocation = targetPoi.id
      facts.addEvent(`前往${targetPoi.nameZh}`)

      // 通知章节系统
      if (session.chapter) {
        new ChapterManager(session).onEvent('arrive', targetPoi.id)
      }

      // NPCs at this sub-location
      const npcsHere = session.npcs
        .filter(n => n.location === current &&
          (n.subLocation ?? n.homeBase) === targetPoi.id)
        .map(n => n.name)

      // NPC 回避检查：低信任 NPC 在玩家到达时离开
      const avoidingNpcs: string[] = []
      for (const npcName of npcsHere) {
        const avoidNpc = session.npcs.find(n => n.name === npcName)
        if (avoidNpc && avoidNpc.condition !== 'unconscious' && avoidNpc.condition !== 'recovering') {
          const resp = evaluateResponse(avoidNpc)
          if (resp.type === 'avoidance' && resp.moveAway) {
            // 如果 homeBase 就是玩家当前位置，逃到广场
            const dest = (avoidNpc.homeBase === session.worldState.currentSubLocation)
              ? 'town-square'
              : (avoidNpc.homeBase ?? 'town-square')
            moveNPC(avoidNpc, dest, session)
            avoidingNpcs.push(npcName)
          }
        }
      }
      const remainingNpcs = npcsHere.filter(n => !avoidingNpcs.includes(n))
      const avoidMsg = avoidingNpcs.length
        ? `${avoidingNpcs.join('、')}看到你后匆匆离开了。` : ''

      // 危险区域内移动遭遇（20%，共享冷却）
      let encounterWarning = ''
      {
        const cooldownKey = `encounter_cooldown_${current}`
        const lastTurn = Number(session.worldState.flags[cooldownKey] ?? 0)
        const onCooldown = session.turnCount - lastTurn < 3
        const area = locations[current]
        if (area && area.monsterPool.length > 0 && area.dangerLevel !== 'safe' && !onCooldown) {
          if (Math.random() < 0.2) {
            const pool = area.monsterPool
            const count = Math.random() < 0.3 ? 2 : 1
            const picked: string[] = []
            for (let i = 0; i < count; i++) {
              picked.push(pool[Math.floor(Math.random() * pool.length)])
            }
            encounterWarning = `[遭遇] 你在途中遭遇了${picked.join('和')}！`
            session.worldState.flags['pending_encounter'] = picked.join(',')
            session.worldState.flags[cooldownKey] = session.turnCount
          }
        }
      }

      return {
        output: [
          targetPoi.arrivalText ?? `你来到了${targetPoi.nameZh}。`,
          targetPoi.description,
          remainingNpcs.length ? `这里有：${remainingNpcs.join('、')}。` : '',
          avoidMsg,
          encounterWarning,
        ].filter(Boolean).join('\n'),
      }
    }

    // ── Check if it's a POI in a different area ──
    const otherArea = findSubLocationArea(destination)
    if (otherArea) {
      const areaName = locations[otherArea]?.nameZh ?? otherArea
      return { output: `${destination}在${areaName}，你需要先前往那个区域。`, isError: true }
    }

    // ── Nothing matched — 目的地不在地图注册表中 ──
    const available = currentArea.pointsOfInterest
      .filter((p: any) => isPoiDiscovered(session, p))
      .map((p: any) => `${p.nameZh}(${p.id})`)
    const areaConnections = connections
      .filter(c => c.from === current || c.to === current)
      .map(c => c.from === current ? c.to : c.from)
    return {
      output: `无法前往"${destination}"。\n区域内可去：${available.join('、') || '无'}\n其他区域：${areaConnections.join('、') || '无'}`,
      isError: true,
      unknownDestination: true,
    }
  },
}
