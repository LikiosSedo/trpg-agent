/**
 * 🎵 音频切换工具 — DM 在关键剧情节点覆盖 BGM
 *
 * 日常 BGM 由代码根据位置/时间自动选择，DM 不需要管。
 * 仅在高冲击场景（BOSS战、揭秘、牺牲、凯旋等）调用此工具。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'

export interface AmbianceOverride {
  bgm?: string
  ambient?: string
  reason?: string
}

let pendingOverride: AmbianceOverride | null = null

export function consumeAmbianceOverride(): AmbianceOverride | null {
  const o = pendingOverride
  pendingOverride = null
  return o
}

export const SetAmbianceTool: Tool = {
  name: 'SetAmbiance',
  description: `切换背景音乐。仅在关键剧情节点使用，日常场景由系统自动管理。

可用 BGM（仅选以下之一）：
- boss-battle: BOSS级战斗
- tension: 揭示重大阴谋、教团真相
- sorrow: NPC死亡、重大牺牲、沉痛叙事（弦乐+钢琴长曲）
- revelation: 重大真相揭示、命运转折、史诗展开（管弦乐从沉寂渐强到壮烈）
- reflection: 章节回顾、往事回忆、凝望不可能的未来（RPG管弦乐）
- triumph: 章节通关、重大胜利
- mystery: 神秘遗迹、虚空棱镜相关
- danger: 即将遭遇伏击、陷入绝境
- peaceful: 温馨对话、NPC打开心扉

不要频繁调用。普通战斗、普通移动、普通对话不需要切换音乐。`,
  inputSchema: z.object({
    bgm: z.enum(['boss-battle', 'tension', 'sorrow', 'revelation', 'reflection', 'triumph', 'mystery', 'danger', 'peaceful'])
      .describe('要切换的 BGM'),
    reason: z.string().optional().describe('切换原因（日志用）'),
  }),
  isConcurrencySafe: true,
  isReadOnly: true,
  async execute(input: any) {
    pendingOverride = { bgm: input.bgm, reason: input.reason }
    return { output: `BGM 切换为 ${input.bgm}。${input.reason ? `原因：${input.reason}` : ''}` }
  },
}
