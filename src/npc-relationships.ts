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
  /**
   * 信任章节软上限：key=章节号(1-4)，value=该章节信任最高能到多少。
   * 超过上限后信任增长衰减为 1/3（四舍五入，最少+1→0）。
   * 设计原则：刚认识的人不可能一天交心，但做了重大事情（任务）仍可突破。
   */
  trustCeiling: Record<number, number>
  /**
   * 是否有跨区域追踪能力。
   * 只有战斗能力强且有追踪经验的 NPC 才能跨区域追踪玩家。
   * 追踪范围：地表区域（镇、森林、荒原）+ 矿道上层。
   * 不可追踪：矿道中层/下层（太危险，地形复杂）。
   */
  canTrack: boolean
}

const DEFAULT_THRESHOLDS: TrustThresholds = {
  curt: -2, hostile: -5, avoidance: -6, combat: -8,
}

export const NPC_PERSONALITIES: Record<string, NPCPersonality> = {
  // ── 格雷格：酒馆老板，温厚但封存过去 ──
  // Ch1 能成为熟客(4)，Ch2 可以成朋友(6)，Ch3 触及痛苦回忆后才能交心(8)
  '格雷格': {
    thresholds: { ...DEFAULT_THRESHOLDS },
    canFight: true,
    combatResponse: 'fight',
    bonds: [
      { npcName: '小莉', weight: 2.0 },
      { npcName: '艾琳娜', weight: 0.5 },
    ],
    permanentGrudges: ['attack_小莉', 'harm_小莉'],
    trustCeiling: { 1: 4, 2: 6, 3: 8, 4: 10 },
    canTrack: true,  // 前佣兵，有追踪经验
  },
  // ── 小莉：孩子，天真易信任，但也容易害怕 ──
  // 孩子对善意的人打开心扉很快，Ch1 就能到5
  '小莉': {
    thresholds: { curt: -1, hostile: -3, avoidance: -3, combat: -10 },
    canFight: false,
    combatResponse: 'flee',
    bonds: [
      { npcName: '格雷格', weight: 1.5 },
    ],
    permanentGrudges: [],
    trustCeiling: { 1: 5, 2: 7, 3: 9, 4: 10 },
    canTrack: false,  // 孩子，没有追踪能力
  },
  // ── 艾琳娜：公会长，职业化，用数据说话 ──
  // Ch1 保持职业距离(3)，需要看到你的能力和忠诚才会逐步开放
  '艾琳娜': {
    thresholds: { curt: -3, hostile: -5, avoidance: -7, combat: -9 },
    canFight: true,
    combatResponse: 'call_guards',
    bonds: [
      { npcName: '韩猛', weight: 1.0 },
      { npcName: '格雷格', weight: 0.5 },
      { npcName: '叶绿', weight: 1.5 },  // 同族半精灵，关系亲近
    ],
    permanentGrudges: ['betray_guild'],
    trustCeiling: { 1: 3, 2: 5, 3: 7, 4: 10 },
    canTrack: true,  // 高等精灵，感知敏锐，冒险者经验丰富
  },
  // ── 维克多：被胁迫的镇长，恐惧支配一切 ──
  // Ch1-2 几乎不可能打开心防，Ch3 绝望时才可能松口，Ch4 彻底崩溃
  '维克多': {
    thresholds: { curt: -2, hostile: -5, avoidance: -6, combat: -10 },
    canFight: false,
    combatResponse: 'flee',
    bonds: [],
    permanentGrudges: [],
    trustCeiling: { 1: 2, 2: 4, 3: 6, 4: 10 },
    canTrack: false,  // 文官，没有战斗和追踪能力
  },
  // ── 卡恩：教团卧底，极度伪装 ──
  // 表面友善但内心封闭，信任增长极慢且上限最低
  // 只有到了Ch4、掌握了足够证据，他才可能被逼到墙角
  '卡恩': {
    thresholds: { curt: -10, hostile: -10, avoidance: -10, combat: -11 },
    canFight: false,
    combatResponse: 'plot_revenge',
    bonds: [],
    permanentGrudges: [],
    trustCeiling: { 1: 3, 2: 4, 3: 6, 4: 10 },
    canTrack: true,  // 教团成员，有特殊能力（但不会轻易暴露）
  },
  // ── 陈妈：旅店大妈，八卦之王，最容易交心 ──
  // 天生健谈，Ch1 一碗热汤就能聊开(5)，但深层情报她自己也是慢慢发现的
  '陈妈': {
    thresholds: { curt: -2, hostile: -4, avoidance: -6, combat: -8 },
    canFight: false,
    combatResponse: 'call_guards',
    bonds: [
      { npcName: '格雷格', weight: 0.5 },
    ],
    permanentGrudges: [],
    trustCeiling: { 1: 5, 2: 7, 3: 9, 4: 10 },
    canTrack: false,  // 普通镇民，没有追踪能力
  },
  // ── 格罗姆：矮人铁匠，尊重行动不尊重嘴皮 ──
  // 需要用实际行动证明自己（买东西、帮忙、完成任务）才会认可你
  '格罗姆': {
    thresholds: { curt: -1, hostile: -3, avoidance: -5, combat: -5 },
    canFight: true,
    combatResponse: 'fight',
    bonds: [],
    permanentGrudges: [],
    trustCeiling: { 1: 4, 2: 6, 3: 8, 4: 10 },
    canTrack: false,  // 矮人铁匠，不会离开铺子追踪
  },
  // ── 叶绿：草药师，温和但心事重重 ──
  // 对客人友善(4)，但助手的事让她越来越焦虑，Ch2 后才开始向人倾诉
  '叶绿': {
    thresholds: { curt: -2, hostile: -4, avoidance: -5, combat: -9 },
    canFight: false,
    combatResponse: 'flee',
    bonds: [
      { npcName: '艾琳娜', weight: 1.5 },  // 同族半精灵，关系亲近
    ],
    permanentGrudges: [],
    trustCeiling: { 1: 4, 2: 6, 3: 8, 4: 10 },
    canTrack: false,  // 草药师，没有战斗和追踪能力
  },
  // ── 韩猛：公会军官，纪律严明，忠于艾琳娜 ──
  // 跟着艾琳娜的节奏开放，但作为军人更看重行动
  '韩猛': {
    thresholds: { curt: -2, hostile: -4, avoidance: -6, combat: -7 },
    canFight: true,
    combatResponse: 'fight',
    bonds: [
      { npcName: '艾琳娜', weight: 1.0 },
    ],
    permanentGrudges: [],
    trustCeiling: { 1: 4, 2: 6, 3: 8, 4: 10 },
    canTrack: true,  // 退役战士，追踪专家
  },
}

export function getPersonality(npcName: string): NPCPersonality {
  return NPC_PERSONALITIES[npcName] ?? {
    thresholds: { ...DEFAULT_THRESHOLDS },
    canFight: false,
    combatResponse: 'flee' as const,
    bonds: [],
    permanentGrudges: [],
    trustCeiling: { 1: 4, 2: 6, 3: 8, 4: 10 },
    canTrack: false,
  }
}
