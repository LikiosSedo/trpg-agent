/**
 * Lore System — 对外公开 API
 *
 * 使用方式:
 *
 *   import { getLoreStore, parseChapterNumber } from './lore/index.js'
 *
 *   const store = getLoreStore()
 *   const entries = store.list({ currentChapter: 2, type: 'character' })
 *   const greg = store.read({ query: '格雷格', currentChapter: 2 })
 *   const hits = store.grep({ query: '达里安', currentChapter: 3 })
 *
 * engine 每个 user turn 开始时应调用:
 *   getLoreStore().resetTurnCounter()
 */

export {
  LoreStore,
  getLoreStore,
  resetLoreStore,
  parseChapterNumber,
} from './lore-store.js'

export { parseFrontmatter, type ParsedFrontmatter } from './frontmatter.js'

export type {
  LoreType,
  LoreFrontmatter,
  LoreEntry,
  LoreSummary,
} from './types.js'
