# GameEngine Extraction: Design Document


## Executive Summary

The TRPG codebase currently duplicates game logic across two entry points: `src/main.ts` (CLI/readline) and `src/server.ts` (Express/WebSocket). Both files independently manage character creation, the game loop, slash commands, DM communication, NPC dossier updates, quest checking, chapter advancement, auto-saving, and death detection. This document specifies how to extract a `GameEngine` class that encapsulates all shared game logic, leaving each entry point as a thin adapter responsible only for I/O transport and rendering.

---

## 1. Current Architecture Inventory

### 1.1 Line-by-Line Breakdown of `main.ts` (593 lines)

| Lines | Responsibility | Category |
|-------|---------------|----------|
| 1-26 | Imports | Adapter (CLI-specific imports like `readline`, `chalk`) |
| 28 | `let dossier = new DossierManager()` | **Global state** -- should be engine-owned |
| 34-40 | `createRL()`, `ask()` readline helpers | Adapter-only |
| 44-251 | `handleSlashCommand()` -- 12 commands | **Duplicated logic** with different rendering |
| 256-267 | `showSplash()` -- ASCII art | Adapter-only |
| 271-297 | `characterCreation()` -- interactive prompts | Adapter-only (I/O), but character data creation is engine |
| 301-533 | `gameLoop()` -- THE game loop | **Core engine logic** wrapped in CLI I/O |
| 303-304 | Get session/facts from global state | Engine |
| 307-326 | Opening scene DM prompt construction | Engine |
| 329-335 | Opening NPC unlock check | Engine |
| 339-340 | Turn counter, action state | Engine |
| 342-532 | Main while loop: input dispatch | Mix of adapter (readline) and engine (game logic) |
| 357-360 | `/quit` -- save and exit | Engine (save) + Adapter (break) |
| 364-417 | `/load` -- full load logic with migration | Engine |
| 419-429 | Slash command dispatch | Engine (logic) + Adapter (rendering) |
| 432-438 | Safety check | Engine |
| 440-449 | Turn increment + broken promises check | Engine |
| 452-471 | Build DM input (safety + guidance + idle + player text) | Engine |
| 474-482 | Consume actions, display suggestions | Engine (consume) + Adapter (display) |
| 485-492 | Quest objective check post-combat | Engine |
| 495-505 | NPC dossier update on mention | Engine |
| 508-510 | Chapter advance turn | Engine |
| 512-519 | Auto-save every 5 turns | Engine |
| 521-530 | Death check | Engine |
| 541-556 | `sendToDM()` -- stream DM response, print to stdout | Engine (streaming) + Adapter (stdout.write) |
| 560-592 | `main()` -- orchestrate creation + init + loop | Adapter |

### 1.2 Line-by-Line Breakdown of `server.ts` (810 lines)

| Lines | Responsibility | Category |
|-------|---------------|----------|
| 1-29 | Imports | Adapter (Express, WebSocket) |
| 33-36 | `stripAnsi()` | Adapter-only |
| 41-64 | `migrateSession()` | **Duplicated** (same logic as main.ts lines 383-403) |
| 67-118 | `buildResumeRecap()` | Engine (web-only feature, but pure data) |
| 121-149 | `buildFallbackActions()` | Engine (generates fallback actions from state) |
| 151-227 | Express app, password auth, static files | Adapter-only |
| 229-763 | WebSocket `connection` handler | Mix |
| 243-253 | Per-connection state (dossier, connSession, flags) | Should be engine-owned |
| 249-253 | `send()`, `sysMsg()` helpers | Adapter |
| 256-279 | `sendToDM()` -- stream DM, send via WS | Engine + Adapter |
| 299-319 | `resume` handler -- restore session | Engine |
| 323-368 | `create` handler -- new game | Engine + Adapter |
| 371-750 | `input` handler -- game commands | **Duplicated** with main.ts |
| 383-423 | `/status` -- structured data (not chalk) | Same logic, different output format |
| 425-458 | `/quest` -- structured data | Same logic, different output format |
| 460-493 | `/save`, `/load`, `/saves` | Same logic, WS messages instead of console |
| 494-518 | `/map` -- structured data | Same logic, different output format |
| 520-538 | `/npc` -- structured data | Same logic, different output format |
| 539-608 | `/world`, `/inventory`, `/shop`, `/recap`, `/chapter`, `/help` | Same logic |
| 644-749 | Core game turn (safety, DM call, combat, quest, NPC, chapter, save) | **Nearly identical** to main.ts |
| 766-798 | `renderPrologueText()`, `renderWorldGuideText()` | Adapter (text versions) |
| 800-809 | Server startup | Adapter |

### 1.3 Classification Summary

**Identical logic that MUST be in the engine (currently duplicated):**
- Session migration (`migrateSession` in server.ts, inline in main.ts `/load`)
- DM input construction (safety + guidance + idle + player text)
- Opening prompt construction
- Turn processing pipeline: increment turn -> check broken promises -> build DM input -> call DM -> consume actions -> check quest objectives -> update NPC dossier -> advance chapter -> auto-save -> death check
- All slash command DATA computation (status, quest, map, inventory, shop, npc list, chapter, recap, saves list)
- Save/load logic
- NPC dossier unlock/interaction detection

**Different but equivalent (same data, different rendering):**
- `/status`: CLI prints with chalk; Web sends structured JSON panel
- `/quest`: CLI prints with chalk bars; Web sends structured JSON
- `/map`: CLI prints WORLD_OVERVIEW + chalk; Web sends location objects
- All other slash commands follow the same pattern

**Truly adapter-specific (stays in adapter):**
- CLI: readline, chalk rendering, `process.stdout.write`, splash screen, character creation prompts
- Web: Express server, WebSocket handling, password auth, `send()` helper, resume/reconnect protocol, `sync` messages to localStorage, `dm_end` with combat state, `combat_monster`/`combat_status` events, fallback actions

---

## 2. GameEngine API

### 2.1 Core Types

```typescript
// ─── Command Results ─────────────────────────────

/** Base for all command results */
interface CommandResultBase {
  type: string
}

/** Structured data for slash commands -- adapter decides how to render */
interface StatusResult extends CommandResultBase {
  type: 'status'
  data: {
    name: string; level: number; hp: number; maxHp: number
    gold: number; xp: number; nextLevelXp: number | null
    abilities: Record<string, { value: number; mod: number }>
    equipped: {
      weapon: { name: string; attackMod: number; damage: string } | null
      armor: { name: string; ac: number } | null
    }
    spells: Array<{ name: string; desc: string; remaining: number; max: number; isCantrip: boolean }>
    skills: string[]
    actions: string[]
  }
}

interface QuestResult extends CommandResultBase {
  type: 'quest'
  data: {
    active: Array<{
      name: string; desc: string
      objectives: Array<{ text: string; done: boolean; progress?: { current: number; required: number } }>
      reward: { gold: number; xp: number }
    }>
    completed: string[]
    xp: number; level: number; nextLevelXp: number | null
  }
}

interface MapResult extends CommandResultBase {
  type: 'map'
  data: {
    currentLocation: string
    locations: Array<{ id: string; nameZh: string; danger: number; description: string }>
    currentSubLocation?: string
    subLocations: Array<{
      id: string; nameZh: string; description: string
      isCurrent: boolean; npcs: string[]
    }>
    worldOverview: string
  }
}

interface InventoryResult extends CommandResultBase {
  type: 'inventory'
  data: {
    weapon: { name: string; desc: string } | null
    armor: { name: string; desc: string } | null
    items: Array<{ name: string; type: string; desc: string }>
    gold: number
  }
}

interface ShopResult extends CommandResultBase {
  type: 'shop'
  data: {
    npcName: string
    playerGold: number
    items: Array<{ name: string; type: string; description: string; bonus?: number; price: number }>
  } | null  // null = no shop nearby
}

interface NpcListResult extends CommandResultBase {
  type: 'npc_list'
  data: { npcs: Array<{ name: string; portrait: string[]; summary: string; trust: number }> }
}

interface NpcDetailResult extends CommandResultBase {
  type: 'npc_detail'
  data: {
    name: string; portrait: string[]; layers: Array<{ label: string; text: string }>
    trust: number
  } | null  // null = not found
}

interface SavesResult extends CommandResultBase {
  type: 'saves'
  data: { saves: Array<{ file: string; name: string; turn: number; date: string }> }
}

interface SaveResult extends CommandResultBase {
  type: 'save'
  path: string
}

interface LoadResult extends CommandResultBase {
  type: 'load'
  success: boolean
  message: string
}

interface RecapResult extends CommandResultBase {
  type: 'recap'
  data: {
    critical: Array<{ turn: number; fact: string }>
    recent: Array<{ turn: number; fact: string }>
    clues: string[]
    npcDialogues: Array<{ name: string; logs: string[] }>
    quests: { active: string[]; completed: string[] }
  }
}

interface ChapterResult extends CommandResultBase {
  type: 'chapter'
  data: {
    title: string
    exploration: Record<string, { found: number; total: number }>
    discoveries: string[]
  } | null  // null = chapter system not active
}

interface HelpResult extends CommandResultBase {
  type: 'help'
  data: { commands: Array<{ cmd: string; desc: string }> }
}

interface WorldGuideResult extends CommandResultBase {
  type: 'world'
  data: { text: string }
}

interface QuitResult extends CommandResultBase {
  type: 'quit'
  savePath: string
}

interface ErrorResult extends CommandResultBase {
  type: 'error'
  message: string
}

type SlashCommandResult =
  | StatusResult | QuestResult | MapResult | InventoryResult
  | ShopResult | NpcListResult | NpcDetailResult | SavesResult
  | SaveResult | LoadResult | RecapResult | ChapterResult
  | HelpResult | WorldGuideResult | QuitResult | ErrorResult

// ─── Turn Processing Events ─────────────────────

/** Events emitted during a game turn, in order */
type TurnEvent =
  | { type: 'broken_promise'; npcName: string; reason: string }
  | { type: 'safety_block'; reason: string }
  | { type: 'dm_text_delta'; text: string }
  | { type: 'dm_end'; combat: boolean; pendingMonster: boolean; actions: SceneActions }
  | { type: 'dm_error'; message: string }
  | { type: 'combat_monster'; text: string }
  | { type: 'combat_status'; text: string; ended: boolean; result?: 'victory' | 'defeat' | 'fled' }
  | { type: 'quest_completed'; questName: string; text: string }
  | { type: 'quest_progress'; questName: string; text: string; current?: number; required?: number }
  | { type: 'npc_unlock'; npcName: string }
  | { type: 'npc_update'; text: string }
  | { type: 'auto_save'; path?: string }
  | { type: 'death' }
  | { type: 'detail_match'; content: string }

// ─── Initialization ─────────────────────────────

interface CharacterSpec {
  name: string
  classId: string  // 'fighter' | 'mage' | 'ranger' | 'cleric'
}

interface NewGameResult {
  session: GameSession
  classNameZh: string
  openingPrompt: string
}

interface ResumeOptions {
  session: GameSession
  dossierData?: Record<string, any>
  dmMessages?: any[]
}
```

### 2.2 GameEngine Class

```typescript
class GameEngine {
  // ─── Lifecycle ────────────────────────────────

  /**
   * Create a new game. Initializes all internal state.
   * Does NOT call the DM yet (adapter controls when to stream the opening).
   */
  createGame(spec: CharacterSpec): NewGameResult

  /**
   * Resume a saved game (from file or from client-provided data).
   * Handles migration of old save formats.
   */
  resumeGame(options: ResumeOptions): void

  /**
   * Load a saved game from disk by slot name.
   * Throws on failure.
   */
  loadGame(slotName: string): void

  // ─── Slash Commands ───────────────────────────

  /**
   * Execute a slash command. Returns structured data.
   * The adapter is responsible for rendering.
   * Returns null if the command is not recognized.
   */
  executeCommand(input: string): SlashCommandResult | null

  // ─── Game Turn ────────────────────────────────

  /**
   * Process a player's narrative input (non-slash-command).
   * Returns an AsyncGenerator that yields TurnEvents.
   * The adapter consumes these events and renders them.
   *
   * This is the complete turn pipeline:
   * 1. Safety check
   * 2. Increment turn
   * 3. Check broken promises
   * 4. Build DM input (safety + guidance + idle + player text)
   * 5. Stream DM response (yields dm_text_delta events)
   * 6. Consume actions (yields dm_end)
   * 7. Execute monster phase if pending (yields combat events)
   * 8. Check quest objectives (yields quest events)
   * 9. Update NPC dossier (yields npc events)
   * 10. Advance chapter
   * 11. Auto-save if needed
   * 12. Death check
   */
  processTurn(input: string, options?: { resumeRecap?: boolean }): AsyncGenerator<TurnEvent>

  /**
   * Stream the opening DM narration for a new game.
   * Yields TurnEvents (dm_text_delta, dm_end, npc_unlock).
   */
  streamOpening(): AsyncGenerator<TurnEvent>

  /**
   * Check if a player input matches a detail expansion from the last SetActions.
   * Returns the detail content if matched, null otherwise.
   */
  checkDetailMatch(input: string): string | null

  // ─── State Access (read-only for adapters) ────

  /** Current session snapshot */
  getSession(): Readonly<GameSession>

  /** Dossier data for persistence */
  getDossierData(): Record<string, any>

  /** DM message history for persistence */
  getDMMessages(): any[]

  /** Whether a game is currently active */
  isGameActive(): boolean

  /** Save current game state to disk */
  save(slotName?: string): string

  /** List all available saves */
  static listSaves(): Array<{ file: string; name: string; turn: number; date: string }>

  /** Build resume recap text for reconnection */
  buildResumeRecap(): string
}
```

### 2.3 How Streaming Works

The `processTurn` method returns an `AsyncGenerator<TurnEvent>`. This is the critical design decision:

```typescript
// CLI adapter usage:
for await (const event of engine.processTurn(input)) {
  switch (event.type) {
    case 'dm_text_delta':
      process.stdout.write(event.text)
      break
    case 'dm_end':
      console.log()
      // display actions with chalk
      break
    case 'quest_completed':
      console.log(chalk.green(`\n  [任务完成] ${event.questName}`))
      break
    // ... etc
  }
}

// Web adapter usage:
for await (const event of engine.processTurn(input)) {
  switch (event.type) {
    case 'dm_text_delta':
      ws.send(JSON.stringify({ type: 'dm', text: event.text }))
      break
    case 'dm_end':
      ws.send(JSON.stringify({ type: 'dm_end', ...event }))
      break
    case 'quest_completed':
      ws.send(JSON.stringify({ type: 'system', text: `✓ ${event.questName}` }))
      break
    // ... etc
  }
}
```

The `AsyncGenerator` approach means:
- DM streaming is transparently forwarded (each `text_delta` from the DM agent becomes a `TurnEvent`)
- Post-DM processing events (combat, quests, NPC updates) are yielded after the DM stream completes
- The adapter never needs to know about the internal pipeline ordering
- Error handling is natural (try/catch around the for-await loop)

---

## 3. Global State Problem

### 3.1 Inventory of All Global Mutable State

| Location | Variable | Type | Scope |
|----------|----------|------|-------|
| `game-state.ts:8` | `session` | `GameSession \| null` | Entire codebase via `getSession()` |
| `game-state.ts:9` | `facts` | `GameFactStore \| null` | Entire codebase via `getFacts()` |
| `game-state.ts:10` | `registry` | `ItemRegistry \| null` | Tools via `getRegistry()` |
| `dm-agent.ts:50` | `agent` | `Agent \| null` | DM communication via `getDMAgent()` |
| `set-actions.ts:18` | `pendingActions` | `SceneActions \| null` | Written by SetActions tool, consumed by main/server |
| `events.ts:82` | `idleCount` | `number` | Idle detection |
| `events.ts:83` | `eventIndex` | `Record<string, number>` | Idle event cycling |
| `main.ts:28` | `dossier` | `DossierManager` | NPC profiles (CLI only) |
| `server.ts:243` | `dossier` (per-connection) | `DossierManager` | NPC profiles (per WS conn) |
| `server.ts:244` | `connSession` (per-connection) | `GameSession \| null` | Per-connection session |

### 3.2 Migration Plan Per Global

#### 3.2.1 `session` and `facts` (game-state.ts)

**Current problem:** All 12 tools call `getSession()` and `getFacts()` to access the global singleton. The web server hacks around this with `setSession()` before every message handler to switch the "active" connection.

**Engine migration:**
- The `GameEngine` instance owns `session` and `facts` as private fields.
- `getSession()` / `getFacts()` / `setSession()` remain as-is during migration. The engine calls `initGameState(session)` on construction/resume, which sets the global. This is **Phase 1 compatibility**.
- In Phase 2 (post-extraction), tools can be refactored to receive session via context injection rather than global import. But this is NOT in scope for the initial extraction.

**Risk:** The web server's multi-connection model relies on `setSession()` to swap state before each message. With the engine, each connection gets its own `GameEngine` instance, and the engine sets the global before processing. This is the same pattern, just better encapsulated.

**Mitigation:** Add a `GameEngine._activate()` private method that calls `setSession()` internally. Each public method calls `_activate()` first. This guarantees correctness even if the server processes messages from different connections.

#### 3.2.2 `agent` (dm-agent.ts)

**Current problem:** Single global Agent instance. The web server reinitializes it per connection with `initDMAgent()`, but because it's global, a second connection would clobber the first.

**Engine migration:**
- The engine owns the agent lifecycle. `initDMAgent()` and `dmRespond()` remain global for Phase 1.
- The engine calls `initDMAgent()` in `createGame()` and `resumeGame()`.
- Concurrency caveat: multiple `GameEngine` instances sharing the same process still share one global agent. This is the existing bug in server.ts, not introduced by this refactor. Document it as a known limitation.

**Risk:** Low. The current server already has this limitation. A proper fix (agent-per-engine) is a follow-up.

#### 3.2.3 `pendingActions` (set-actions.ts)

**Current problem:** The `SetActions` tool writes to a module-level variable. The main loop and server handler both call `consumeActions()` to read and clear it.

**Engine migration:**
- Keep the global for Phase 1. The engine calls `consumeActions()` at the right point in `processTurn()`.
- The engine yields a `dm_end` event containing the consumed actions (or fallback actions).

**Risk:** Low. The consume-once pattern is already correct.

#### 3.2.4 `idleCount` / `eventIndex` (events.ts)

**Current problem:** Module-level variables tracking idle behavior.

**Engine migration:**
- Keep the global for Phase 1. The engine calls `checkIdleEvent()` and `resetIdleTracking()`.
- In a future refactor, these could move into `GameSession` (session-level state) or into the engine instance.

**Risk:** Very low. These are already correctly scoped to a single game instance.

#### 3.2.5 `dossier` (main.ts / server.ts)

**Current problem:** Each entry point creates and manages its own `DossierManager` instance.

**Engine migration:**
- The engine owns the `DossierManager` as a private field.
- The engine exposes `getDossierData(): Record<string, any>` for persistence.
- The engine handles unlock/interaction calls internally during `processTurn()`.

**Risk:** Low. The dossier is purely in-memory and serializable.

### 3.3 Summary: What Changes in Phase 1

The global state in `game-state.ts`, `dm-agent.ts`, `set-actions.ts`, and `events.ts` **remains global** in Phase 1. The engine wraps access to them, ensuring correctness. The only structural change is that `DossierManager` moves from adapter ownership to engine ownership.

This is deliberate: refactoring the tools to accept injected context would require changing all 12 tool files, which increases risk. Phase 1 focuses on extracting the engine without touching tools.

---

## 4. Migration Plan (Step by Step)

### Step 1: Create `GameEngine` Shell with `executeCommand()`

**What:** Create `src/engine.ts` with a `GameEngine` class. Move all slash command DATA logic into it. Both `main.ts` and `server.ts` delegate to `engine.executeCommand()`.

**Changes:**
1. Create `src/engine.ts` with `GameEngine` class
2. Implement `executeCommand()` returning `SlashCommandResult` union
3. Engine constructor takes an optional existing `GameSession` and initializes internal state
4. Move `migrateSession()` from server.ts into engine as a private method

**Both adapters change to:**
```typescript
const result = engine.executeCommand(input)
if (result) {
  // CLI: render with chalk based on result.type
  // Web: send JSON panel based on result.type
}
```

**Test criteria:**
- All 12 slash commands produce identical user-visible output in CLI
- All 12 slash commands produce identical JSON in Web
- `/save` and `/load` still work
- Manual test: play 3 turns in CLI, `/status`, `/quest`, `/map`, `/inventory`, `/npc`, `/shop`, `/chapter`, `/recap`, `/help`, `/saves`, `/save`, `/load`
- Manual test: same sequence via Web UI

**Rollback:** Delete `src/engine.ts`, revert adapter changes. Zero risk since original code is untouched until adapters are updated.

### Step 2: Move Game Initialization into Engine

**What:** `createGame()` and `resumeGame()` methods. Adapters delegate initialization to the engine.

**Changes:**
1. `GameEngine.createGame(spec)` -- creates session, inits state, returns `NewGameResult`
2. `GameEngine.resumeGame(options)` -- restores session, migrates, inits DM agent
3. `GameEngine.loadGame(slotName)` -- loads from disk
4. `main.ts` `main()` function calls `engine.createGame()` then `engine.streamOpening()`
5. `server.ts` `create` handler calls `engine.createGame()` then `engine.streamOpening()`
6. `server.ts` `resume` handler calls `engine.resumeGame()`

**Test criteria:**
- New game starts correctly in both CLI and Web
- Load/resume works in both
- DM agent is properly initialized
- Chapter auto-beats fire on new game

**Rollback:** Revert `engine.ts` additions and adapter changes for init.

### Step 3: Extract `processTurn()` as AsyncGenerator

**What:** The core turn pipeline becomes `processTurn()`. This is the largest and most critical step.

**Changes:**
1. Implement `processTurn()` as an `async function*` that yields `TurnEvent` objects
2. Move the entire turn pipeline from main.ts lines 440-530 and server.ts lines 644-749 into the engine
3. The DM streaming loop (`dmRespond()`) is wrapped: each `text_delta` is yielded as a `TurnEvent`
4. Post-DM processing (combat, quests, NPC, chapter, autosave, death) yields appropriate events
5. `main.ts` game loop becomes a consumer of `engine.processTurn()`
6. `server.ts` input handler becomes a consumer of `engine.processTurn()`

**Pipeline inside `processTurn()`:**

```typescript
async function* processTurn(input: string, options?: { resumeRecap?: boolean }): AsyncGenerator<TurnEvent> {
  this._activate()  // set global state to this engine's session

  // 1. Safety check
  const safety = checkSafety(input)
  if (safety.level === 'block') {
    yield { type: 'safety_block', reason: safety.reason }
    this.save('quicksave')
    return
  }

  // 2. Increment turn
  this.session.turnCount++

  // 3. Check broken promises
  const brokenPromises = checkBrokenPromises(this.session)
  for (const bp of brokenPromises) {
    const result = changeTrust(this.session, bp)
    if (result.applied) {
      yield { type: 'broken_promise', npcName: bp.npcName, reason: bp.reason }
    }
  }

  // 4. Build DM input
  const parts: string[] = []
  if (options?.resumeRecap) {
    parts.push(this.buildResumeRecap())
  }
  if (safety.level === 'warn') parts.push(`[DM安全指令: ${safety.dmInstruction}]`)
  const guidance = getEarlyGuidance(this.session.turnCount)
  if (guidance) parts.push(guidance)
  const idle = checkIdleEvent(input)
  if (idle) parts.push(idle)
  parts.push(input)

  // 5. Stream DM response
  let fullText = ''
  try {
    for await (const event of dmRespond(parts.join('\n\n'))) {
      if (event.type === 'text_delta') {
        yield { type: 'dm_text_delta', text: event.text ?? '' }
        fullText += event.text ?? ''
      }
    }
  } catch (err) {
    yield { type: 'dm_error', message: (err as Error).message.slice(0, 100) }
  }

  // 6. Consume actions
  const dmActions = consumeActions()
  const actions = dmActions ?? this.buildFallbackActions()
  yield {
    type: 'dm_end',
    combat: !!this.session.combat?.active,
    pendingMonster: !!this.session.combat?.pendingMonsterTurn,
    actions,
  }

  // 7. Monster phase
  if (this.session.combat?.pendingMonsterTurn) {
    const monsterResult = executeMonsterPhase(this.session)
    if (monsterResult.log.length > 0) {
      yield { type: 'combat_monster', text: monsterResult.log.join('\n') }
    }
    if (monsterResult.ended) {
      yield { type: 'combat_status', text: '...', ended: true, result: monsterResult.result }
      if (this.session.chapter) new ChapterManager(this.session).onEvent('combat_end')
    } else {
      const status = getCombatSummary(this.session)
      if (status) yield { type: 'combat_status', text: status, ended: false }
    }
  }

  // 8. Quest objectives
  const qm = new QuestManager(this.session)
  const { completed, progress } = qm.checkCombatObjectives()
  for (const r of completed) yield { type: 'quest_completed', questName: r.questName, text: r.text }
  for (const p of progress) yield { type: 'quest_progress', questName: p.questName, text: p.text }

  // 9. NPC dossier
  for (const npc of this.session.npcs) {
    if (input.includes(npc.name) || fullText.includes(npc.name)) {
      const unlock = this.dossier.unlock(npc.name, this.session.turnCount)
      if (unlock) yield { type: 'npc_unlock', npcName: npc.name }
      const update = this.dossier.onInteraction(npc.name, npc.trust, this.session.turnCount)
      if (update) yield { type: 'npc_update', text: update }
    }
  }

  // 10. Chapter advance
  if (this.session.chapter) new ChapterManager(this.session).advanceTurn()

  // 11. Auto-save
  if (this.session.turnCount % 5 === 0) {
    this.session.dossierData = this.dossier.toJSON()
    const path = this.facts.save('autosave')
    yield { type: 'auto_save', path }
  }

  // 12. Death check
  if (this.session.player.hp <= 0) {
    this.session.dossierData = this.dossier.toJSON()
    this.facts.save('death-save')
    yield { type: 'death' }
  }
}
```

**Test criteria:**
- Play a full game session (5+ turns) in CLI -- no behavioral difference
- Play a full game session in Web -- no behavioral difference
- Combat flows correctly (monster phase, combat status)
- Quest completion notifications appear at the right time
- NPC unlock notifications appear
- Auto-save triggers every 5 turns
- Death screen shows correctly
- Safety block works

**Rollback:** Revert `processTurn` and adapter changes. Steps 1-2 remain intact.

### Step 4: Extract `streamOpening()` 

**What:** The opening DM call + NPC unlock logic becomes `streamOpening()`.

**Changes:**
1. Implement `streamOpening()` as an `async function*` yielding `TurnEvent`
2. Remove opening logic from both `main.ts` and `server.ts`

**Test criteria:**
- New game opening narration streams correctly in CLI
- New game opening narration streams correctly in Web
- NPC mentioned in opening are unlocked

### Step 5: Implement `checkDetailMatch()` and Clean Up Adapters

**What:** Move the detail-match logic (checking if input matches a SetActions detail label) into the engine. Final cleanup of adapters.

**Changes:**
1. Engine tracks `lastActions` internally
2. `checkDetailMatch(input)` returns detail content or null
3. `main.ts` becomes ~80 lines (readline + chalk rendering)
4. `server.ts` becomes ~150 lines (Express + WebSocket + JSON sending)

**Test criteria:**
- Detail expansion works in CLI (click-to-expand)
- Detail expansion works in Web
- Full regression: all slash commands, all turn features

### Step 6: Add Engine Unit Tests

**What:** Write tests for the engine's deterministic methods (not DM streaming).

**Changes:**
1. Create `src/engine.test.ts`
2. Test `executeCommand()` for all command types
3. Test `createGame()`, `resumeGame()`, `loadGame()`
4. Test `checkDetailMatch()`
5. Integration test: mock DM agent, verify `processTurn()` event sequence

**Test criteria:** All tests pass. Coverage for every `SlashCommandResult` type.

---

## 5. Risk Analysis

### 5.1 What Could Break?

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Global state race condition during `processTurn()` | Medium | High | `_activate()` at start of every public method ensures correct session is set |
| DM streaming interruption changes behavior | Low | High | The `for await` delegation is mechanical -- same events, same order |
| Slash command output differs between old and new | Medium | Medium | Structured data is adapter-rendered; compare JSON snapshots |
| Save/load format incompatibility | Low | High | Engine uses identical `GameFactStore.save()` -- no format change |
| `migrateSession()` logic differs between entry points | Already exists | Medium | Extracting into engine FIXES this by having one implementation |
| Monster phase timing changes | Low | High | The yield-based pipeline preserves exact ordering |
| `consumeActions()` called at wrong time | Low | Medium | Engine calls it at the same point in the pipeline as before |
| Web reconnect/resume breaks | Medium | Medium | `resumeGame()` tested explicitly; `buildResumeRecap()` tested |
| Multiple WS connections interfere | Already exists | Medium | Not made worse; documented as known limitation |
| Performance regression from AsyncGenerator overhead | Very Low | Low | Generator overhead is negligible vs. network I/O to DM API |

### 5.2 Verification Strategy

1. **Snapshot testing:** Before starting, capture JSON output of every slash command for a test save. After migration, run the same commands and diff.

2. **DM response recording:** Record 10 turns of DM interaction (input + response). After migration, replay the same inputs (with mocked DM) and verify the event sequence matches.

3. **Manual smoke test checklist:**
   - [ ] New game (CLI): character creation, opening narration, first 3 turns
   - [ ] New game (Web): same sequence
   - [ ] Load game (CLI): load save, verify state, play 2 turns
   - [ ] Load game (Web): resume from localStorage, verify state
   - [ ] Combat (CLI): initiate fight, player attack, monster phase, loot
   - [ ] Combat (Web): same sequence, verify combat events
   - [ ] Quest flow: accept quest, complete objective, claim reward
   - [ ] NPC dossier: encounter NPC, verify unlock notification
   - [ ] Auto-save: play 5 turns, verify autosave file exists
   - [ ] Death: reduce HP to 0, verify death screen
   - [ ] All slash commands in both CLI and Web

4. **Diff-based review:** Every step produces a PR-ready diff. Review that:
   - No logic is removed from the codebase (only moved)
   - Adapter code only calls engine methods, never game-state directly
   - Engine code never imports chalk, readline, express, or ws

### 5.3 Rollback Plan

Each step is a separate commit (or PR). Rollback = `git revert <commit>`.

- Step 1 rollback: revert engine.ts and adapter command dispatch changes
- Step 2 rollback: revert init logic changes
- Step 3 rollback: revert processTurn and adapter loop changes (most critical -- do this as its own PR with careful review)
- Step 4-6: low risk, straightforward revert

At no point during migration are both the old and new code paths removed simultaneously. The pattern is:
1. Add engine method
2. Wire adapter to use engine method
3. Remove duplicate code from adapter

If step 2 fails testing, we revert step 2 and the engine method remains inert but harmless.

---

## 6. File-by-File Change List

### New Files

#### `src/engine.ts` (NEW -- ~400 lines)

The `GameEngine` class. Contains:
- Constructor accepting optional `GameSession`
- Private fields: `session`, `facts`, `dossier`, `lastActions`, `gameActive`
- Private `_activate()` -- sets global state
- Private `buildFallbackActions()` -- moved from server.ts
- Private `buildResumeRecap()` -- moved from server.ts
- `createGame(spec)` -- moved from main.ts `main()` + server.ts `create` handler
- `resumeGame(options)` -- moved from server.ts `resume` handler
- `loadGame(slotName)` -- moved from main.ts `/load` + server.ts `/load`
- `executeCommand(input)` -- all slash command logic
- `processTurn(input)` -- the core async generator
- `streamOpening()` -- opening DM call
- `checkDetailMatch(input)` -- detail expansion
- Read-only accessors: `getSession()`, `getDossierData()`, `getDMMessages()`, `isGameActive()`
- `save(slotName?)` and static `listSaves()`

#### `src/engine-types.ts` (NEW -- ~200 lines)

All `CommandResult` types, `TurnEvent` union, `CharacterSpec`, `NewGameResult`, `ResumeOptions`. Exported for use by adapters and engine.

#### `src/engine.test.ts` (NEW -- ~200 lines)

Unit tests for `GameEngine`.

### Modified Files

#### `src/main.ts` (MODIFIED -- shrinks from ~593 to ~120 lines)

**Removals:**
- `handleSlashCommand()` function (lines 44-251) -- replaced by `engine.executeCommand()`
- Game loop body (lines 340-530) -- replaced by consuming `engine.processTurn()`
- `sendToDM()` function (lines 541-556) -- replaced by consuming `dm_text_delta` events
- `migrateSession` logic inside `/load` (lines 383-403) -- moved to engine
- NPC dossier management code -- moved to engine

**Additions:**
- `import { GameEngine } from './engine.js'`
- `renderCommandResult(result: SlashCommandResult)` -- chalk-based rendering of structured results
- `renderTurnEvent(event: TurnEvent)` -- chalk-based rendering of turn events
- Simplified game loop: `for await (const event of engine.processTurn(input))`

**Retained:**
- `createRL()`, `ask()` -- readline helpers
- `showSplash()` -- CLI splash screen
- `characterCreation()` -- interactive prompts
- Top-level `main()` orchestration (but simplified)

#### `src/server.ts` (MODIFIED -- shrinks from ~810 to ~250 lines)

**Removals:**
- `migrateSession()` function (lines 41-64) -- moved to engine
- `buildResumeRecap()` function (lines 67-118) -- moved to engine
- `buildFallbackActions()` function (lines 121-149) -- moved to engine
- All slash command handling in `input` handler (lines 383-643) -- replaced by `engine.executeCommand()`
- Core turn logic in `input` handler (lines 644-749) -- replaced by consuming `engine.processTurn()`
- `sendToDM()` inner function -- replaced by consuming events
- `renderPrologueText()`, `renderWorldGuideText()` -- moved to engine or kept as simple wrappers

**Additions:**
- `import { GameEngine } from './engine.js'`
- Per-connection `engine` instance instead of per-connection `connSession` + `dossier`
- Simplified WebSocket message handler

**Retained:**
- Express app setup, password auth, static files
- WebSocket connection management
- `send()` helper function
- Server startup

#### `src/game-state.ts` (NO CHANGE in Phase 1)

The globals remain. The engine uses `initGameState()`, `getSession()`, `getFacts()`, `setSession()` exactly as before. No modification needed.

#### `src/dm-agent.ts` (NO CHANGE in Phase 1)

The global agent remains. The engine calls `initDMAgent()`, `dmRespond()`, `getDMMessages()`, `restoreDMMessages()` exactly as before.

#### `src/tools/set-actions.ts` (NO CHANGE in Phase 1)

The global `pendingActions` remains. The engine calls `consumeActions()` exactly as before.

#### `src/events.ts` (NO CHANGE in Phase 1)

The globals remain. The engine calls `getEarlyGuidance()`, `checkIdleEvent()`, `resetIdleTracking()` exactly as before.

#### `src/game-facts.ts` (NO CHANGE)

No modifications. The engine creates `GameFactStore` instances via `initGameState()`.

#### `src/types.ts` (NO CHANGE)

No modifications needed. All existing types are reused.

#### `src/combat-manager.ts` (NO CHANGE)

No modifications. The engine calls `executeMonsterPhase()` and `getCombatSummary()` directly.

#### `src/quest-manager.ts` (NO CHANGE)

No modifications. The engine creates `QuestManager` instances as before.

#### `src/dossier.ts` (NO CHANGE)

No modifications. The engine creates `DossierManager` instances internally.

#### `src/chapter-manager.ts` (NO CHANGE)

No modifications. The engine creates `ChapterManager` instances as before.

#### `src/trust-system.ts` (NO CHANGE)

No modifications. The engine calls `checkBrokenPromises()` and `changeTrust()` directly.

#### `src/safety.ts` (NO CHANGE)

No modifications. The engine calls `checkSafety()` directly.

#### All `src/tools/*.ts` (NO CHANGE in Phase 1)

No modifications. Tools continue to use `getSession()` / `getFacts()` / `getRegistry()` globals. The engine's `_activate()` ensures the correct session is active before DM calls.

### Summary Table

| File | Action | Lines Before | Lines After (est.) |
|------|--------|-------------|-------------------|
| `src/engine.ts` | CREATE | 0 | ~400 |
| `src/engine-types.ts` | CREATE | 0 | ~200 |
| `src/engine.test.ts` | CREATE | 0 | ~200 |
| `src/main.ts` | MODIFY | 593 | ~120 |
| `src/server.ts` | MODIFY | 810 | ~250 |
| `src/game-state.ts` | NO CHANGE | 62 | 62 |
| `src/dm-agent.ts` | NO CHANGE | 117 | 117 |
| `src/tools/set-actions.ts` | NO CHANGE | 55 | 55 |
| `src/events.ts` | NO CHANGE | 123 | 123 |
| `src/game-facts.ts` | NO CHANGE | 198 | 198 |
| `src/types.ts` | NO CHANGE | 203 | 203 |
| All other `src/*.ts` | NO CHANGE | - | - |
| All `src/tools/*.ts` | NO CHANGE | - | - |

**Net result:** ~800 lines of duplicated logic in main.ts + server.ts become ~400 lines in engine.ts + ~200 lines in engine-types.ts. Adapters shrink from 1403 combined lines to ~370 combined lines. Total codebase grows by roughly 0 lines (duplication removal offsets new files).

---

## Appendix A: Slash Command Mapping

This table shows exactly how each slash command maps between the current implementations and the new engine:

| Command | main.ts implementation | server.ts implementation | Engine method | Result type |
|---------|----------------------|------------------------|---------------|-------------|
| `/status` | chalk console.log (lines 49-53) | JSON panel (lines 383-423) | `executeCommand('/status')` | `StatusResult` |
| `/inventory` | chalk console.log (lines 55-70) | JSON panel (lines 542-550) | `executeCommand('/inventory')` | `InventoryResult` |
| `/map` | console.log WORLD_OVERVIEW + chalk (lines 72-93) | JSON panel (lines 494-518) | `executeCommand('/map')` | `MapResult` |
| `/save` | facts.save() + console.log (lines 95-99) | facts.save() + sysMsg (lines 460-463) | `executeCommand('/save')` | `SaveResult` |
| `/saves` | console.log list (lines 101-112) | JSON panel (lines 574-578) | `executeCommand('/saves')` | `SavesResult` |
| `/npc` | dossier.renderList() (lines 114-117) | JSON panel (lines 520-526) | `executeCommand('/npc')` | `NpcListResult` |
| `/npc <name>` | dossier.renderProfile() (lines 419-422) | JSON panel (lines 528-538) | `executeCommand('/npc <name>')` | `NpcDetailResult` |
| `/quest` | chalk + progress bars (lines 119-154) | JSON panel (lines 425-458) | `executeCommand('/quest')` | `QuestResult` |
| `/world` | renderWorldGuide() (line 157-159) | sysMsg text (line 539-540) | `executeCommand('/world')` | `WorldGuideResult` |
| `/shop` | chalk console.log (lines 161-184) | JSON panel (lines 552-572) | `executeCommand('/shop')` | `ShopResult` |
| `/chapter` | chalk + progress bars (lines 186-207) | JSON panel (lines 609-622) | `executeCommand('/chapter')` | `ChapterResult` |
| `/recap` | chalk console.log (lines 208-229) | JSON panel (lines 587-608) | `executeCommand('/recap')` | `RecapResult` |
| `/help` | chalk.dim list (lines 230-247) | JSON panel (lines 623-642) | `executeCommand('/help')` | `HelpResult` |
| `/quit` | save + break (lines 357-360) | save + sysMsg (lines 580-586) | `executeCommand('/quit')` | `QuitResult` |
| `/load` | inline migration + init (lines 364-417) | inline migration + init (lines 466-492) | `engine.loadGame(slot)` | `LoadResult` |

---

## Appendix B: Adapter Skeleton After Migration

### CLI Adapter (`main.ts` after migration)

```
1. Imports (engine, chalk, readline)
2. createRL() / ask() helpers
3. showSplash()
4. characterCreation() -- interactive prompts
5. renderCommandResult(result) -- switch on result.type, chalk output
6. renderTurnEvent(event) -- switch on event.type, chalk/stdout output
7. gameLoop(engine, rl):
   a. Print prologue
   b. for await (event of engine.streamOpening()) → renderTurnEvent
   c. while true:
      - input = await ask(rl, prompt)
      - if detail match → print detail
      - if slash command → result = engine.executeCommand(input); renderCommandResult(result)
      - if /quit → break
      - else → for await (event of engine.processTurn(input)) → renderTurnEvent
8. main() -- showSplash, characterCreation, engine.createGame, gameLoop
```

### Web Adapter (`server.ts` after migration)

```
1. Imports (engine, express, ws)
2. Express setup (static, auth, health)
3. wss.on('connection'):
   a. const engine = new GameEngine()
   b. ws.on('message'):
      - if 'resume' → engine.resumeGame(msg); send('resumed')
      - if 'create' → engine.createGame(msg); for await (engine.streamOpening()) → send events
      - if 'input':
        - result = engine.executeCommand(input)
        - if result → send('panel', result)
        - else → for await (engine.processTurn(input)) → send events
   c. ws.on('close') → engine.save('autosave')
4. Server listen
```

---

### Critical Files for Implementation
- /Users/sdliu/project/trpg-agent/src/main.ts
- /Users/sdliu/project/trpg-agent/src/server.ts
- /Users/sdliu/project/trpg-agent/src/game-state.ts
- /Users/sdliu/project/trpg-agent/src/dm-agent.ts
- /Users/sdliu/project/trpg-agent/src/tools/set-actions.ts