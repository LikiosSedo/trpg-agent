# 场景立绘 Prompt 集 — 破晓镇 TRPG

> **统一风格前缀（场景图 prompt 必须包含）：**
> Style: pixel art scene illustration, 2D retro RPG style, dark Lovecraftian/Cthulhu horror atmosphere, limited color palette with muted tones and eerie highlights, 256×144 pixel landscape scene (16:9 ratio), visible pixel texture, reminiscent of Darkest Dungeon environment art meets classic SNES RPG town/dungeon screens. No characters or NPCs in the scene — environment only. Atmospheric perspective with foreground detail fading to ominous background. **CRITICAL: NO TEXT anywhere in the image. No labels, signs, words, letters, or readable characters of any language. All text/labels will be added by frontend code overlay. Signs and books in the scene should appear weathered/illegible or shown from an angle where text is not readable.**

---

# ═══════════════════════════════════════
# 第零部分：羊皮纸世界地图（核心导航图）
# ═══════════════════════════════════════

## 0. 破晓镇世界地图 (World Map — Parchment Style)

> 这是玩家打开地图面板时第一眼看到的图。决定整个游戏的空间感建立。
> 文件名：`map-world-parchment.png`
> 尺寸建议：512×512 或 512×384，正方形或略宽，适配移动端地图面板。

```
Create a pixel art hand-drawn fantasy world map on aged parchment paper, in dark Cthulhu-themed 2D RPG style.

This is a local regional map depicting a small mountain valley and its surrounding areas, drawn by an in-world cartographer. It should look like a physical artifact — a traveler's map found in an old backpack.

=== PARCHMENT BASE ===
- Aged yellowed parchment with visible fiber texture, tea-stained edges, subtle fold creases forming a cross pattern (as if folded into quarters and carried in a pocket)
- Burned or torn edges on the bottom-right corner — something damaged this map
- Faint coffee/wine ring stain in one corner
- The parchment has a slight curl shadow at the edges suggesting it's lying on a surface

=== GEOGRAPHIC LAYOUT (top-down bird's-eye) ===

The map depicts a mountain valley roughly 10km across:

CENTER: The Town
- Drawn as a cluster of tiny buildings around a central square, with a golden glowing dot marking an ancient stele
- Warm ink coloring — amber/brown buildings, tiny smoke wisps from chimneys
- A wall outline around the town (low stone wall)
- Roads branch out in three directions: south, north, west
- NO TEXT LABELS — the town is identified purely by its visual identity (buildings, stele glow, warm colors)

NORTH (top of map): The Mines
- Mountain range drawn in classic cartographic style — grey jagged peaks with hatch-shading for slopes
- A dark tunnel mouth carved into the mountainside, with tiny rail tracks leading from town
- The mountain area uses cold grey-blue ink, darker than the rest of the map
- Danger marking: small skull-and-crossbones symbol near the mine entrance, hand-drawn
- The ink around the mine area subtly bleeds darker, as if the parchment is stained by proximity to the mines

SOUTH/EAST (bottom and right of map): The Forest
- Dense tree symbols drawn in dark green ink, getting progressively darker (more ink saturation) toward the center
- The tree line starts abruptly — forest edge is drawn as a hard boundary
- A winding path enters from the town road and disappears into the dark trees
- Hidden location hints: faint dotted-line paths branching off the main trail, with "?" marks
- Small illustration of a wolf silhouette near the forest edge (map decorator's flourish)

WEST (left of map): The Wasteland
- Drawn with sparse, scratchy ink strokes — cracked ground patterns, scattered rock formations depicted as small sharp triangles
- A dry riverbed winds through the wasteland (drawn in lighter, faded ink)
- The area feels emptier on the map — less detail, more negative space, suggesting desolation
- A tiny watchtower ruin symbol in the distance
- Fog represented by light cross-hatching that fades the features beneath it

=== CONNECTIONS / ROADS ===
- Solid ink lines for known paths (town to each area)
- Dashed lines for rumored/hidden paths (forest to wasteland, forest to mines side entrance)
- The dashed paths have small "?" symbols (no text annotations)

=== DECORATIVE ELEMENTS ===
- A compass rose in the top-right corner, drawn in ornate decorative style with directional arrow/needle only (NO letters, not even N/S/E/W — frontend will overlay directional labels). The North needle is slightly corroded/bent (subtle worldbuilding — magnetic anomaly from the mines)
- Small decorative border of intertwined vines and thorns, broken in places

CRITICAL: ABSOLUTELY NO TEXT anywhere on the map. No labels, no annotations, no legends, no titles, no initials, no letters of any kind in any language. ALL text/labeling will be handled by frontend code overlay. The map communicates PURELY through visual iconography — buildings for town, trees for forest, peaks for mines, cracked stone for wasteland, skulls for danger, "?" marks for unknown paths (the "?" is a visual symbol/glyph, render it as a small decorative icon, not as a typographic character).

=== SUBTLE HORROR / WORLDBUILDING ===
- The four regions form a rough cross/compass shape with the town at center — this mirrors the stele's rune pattern (the town IS the seal)
- The ink used for the mine area is subtly different in hue — darker, with a faint purple tinge, as if the cartographer's ink was contaminated
- In the empty space between regions, extremely faint pencil marks (almost invisible) trace geometric lines connecting the four regions through the town center — someone was mapping something beyond geography
- The parchment ages/darkens toward the mine area — the paper itself is corrupted

=== COLOR PALETTE ===
- Parchment base: warm yellowed cream, aged tea-stain brown
- Town: warm amber ink, tiny gold dot for stele
- Forest: dark green ink deepening to near-black at center
- Mines: cold grey-blue ink with purple contamination
- Wasteland: dry brown/grey with faded strokes
- Roads: dark brown ink (solid), lighter brown (dashed)
- Danger marks: red ink for skull symbols
- Overall tone: A beautiful, functional map with an undercurrent of dread hidden in its details

=== MOOD ===
This map has been carried by adventurers for years. It's accurate, practical, and well-crafted. But the map also tells a story its creator didn't intend: the creeping corruption is visible in the ink itself. The parchment is aging faster near the mine section. The compass needle is wrong. The faint geometric lines suggest someone realized this isn't just geography — it's anatomy. The town sits at the heart of something, and the map is a diagram of its body.

Style: pixel art, 2D, hand-drawn fantasy cartography on aged parchment, dark Lovecraftian undertones, visible pixel texture, muted earth-tone palette with strategic color accents.
```

---

# ═══════════════════════════════════════
# 第一部分：四大区域总览图（远景鸟瞰视角）
# ═══════════════════════════════════════

## 1. 破晓镇 (Dawnbreak Town) — 主区域

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A bird's-eye overview of a small mountain valley mining town at dusk. About 500 people live here.

Visual composition:
- Foreground: A cobblestone road lined with low stone buildings, timber-framed rooftops with slate tiles
- Midground: The town center — a faintly glowing ancient stone stele (obelisk) stands in a small square, radiating dim amber light. Around it: a tavern with warm window glow, a blacksmith with forge smoke, a guild hall with a sword-and-shield emblem
- Background: Grey mountain ridges (Greyspine Mountains) looming over the valley, their peaks disappearing into sickly grey-green clouds. A dark forest line visible to the south, and barren grey wasteland stretching westward
- Sky: Twilight — deep indigo transitioning to bruised purple near the mountains, with a single oversized pale moon casting long shadows
- Subtle horror element: The stone stele's faint glow reveals hairline fractures running through the ground beneath the town square, as if something massive is sealed below. The mountain silhouette against the sky vaguely resembles a sleeping figure

Color palette: Warm amber/yellow for town lights, cold grey-blue for stone buildings, deep indigo sky, sickly green-grey for the mountains. The stele glows soft gold — the only warm beacon in creeping darkness.

Mood: A tiny island of warm light in a valley of ancient, indifferent stone. The mountains don't protect this town — they imprison it. The stele's light feels less like a blessing and more like a ward desperately holding.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9 landscape ratio.
```

---

## 2. 暮色森林 (Twilight Woods) — 主区域

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A dense, ancient forest south of a mountain town. The deeper you go, the darker it gets.

Visual composition:
- Foreground: Massive gnarled tree trunks with exposed root systems, bark covered in pale lichen that faintly glows
- Midground: A narrow dirt path winding between towering old-growth trees, dappled light filtering through the canopy in scattered beams. Thick undergrowth of ferns and thorny bushes
- Background: The forest becomes a wall of black — tree trunks merge into shadow, only the faintest outlines of deeper trees visible. Occasional pale dots of bioluminescent mushrooms on the forest floor
- Ground: Fallen leaves, patches of dark moss. A shallow stream crosses the path with unnaturally still water reflecting a sky that doesn't quite match what's above
- Subtle horror element: Among the tree branches, organic shapes that could be cocoons — or could be nothing. Spider silk threads catch the last light. Deep in the background darkness, two faint points of reflected light that might be animal eyes... or might not be

Color palette: Deep greens fading to black, warm amber for the scattered light beams, pale blue-green for bioluminescence, dark brown earth tones. The deeper areas use near-black with hints of sickly violet.

Mood: Beautiful and treacherous. The forest pretends to be ordinary woodland but the light doesn't behave right — it's dimmer than it should be for midday. The silence is too complete. Every rustling sound could be wind, or something that's been watching you since you stepped past the tree line.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9 landscape ratio.
```

---

## 3. 灰脊矿道 (Greyspine Mines) — 主区域

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: The entrance to an old mine carved into a grey mountain face. The economic heart of a nearby town — and the source of its recent terror.

Visual composition:
- Foreground: Rusted iron mine cart tracks emerging from a dark rectangular tunnel mouth, wooden support beams framing the entrance, several rotting warning signs (weathered beyond legibility, only faded paint and wood grain visible)
- Midground: The mine entrance itself — a gaping dark hole in grey rock face, with cold air visibly flowing out as mist. Abandoned mining tools (pickaxes, lanterns) scattered near the entrance. A few broken wooden crates
- Background: The mountain face rising steeply above, grey rock streaked with veins of dark mineral. A rickety wooden elevator platform on the right side, leading down into darkness
- Lighting: Exterior daylight illuminates the entrance area, but the tunnel interior is absolute black except for a single guttering lantern hung just inside, its light seeming weaker than it should be — as if the darkness is actively consuming it
- Subtle horror element: The mine entrance looks like a mouth. The timber supports resemble teeth. Water seeps from cracks in the rock forming patterns that, if you stare long enough, resemble faces screaming. Deep inside the tunnel, barely visible, a faint purple-red glow pulses rhythmically — like a heartbeat

Color palette: Cold greys, iron rust-brown, deep black for the tunnel interior. The single lantern casts sickly yellow. The pulsing deep glow is dark crimson-violet. Mountain rock has green-grey mineral streaks.

Mood: Everything about this place says "do not enter." The miners' abandoned tools tell a story of people who dropped everything and ran. The mountain is not empty — it's full. Something down there is breathing, and the darkness at the entrance isn't the absence of light, it's a presence.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9 landscape ratio.
```

---

## 4. 碎石荒原 (Shatterstone Wastes) — 主区域

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A desolate wasteland of cracked grey rock and sand west of a mountain town. An ancient battlefield where something terrible happened long ago.

Visual composition:
- Foreground: Cracked, parched grey stone ground with deep fissures. Jagged rock formations jutting upward like broken bones or fossilized ribs
- Midground: A winding path through the wasteland, marked by occasional weathered stone cairns. Patches of dead scrubland. Wisps of ground-hugging fog that moves against the wind
- Background: Flat grey horizon broken only by distant ruined structures — one appears to be a crumbling watchtower. The sky is perpetually overcast with low, swirling grey clouds that never seem to rain
- Atmosphere: Thin tendrils of pale fog drifting between rock formations, creating the illusion of movement where there is none. A single dead tree, bleached white, twisted into an unnatural spiral
- Subtle horror element: The cracked ground pattern, seen from above, forms a vast geometric shape — too regular to be natural. The rock formations don't cast shadows in the right direction. In the fog, if you look carefully, silhouettes of armored figures standing at attention — the dead army that never left

Color palette: Desaturated greys, bone-white, muted yellow-brown for dead vegetation. The fog is pale greenish-white. Sky is bruised grey-purple. Occasional rust-red streaks in the rock like old bloodstains that never faded.

Mood: A place where a great many people died violently and the land absorbed their anguish. The fog isn't weather — it's memory. The ground-level cold isn't temperature — it's the breath of whatever was buried here centuries ago and never stopped being angry.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9 landscape ratio.
```

---

# ═══════════════════════════════════════
# 第二部分：破晓镇 子地点（第一人称进入视角）
# ═══════════════════════════════════════

## 1-1. 镇中广场 (Town Square)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: The central square of a small mining town at night. First-person perspective of arriving.

Visual composition:
- Center: An ancient stone obelisk (the Dawn Stele) standing 3 meters tall, carved with unreadable runes that catch moonlight in patterns that seem to shift. A low iron fence surrounds its base
- Left side: Low stone buildings with shuttered windows, a general goods shop with a weathered wooden hanging sign (icon of a barrel and sack, no text)
- Right side: A road leading toward a tavern with warm window glow visible in the distance
- Ground: Worn cobblestones arranged in concentric circles around the stele — an old design that locals don't think about but visitors find unsettling
- Lighting: Pale moonlight from above, the stele's runes glow faintly silver-amber. A single oil street lamp flickers near a bench
- Subtle horror: The cobblestone circle pattern around the stele is actually a seal. Hairline dark cracks run from the stele base outward like frozen lightning

Color palette: Cold blue moonlight, warm amber from distant tavern, silver glow from stele runes, dark stone grey.

Mood: Quiet. Too quiet for a town of 500. The stele stands watching like it has for centuries. The runes pulse with each gust of wind — or maybe with something beneath.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-2. 晨光石碑 (Dawn Stele) — 近景

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: Close-up view of an ancient stone obelisk at night. The player stands right before it.

Visual composition:
- Dominant element: The stele fills 60% of the frame — a tall grey monolith with weathered surface, covered in densely carved runes in an unknown script. Some runes glow faintly silver, others are dark and seem to absorb light
- Base: Moss-covered stone foundation, cracks radiating outward. Dried flower offerings from townsfolk scattered at the base
- Surrounding: Iron fence posts with chain, a few moths circling a nearby lantern
- Lighting: Moonlight creates sharp shadows on the carved surface, making the runes appear three-dimensional. Certain clusters of runes pulse with inner light — always different ones
- Subtle horror: The stele's shadow on the ground is wrong — it's longer than it should be for the moon's position, and its edges writhe microscopically. The runes, if you could read them, are a warning. The moss at the base grows in patterns matching the rune script, as if the stone is teaching the living world its language

Color palette: Silver-grey stone, moonlit blue highlights, amber rune-glow, dark moss green. The shadow is pure void-black with purple edges.

Mood: Standing before something that predates every building in this town by millennia. It's not a monument — it's a lock. And you can feel, in your bones, that the key is somewhere nearby.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-3. 碎盾亭酒馆 (The Shattered Shield Tavern)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: Interior of a worn adventurer's tavern at night. Warm, lived-in, hiding old pain.

Visual composition:
- Foreground: A heavy wooden bar counter, scarred with knife marks and old mug rings. A half-polished mug sits on the counter
- Midground: The main room — 4-5 wooden tables, a crackling fireplace on the right wall. The ceiling is low with exposed timber beams, from which hang dried herbs and a battered shield with a crack down its center (the tavern's namesake)
- Background: A staircase leading up to lodging rooms. A back door to the kitchen. A weapon rack on the wall — decorative now, but the blades are real and maintained
- Details: Candles on tables, a job notice board near the entrance with pinned parchment sheets (shown as overlapping paper rectangles with ink marks, no readable text at this scale), a moose-like creature skull mounted above the fireplace
- Lighting: Warm firelight dominates, creating dancing shadows. The corners of the room remain in comfortable darkness
- Subtle horror: Behind the bar, underneath the counter, a locked iron box that seems to absorb the firelight around it — Greg's locked diary from his dead friend. The cracked shield on the ceiling has a stain that, in the right firelight, looks like a handprint in old blood

Color palette: Warm amber, deep brown wood, orange firelight, copper and brass fixtures. The locked box area is noticeably darker — a cold spot in the warm room.

Mood: The safest place in town. A haven built by a man running from his past. The fire keeps the shadows at bay, but Greg knows — the shadows aren't afraid of fire. They're just being polite. For now.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-4. 破晓旅店 (Dawn's Rest Inn)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: The front room of a modest inn. Clean, orderly, with an all-knowing innkeeper's touch.

Visual composition:
- Foreground: A wooden reception counter with a guest ledger, a small bell, and a vase of wildflowers (the only color in the room)
- Midground: A small common dining area with clean cloth-draped tables. A window reveals the dark street outside. Embroidered curtains with folk patterns
- Background: A hallway leading to guest rooms, each door numbered with brass plates. A staircase leading to the second floor
- Details: A shelf of local preserves and tea tins behind the counter. A framed cross-stitch embroidery on the wall (decorative pattern, no readable text). A cat sleeping on a chair
- Lighting: Warm oil lamp light, softer and steadier than the tavern's firelight. More domestic, less adventurous
- Subtle horror: A guest ledger lies open — dense rows of ink lines, some aggressively scratched out (convey "crossed-out entries" through ink density and scratch marks, not readable names). The cat opens one eye to look at you, and its pupil is briefly slit vertically before returning to normal round

Color palette: Warm but softer than the tavern — honey yellows, cream whites, soft wood browns. Clean and domestic. The scratched ledger entries are in darker ink that seems to stain the surrounding pages.

Mood: Comfort with an undercurrent of information. Chen Ma sees everyone who comes and goes. The ledger records more than names. The tea she serves loosens tongues. This room is warm, but it's also a spider's web — a benevolent one.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-5. 铁砧铺 (The Sturdy Anvil)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: Interior of a dwarven blacksmith's forge. Industrial, hot, honest.

Visual composition:
- Foreground: A massive iron anvil, scarred with decades of hammerwork. Tongs, hammers, and metal blanks arranged with military precision on a wall rack
- Midground: The forge itself — a stone furnace with glowing orange-red coals, bellows attached. Weapon displays on the walls: swords, axes, a shield, all functional and unadorned. An armor stand with a half-finished chainmail
- Background: Stone walls blackened with soot, a small window letting in cool air. A locked cabinet (special orders / rare materials). A workbench with sketches of weapon designs
- Ground: Stone floor with iron filings, a water quench trough with steam rising
- Lighting: Forge-fire dominates — intense orange-red from the furnace, casting everything in harsh warm contrast. Areas away from the forge fall into deep shadow
- Subtle horror: One weapon on the wall — a dagger — has a blade that doesn't reflect the forge light the same way as the others. Its metal is too dark. Grom made it from ore pulled from the deep mines and never sold it because something about it feels wrong

Color palette: Intense forge orange-red, dark iron grey, soot black, copper tones. The anomalous dagger is blue-black like a bruise.

Mood: The most honest place in town. Metal doesn't lie, and neither does Grom. But even he can't explain why the deep-mine ore feels alive when he works it. He shapes it anyway. A dwarf doesn't flinch from metal.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-6. 草药堂 (Greenleaf Apothecary)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A half-elf herbalist's shop. Fragrant, cluttered, hiding a serpent among the leaves.

Visual composition:
- Foreground: A counter covered with mortar-and-pestle sets, glass vials of colored liquids (green, amber, red healing potions), bundled dried herbs
- Midground: Floor-to-ceiling wooden shelves packed with jars, bottles, dried plants, fungi, seeds. A distillation apparatus bubbles gently. Hanging herb bundles from ceiling rafters create a fragrant curtain
- Background: A back room with a curtain — half-open, revealing a small garden courtyard where medicinal plants grow in stone planters. A bookshelf with herbalism references
- Details: A mortar with fresh crushed herbs, green stains on the counter. A small shrine to a nature deity in the corner with a fresh offering
- Lighting: Diffused green-tinted natural light filtering through herb bundles and the back garden. Soft, organic, calming
- Subtle horror: One shelf section, partly hidden behind hanging herbs, contains jars with contents that are too dark, too viscous, with strange dark symbols scratched into the glass (abstract, not readable text). The assistant's workspace — the Eclipsed Whisperer's ingredients. The distillation apparatus sometimes produces a vapor that moves with intent rather than following air currents

Color palette: Rich greens, warm ambers for potions, natural wood and terracotta. The hidden shelf section shifts to sickly purple-black. The vapor is translucent pale green with wrong-colored highlights.

Mood: A garden of healing with a poison vine growing in the back. Ye Lu genuinely helps people. But her assistant serves a different master, and some of the "special orders" shipped through here aren't medicine — they're preparations for a ritual.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-7. 冒险者公会分部 (Adventurer Guild Branch)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A practical adventurer's guild office. Military efficiency meets quiet desperation.

Visual composition:
- Foreground: A heavy oak mission desk with stacked parchments, a wax seal stamp, and a partially unrolled regional map with red X marks (danger zones / disappearance sites)
- Midground: A noticeboard covering an entire wall, covered with pinned parchment sheets of varying age — most have plain wax seals, several have prominent red wax seals (conveying urgency through color, not text). Trophy weapons and monster parts mounted on walls (a wolf skull, giant spider fangs)
- Background: A small armory behind iron bars, a meeting room with a round table, a shelf of adventurer registration records
- Details: A training dummy in the corner with slash marks. A first aid cabinet. An open ledger on the desk with rows of ink entries, several marked with aggressive red ink stamps (convey "overdue/missing" through red color and crossed-out rows, not readable text)
- Lighting: Practical oil lamp lighting, bright and even. Maps and documents clearly readable. Functional, not atmospheric
- Subtle horror: The red stamps in the ledger increase dramatically toward the recent pages — the bottom half of the visible page is almost entirely red. The regional map's red X marks, when seen together, form a pattern — they radiate outward from the deep mines like ripples from a stone dropped in water

Color palette: Functional warm lighting, parchment yellows, dark oak, iron grey for the armory. Red seal/stamp marks provide urgent color accents. The accumulating red in the ledger tells the story without words.

Mood: This place runs on routine and paperwork, but the routine is cracking. Too many adventurers sent out, too few coming back. Han Meng keeps his one arm busy filing reports because if he stops, he'll have to think about what the pattern means.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-8. 镇长府 (Mayor's Office)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A once-dignified mayor's study, now a cage of paranoia. The curtains are always drawn.

Visual composition:
- Foreground: A large mahogany desk drowning in disorganized papers, an untouched cup of cold tea, multiple quill pens — some snapped in half from stress
- Midground: Bookshelves lining the walls, a large official town map with pins (merchant routes, patrol schedules). Heavy velvet curtains drawn tight over windows. An ornate chair that seems too large for its current occupant
- Background: A portrait of Victor's family on the wall — himself, his wife, and a young girl (his kidnapped daughter). The portrait is the only well-maintained thing in the room. A safe in the corner, and a side door leading to private quarters
- Details: A half-empty bottle of wine. A silver-framed daguerreotype lying face-down on the desk. A crushed letter in the wastebin. The door has three separate locks
- Lighting: A single desk lamp casting a pool of yellow light, leaving the rest of the room in oppressive shadow. The curtains block all external light
- Subtle horror: The shadows in the room don't behave correctly — they're deeper than the light source explains, and in the darkest corner behind the desk, something that could be a shadow seems to breathe. The family portrait's painted eyes of the daughter seem to follow you. The crushed letter, if smoothed out, bears a cult eclipse-eye watermark

Color palette: Dark blues, deep mahogany browns, sickly lamplight yellow. The shadows are unnaturally deep purple-black. The family portrait is the only area with normal, warm colors — a window into a happier past.

Mood: A man's mind made physical. Every drawn curtain is a secret. Every lock is fear. Victor Blackstone was a decent mayor once. Now he's a puppet whose strings are invisible but always taut. The room smells of cold tea, cheap wine, and quiet desperation.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 1-9. 银鳞商会 (Silver Scale Guild Hall)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A merchant guild hall that's too opulent for a mining town of 500. Money built this. Dirty money.

Visual composition:
- Foreground: Polished marble floor with the Silver Scale emblem inlaid in silver and jade — a serpent coiled around a balance scale. Velvet rope barriers
- Midground: A grand trading hall with mahogany display cases (ore samples, gemstones, trade goods). A crystal chandelier (absurd for this town's size). Padded chairs and a negotiation table. A large abacus and ledger on a marble counter
- Background: A staircase leading to private upper floors (off limits). Locked vault door visible through an archway. Portraits of previous guild masters on the walls
- Details: The trade goods include ore samples that shimmer with unusual iridescence. A guard standing at the vault entrance. Fresh flowers (imported — nothing local is this colorful)
- Lighting: Bright, almost aggressive chandelier light making everything gleam. Designed to impress and intimidate. No shadows — that's the point
- Subtle horror: This room has NO shadows. That's not natural — the chandelier isn't bright enough to eliminate all shadows, yet there are none. The serpent in the floor emblem's eye is a real gemstone, and if you look at it from different angles, it appears to blink. The ore samples in the display case include deep-mine specimens with the same void-purple shimmer as the cultist's artifacts

Color palette: Opulent golds, marble white, jade green, polished dark mahogany. Silver fixtures. The shadowless room creates an uncanny-valley cleanliness. The void-ore samples provide the only dark color accent — an alien note in the calculated luxury.

Mood: Wealth as a weapon. Everything in this room says "we own this town." Lu Yinzhou built this hall to remind people who controls the ore, the trade routes, the economy. The absence of shadows isn't a lighting trick — he paid for something to keep them away. He doesn't know what he actually bought.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

# ═══════════════════════════════════════
# 第三部分：暮色森林 子地点
# ═══════════════════════════════════════

## 2-1. 森林入口 (Forest Entrance)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: The edge where civilized land meets ancient forest. A threshold.

Visual composition:
- Foreground: A worn wooden signpost, its painted text completely faded and illegible from weather. The last bit of cobblestone path crumbling into dirt
- Midground: The tree line — massive trunks forming a natural archway. The canopy above filters sunlight into scattered beams. A footpath disappears between the roots
- Background: Deepening green darkness between trees. Bird sounds would be here, but the trees closest to the entrance are oddly silent
- Ground: Transition from packed dirt to leaf litter, moss, exposed roots
- Lighting: Bright behind (town side), rapidly dimming ahead. The transition is abrupt — three steps into the forest and daylight halves
- Subtle horror: The tree bark near the entrance has claw marks at about wolf height. Old, deep. The path has two sets of footprints going in. None coming out. Fresh.

Color palette: Warm brown dirt transitioning to cool dark green. The light gradient from gold to emerald to near-black tells the story of depth.

Mood: A door you can walk through but might not walk back from. The forest has been here longer than the town. It's patient.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 2-2. 旧伐木场 (Old Lumber Camp) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: An abandoned lumber camp reclaimed by goblins. Industrial ruin meets feral habitation.

Visual composition:
- Foreground: A collapsed log pile, rusted two-man saw, rotting stumps. A crude goblin warning totem made of sticks and a small animal skull
- Midground: The remains of a timber frame building — roof caved in, walls leaning. Inside: crude goblin bedrolls, stolen goods piled messily, a cookfire ring with bones. Scrap metal armor hung on nails
- Background: A larger structure — the old foreman's cabin, now the bugbear leader's den. Its door is reinforced with scavenged metal. Goblin-carved symbols on the doorframe
- Details: Empty cages (for captured animals or... people?). A half-eaten deer carcass. Tripwire traps rigged across the path
- Lighting: Dappled forest light, the cookfire's residual warmth. Goblin-green phosphorescent paint marks territories
- Subtle horror: Among the stolen goods — a miner's helmet and pickaxe. Fresh. The cages have scratch marks on the inside.

Color palette: Decayed browns and greys for the camp ruins, sickly green for goblin markings, rust-orange for scavenged metal. Dark forest backdrop.

Mood: Civilization tried to cut this forest down. The forest took its buildings back and gave them to something worse. The goblins aren't the scariest thing here — they moved in because something deeper in the forest pushed them to the edges.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 2-3. 猎人石屋 (Hunter's Stone House) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A hermit hunter's stone cottage deep in the forest. Deliberately hidden, deliberately quiet.

Visual composition:
- Foreground: A small clearing with animal pelts stretched on drying racks. Snare traps and hunting tools hung on external wall hooks. A chopping block with a hatchet embedded in it
- Midground: The cottage itself — rough-cut grey stone, moss-covered roof, a single chimney with thin smoke. One window with shutters, a heavy wooden door. Firewood stacked neatly against the wall
- Background: Dense forest pressing in from all sides, the clearing feels like a pocket carved from the woods. Animal trails visible leading away
- Details: A wind chime made of bone and copper that serves as an alarm system. A map of the forest scratched into a flat stone near the door. Fresh tracking marks in the mud
- Lighting: A single beam of canopy-filtered light illuminating the clearing like a spotlight. The cottage window has warm golden glow
- Subtle horror: The bone wind chime is not made from animal bones — one piece is distinctly humanoid (a finger bone). The hunter knows what's in this forest. His stone cottage isn't just shelter — it's a fortress. The walls have scratch marks on the OUTSIDE, at heights no wolf could reach

Color palette: Forest greens, stone grey, warm amber from the window, bone-white chimes. The scratch marks are pale against dark stone.

Mood: Someone who chose to live in the danger rather than pretend it doesn't exist. Old Lin knows these woods like his own heartbeat. The fact that he still bolts his door at night says everything about what walks here after dark.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 2-4. 月池 (Moon Pool) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A supernatural forest pool where a shadow cult performed summoning rituals. Residual dark energy lingers.

Visual composition:
- Foreground: Flat stone slabs arranged in a semicircle around the pool — clearly artificial, altar-like. Dried wax drippings from black candles. Strange chalk markings half-washed by rain
- Midground: The pool itself — perfectly circular (unnaturally so), about 3 meters across. The water is black as ink but perfectly still, reflecting the moon with impossible clarity even through the canopy. Faint ripples appear with no wind or fish to cause them
- Background: Dead trees ring the clearing — living forest stops abruptly in a perfect circle around the pool. The dead trees have bark that's turned white, like bleached bone
- Atmosphere: Fog rises from the pool surface, but it rises downward — falling up into the canopy like inverted rain
- Lighting: Intense moonlight focused on the pool as if the canopy has a hole directly above (it doesn't — the light comes from the water itself). The surrounding area is pitch black
- Subtle horror: The pool reflects the moon. But there's no moon tonight. The reflection shows a sky full of stars in constellations that don't exist. If you stare too long, something in the reflection stares back — a vast eye opening behind the false stars

Color palette: Void-black water, bone-white dead trees, silver-blue reflected moonlight, dark purple for residual shadow energy. The chalk marks glow faint sickly green.

Mood: A wound in the world that hasn't healed. The cult opened something here. They thought they closed it when they left. They were wrong. The pool doesn't reflect this world — it's a window to somewhere else, and the glass is cracked.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

# ═══════════════════════════════════════
# 第四部分：灰脊矿道 子地点
# ═══════════════════════════════════════

## 3-1. 上层矿道 (Upper Mine Shafts)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: The still-operational upper level of a mountain mine. Normal on the surface, but something is wrong with the sounds.

Visual composition:
- Foreground: Iron rail tracks with a mine cart, partially loaded with grey ore. Wooden support beams with iron reinforcements. Pickaxe marks on the walls — fresh, active work
- Midground: A branching tunnel intersection, one path lit by oil lanterns (active shaft), the other blocked by a wooden barricade with faded warning signs (illegible, paint peeling — the meaning is conveyed by the barricade itself, not by text)
- Background: The lit tunnel stretches ahead, lanterns creating pools of light between stretches of darkness. Dripping water from the ceiling
- Details: Miner's helmets and lunch pails on a rack (workers on break). A ventilation shaft in the ceiling with cold air flowing. Support pillars with chalk tally marks counting production
- Lighting: Warm lantern light in active areas, total darkness beyond. The barricade blocks a passage that seems to exhale cold, stale air
- Subtle horror: The barricade's wood is new — hastily built. Through gaps in the boards, the tunnel beyond is darker than darkness, and a faint whistling sound comes from deep below that rises and falls like breathing. The tally marks on the nearest pillar have been crossed out for the last two weeks

Color palette: Warm amber lantern light, cold grey stone, iron-brown rails, deep black tunnels. The air from beyond the barricade carries visual distortion, like heat shimmer but cold.

Mood: People still work here. That's the most unsettling part. Every day they come down, mine ore within earshot of whatever made the deep levels uninhabitable, and go home pretending the barricade will hold. The whistling is getting louder.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 3-2. 废弃矿工宿舍 (Abandoned Barracks) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: An abandoned workers' dormitory deep in the mines, repurposed as a shadow cult meeting point.

Visual composition:
- Foreground: Overturned bunk beds and rotting mattresses pushed to the walls to clear a central space. A stone floor cleaned of dust in a perfect circle
- Midground: The cleared center — a ritual space. An eclipse-eye symbol painted in dark substance on the floor. Black candle stubs at five points. Scattered cult pamphlets with indoctrination text. A makeshift altar of stacked mining equipment topped with a dark crystal shard
- Background: The dormitory walls — old miner graffiti ("Day 34", "Miss home") overlaid with cult symbols in dark paint. A passage leads deeper into the mines. Locker doors hanging open, personal items of vanished miners still inside
- Details: A cult robe folded neatly on a chair — someone was here recently. Empty potion vials with dark residue. A list of names — some crossed out
- Lighting: A single lantern with a dark purple glass filter casting everything in bruised violet light. The eclipse-eye on the floor seems to drink the light
- Subtle horror: The miners' personal items in the lockers include faded photographs and children's crayon drawings. A pinned sheet on the wall has rows of entries with most scratched out in dark ink — a visual roster of the disappeared. The crystal shard on the altar pulses with a rhythm that matches your heartbeat — and adjusts when you notice it

Color palette: Dark violet cultist light, grey stone, rust-brown iron, black ritual markings. The crystal shard is void-purple with internal crimson lightning. The miners' personal items are the only normal-colored objects — washed out by the purple light.

Mood: Two timelines overlapping. The miners who lived here laughed, complained, missed their families. The cult came after and painted their despair over with madness. The crystal doesn't care about either group — it's been awake longer than the mine has existed.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 3-3. 深渊祭坛 (Abyss Altar) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: The deepest point of the mines — a natural cavern repurposed as the cult's primary altar. The climactic ritual site.

Visual composition:
- Foreground: Jagged natural rock floor dropping into a vast cavern. Stalactites and stalagmites. The mine tunnel opens onto a ledge overlooking the space below
- Midground: A massive natural stone platform in the center of the cavern, carved with concentric ritual circles. Black stone pillars (not mine-carved — far older) surround the platform. Chains bolted to the pillars (for restraining sacrifices). Cult banners bearing the eclipse-eye hang from stalactites
- Background: The cavern walls are covered in the same runes as the Dawn Stele in town — but inverted, as if this is the other end of a key-and-lock pair. Far below the platform, an abyss of unknown depth where no light reaches
- Atmosphere: Cold mist rises from the abyss. The air has a physical pressure, like being underwater. Sound behaves wrong — echoes return in different voices
- Lighting: Scattered purple-crimson void-light from cracks in the cavern walls that pulse rhythmically. No natural light whatsoever. The ritual circles on the platform glow faintly when the void-light pulses
- Subtle horror: The abyss below the platform is not empty. If you stare into it, the darkness MOVES — not shifting shadows, but something vast and singular adjusting its position. The runes on the walls are bleeding — dark liquid seeps from the carved lines. The chains have been used recently

Color palette: Void-black and dark crimson dominate. Purple-violet ritual glows. The stone is unnaturally dark grey, almost organic. The chain iron has a wrongness — too smooth, like it was grown rather than forged.

Mood: You've reached the bottom. Not of the mine — of reality. This cavern existed before the mountain formed around it. The cult found it; they didn't create it. Something has been waiting here since before humans existed, patient as geology, and it's almost awake.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 3-4. 虚空棱镜室 (Void Prism Chamber) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A sealed chamber adjacent to the Abyss Altar containing the Void Prism — an artifact that weakens reality itself.

Visual composition:
- Foreground: A narrow passage opens into a small, perfectly cubic chamber — walls too smooth for mining, as if reality was cut with a scalpel. No tool marks
- Center: The Void Prism — a floating black crystalline octahedron, roughly 30cm across, hovering at chest height. It doesn't reflect light — it consumes it. The air around it warps visibly, like looking through old glass. Faint geometric patterns orbit the prism like electron shells
- Walls: The chamber walls show the geological cross-section of millennia — layers of rock that simply stop at the chamber boundary, as if the room was inserted into the mountain rather than carved from it
- Floor: A containment circle carved into the stone, filled with silver-like liquid metal that flows continuously in a loop. Salt lines. Failed containment attempts
- Lighting: The prism is a light SINK — everything near it is darker. The only illumination comes from the orbiting geometric patterns and the silver floor-liquid. Both cast anti-shadows — areas of light where shadows should be
- Subtle horror: Standing in this room, you can hear a sound below human hearing — a vibration in your chest. Your shadow points toward the prism instead of away from the light source. The silver liquid's flow pattern traces words in a language that predates all known civilizations. The prism is not an artifact — it's an egg

Color palette: Void-black prism, silver-white containment liquid, geometric patterns in impossible colors (colors that shouldn't exist in pixel art — suggest them through dithering of purple, black, and electric blue). The chamber stone is dead grey — no mineral variation, unnaturally uniform.

Mood: The end of the game is here. Everything — the cult, the disappearances, the stele, the town — revolves around this object. It's beautiful in the way a black hole is beautiful. The sound it makes isn't a sound — it's silence with teeth.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

# ═══════════════════════════════════════
# 第五部分：碎石荒原 子地点
# ═══════════════════════════════════════

## 4-1. 荒原入口 (Wasteland Entrance)

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: The western edge of a desolate wasteland. Transition from mountain valley to ancient dead land.

Visual composition:
- Foreground: A dry riverbed with cracked mud and bleached stones. A crude wooden gate marking the town's western boundary, half-collapsed
- Midground: The wasteland opens — flat grey rock extending to the horizon, broken by jagged stone formations rising like teeth from a buried jaw. A faint path marked by stone cairns
- Background: Low grey clouds pressing down. Distant smoke or dust column rising from somewhere unseen. The silhouette of a ruined tower far away
- Ground: Cracked stone with geometric fracture patterns. Sparse dead grass. Bone-dry
- Atmosphere: Ground-hugging pale fog that moves laterally, always westward, regardless of wind direction
- Lighting: Flat, grey, oppressive. No shadows because the overcast is total. The light seems to come from everywhere and nowhere
- Subtle horror: The stone cairn path markers are not carved — they're natural formations that just happen to form a trail. Or something arranged them to look natural. The fog at ankle level occasionally reveals shapes beneath it — flat stones? Or the surface of something larger, buried?

Color palette: Desaturated everything — grey stone, grey sky, bone-white dead grass, rust-red rock streaks. The fog is greenish-pale. The distant smoke is the only dark vertical element.

Mood: The world died here once. It's still dying. The air tastes like old iron and regret.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 4-2. 兽人营地 (Orc War Camp) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A fortified orc war camp in the wasteland, driven to unusual aggression by shadow energy corruption.

Visual composition:
- Foreground: A crude palisade of sharpened logs and scavenged metal sheets. Tribal war banners in red and black. Bone trophies on stakes
- Midground: The camp interior — hide tents around a central bonfire. Weapon racks overloaded with crude but effective arms. A training ground with straw targets (slashed to ribbons). An orc shaman's tent, larger, draped in strange dark-purple cloth that doesn't match orcish aesthetics
- Background: Rocky outcrops forming a natural wind break. Patrol sentries on elevated positions. The wasteland stretching beyond
- Details: War drums near the fire. Meat drying on racks. The shaman's tent has shadow-cult symbols mixed with traditional orcish totems — a corruption of their spiritual practice
- Lighting: Bonfire orange dominates the camp. The shaman's tent absorbs light — its purple cloth creating a dark void within the warm firelit scene
- Subtle horror: The orcs' war paint includes patterns they don't traditionally use — eclipse-eye derivatives they've adopted without understanding their origin. The shaman's tent pulses with the same rhythm as the deep mine crystal. These orcs aren't naturally this aggressive — they're being amplified

Color palette: Warm bonfire orange and red for the camp, dark purple anomaly for the shaman's tent. Orc greens and browns. Bone-white trophies. The contrast between normal orcish warmth and the cold purple intrusion tells the story.

Mood: Orcs are straightforward — they fight, they feast, they sleep. But something has poisoned their shaman's visions, and now they raid with a fury that frightens even themselves. They don't know why they can't sleep anymore, or why the shaman's eyes have turned purple.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 4-3. 古战场墓冢 (Ancient Barrow) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A half-collapsed underground burial mound from an ancient war. The dead are becoming restless.

Visual composition:
- Foreground: A stone staircase descending into earth, partially blocked by collapsed rubble. Carved stone archway with eroded warrior figures flanking the entrance
- Midground: The barrow interior — a long chamber with stone sarcophagi lining both walls. Some lids have shifted. Ancient weapons and armor in alcoves, corroded but still identifiable. Wall murals depicting a battle — humans fighting something from the sky
- Background: The chamber deepens into darkness. A faint glow from the far end — a pedestal holding a stone fragment that shimmers with the same material as the Dawn Stele
- Floor: Dust, scattered bones, footprints in the dust that aren't yours. Small pieces of broken pottery. Dried flowers from offerings decades old
- Lighting: Your light source is the primary illumination. The stele fragment at the back emits cold silver light. Between your light and the fragment: complete darkness where things shuffle
- Subtle horror: One sarcophagus is empty. The lid is on the floor. The dust around it shows drag marks leading deeper into the barrow. The wall murals' "something from the sky" looks disturbingly like the geometric patterns orbiting the Void Prism. The ancient warriors fought this before — and they lost

Color palette: Dust brown, cold stone grey, corroded bronze-green for ancient metal. The stele fragment's silver glow is the only clean color. The darkness between light sources is absolute void.

Mood: A memorial to humanity's first encounter with the void. They buried their dead here and the fragment as a ward. Centuries later, the ward is weakening because the Prism is waking up, and the dead are beginning to remember the war they lost.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

## 4-4. 废弃瞭望塔 (Ruined Watchtower) — 隐藏地点

```
Create a pixel art scene in dark Cthulhu-themed 2D RPG style.

Scene: A crumbling stone watchtower on a rocky outcrop, offering a panoramic view of the wasteland. The last post of a dead adventurer.

Visual composition:
- Foreground: The tower's base — circular stone wall, partially collapsed. A doorway with no door. Rubble and dead vines
- Midground: The interior — a spiral stone staircase winding upward, some steps missing. Ground floor has remnants of a camp: bedroll, extinguished fire, scattered supplies — someone lived here recently. A journal lies open on a makeshift desk of stacked stones
- Upper section (visible through the collapsed wall): The top platform with a panoramic view — grey wasteland stretching in all directions, the town visible as distant warm lights to the east, the orc camp as a bonfire dot to the north, the forest line to the south
- Details: An open journal on the desk with dense scribbled lines and a rough hand-drawn map sketch (all illegible at this distance/scale — convey "writing" through ink-line texture, not actual readable text). A telescope (cracked lens). Signal flares (unused). A blood stain on the staircase above the camp
- Lighting: Grey daylight flooding through the gaps in the walls. Wind whistling through the tower creates a low moaning sound
- Subtle horror: The open journal pages show ink lines becoming increasingly chaotic — neat rows devolving into frantic scrawl, then a page filled entirely with the same repeated stroke pattern (convey "madness" through ink density and line chaos, not readable words). The blood stain on the stairs leads upward but there's no body at the top. The telescope, if you look through it at the town, shows the Dawn Stele — surrounded by something that isn't visible to the naked eye

Color palette: Weathered stone grey, pale sky, distant warm amber for town lights. The journal is yellowed parchment. The blood is dried brown-black. The view through the telescope could be rendered as a circular vignette with disturbing color distortion.

Mood: Someone came here to watch and understand. They watched too long, or understood too much. The tower offers clarity — sometimes that's a curse. From here, you can see the pattern connecting every location. Whether you can unsee it is another question.

Style: pixel art, 2D, retro RPG scene, dark Lovecraftian atmosphere, limited palette, visible pixel texture, 16:9.
```

---

# ═══════════════════════════════════════
# 生成规范
# ═══════════════════════════════════════

## 风格一致性要求

1. **统一画布**：256×144 像素（16:9），与 NPC 立绘的 128×128 区分
2. **像素密度**：保持与 NPC 立绘一致的像素粒度感
3. **克苏鲁元素分级**：
   - 安全区域（镇内）：暗示级 — 裂缝、不正常的影子、异常的光
   - 中危区域（森林/荒原）：可见级 — 明显的异常现象、仪式痕迹
   - 高危区域（矿道深层）：直面级 — 虚空能量、不可名状的存在感
4. **颜色规范**：
   - 破晓镇：暖色基调（琥珀、金黄、暖褐），冷色恐怖点缀
   - 暮色森林：绿色渐变到黑，生物光蓝绿色
   - 灰脊矿道：冷灰石色 + 虚空紫红，人造暖光对比
   - 碎石荒原：全灰度去饱和，锈红和骨白点缀
5. **无角色**：场景图不包含任何 NPC 或怪物，纯环境

## 文件命名规则

```
# 主区域
scene-dawnbreak-town.png
scene-twilight-woods.png
scene-greyspine-mines.png
scene-shatterstone-wastes.png

# 破晓镇 POI
scene-town-square.png
scene-dawn-stele.png
scene-shattered-shield-tavern.png
scene-dawns-rest-inn.png
scene-sturdy-anvil.png
scene-greenleaf-apothecary.png
scene-adventurer-guild.png
scene-mayor-office.png
scene-silver-scale-guild.png

# 暮色森林 POI
scene-forest-entrance.png
scene-old-lumber-camp.png
scene-hunter-stone-house.png
scene-moon-pool.png

# 灰脊矿道 POI
scene-upper-mines.png
scene-abandoned-barracks.png
scene-abyss-altar.png
scene-void-prism.png

# 碎石荒原 POI
scene-wastes-entrance.png
scene-orc-camp.png
scene-ancient-barrow.png
scene-ruined-watchtower.png
```

## 总计：24 张场景图

- 4 张主区域远景
- 9 张破晓镇 POI
- 4 张暮色森林 POI
- 4 张灰脊矿道 POI
- 4 张碎石荒原 POI（含入口）
