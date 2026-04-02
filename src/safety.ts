/**
 * 安全检测 — 判断玩家输入是否越界
 *
 * 三级响应:
 * - pass: 正常继续
 * - warn: 游戏内后果（NPC 生气、被卫兵抓等）
 * - block: 强制终止游戏
 */

export type SafetyLevel = 'pass' | 'warn' | 'block'

export interface SafetyResult {
  level: SafetyLevel
  reason?: string
  dmInstruction?: string  // 注入给 DM 的指令
}

// 直接阻断的关键词（现实犯罪、极端暴力等）
const BLOCK_PATTERNS = [
  /制造.*炸弹/i,
  /怎么.*杀.*真人/i,
  /儿童.*色情/i,
  /child.*porn/i,
  /how.*to.*make.*bomb/i,
  /real.*world.*violence/i,
  /doxx/i,
  /swat/i,
]

// 警告级别（游戏内可以有后果的不当行为）
const WARN_PATTERNS = [
  { pattern: /杀.*无辜|屠.*平民|灭.*村/, instruction: '玩家试图伤害无辜平民。作为DM，让卫兵立即出现制止，NPC好感度大幅下降。如果玩家坚持，让更强的NPC（如艾琳娜）介入。' },
  { pattern: /偷.*NPC|抢.*商店|打劫/, instruction: '玩家试图偷窃/抢劫。进行一个高DC的检定(DC16)。失败则被抓住，需要付罚金或被关押。NPC信任度-3。' },
  { pattern: /攻击.*格雷格|攻击.*艾琳娜|攻击.*小莉/, instruction: '玩家试图攻击重要NPC。这个NPC远比玩家强大。让NPC轻松制服玩家，并严正警告。信任度归零。' },
  { pattern: /自杀|自我伤害/, instruction: '玩家提到自我伤害。以温和的方式化解，让NPC表达关心。不要模拟自我伤害场景。' },
]

export function checkSafety(input: string): SafetyResult {
  // Level 1: 直接阻断
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(input)) {
      return {
        level: 'block',
        reason: '检测到违规内容，游戏终止。',
      }
    }
  }

  // Level 2: 游戏内后果
  for (const { pattern, instruction } of WARN_PATTERNS) {
    if (pattern.test(input)) {
      return {
        level: 'warn',
        dmInstruction: instruction,
      }
    }
  }

  // Level 3: 正常
  return { level: 'pass' }
}
