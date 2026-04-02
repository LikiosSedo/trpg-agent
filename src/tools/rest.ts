/**
 * 🏕️ 休息工具
 *
 * 短休息或长休息，恢复 HP 和法术位。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession, getFacts } from '../game-state.js'
import { shortRest, longRest } from '../rules-engine.js'

export const RestTool: Tool = {
  name: 'Rest',
  description: `在安全地点休息恢复。
- "short": 短休息。恢复部分 HP (掷生命骰 + CON 修正)
- "long": 长休息。恢复全部 HP + 全部法术位
只能在非战斗状态下使用。DM 判断当前位置是否足够安全。
长休息期间可能发生随机遭遇 (DM 掷骰决定)。`,
  inputSchema: z.object({
    type: z.enum(['short', 'long']).describe('"short" 短休息, "long" 长休息'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const player = session.player
    const oldHp = player.hp

    if (input.type === 'short') {
      shortRest(player)
      const healed = player.hp - oldHp
      facts.addEvent(`短休息，恢复${healed}HP`)
      return { output: `短休息完成。恢复${healed}HP(${oldHp}→${player.hp}/${player.maxHp})。` }
    }

    // Long rest
    longRest(player)
    const healed = player.hp - oldHp
    const spells = player.spells
      .filter(s => s.usesPerRest > 0)
      .map(s => `${s.name}(${s.remaining}/${s.usesPerRest})`)
    facts.addEvent(`长休息，完全恢复`, 'normal')
    return {
      output: [
        `长休息完成。HP完全恢复(${oldHp}→${player.hp}/${player.maxHp})。`,
        spells.length ? `法术位恢复：${spells.join('、')}。` : '',
      ].filter(Boolean).join('\n'),
    }
  },
}
