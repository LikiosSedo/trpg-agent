# NPC Companion / Party System Design

> Status: **Design Only** -- not implemented. Reference for future development.

---

## 1. Overview

A system allowing NPCs to temporarily follow the player, triggered by story beats, player invitation, or NPC initiative. Designed for phased implementation with minimal disruption to existing systems.

**Core constraints:**
- Max 2 companions at once (token budget + combat balance + narrative focus)
- All companion behavior is code-enforced, not DM-dependent
- Combat uses passive effect model (no full NPC AI/initiative)

---

## 2. Data Model

```typescript
interface CompanionState {
  npcName: string
  joinedTurn: number
  reason: 'story' | 'player_invite' | 'npc_initiative'
  combatRole: 'fighter' | 'support' | 'passive' | 'flee'
  expiresAt?: number       // auto-leave turn
  maxArea?: string         // area restriction (e.g. 'twilight-woods')
}

// Added to GameSession:
companions?: CompanionState[]
```

---

## 3. NPC Follow Conditions

| NPC | Min Trust | Chapter Gate | Extra Condition | Allowed Areas | Combat Role |
|-----|-----------|-------------|-----------------|---------------|-------------|
| Greg | 6 | Ch3+ | Must involve Xiaoli's safety or mine investigation | All (override local) | fighter |
| Xiaoli | 5 | Ch3+ | **Greg must agree (trust >= 4) and accompany** | Only with Greg | passive |
| Elena | 5 | Ch4 | Final assault only | Mines | fighter |
| Han Meng | 4 | Ch3+ | During guild missions | Mines, Forest | fighter |
| Kahn | 3 | Any | He always "happens to be around" | All (roaming) | fake passive |
| Ye Lu | 5 | Ch3+ | Assistant investigation related | Town, Forest | support |
| Grom | 4 | Ch3+ | Ore investigation | Mines | fighter |
| Chen Ma | - | - | Never follows | - | - |
| Victor | - | - | Never voluntarily follows | - | - |
| Old Lin | 3 | Ch2 | Auto-joins in forest | Forest only | support |

### Xiaoli Special Protection

Xiaoli is `stationary` -- the companion system must **temporarily override** her mobility when conditions are met, and restore it on leave.

Hard prerequisite chain:
1. Greg trust >= 4
2. Greg explicitly agrees (dialogue check) OR Greg also joins as companion
3. Chapter >= 3

If Greg goes unconscious while both are companions -> Xiaoli auto-leaves and returns to tavern.

---

## 4. Story Integration Points

### Ch2 -- Twilight Woods

- **Old Lin** joins after `ch2_meet_hunter` beat
- Story-type companion, `maxArea: 'twilight-woods'`
- Auto-leaves after `ch2_forest_combat` beat
- Passive support: +2 perception/survival checks (narrative only in Phase 1)
- Note: Old Lin needs to be promoted to full NPC object in `createInitialNPCs()`

### Ch3 -- Mine Investigation

- **Han Meng** offers to join if trust >= 4 (`npc_initiative`)
- **Ye Lu** asks to join if assistant investigation discovery is complete
- **Greg** can be invited after obtaining Darian's journal (`ch3_d_journal`), but with dramatic reluctance (trauma)
- Xiaoli going to mines should be Ch4, not Ch3 (Ch3 dmSecrets don't know about the Prism)

### Ch4 -- Final Push

- **Elena + Han Meng** auto-join via `ch4_final_push` beat (forced story)
- **Greg + Xiaoli** optional high-trust route (Xiaoli senses the Void Prism)
- If player built trust with Grom, he can provide special silver weapons before the push

### Kahn -- The Spy Problem

Kahn as undercover agent creates the biggest design challenge:
- He won't refuse (refusing breaks his cover)
- While accompanying, he secretly gathers intel
- System sets flags: `kahn_accompanied_mine`, `kahn_accompanied_wastes`
- Ch4 revelation generates different narrative based on these flags
- DM prompt injection: "If Kahn is following, his performance is more careful, but occasionally a calculating look flashes in his eyes when he thinks no one is watching."

### Information Isolation

- Xiaoli following to mines will naturally trigger her sensing shadow energy -- this is an **optional reward route**, not a leak (high trust investment = extra info payoff)
- DM prompt injection per companion: personality-specific environmental reactions
- Companions don't volunteer information beyond their chapter's dmSecrets boundary

---

## 5. Combat Design

### Passive Effect Model (No Full NPC AI)

| combatRole | Behavior | Mechanism |
|-----------|----------|-----------|
| fighter | Fixed 3-5 damage to random enemy per round | Applied after monster turns |
| support | Heal 1d4 HP or +1 AC buff every 2 rounds | Auto applyEffect |
| passive | Hides, no mechanical effect | Narrative only |
| flee | Auto-leaves companion list when combat starts | moveNPC back to homeBase |

### Balance Adjustments

- With fighter companion: encounter monster count +1 or monster HP +25%
- Monsters have 30% chance to target companion NPC instead of player
- Companion uses own AC from `npc-combatants.json`

### Companion KO

1. NPC HP -> 0: mark `condition: 'unconscious'`, remove from companions
2. Narrative injection: "{NPC} falls!"
3. KO'd NPC stays at combat location
4. Recovers via existing `recoveryTurns` mechanism
5. If player leaves area, NPC returns to homeBase after recovery
6. Same NPC KO'd twice -> refuses to follow next time (flag)

---

## 6. Guard System Interaction

Current guard system (`NPC_GUARDS` in attack.ts) checks same sub-location. With companions:

- Both Xiaoli and Greg as companions -> Greg always at player's location -> guard works naturally
- Xiaoli as companion without Greg -> **not allowed** (hard prerequisite)
- Player attacks a companion -> all other companions immediately leave, trust tanks
- Greg as companion goes unconscious -> Xiaoli auto-leaves

---

## 7. Narrative Burden Control

### DM Prompt Rules for Companions

```
When player has NPC companions:
1. Use 1 sentence per companion per turn for reactions (expression, gesture, brief line)
2. Don't write long companion dialogues. Main dialogue still via Talk tool.
3. In combat: "Greg's iron fist slams into the skeleton's shoulder" (1 sentence)
4. Environmental reactions can use companion POV for extra info
5. Companions don't initiate long conversations. Important info goes to SetActions details.
```

### Token Budget

- Per companion per turn: ~200 tokens overhead
- 2 companions = ~400 extra tokens/turn
- Acceptable within 1M context window

---

## 8. Risk & Edge Cases

| Risk | Mitigation |
|------|-----------|
| Lure NPC to dangerous area | passive/flee roles don't stay in combat; harming Xiaoli triggers permanentGrudge |
| NPC at unreachable location | maxArea check on Move; companion warned and auto-leaves at boundary |
| Player attacks companion | All companions leave, trust tanks, cascadeReputation triggers |
| Save/load with companions | CompanionState in GameSession auto-persists; mobility override restored on load |
| Multiple companion interactions | DM prompt injects relationship-aware flavor text |
| Kahn gathering intel while following | Flag-based tracking, affects Ch4 revelation narrative |

---

## 9. Implementation Phases

### Phase 1: MVP -- Story-Triggered Companions (~400 lines)

Only `reason: 'story'` companions. No player invite. Combat is narrative-only (no mechanical effects).

**Files to modify:**
- `types.ts` -- Add CompanionState, extend GameSession
- `story-script.ts` -- Add companion directives to beats
- `chapter-manager.ts` -- Handle companion join/leave in onEvent
- `tools/move.ts` -- Sync companion NPC positions, area boundary check
- `engine.ts` -- Inject companion context into DM prompt
- `dm-prompt.ts` -- Add companion narrative rules

**New file:**
- `companion-manager.ts` -- Central join/leave/sync/validate logic

**No changes needed:**
- Combat system (companions are narrative-only in Phase 1)
- Trust system (unchanged)
- Guard system (unchanged, works naturally with position sync)

### Phase 2: Combat Participation

- `companion-manager.ts` -- `executeCompanionCombatEffects()`
- `combat-manager.ts` -- Monster attack distribution to companions
- Encounter scaling (more monsters with fighter companions)

### Phase 3: Player Invitation

- `tools/talk.ts` -- `approach: 'invite'` handling
- Trust + chapter + condition checks
- Character-specific rejection dialogue
- UI: party panel showing current companions

### Phase 4: NPC Initiative + Companion Interactions

- Beat-driven NPC offers to join
- Inter-companion relationship flavor text
- Companion auto-comments on discoveries
- Kahn's hidden intel collection system
