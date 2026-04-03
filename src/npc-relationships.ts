/**
 * NPC 性格与关系网 — 静态数据
 *
 * 定义每个 NPC 的信任阈值、战斗响应、关系纽带和永久仇恨触发条件。
 */

import type { TrustThresholds } from './types.js'

export interface NPCPersonality {
  thresholds: TrustThresholds
  canFight: boolean
  combatResponse: 'fight' | 'call_guards' | 'flee' | 'plot_revenge' | 'ban_from_location'
  bonds: Array<{ npcName: string; weight: number }>
  permanentGrudges: string[]
}

const DEFAULT_THRESHOLDS: TrustThresholds = {
  curt: -2, hostile: -5, avoidance: -6, combat: -8,
}

export const NPC_PERSONALITIES: Record<string, NPCPersonality> = {
  '格雷格': {
    thresholds: { ...DEFAULT_THRESHOLDS },
    canFight: true,
    combatResponse: 'fight',
    bonds: [
      { npcName: '小莉', weight: 2.0 },
      { npcName: '艾琳娜', weight: 0.5 },
    ],
    permanentGrudges: ['attack_小莉', 'harm_小莉'],
  },
  '小莉': {
    thresholds: { curt: -1, hostile: -3, avoidance: -3, combat: -10 },
    canFight: false,
    combatResponse: 'flee',
    bonds: [
      { npcName: '格雷格', weight: 1.5 },
    ],
    permanentGrudges: [],
  },
  '艾琳娜': {
    thresholds: { curt: -3, hostile: -5, avoidance: -7, combat: -9 },
    canFight: true,
    combatResponse: 'call_guards',
    bonds: [
      { npcName: '韩猛', weight: 1.0 },
      { npcName: '格雷格', weight: 0.5 },
    ],
    permanentGrudges: ['betray_guild'],
  },
  '维克多': {
    thresholds: { curt: -2, hostile: -5, avoidance: -6, combat: -10 },
    canFight: false,
    combatResponse: 'flee',
    bonds: [],
    permanentGrudges: [],
  },
  '卡恩': {
    thresholds: { curt: -10, hostile: -10, avoidance: -10, combat: -11 },
    canFight: false,
    combatResponse: 'plot_revenge',
    bonds: [],
    permanentGrudges: [],
  },
  '陈妈': {
    thresholds: { curt: -2, hostile: -4, avoidance: -6, combat: -8 },
    canFight: false,
    combatResponse: 'call_guards',
    bonds: [
      { npcName: '格雷格', weight: 0.5 },
    ],
    permanentGrudges: [],
  },
  '格罗姆': {
    thresholds: { curt: -1, hostile: -3, avoidance: -5, combat: -5 },
    canFight: true,
    combatResponse: 'fight',
    bonds: [],
    permanentGrudges: [],
  },
  '叶绿': {
    thresholds: { curt: -2, hostile: -4, avoidance: -5, combat: -9 },
    canFight: false,
    combatResponse: 'flee',
    bonds: [],
    permanentGrudges: [],
  },
  '韩猛': {
    thresholds: { curt: -2, hostile: -4, avoidance: -6, combat: -7 },
    canFight: true,
    combatResponse: 'fight',
    bonds: [
      { npcName: '艾琳娜', weight: 1.0 },
    ],
    permanentGrudges: [],
  },
}

export function getPersonality(npcName: string): NPCPersonality {
  return NPC_PERSONALITIES[npcName] ?? {
    thresholds: { ...DEFAULT_THRESHOLDS },
    canFight: false,
    combatResponse: 'flee' as const,
    bonds: [],
    permanentGrudges: [],
  }
}
