import type { GameSession } from './types.js'
import { GameFactStore } from './game-facts.js'

let session: GameSession | null = null
let facts: GameFactStore | null = null

export function initGameState(s: GameSession): void {
  session = s
  facts = new GameFactStore(s)
}

export function getSession(): GameSession {
  if (!session) throw new Error('Game not initialized — call initGameState first')
  return session
}

export function getFacts(): GameFactStore {
  if (!facts) throw new Error('Game not initialized — call initGameState first')
  return facts
}
