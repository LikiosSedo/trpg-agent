/**
 * NPC 移动能力验证
 */
import type { NPC, GameSession } from './types.js'
import { locations } from './data/maps.js'

/** 获取 NPC 当前子地点（fallback to homeBase） */
export function getNPCSubLocation(npc: NPC): string {
  return npc.subLocation ?? npc.homeBase ?? ''
}

/** 获取玩家当前子地点（fallback to area default） */
export function getPlayerSubLocation(session: GameSession): string {
  if (session.worldState.currentSubLocation) return session.worldState.currentSubLocation
  return getDefaultSubLocation(session.worldState.currentLocation)
}

/** 获取区域的默认入口子地点 */
export function getDefaultSubLocation(areaId: string): string {
  const loc = locations[areaId]
  if (!loc) return ''
  const def = loc.pointsOfInterest.find((p: any) => p.isDefault)
  return def?.id ?? loc.pointsOfInterest[0]?.id ?? ''
}

/** 查找子地点所属区域 */
export function findSubLocationArea(poiId: string): string | null {
  for (const [areaId, loc] of Object.entries(locations)) {
    if (loc.pointsOfInterest.some(p => p.id === poiId)) return areaId
  }
  return null
}

/** 检查子地点是否在指定区域内 */
export function isSubLocationInArea(poiId: string, areaId: string): boolean {
  const loc = locations[areaId]
  return loc?.pointsOfInterest.some(p => p.id === poiId) ?? false
}

/** 获取子地点的中文名 */
export function getSubLocationName(poiId: string): string {
  for (const loc of Object.values(locations)) {
    const poi = loc.pointsOfInterest.find(p => p.id === poiId)
    if (poi) return poi.nameZh
  }
  return poiId
}

/** 验证 NPC 是否可以移动到目标子地点 */
export function canNPCMoveTo(
  npc: NPC, targetPoiId: string, session: GameSession
): { allowed: boolean; reason?: string } {
  const mobility = npc.mobility ?? 'local'

  if (mobility === 'stationary') {
    return { allowed: false, reason: `${npc.name}不会离开${getSubLocationName(npc.homeBase ?? '')}` }
  }

  const targetArea = findSubLocationArea(targetPoiId)
  if (!targetArea) {
    return { allowed: false, reason: `未知地点: ${targetPoiId}` }
  }

  if (mobility === 'local') {
    if (targetArea !== npc.location) {
      return { allowed: false, reason: `${npc.name}不会离开${npc.location}区域` }
    }
    return { allowed: true }
  }

  // roaming: can go anywhere
  return { allowed: true }
}

/** 执行 NPC 移动 */
export function moveNPC(
  npc: NPC, targetPoiId: string, session: GameSession
): { success: boolean; reason?: string } {
  const check = canNPCMoveTo(npc, targetPoiId, session)
  if (!check.allowed) return { success: false, reason: check.reason }

  const targetArea = findSubLocationArea(targetPoiId)
  if (targetArea && targetArea !== npc.location) {
    npc.location = targetArea
  }
  npc.subLocation = targetPoiId
  return { success: true }
}
