import type { GameSession } from './types.js'
import { GameFactStore } from './game-facts.js'
import { ItemRegistry } from './item-registry.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

let session: GameSession | null = null
let facts: GameFactStore | null = null
let registry: ItemRegistry | null = null

export function initGameState(s: GameSession): void {
  session = s
  facts = new GameFactStore(s)
}

export function getSession(): GameSession {
  if (!session) throw new Error('Game not initialized — call initGameState first')
  return session
}

/** Replace the active session (used by web server to swap per-connection state). */
export function setSession(s: GameSession): void {
  session = s
  facts = new GameFactStore(s)
}

export function getFacts(): GameFactStore {
  if (!facts) throw new Error('Game not initialized — call initGameState first')
  return facts
}

export function initItemRegistry(): void {
  registry = new ItemRegistry()
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const dataDir = join(__dirname, '..', 'data')
  const equipment = JSON.parse(readFileSync(join(dataDir, 'equipment.json'), 'utf-8'))
  const loot = JSON.parse(readFileSync(join(dataDir, 'loot-items.json'), 'utf-8'))
  registry.load(equipment, loot)
}

export function getRegistry(): ItemRegistry {
  if (!registry) throw new Error('ItemRegistry not initialized — call initItemRegistry() first')
  return registry
}

// ─── 时间推进 ──────────────────────────────

const TIME_ORDER: Array<'morning' | 'afternoon' | 'evening' | 'night'> = [
  'morning', 'afternoon', 'evening', 'night',
]

/** 推进一个时段。移动（区域间）和休息时调用。 */
export function advanceTime(): string {
  const s = getSession()
  const cur = TIME_ORDER.indexOf(s.worldState.timeOfDay)
  const next = TIME_ORDER[(cur + 1) % TIME_ORDER.length]
  s.worldState.timeOfDay = next
  const names: Record<string, string> = { morning: '清晨', afternoon: '下午', evening: '黄昏', night: '深夜' }
  return names[next]
}
