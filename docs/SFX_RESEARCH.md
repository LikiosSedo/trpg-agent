# SFX Research — Free Sound Effect Sources for TRPG Agent

> **Written**: 2026-04-18
> **Scope**: Pixel-art D&D web game, turn-based grid combat, TypeScript + vanilla JS frontend.
> **Deployment target**: Local dev now → GitHub Pages later. All recommended assets must be safe to re-host on a public static site.
> **License bar**: Must allow (a) commercial use, (b) redistribution as part of a shipped game, (c) ideally no attribution; if attribution required it must be feasible in a single `CREDITS.md`.

---

## 0. Current State (baseline)

Audit of `public/audio/sfx/` at time of writing:

- **`kenney-rpg/`** — Kenney RPG Audio (50 files, CC0). Already wired: UI clicks, book flips, cloth, coins, doors, draw knife, footsteps.
- **`kenney-impact/`** — Kenney Impact Sounds (130 files, CC0). Already wired: heavy body hits, plate armor impacts, footsteps on wood/grass/snow/carpet.
- **`fantasy-pack/Fantasy SFX Pack Vol 1/`** — Third-party fantasy pack (license TBD, see §5 gap list). Contains bow/dagger/sword/shield + fireball / ice / electric / necromancy loops.
- **Loose `.ogg` / `.wav` at root** — `sword_*.wav`, `heavy_*.wav`, `healing_*.wav`, `shield_*.wav`, `spell_*.ogg`, `creature_*.ogg`, `blade_*.ogg` etc. Mostly from rubberduck's *80 CC0 RPG SFX* and artisticdude's *RPG Sound Pack* (both CC0).

**Already hooked in `public/index.html`:**
- `attack_swing`, `attack_hit`, `enemy_hit`, `spell_cast`, `spell_hit`, `healing`, `shield`, `combat_start`, `creature_die`, `victory`, `death`, `flee`
- UI: `ui_click`, `ui_open`, `ui_close`, `ui_tab`, `ui_send`, `ui_coins`, `draw_weapon`, `door`, `npc_card`, `item_acquire`

**The user's claim "游戏目前没有任何音效" is outdated** — the frontend has a functional `playSfx()` engine with ~20 keys wired to real files (see `public/index.html:8537-8592`). What's still missing (see §5 gap list):

- **Grid combat events** (`combat_grid_move` / `combat_grid_attack` / `combat_grid_death` / `actor_turn_start`) have no per-event sfx hook — they currently inherit the generic `attack_hit` sound from the old battle loop.
- **Per-monster vocalizations** (Goblin / Wolf / Cockatrice / Spider / Spider Matriarch). Current `creature_die_01.ogg` is a single generic groan.
- **Turn-start stinger** (friendly vs enemy distinction).
- **Miss / dodge** (currently nothing plays on miss).
- **Critical hit stinger** (currently reuses `attack_hit`, no "重击" flair).
- **Spell school differentiation** (ice/debuff/summon are stubbed).
- **Treasure / chest opening** (not wired).
- **Level up / quest complete stinger**.

This research assumes the goal is **not** "bootstrap from zero" but **"fill the gaps and upgrade thin spots"**.

---

## 1. Source-by-Source Review

For every source I confirmed the license by pulling the actual license / FAQ page. Quoted license clauses cite the verified source URL.

### 1.1 Freesound.org — coverage ★★★★★ (5/5)

**URL**: <https://freesound.org/> · **License page**: <https://freesound.org/help/faq/#licenses>

Four license flavors coexist — **you must filter**. On the search page click the "License" facet and select only CC0 (+ optionally CC-BY):

| License | Commercial | Redistribute | Attribution | Safe for our use? |
|---|---|---|---|---|
| **CC0** | ✅ | ✅ | ❌ not required | ✅ ideal |
| **CC-BY 4.0** | ✅ | ✅ | ✅ required | ✅ with CREDITS.md entry |
| **CC-BY-NC 4.0** | ❌ | ✅ (non-commercial only) | ✅ required | ❌ avoid (we may go commercial) |
| **Sampling+** (retired) | ❌ commercial ads | ✅ | ✅ | ❌ avoid |

**Attribution format for CC-BY 4.0** (official Freesound guidance):
`"<SoundName>" by <User> — https://freesound.org/s/<id>/ — CC-BY 4.0`

**Recommended packs / sounds** (verified URLs):
- **Sword Clashes Pack** by JohnBuhr — <https://freesound.org/people/JohnBuhr/packs/18347/>
- **Epic Effects** by qubodup — <https://freesound.org/people/qubodup/packs/9790/> (mostly CC0, some CC-BY — check per-file)
- **Wolf Howl** by NaturesTemper (CC0) — <https://freesound.org/people/NaturesTemper/sounds/398430/>
- **Goblin Death** by spookymodem (CC0) — <https://freesound.org/people/spookymodem/sounds/249813/>
- **Goblin_04.wav** by LittleRobotSoundFactory (check license — most LRSF stuff is CC-BY 4.0) — <https://freesound.org/people/LittleRobotSoundFactory/sounds/270388/>
- **Voices - Orcs** (51 sounds) by LittleRobotSoundFactory — <https://freesound.org/people/LittleRobotSoundFactory/packs/17722/> (goblin substitute)
- **Chicken clucking** by Breviceps (CC0) — <https://freesound.org/people/Breviceps/sounds/456803/>
- **Chickens + rooster** by evsecrets (CC0) — <https://freesound.org/people/evsecrets/sounds/346961/>
- **Slash - Rpg** by colorsCrimsonTears (CC0) — <https://freesound.org/people/colorsCrimsonTears/sounds/580307/>

**Verdict**: **Largest catalog**, but quality varies per-file. Use when OGA/Kenney don't have a specific creature (wolf howl, chicken-hiss for cockatrice, specific goblin voices). **Always re-verify the license at the top-right of each sound page** — pack-level license filters lie.

---

### 1.2 OpenGameArt.org — coverage ★★★★★ (5/5)

**URL**: <https://opengameart.org/> · **License FAQ**: <https://opengameart.org/content/faq>

| License | Commercial | Redistribute | Attribution | Safe? |
|---|---|---|---|---|
| **CC0** | ✅ | ✅ | ❌ | ✅ ideal |
| **CC-BY 3.0 / 4.0** | ✅ | ✅ | ✅ title + author + license + link | ✅ |
| **CC-BY-SA 3.0 / 4.0** | ✅ | ✅ | ✅ + **derivatives must use same license** | ⚠️ viral — use sparingly |
| **OGA-BY 3.0 / 4.0** | ✅ | ✅ | ✅ | ✅ (OGA's own non-DRM-restrictive variant) |
| **GPL 2.0 / 3.0** | ✅ | ✅ | ✅ | ❌ avoid in a closed-source game (code-contagion risk); safe only if game itself is GPL |

**Attribution format** (CC-BY / OGA-BY — per OGA FAQ):
```
"<Title>" by <Author> — https://opengameart.org/content/<slug> — licensed under <CC-BY / OGA-BY> <version>
```

**Top-tier CC0 packs (directly relevant to this project)**:

| Pack | Author | Files | Format | Size | Download |
|---|---|---|---|---|---|
| **RPG Sound Pack** (95 files — the classic) | artisticdude | 95 | WAV | 12.5 MB | <https://opengameart.org/content/rpg-sound-pack> · direct: <https://opengameart.org/sites/default/files/rpg_sound_pack.zip> |
| **80 CC0 RPG SFX** | rubberduck | 80 | OGG | 1.8 MB | <https://opengameart.org/content/80-cc0-rpg-sfx> · direct: <https://opengameart.org/sites/default/files/80-CC0-RPG-SFX_0.zip> |
| **80 CC0 creature SFX** (roars/hurts/screams) | rubberduck | 80 | OGG | 1.9 MB | <https://opengameart.org/content/80-cc0-creature-sfx> · direct: <https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip> |
| **50 RPG sound effects** | Kenney (re-hosted) | 50 | OGG | 691 KB | <https://opengameart.org/content/50-rpg-sound-effects> · direct: <https://opengameart.org/sites/default/files/RPGsounds_Kenney.zip> |
| **20 Sword Sound Effects (Attacks and Clashes)** | StarNinjas | 20 | WAV | ~300 KB | <https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes> · direct: <https://opengameart.org/sites/default/files/sword_-_starninjas_1.zip> + <https://opengameart.org/sites/default/files/sword_clash_-_starninjas_0.zip> |
| **Goblins Sound Pack** (hit/die/attack) | artisticdude | 15 | WAV | 1.4 MB | <https://opengameart.org/content/goblins-sound-pack> · direct: <https://opengameart.org/sites/default/files/goblins_0.zip> |
| **Monster Sound Effects Pack** | Ogrebane | multi | WAV | 1.4 MB | <https://opengameart.org/content/monster-sound-effects-pack> · direct: <https://opengameart.org/sites/default/files/monster_sfx_pack.zip> |
| **Monster Sound Pack, Volume 1** | Ogrebane | multi | WAV | 2 MB | <https://opengameart.org/content/monster-sound-pack-volume-1> · direct: <https://opengameart.org/sites/default/files/monster-sounds-volume-2.zip> |

**CC-BY 3.0 packs (keep short-list, add to CREDITS.md)**:

| Pack | Author | License | Notes |
|---|---|---|---|
| **Magic SFX Sample** (fire/ice/wind/heal/misc, 5 files) | ViRiX Dreamcore (David Mckee) | CC-BY 3.0 | <https://opengameart.org/content/magic-sfx-sample> · direct: <https://opengameart.org/sites/default/files/Magic%20SFX%20Preview%20Pack.zip> |
| **Spider Chattering** (lone WAV, 809 KB) | spookymodem | CC-BY 3.0 | <https://opengameart.org/content/spider-chattering> · direct: <https://opengameart.org/sites/default/files/Spider%20Chattering.wav> |

**CC-BY-SA / GPL — avoid unless desperate**:
- *Spell Sounds Starter Pack* by p0ss is **triple-licensed CC-BY-SA 3.0 / GPL 2 / GPL 3**. CC-BY-SA is viral; avoid mixing with closed-source game. Use the simpler CC0 spell sounds from `80-cc0-rpg-sfx` or Sonniss instead. <https://opengameart.org/content/spell-sounds-starter-pack>

**Verdict**: **Second-largest and best-curated for game-ready assets**. Everything hand-made for games. Stick to CC0 + OGA-BY + CC-BY 3.0 only.

---

### 1.3 Kenney.nl — coverage ★★★★ (4/5)

**URL**: <https://kenney.nl/assets/category:Audio> · **License**: **100% CC0 across all packs** (confirmed on individual pack pages).

Already partially integrated. Every pack is a single ZIP download, OGG format, no account required.

| Pack | Files | Coverage for our project | URL |
|---|---|---|---|
| **RPG Audio** | 50 | ✅ already bundled — foley, footsteps, weapons | <https://kenney.nl/assets/rpg-audio> |
| **Impact Sounds** | 130 | ✅ already bundled — body/plate impacts, footsteps on 5 surfaces | <https://kenney.nl/assets/impact-sounds> |
| **UI Audio** | 50 | ⚠️ partial — more UI variety (confirm/error/select tones) | <https://kenney.nl/assets/ui-audio> |
| **Interface Sounds** | 51 | ⚠️ overlap with UI Audio but with harsher clicks | <https://kenney.nl/assets/interface-sounds> |
| **Music Jingles** | — | ✅ level-up / quest-complete stingers | <https://kenney.nl/assets/music-jingles> |
| **Voiceover Pack** | — | ⚠️ English spoken numbers / phrases — low priority | <https://kenney.nl/assets/voiceover-pack> |

**Verdict**: **Best signal-to-noise on free asset web**. CC0, consistent mastering, consistent sample rate. Gap: no creature vocals (spider/wolf/goblin) — fall back to OGA for those.

---

### 1.4 Sonniss GDC Game Audio Bundle — coverage ★★★★★ (5/5)

**URL**: <https://sonniss.com/gameaudiogdc/> · **License**: <https://sonniss.com/gdc-bundle-license/> (Unlimited User License)

Yearly free-for-GDC bundle. Cumulative archive now >200 GB across 9 years. **Highest production-value free source on the internet** — these are commercial-grade assets from pro vendors, released as a goodwill gift to game-dev community.

**License key points (verified from `sonniss.com/gdc-bundle-license/`)**:
1. ✅ **Commercial use**: Unlimited projects, unlimited lifetime, sell finished games for money.
2. ✅ **Redistribute in shipped game**: Permitted (sounds are "incorporated into licensee projects").
3. ❌ **Redistribute raw files / as standalone sfx library**: Prohibited.
4. ❌ **Attribution**: Not required.
5. ❌ **AI/ML training**: Explicitly prohibited (added in recent years).
6. ✅ **GitHub Pages deployment**: Fine — it's shipping the sfx baked into a web game, not distributing the raw pack.

**⚠️ Practical restriction** (this is the catch): you must **process / modify the audio before shipping** in the most conservative reading of "incorporated". In practice: re-encoding from WAV → OGG at a lower bitrate, trimming, or bundling into an audio sprite satisfies this. Shipping the raw untouched WAVs on a public CDN in a way that allows easy extraction is in a gray zone — community consensus is "it's fine if it's part of your game".

| Year | Size | Parts | Still downloadable? |
|---|---|---|---|
| 2026 | 7.47 GB | 1 part | ✅ <https://gdc.sonniss.com/> |
| 2024 | 27.5 GB | 9 parts | ✅ <https://gdc.sonniss.com/gdc-2024-game-audio-bundle/> |
| 2017 – 2023 | ~20-30 GB/year | varies | ✅ linked from main archive page |

**How to actually use it for this project**:
1. Download 2024 or 2026 bundle (2024 is huge, 2026 is smaller + more fresh).
2. Extract, **do not** just dump into `public/audio/sfx/` as-is.
3. Use a grep/find workflow: cherry-pick maybe 20-40 files that actually match our needs (goblin growl, sword clash, fireball, chicken). Most of the bundle is ambient/sci-fi/weapons-reload — irrelevant.
4. Convert each picked file to OGG Vorbis 96kbps mono, trim heads/tails, normalize to -18 LUFS (see §6.3).
5. **Ship only the processed OGG**, not the original WAVs.

**Verdict**: **Use for high-impact one-shots** (fireball launch, spider matriarch roar, critical hit stinger, victory fanfare) where production value matters. Too big to mass-import.

---

### 1.5 Pixabay Sound Effects — coverage ★★★ (3/5)

**URL**: <https://pixabay.com/sound-effects/> · **License**: <https://pixabay.com/service/license-summary/>

**License key points**:
1. ✅ Commercial + non-commercial — both fine.
2. ✅ No attribution required (credit appreciated).
3. ❌ **Cannot redistribute as standalone / stock library**. Must be combined with other media into a new creative work.
4. ❌ No AI/ML training.
5. ✅ Games on GitHub Pages: fine (game is "other media / creative work").
6. ⚠️ A 2023+ clause: Pixabay scrapes AI-generated content — verify each SFX has a real human uploader listed.

**Recommended use**: When Sonniss doesn't have a specific thing and OGA quality is poor. Good for ambient one-shots (thunder, cave drip, wind gust) and random foley. **Search UX is weaker than Freesound** (no license-granularity filter).

**Verdict**: Solid fallback but not primary.

---

### 1.6 Mixkit — coverage ★★ (2/5)

**URL**: <https://mixkit.co/free-sound-effects/> · **License**: <https://mixkit.co/license/>

**License key points**:
1. ✅ Commercial + non-commercial.
2. ✅ No attribution required.
3. ❌ Cannot redistribute standalone.
4. ⚠️ Small catalog (a few hundred sfx) vs Freesound's 500k+.
5. ✅ GitHub Pages: fine.

**Verdict**: Same license shape as Pixabay but **much smaller library**. Skip unless you specifically want their polished UI clicks.

---

### 1.7 itch.io — coverage ★★★★ (4/5)

**URL**: <https://itch.io/game-assets/free/tag-sound-effects>

itch.io is a **storefront**, not a license. Each pack has its own. Sort by "free" + tag "sound-effects" + tag "fantasy/rpg". **Read each pack's specific license text** — popular packs vary from CC0 to "free for non-commercial" to "free with credit".

**Pre-vetted recommendations with confirmed CC0 or commercial-safe license**:
- **Interface SFX Pack 1 (CC0)** by ObsydianX — UI-specific, CC0.
- **Basic Spell Impacts [Free/CC0]** by lentikula — 4 spell schools × 5 variants = 20 sfx, CC0.
- **Free Pixel Combat SFX** by Helton Yan — 2100 retro-style combat sounds. License: "free for any project" (check exact text on pack page — not CC0 but royalty-free).
- **Sword Combat Sound Effects Pack Free Version** by Hove Audio — fantasy sword pack, free tier.

**Risk**: licenses can be revoked / changed per-pack; download + archive a copy of the pack's license text at download time.

**Verdict**: Good for flavor packs but **always verify per-pack**. Don't batch-auto-download.

---

### 1.8 Others (briefly)

- **Zapsplat** — requires free account; license is "free with credit or paid to remove credit". Attribution format is "sound effect obtained from zapsplat.com". Fine for shipping web game with a CREDITS line. Useful for gap-filling. <https://www.zapsplat.com/license/>
- **Universal-Sound-FX / Imphenzia packs on Unity Store** — some are free; check each. Usually CC0.
- **Adobe Mixkit** (same as Mixkit above, Adobe-owned).

---

## 2. Scene-by-Scene SFX Recommendations

Each row: **key** (proposed `SFX_MAP` key) · **description** · **recommended source** · **frontend trigger** · **status** (✅ already wired / ⚠️ partial / ❌ missing).

### A. Battle — General

| Key | Description | Best source | Trigger in `public/index.html` | Status |
|---|---|---|---|---|
| `turn_start_player` | Light "whoosh + subtle chime" — 200ms stinger when player's turn begins | Kenney UI Audio (`rollover_*`) + filter; OR OGA *80 CC0 RPG SFX* `spell_01.ogg` trimmed | `case 'actor_turn_start'` when `msg.side === 'player'` (line 6317) | ❌ missing |
| `turn_start_enemy` | Low thud / drum hit — "tension" cue | OGA *80 CC0 RPG SFX* `stones_01.ogg` pitched down; OR Kenney Impact `impactMining_000.ogg` | Same event, `msg.side === 'enemy'` | ❌ missing |
| `grid_step` | Single-cell grid footstep, 130ms cadence matches animation | **Already have**: `kenney-impact/footstep_wood_*` / `footstep_grass_*` — pick one per area tag | Inside `animateGridMoveAsync` per cell, **throttle to 2 cells/s max** to avoid machine-gun effect | ⚠️ partial — logic not wired |
| `attack_swing` | Weapon whoosh before hit | **Already wired** — uses `heavy_sword_swing_*.wav` | `case 'combat_grid_attack'` — play at entry, before hit resolution | ✅ ready |
| `attack_hit_normal` | Flesh/metal connect | **Already wired** as `attack_hit` (heavy_hit_*) | `combat_grid_attack` when `msg.hit && !msg.isCritical` | ✅ ready |
| `attack_hit_crit` | Heavier punch + **rising whoosh layer** + screen-shake pair | Layered: `heavy_hit_01.wav` + Sonniss 2024 `/Sword_Impacts/` for the "metallic ring tail" | `combat_grid_attack` when `msg.isCritical` | ❌ missing (reuses `attack_hit`) |
| `attack_miss` | Pure whoosh, no impact | StarNinjas *20 Sword Sound Effects* — the "clash" subset, or just the swing with no-hit | `combat_grid_attack` when `!msg.hit` | ❌ missing (currently silent) |
| `death_humanoid` | Short grunt + body drop thud | artisticdude *RPG Sound Pack* — NPC sounds + `heavy_hit` tail | `case 'combat_grid_death'` when unit is humanoid | ⚠️ partial (single generic sound) |
| `death_creature` | Beast gurgle + soft thud | rubberduck *80 CC0 creature SFX* — `hurt_*` / `misc_*` | `combat_grid_death` when unit.type is monster | ⚠️ partial |
| `potion_drink` | Glass clink + gulp + refresh sparkle | OGA *80 CC0 RPG SFX* `item_misc_04.ogg` + Kenney UI confirm layered | `action === 'item'` in battle action handler (already at line 6946 uses `item_acquire`) | ⚠️ currently using wrong sfx |

### B. Spells by school

| Key | Description | Best source | Trigger | Status |
|---|---|---|---|---|
| `spell_fire_cast` | Low rumble + crackling ignition | `spell_fire_0X.ogg` in rubberduck CC0 pack (already have) + Fantasy SFX Pack `Fireball_Hold.wav` loop | DM tool emits `spell_cast` with `school: 'fire'` | ⚠️ partial |
| `spell_fire_impact` | Boom + sizzle | `spell_impact_01.wav` (already have) | On fire spell damage roll | ⚠️ generic |
| `spell_ice_cast` | Cold shimmer + crystalline rise | ViRiX *Magic SFX Sample* Ice blast (CC-BY 3.0 — attribution needed) | `school: 'cold'` | ❌ missing |
| `spell_ice_impact` | Shatter + crackle | Sonniss 2024 `Glass_Shatter` or OGA CC0 Sounds Library | `school: 'cold'` hit | ❌ missing |
| `spell_heal` | Warm chime + swell | **Already have** `healing_0X.wav` | `action === 'spell'` + `s.isBuff` (already wired) | ✅ |
| `spell_debuff` | Low ominous drone, 1s | Fantasy SFX Pack `Dark Necromancy Chant_01.wav` trimmed | DM-side buff/debuff tag | ❌ missing |
| `spell_summon` | Rising reversed cymbal + bell | OGA *Magic Sounds* collection (mostly CC0) | Summon spell events | ❌ missing |

### C. Chapter 1 monsters

Mix-and-match strategy: use a **base pack** (rubberduck creatures) + **monster-specific clip** (OGA or Freesound CC0) as a layered playback.

| Key | Description | Best source | Status |
|---|---|---|---|
| `mon_goblin_attack` | Squeaky battlecry | **artisticdude Goblins Sound Pack** (CC0) <https://opengameart.org/content/goblins-sound-pack> | ❌ |
| `mon_goblin_hurt` | Short yelp | Same pack | ❌ |
| `mon_goblin_die` | Dying squeal | Same pack + spookymodem's CC0 *Goblin Death* <https://freesound.org/people/spookymodem/sounds/249813/> | ❌ |
| `mon_wolf_growl` | Low throat growl | Freesound CC0 search "wolf growl" — NaturesTemper has a clean one | ❌ |
| `mon_wolf_howl` | Mid-battle howl / call for pack | **NaturesTemper's Wolf howl (CC0)** <https://freesound.org/people/NaturesTemper/sounds/398430/> | ❌ |
| `mon_wolf_die` | Whimper + thud | Monster Sound Pack Vol 1 (Ogrebane, CC0) | ❌ |
| `mon_cockatrice_call` | Rooster crow + snake hiss layer (two-source mix) | **evsecrets rooster (CC0)** <https://freesound.org/people/evsecrets/sounds/346961/> mixed with CC0 snake hiss from Freesound | ❌ |
| `mon_cockatrice_die` | Rooster death-squawk pitched down | Same sources + Audacity pitch-shift | ❌ |
| `mon_spider_chitter` | Fast clicking mandibles | **spookymodem *Spider Chattering*** (CC-BY 3.0 — needs attribution) <https://opengameart.org/content/spider-chattering> | ❌ |
| `mon_spider_hiss` | Hiss / threat | rubberduck *80 CC0 creature SFX* `hurt_*` pitched; or Freesound CC0 "spider" | ❌ |
| `mon_spider_die` | Wet crunch | Kenney Impact `impactMining_000.ogg` + creature_hurt layer | ❌ |
| `mon_matriarch_entrance` | 2-3s deep roar + echo — **boss-tier production** | **Sonniss 2024 bundle** `Creatures/` dir (has several monster roars at commercial quality); fallback: OGA *CC0 Deep Monster Roar* <https://opengameart.org/content/cc0-deep-monster-roar> | ❌ |
| `mon_matriarch_phase` | Roar + cracking web tear | Sonniss 2024 `Creatures/` + `Foley/Wood_Crack` | ❌ |
| `mon_matriarch_die` | Long dying wail + crumble | Sonniss 2024 `Creatures/Dying` + Kenney Impact rubble | ❌ |

### D. UI / Exploration

| Key | Description | Best source | Trigger | Status |
|---|---|---|---|---|
| `ui_click` | Soft click | Kenney RPG `metalClick.ogg` | Any button | ✅ |
| `ui_page_flip` | Book page flip | Kenney RPG `bookFlip1-3.ogg` | Chapter transition, log scroll | ✅ |
| `ui_open_panel` / `ui_close_panel` | Book open / close | Kenney RPG `bookOpen.ogg` / `bookClose.ogg` | Inventory/quest panel toggle | ✅ |
| `treasure_open` | Wooden creak + chime | OGA *RPG Sound Pack* creaky door + `item_gem_0X.ogg` layered | DM tool returns loot event | ❌ missing |
| `item_pickup_gold` | Coin jingle | Kenney RPG `handleCoins.ogg` / `handleCoins2.ogg` | `item_acquired` with `gold` | ✅ |
| `item_pickup_generic` | Light pickup | `item_misc_0X.ogg` (rubberduck CC0) | `item_acquired` without gold | ✅ |
| `level_up` | 1-2s triumphant fanfare | **Kenney Music Jingles** — "positive_*" | On character level up | ❌ missing |
| `quest_complete` | Similar but more "discovered" | Kenney Music Jingles — "tada_*" | Quest-done event | ❌ missing |
| `danger_cue` | Low ominous note, 500ms | OGA CC0 *Deep Monster Roar* trimmed + reverb; OR Sonniss `Stingers/` | Before skill check failure, trap trigger | ❌ missing |
| `trap_spring` | Click + whoosh + metal snap | OGA `lock_0X.ogg` + `metal_0X.ogg` layered (already have) | Trap activation | ⚠️ parts exist, not wired |

---

## 3. Technical Embedding Plan

### 3.1 Audio library choice: **Stay with vanilla `Audio()`** — do NOT add Howler.js

**Rationale** (decision, not a menu):

The project already has a functional 4-slot `sfxPool` rotating `Audio` element strategy at `public/index.html:8537-8592`. For our use case (30-50 short one-shots, 5-50 KB each, no 3D panning, no fades, no audio sprites-at-scale), Howler buys:
- ✅ Cross-browser quirks (Safari 14- autoplay, iOS silent switch)
- ✅ Caching
- ✅ Audio sprites (one file, multiple cues)
- ❌ ... at the cost of a 7 KB library dep and having to refactor ~40 existing `playSfx()` call sites.

What we **actually need** is only iOS unlock (which is already handled at line 8535's `touchstart` listener) and simple volume. Adding Howler is premature optimization unless we hit real problems.

**When to reconsider Howler**:
- If you decide to consolidate 30+ sfx into a single audio sprite (saves 29 HTTP requests).
- If Safari-on-iOS users report missing sfx after switching apps.
- If you add music crossfade or 3D positional audio.

**Alternative if you want sprites without Howler**: Web Audio API + `AudioBuffer` + offset/duration — ~80 lines of code. Keep in back pocket.

### 3.2 Timing — when to fire each sfx

**Principle**: sfx should fire at the **same frame** as the visual peak of the event, not before, not after. Specific mapping for grid combat:

| Event | Visual peak | SFX fires at | Notes |
|---|---|---|---|
| `actor_turn_start` | Portrait card slides in (~320ms animation) | **+0ms** (entry) | Short stinger, don't collide with portrait swoosh |
| `combat_grid_move` | Each cell transition (130ms) | **+0ms per cell**, but **throttle** | Don't play every cell on a 6-cell path — use max 2-per-second or only every 2nd cell |
| `combat_grid_attack` (swing phase) | Attacker's melee lunge ~100ms before hit | **+0ms** at event entry | `attack_swing` |
| `combat_grid_attack` (hit phase) | `playHitEffect` fires red flash + damage number | **+80ms** (sync with hit flash) | Main impact sound; for crits, layer crit stinger +40ms |
| `combat_grid_death` | Unit fade + thud | **+0ms** | Thud first; if you want wail, also fire creature_die +150ms |

**Implementation hint** — the existing `battleQueue.enqueue(async () => { ... })` pattern in index.html makes this easy. Add `playSfx(...)` calls inside the async lambdas at the right `await` points.

### 3.3 Volume ducking — preventing cacophony

When 3+ enemies act in succession on the grid, moves + hits stack. Current pool of 4 channels helps but doesn't solve the loudness summing.

**Simple rule** (add to `playSfx`):

```js
// Track active sfx in the last 100ms — scale volume down if > 2 playing
const now = performance.now()
const recentActive = sfxPool.filter(a => !a.paused && a.currentTime < 0.2).length
const duckFactor = recentActive > 2 ? 0.6 : (recentActive > 1 ? 0.85 : 1.0)
audio.volume = (volume ?? 0.4) * duckFactor
```

**Per-category volume ceilings** (subjective targets, measure with a LUFS meter ideally):
- UI sfx: 0.2 – 0.3 (background)
- Footsteps: 0.15 – 0.25 (very background)
- Normal hit / spell cast: 0.35 – 0.5
- Critical / death / boss roar: 0.5 – 0.7
- Level up / fanfare: 0.6 (reward peak)

### 3.4 Loading strategy — **preload critical, lazy-load the rest**

Current code sets `src` on play → HTTP fetch on every first-play. Good for cold start but causes a ~100ms delay on first hit.

**Recommended tiered preload**:

```js
// Tier 1: Critical combat sfx — preload on game boot (total ~80KB)
const PRELOAD_CRITICAL = [
  'heavy_sword_swing_01.wav', 'heavy_hit_01.wav', 'heavy_hit_02.wav',
  'kenney-impact/impactSoft_heavy_000.ogg', 'kenney-impact/impactSoft_heavy_001.ogg',
  'sword_unsheathe_01.wav', 'creature_die_01.ogg',
]
// Tier 2: Chapter-specific — preload on chapter load
const PRELOAD_CH1 = ['goblin_attack_01.wav', 'spider_chitter_01.wav', ...]
// Tier 3: UI + exploration — fetch-on-first-use (acceptable)
```

Preload by setting `preload="auto"` on a hidden `<audio>`:
```js
PRELOAD_CRITICAL.forEach(f => {
  const a = new Audio(SFX_BASE + f); a.preload = 'auto'; a.load()
})
```

### 3.5 Directory structure

Current `public/audio/sfx/` is a flat dump + two vendored packs. Keep it mostly flat but reorganize around usage:

```
public/audio/sfx/
├── CREDITS.md               # per-file attribution for CC-BY assets
├── LICENSES/                # copies of each source pack's license.txt
│   ├── kenney-cc0.txt
│   ├── artisticdude-cc0.txt
│   └── virix-cc-by-3.0.txt
├── combat/
│   ├── swing_*.ogg          # attack_swing pool
│   ├── hit_*.ogg            # attack_hit pool
│   ├── crit_*.ogg           # attack_hit_crit pool
│   ├── miss_*.ogg
│   ├── death_humanoid_*.ogg
│   └── death_creature_*.ogg
├── monsters/
│   ├── goblin/{attack,hurt,die}_*.ogg
│   ├── wolf/{growl,howl,die}_*.ogg
│   ├── cockatrice/{call,die}_*.ogg
│   ├── spider/{chitter,hiss,die}_*.ogg
│   └── matriarch/{entrance,phase,die}_*.ogg
├── spells/
│   ├── fire_{cast,hit}_*.ogg
│   ├── ice_{cast,hit}_*.ogg
│   ├── heal_*.ogg
│   ├── debuff_*.ogg
│   └── summon_*.ogg
├── ui/
│   ├── click_*.ogg
│   ├── open_*.ogg / close_*.ogg
│   ├── tab_*.ogg
│   ├── coins_*.ogg
│   └── page_flip_*.ogg
├── explore/
│   ├── treasure_open_*.ogg
│   ├── trap_*.ogg
│   ├── pickup_*.ogg
│   ├── level_up_*.ogg
│   └── quest_complete_*.ogg
└── _vendor/                 # original packs as downloaded (for re-processing)
    ├── kenney-rpg/
    ├── kenney-impact/
    └── ...
```

**Why per-category not per-monster globally**: DM logic can swap monster packs per chapter without touching combat/UI paths. Keeps `SFX_MAP` keys stable.

### 3.6 File format & encoding

- **Ship OGG Vorbis** (smaller, universal since 2018). Only use WAV for files shorter than 50ms where encoding latency dominates.
- **Bitrate**: 96 kbps mono for SFX (inaudible degradation), 128 kbps stereo for music.
- **Sample rate**: 44.1 kHz (don't resample down — Vorbis handles this automatically).
- **Normalize**: -18 LUFS integrated for consistent perceived loudness across packs. Use `ffmpeg -i in.wav -af loudnorm=I=-18 out.ogg` or Audacity's built-in loudness normalization.
- **Trim silence** at head/tail (50ms max) — reduces trigger latency.

---

## 4. Attribution Format for CREDITS.md

When using any CC-BY asset, add to `public/audio/CREDITS.md` in this format (already matches existing style for music):

```markdown
### <file-name>.ogg

- **Title**: <original title>
- **Author**: <author name>
- **License**: CC-BY 3.0 (attribution required)
- **Source**: <URL>
- **Modifications** (if any): resampled to 96 kbps OGG, trimmed, loudness-normalized to -18 LUFS
```

For CC0 assets, attribution isn't required but project policy is to list them anyway as courtesy (already the style).

---

## 5. Gap List — What To Fill (prioritized)

Priority = highest impact on game feel per MB downloaded.

### P0 — Fix immediately (existing events silent or wrong)

1. **`attack_miss` sound** — currently silent on miss, feels broken. Source: StarNinjas *20 Sword Sound Effects* "clash" subset (CC0).
2. **Per-grid-event sfx wiring** — `combat_grid_attack` / `combat_grid_death` / `combat_grid_move` / `actor_turn_start` need `playSfx()` calls inside their `battleQueue` handlers at `public/index.html:6272-6355`. Existing sfx keys cover it; just wire them.
3. **Critical hit stinger** — currently identical to normal hit. Source: layer existing `heavy_hit_02.wav` + a deeper impact from Sonniss 2024 `Cinematic_Impacts/`.

### P1 — High impact gameplay polish

4. **Monster-specific vocals** (Goblin/Wolf/Spider/Cockatrice/Matriarch) — currently one generic creature_die_01. Sources listed in §2.C.
5. **Level up / quest complete fanfares** — Kenney Music Jingles (CC0), ~2 files.
6. **Treasure chest open** — OGA `lock_0X.ogg` already exists, just wire + add chime.
7. **Spell school differentiation** (ice, debuff, summon) — ViRiX *Magic SFX Sample* (CC-BY) + OGA *80 CC0 RPG SFX* covers fire/misc already.

### P2 — Nice-to-have flavor

8. **Footstep surface-switching per area tag** (grass in forest, stone in dungeon, wood in tavern) — all Kenney Impact files already present, just route by `area.terrain`.
9. **Turn-start stingers** (friendly bright chime / enemy low drum).
10. **Danger cue** for failed skill checks / trap triggers.

### Verify license before using

11. **`fantasy-pack/Fantasy SFX Pack Vol 1`** currently in repo — **license not documented in `CREDITS.md`**. Before shipping to GitHub Pages, find the original `Fantasy SFX Pack Vol 1 - Asset List.pdf` inside the folder and extract the license. If it's not a compatible free license, **replace these files** with equivalents from Sonniss 2024 bundle before going public.

---

## 6. Download & Process Workflow (cookbook)

For each source pack:

```bash
# 1. Download
cd public/audio/sfx/_vendor
wget https://opengameart.org/sites/default/files/<pack>.zip
unzip <pack>.zip -d <pack-name>/

# 2. Archive the license
cp <pack-name>/license.txt ../LICENSES/<author>-<license>.txt 2>/dev/null || \
  echo "CC0 - no license file shipped" > ../LICENSES/<author>-cc0.txt

# 3. Pick files and re-encode to the shipping folder
for f in <selected files>; do
  ffmpeg -i "<pack-name>/$f" -c:a libvorbis -b:a 96k -ac 1 \
         -af "loudnorm=I=-18:LRA=7:TP=-2, silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB" \
         "../combat/$(basename $f .wav).ogg"
done

# 4. Add SFX_MAP entry in public/index.html
# 5. Wire playSfx('<key>') at the right event
# 6. If CC-BY: append entry to public/audio/CREDITS.md
```

---

## 7. Recommendation Summary

**Top 3 sources, ranked by value for this project**:

1. **🥇 Kenney.nl** — 100% CC0, zero-attribution, consistent mastering, already half-integrated. **Fill remaining UI/impact/music-jingle gaps here first.**
2. **🥈 OpenGameArt.org** (CC0 sub-set) — **Best monster + RPG coverage** at CC0. Pull rubberduck's *80 CC0 RPG SFX* + *80 CC0 creature SFX* and artisticdude's *Goblins Sound Pack* now.
3. **🥉 Sonniss GDC Bundle** — **Production-grade** for high-impact hero moments (boss roar, critical stinger, victory fanfare). Cherry-pick 10-20 files from the 2024 or 2026 bundle.

**Avoid** unless you've read the specific license: `fantasy-pack/` (undocumented), any itch.io pack without explicit CC0 text, *Spell Sounds Starter Pack* by p0ss (CC-BY-SA viral).

**Attribution cost** (if we end up using ViRiX *Magic SFX Sample* + spookymodem *Spider Chattering* + possibly Freesound CC-BY sounds for wolf/goblin): ~5-10 lines in `CREDITS.md`. Manageable.

---

## Appendix: License Quick-Reference Card

Stick this near your desk.

| License | Use in commercial web game | Redistribute in shipped game | Attribution | AI/ML training | Notes |
|---|---|---|---|---|---|
| **CC0** | ✅ | ✅ | Not required | ✅ (CC0 by definition) | Ideal |
| **CC-BY 3.0 / 4.0** | ✅ | ✅ | **Required** | ✅ | Most common on OGA |
| **OGA-BY 3.0 / 4.0** | ✅ | ✅ | **Required** | ✅ | OGA variant without DRM restriction |
| **CC-BY-SA 3.0 / 4.0** | ✅ (but viral — game assets must also be CC-BY-SA) | ✅ | **Required** | ✅ | Avoid for mixed-license projects |
| **CC-BY-NC** | ❌ commercial | ✅ non-commercial only | **Required** | ❌ | Avoid |
| **GPL 2.0 / 3.0** | ⚠️ only if your game is GPL | ✅ | **Required** | ✅ | Copyleft |
| **Kenney CC0** | ✅ | ✅ | Not required (credit appreciated) | ✅ | Same as CC0 |
| **Sonniss Unlimited User** | ✅ | ✅ (as part of game, not standalone) | Not required | ❌ **prohibited** | Don't ship raw bundle |
| **Pixabay License** | ✅ | ✅ (as part of creative work) | Not required | ❌ prohibited | No standalone resale |
| **Mixkit License** | ✅ | ✅ | Not required | Unclear — avoid | No standalone resale |
| **Freesound Sampling+** | ❌ commercial ads | ✅ | Required | — | Retired, avoid |

---

**End of research document.** For questions / proposals to update this plan, edit in place and append a dated entry to a "Revision History" section at the bottom (none yet — this is v1).
