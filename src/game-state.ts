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

/** Replace the active session (used by web server to swap per-connection state). */
export function setSession(s: GameSession): void {
  session = s
  facts = new GameFactStore(s)
}

export function getFacts(): GameFactStore {
  if (!facts) throw new Error('Game not initialized — call initGameState first')
  return facts
}
