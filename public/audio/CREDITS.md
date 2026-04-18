# Audio Credits

All background music and sound effects in this project come from free / open
asset libraries. This file lists explicit attribution for tracks whose license
requires it (CC-BY) and acknowledges CC0 contributors as good practice.

## Background Music — Indoor Sub-locations (added 2026-04-07)

These four tracks were sourced from [OpenGameArt.org](https://opengameart.org/)
to give each shop in Dawnbreak Town its own distinct atmosphere.

### `blacksmith.mp3` — The Sturdy Anvil

- **Title**: Medieval: Harvest Season
- **Author**: Joth
- **License**: CC0 (public domain — no attribution required, listed here for credit)
- **Source**: <https://opengameart.org/content/medieval-harvest-season>

### `guild.mp3` — Silver Scale Guild Hall

- **Title**: Fame Town
- **Author**: RandomMind
- **License**: CC-BY 3.0 (attribution required)
- **Source**: <https://opengameart.org/content/fame-town>

### `apothecary.mp3` — Greenleaf Apothecary

- **Title**: Woodland Fantasy
- **Author**: Matthew Pablo
- **License**: CC-BY 3.0 (attribution required)
- **Source**: <https://opengameart.org/content/woodland-fantasy>
- **Note**: Replaced the earlier "Mystical Theme" by Alexandr Zhelanov, which felt
  too eerie/suspenseful for a cozy herbal shop. Woodland Fantasy is a warm
  acoustic ballad (real violin + flute + guitar) better suited to a quiet
  herbalist interior.

### `inn.mp3` — Dawn's Rest Inn

- **Title**: Small Sleepy Town (Major key version)
- **Author**: cynicmusic ([Phil Boucher](https://cynicmusic.com/))
- **License**: CC-BY 3.0 (attribution required)
- **Source**: <https://opengameart.org/content/meloncholy-town>

## Earlier Background Music

The remaining BGM and ambient tracks under `public/audio/*.mp3` were added in
earlier commits (notably `c5f442a`, `e8d5140`, `06f46bf`, and the tavern
replacements `a098069` / `69f962f`). They are CC0 / CC-BY assets from
OpenGameArt.org. Composers known to be involved include **RandomMind**,
**cynicmusic**, **CleytonRX**, **Joth**, **Sleepy Cat**, and others —
see the original commit messages for per-track details.

## Sound Effects

`public/audio/sfx/` and `public/audio/sfx/fantasy-pack/` are sourced from
free RPG sound packs. See the `fantasy-pack/` subfolder for its bundled
license/readme files.

Per-monster SFX under `public/audio/sfx/monsters/<species>/` are documented
separately in the "Monster-Specific SFX" section below.

## Monster-Specific SFX (added 2026-04-18)

Per-monster vocalizations under `public/audio/sfx/monsters/<species>/` give
each Chapter 1 enemy a distinct audio identity (replaces the earlier generic
creature pool routing). All final files are **OGG Vorbis, mono, 44.1 kHz,
~96 kbps**, loudness-normalized toward **-18 LUFS** with a **-2 dBFS** peak
ceiling (short clips under 0.4 s use peak-normalized path instead of EBU R128,
since they fall below the BS.1770 400 ms gate).

### `monsters/goblin/*.ogg` — Goblin (7 files)

- **Title**: Goblins Sound Pack
- **Author**: artisticdude
- **License**: **CC0** (public domain — listed here as courtesy)
- **Source**: <https://opengameart.org/content/goblins-sound-pack>
- **Files used**:
  - `attack_01`=goblin-1, `attack_02`=goblin-2, `attack_03`=goblin-8
  - `hurt_01`=goblin-11, `hurt_02`=goblin-13
  - `die_01`=goblin-3, `die_02`=goblin-12
- **Modifications**: re-encoded WAV → OGG Vorbis 96 kbps mono, trimmed
  leading/trailing silence (-50 dB threshold), peak-limited to -2 dBFS

### `monsters/wolf/*.ogg` — Wolf (4 files)

Uses two CC0 sources:

- **`howl_01`, `growl_01`, `growl_02`**: from **80 CC0 creature SFX**
  - **Author**: rubberduck
  - **License**: **CC0**
  - **Source**: <https://opengameart.org/content/80-cc0-creature-sfx>
  - **Files used**: `howl.ogg` → `howl_01`; `barking_01.ogg` pitched -150 ¢ →
    `growl_01`; `barking_02.ogg` pitched -180 ¢ → `growl_02`
- **`die_01`**: from **Wolf Monster Sound**
  - **Author**: CaveboyTup
  - **License**: **CC0**
  - **Source**: <https://opengameart.org/content/wolf-monster-sound>
  - **Modifications**: pitched -300 ¢ with librubberband, 200 ms fade-out
    applied to evoke a dying whimper

### `monsters/spider/*.ogg` — Spider (3 files)

Two sources, both CC-BY 3.0 — attribution required:

- **`chitter_01`**: **Spider Chattering** ⚠ **CC-BY 3.0**
  - **Author**: spookymodem
  - **Source**: <https://opengameart.org/content/spider-chattering>
  - **Modifications**: sliced to 0.10–1.80 s window, loudness-normalized,
    re-encoded to OGG Vorbis 96 kbps mono
- **`chitter_02`**: **A Lonely Nightmare — Minimare (Monster) SFX** ⚠ **CC-BY 3.0**
  - **Author**: WakianTech
  - **Source**: <https://opengameart.org/content/a-lonely-nightmare-minimare-monster-sfx>
  - **File used**: `Minimare_Hiss.wav` (creepy hissing attack variant)
  - **Modifications**: re-encoded to OGG Vorbis 96 kbps mono, loudness-normalized
- **`die_01`**: from **80 CC0 creature SFX** (rubberduck, CC0) —
  `hurt_03.ogg` pitched +100 ¢ to feel more insect-like

### `monsters/cockatrice/*.ogg` — Cockatrice (3 files, rooster + snake hybrid)

- **`call_01`**, **`die_01`**, and chicken layer of **`attack_01`**:
  **Chicken Sound Effect** ⚠ **CC-BY 3.0**
  - **Author**: IMadeIt
  - **Source**: <https://opengameart.org/content/chicken-sound-effect>
  - **Modifications**: sliced to punchy 1.2–1.35 s windows; for `die_01`,
    pitched -250 ¢ with a 250 ms fade-out for a dying-squawk feel
- **Snake-head hiss layer of `attack_01`**: same **Minimare Hiss** (WakianTech,
  CC-BY 3.0) as above, layered with `amix` at -3 dB chicken / 0 dB hiss to
  produce the "rooster lunges, snake head hisses" hybrid

### `monsters/matriarch/*.ogg` — Spider Matriarch / Boss (4 files)

Mixes multiple CC0 sources:

- **`entrance_01`**: **CC0 Deep Monster Roar**
  - **Author**: trazzz123
  - **License**: **CC0**
  - **Source**: <https://opengameart.org/content/cc0-deep-monster-roar>
  - **Modifications**: sliced to 0.20–2.70 s window, loudness-normalized
- **`chitter_01`**: **Spider Chattering** (spookymodem, **CC-BY 3.0**)
  pitched **-200 ¢** with librubberband — a low, slow, menacing derivative
  of the normal spider chitter, reserved for the boss
- **`roar_01`**: layered mix of `roar_02.ogg` from **80 CC0 creature SFX**
  (rubberduck, CC0) pitched -150 ¢, with a bed of the `monster_roar.wav`
  (trazzz123, CC0) at -6 dB for body
- **`die_01`**: `monster_04.ogg` from **80 CC0 creature SFX** (rubberduck,
  CC0) pitched -100 ¢ with a 300 ms fade-out

### Cockatrice note — no dedicated snake-hiss source found

The task brief suggested freesound CC0 "snake hiss" for the cockatrice.
Freesound requires a user account for downloads, which this pipeline could
not satisfy. As an OGA-only substitute, `Minimare_Hiss.wav` (WakianTech,
CC-BY 3.0) was used — it is a voiced creature-hiss that layers convincingly
under the rooster squawk. Attribution for WakianTech is covered above.

### Processing pipeline

All downloads and conversions were done locally with a static `ffmpeg 8.1`
(libvorbis + librubberband). The standardization filter chain was:

```
loudnorm=I=-18:LRA=7:TP=-2,
silenceremove (-50 dB threshold, both ends),
[optional rubberband pitch-shift],
alimiter=limit=0.5:level=disabled    # for short clips <0.4 s only
libvorbis @ 96 kbps, mono, 44 100 Hz
```

## Reporting Issues

If you are an author who believes your work is mis-attributed or used outside
its license terms, please open an issue and we will correct or remove the
asset promptly.
