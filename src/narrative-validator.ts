import type { GameSession } from './types.js'
import { changeTrust } from './trust-system.js'

export interface NarrativeWarning {
  category: 'trust' | 'damage' | 'item' | 'gold'
  description: string
  autoApplied?: boolean
}

export interface ToolCallRecord {
  toolName: string
}

// Find nearest NPC name within 40 chars of a match position
function findNearestNPC(text: string, matchIndex: number, session: GameSession): string | null {
  const start = Math.max(0, matchIndex - 40)
  const end = Math.min(text.length, matchIndex + 40)
  const window = text.substring(start, end)
  let closest: { name: string; dist: number } | null = null
  for (const npc of session.npcs) {
    const idx = window.indexOf(npc.name)
    if (idx >= 0) {
      const dist = Math.abs(idx - 40)
      if (!closest || dist < closest.dist) closest = { name: npc.name, dist }
    }
  }
  return closest?.name ?? null
}

export function validateNarrative(
  fullText: string,
  toolsCalled: ToolCallRecord[],
  session: GameSession,
): NarrativeWarning[] {
  const warnings: NarrativeWarning[] = []
  const toolNames = new Set(toolsCalled.map(t => t.toolName))

  // 1. Trust — auto-apply if DM didn't call ChangeTrust
  if (!toolNames.has('ChangeTrust')) {
    const trustPatterns = [
      /(?:信任|好感)\s*(?:增加|提升|上升|提高|好转)/,
      /(?:信任|好感)\s*(?:降低|下降|减少|恶化|变差)/,
      /\[信任变化[：:]([^\]]+)\]/,
      /对你的(?:好感|印象)\s*(?:大增|大减|好了|差了|变好|变差)/,
    ]
    for (const pattern of trustPatterns) {
      const match = fullText.match(pattern)
      if (match) {
        const isDecrease = /降低|下降|减少|恶化|变差|大减|差了/.test(match[0])
        const npcName = findNearestNPC(fullText, match.index ?? 0, session)
        if (npcName) {
          const npc = session.npcs.find(n => n.name === npcName)
          if (npc && npc.location === session.worldState.currentLocation) {
            const delta = isDecrease ? -1 : 1
            const result = changeTrust(session, {
              npcName, channel: 'dialogue', delta,
              reason: `[自动修正] 叙事描述信任${isDecrease ? '降低' : '提升'}`,
              turn: session.turnCount,
            })
            if (result.applied) {
              warnings.push({
                category: 'trust',
                description: `${npcName}信任${isDecrease ? '降低' : '提升'}（自动修正：${result.oldTrust}→${result.newTrust}）`,
                autoApplied: true,
              })
            }
          }
        }
        break
      }
    }
  }

  // 2. Damage — warn only (don't auto-apply)
  if (!toolNames.has('Attack') && !session.combat?.active) {
    const dmgPatterns = [
      /造成\s*(\d+)\s*点伤害/,
      /受到\s*(\d+)\s*点伤害/,
      /HP[：:]\s*\d+\s*[→/]\s*\d+/i,
    ]
    for (const p of dmgPatterns) {
      if (p.test(fullText)) {
        warnings.push({ category: 'damage', description: 'DM描述了伤害但未通过Attack工具执行，实际HP未变化' })
        break
      }
    }
  }

  // 3. Item — warn only
  if (!toolNames.has('TransferItem')) {
    const itemPatterns = [
      /获得了?[「""]([^」""]+)[」""]/,
      /给了你[「""]?([^」""，。]{2,15})/,
    ]
    for (const p of itemPatterns) {
      const m = fullText.match(p)
      if (m) {
        warnings.push({ category: 'item', description: `叙事描述获得"${m[1]?.trim()}"但未通过TransferItem执行` })
        break
      }
    }
  }

  // 4. Gold — warn only
  if (!toolNames.has('TransferItem')) {
    const goldPatterns = [/获得\s*(\d+)\s*金/, /支付\s*(\d+)\s*金/]
    for (const p of goldPatterns) {
      if (p.test(fullText)) {
        warnings.push({ category: 'gold', description: '叙事描述了金币变化但未通过工具执行' })
        break
      }
    }
  }

  return warnings
}
