# 第一地图 · 怪物立绘 Prompt 集（暮色森林）

> **生成工具**: GPT Image 2 (或 DALL-E 3 / Midjourney 同等级)
> **用途**: 战斗演出卡片(`#battle-actor-stage`)+ 棋盘单位立绘 + 图鉴卡
> **目标**: 5 只暮色森林相关怪物的像素风立绘
> **保存路径**: `/public/portraits/monsters/<filename>.png`

## 风格统一指令(每个 prompt 复制粘贴时务必带上)

```
Style: pixel art creature portrait, 2D retro RPG style, dark Lovecraftian/Cthulhu horror atmosphere, limited color palette with muted tones and eerie highlights, single creature centered on solid dark background (deep midnight blue #0a0a14 or near-black), creature in 3/4 view facing slightly left, visible pixel texture, reminiscent of Darkest Dungeon meets classic SNES RPGs. NO text NO UI elements NO borders.
```

> **与人物立绘的画风一致性**：NPC/PC 立绘全部使用同一套像素风格（`pixel art, 2D retro RPG, dark Lovecraftian atmosphere, limited palette, visible pixel texture`）。怪物立绘必须保持统一，保证战斗时玩家角色与怪物卡片视觉风格一致，不出戏。

## 关键规格

- **尺寸**: 1024×1024（GPT Image 2 生成正方形，最终显示时由 CSS `object-fit: cover` 裁剪适配）
- **格式**: PNG，深色实底背景（#0a0a14）
- **构图**: 主体居中，占画面 60-70%，留头顶+脚下空间
- **像素感**: 即便生成分辨率较高，画面必须保持清晰的像素颗粒感、有限色板、无抗锯齿平滑
- **避免**: 多余文字、UI 框、白色背景、过曝高饱和色、Q 版萌系、写实照片风、手绘水彩质感
- **建议生成 2-3 张选最好的** —— LLM 生图随机性大

---

## 1. Goblin · 哥布林 → `monster-goblin.png`

```
Create a pixel art creature portrait in dark Cthulhu-themed 2D RPG style.

Creature: A small, gangly humanoid goblin — child-sized but malevolent. A cowardly scavenger that hunts in packs.

Visual details:
- Mottled grey-green leathery skin with patches of warts and old scars
- Disproportionately large pointed ears, one notched/torn from an old fight
- Sunken yellow eyes glinting with cunning hunger, oversized pupils
- Wide grin showing crooked yellowed fangs, drooling slightly
- Wearing rags and crudely stitched leather scraps, a rope belt with bone trinkets
- Holding a rusted serrated dagger in one hand, other hand twitching with anticipation
- Crouched posture, weight on balls of feet — ready to spring or flee

Atmosphere: Lurking in the underbrush, dim forest light filtering from above casting long shadows. Faint wisps of dirty mist around feet.

Color palette: muted forest greens, sickly yellow eye glow, dirty browns, blood-rust on the dagger. Cold moonlight blue rim-lighting from upper-right.

Mood: A pest, a thief, a coward — but in numbers, deadly.

Style: pixel art, 2D, retro RPG portrait, dark Lovecraftian atmosphere, limited palette, visible pixel texture. Single creature on solid dark background (#0a0a14).
```

---

## 2. Wolf · 暮色狼 → `monster-wolf.png`

```
Create a pixel art creature portrait in dark Cthulhu-themed 2D RPG style.

Creature: A large grey timber wolf, unnaturally large and wrong — touched by corruption seeping from the dark woods.

Visual details:
- Powerful predator build, larger than a normal wolf, shoulder-height around a human's chest
- Thick shaggy fur in shades of slate grey and silver, matted with old blood at the muzzle
- Glowing pale yellow eyes with vertical slit pupils (NOT round wolf eyes — this is wrong, corrupted)
- Lips peeled back showing oversized canines, faint black sap-like saliva dripping
- A single old scar across the snout
- Low predatory crouch, head lowered below shoulders, tail straight back
- Hackles raised along the spine, one paw lifted mid-step — the silent stalking moment

Atmosphere: Standing on damp forest floor scattered with rotting leaves. Mist coiling around its legs.

Color palette: cool greys and silvers dominant, sickly yellow eye glow, hint of necrotic black at mouth. Deep midnight blue background fading to black.

Mood: Apex predator that has tasted something it should not have. The pack is always nearby, but tonight it hunts alone.

Style: pixel art, 2D, retro RPG portrait, dark Lovecraftian atmosphere, limited palette, visible pixel texture. Single creature on solid dark background (#0a0a14).
```

---

## 3. Cockatrice · 鸡蛇怪 → `monster-cockatrice.png`

```
Create a pixel art creature portrait in dark Cthulhu-themed 2D RPG style.

Creature: A bizarre chimera the size of a large dog — body of a fighting cock fused with the tail and hindquarters of a serpent. Cursed, capable of petrifying with its bite.

Visual details:
- Upper body: rooster-like with dark feathers in oily green-purple-bronze iridescence
- Hooked beak open in a hissing gape, forked snake-tongue flicking out
- Wattle and comb a sickly bruised purple, not red
- Cold reptile yellow eyes with vertical slits
- Lower body transitions into thick scaled serpent tail coiled beneath
- Tail tip ends in a barbed spur
- Sharp clawed bird feet gripping a half-petrified small animal (partially turned to stone)
- Wings half-spread for intimidation, feathers ragged

Atmosphere: A forest clearing on broken stone, several small petrified creatures (mice, frogs) scattered in dirt. Faint sickly green miasma rising.

Color palette: oily iridescent dark greens and purples on feathers, sulfurous yellow eyes, dead grey stone for petrified prey.

Mood: A creature that should not exist. Nature's mistake, given malice.

Style: pixel art, 2D, retro RPG portrait, dark Lovecraftian atmosphere, limited palette, visible pixel texture. Single creature on solid dark background (#0a0a14).
```

---

## 4. Giant Spider · 巨型蜘蛛 → `monster-giant-spider.png`

```
Create a pixel art creature portrait in dark Cthulhu-themed 2D RPG style.

Creature: A horse-sized spider, offspring of the matriarch. Black-bodied with unnatural purple veining suggesting deeper corruption.

Visual details:
- Bulbous abdomen the size of a beer keg, glossy black chitin with faint purple pulsing veins beneath the surface (void corruption)
- Eight long jointed legs, segmented and bristled, two raised in threat display
- Cluster of eight glassy black eyes, the largest two glowing faint amethyst purple
- Massive serrated chelicerae (fangs) parted, dripping translucent venom
- Body raised off ground in defensive web posture
- Faint silver-purple silk strands trailing from spinnerets behind

Atmosphere: Crouched in shadow between ancient tree roots draped in purple-tinted webbing. Half-cocooned prey (a deer skull wrapped in silk) faintly visible in background webs.

Color palette: deep matte black chitin, amethyst purple veining and eye glow, silver-violet web strands. Deep midnight blue background fading to black.

Mood: Not a normal spider. A fragment of something larger — and it knows you saw it.

Style: pixel art, 2D, retro RPG portrait, dark Lovecraftian atmosphere, limited palette, visible pixel texture. Single creature on solid dark background (#0a0a14).
```

---

## 5. Spider Matriarch · 蛛母·织暗者 (BOSS) → `monster-spider-matriarch.png`

```
Create a pixel art creature portrait in dark Cthulhu-themed 2D RPG style.

Creature: The Spider Matriarch — Weaver of Shadows. Boss-tier monstrosity. Far more intelligent and ancient than her offspring. The first sign of void corruption seeping into the surface forest.

Visual details:
- Massive size — body larger than a draft horse, eight legs spanning twice that
- Abdomen swollen and semi-translucent with a sickly purple-violet glow from within (a cyst of void energy)
- Iridescent black-purple chitinous shell with carved-looking ritual patterns etched into the carapace
- TEN eyes (not eight) — six clustered above, four below — all glowing cold violet, the largest one deep and dark like a black hole
- Oversized hooked chelicerae dripping silver-violet venom that smokes where it falls
- Faint silver-purple aura shimmer around body
- One front leg raised, tip resembling a clawed scythe
- Three large pulsating egg-sacs at her base, semi-translucent with shadowy shapes writhing inside
- Thick web strands trailing from spinnerets into the darkness beyond the frame

Atmosphere: Throne-like position in the depths of her lair — a cathedral-cavern of bone-pale silk. Soft violet-purple backlight (the void breach) silhouetting her form, casting a long shadow forward toward the viewer.

Color palette: oppressive black and deep purple-violet dominant, silver-violet venom and web highlights, sickly amber glow from within abdomen. Background near-black with subtle web texture.

Mood: A queen of webs and silence. She has been waiting a long time. Her eyes open one by one.

Style: pixel art, 2D, retro RPG portrait, dark Lovecraftian atmosphere, limited palette, visible pixel texture. Single creature on solid dark background (#0a0a14). This is a BOSS creature — she should feel visually grander and more imposing than the regular monsters, with more detail and richer color work in the pixel art.
```

---

## 代码映射（生成完成后需补充）

现有 `MONSTER_PORTRAITS`（`src/engine.ts:377`）：

```typescript
const MONSTER_PORTRAITS: Record<string, string> = {
  'Shadow': 'portraits/monster-shadow.png',
  'Ghoul': 'portraits/monster-ghoul.png',
  'Mimic': 'portraits/monster-mimic.png',
  'Eclipsed Beast': 'portraits/monster-eclipsed-beast.png',
}
```

待追加（5 张画完后）：

```typescript
  'Goblin': 'portraits/monsters/monster-goblin.png',
  'Wolf': 'portraits/monsters/monster-wolf.png',
  'Cockatrice': 'portraits/monsters/monster-cockatrice.png',
  'Giant Spider': 'portraits/monsters/monster-giant-spider.png',
  'Spider Matriarch': 'portraits/monsters/monster-spider-matriarch.png',
```

> **注意**：key 必须与 `game-data.ts` 中怪物的 `name` 字段完全一致（英文）。
> 路径用 `portraits/monsters/` 子目录，与 NPC 立绘区分。

---

## 文件命名约定

PNG 文件放 `/public/portraits/monsters/` 目录：
- `monster-goblin.png`
- `monster-wolf.png`
- `monster-cockatrice.png`
- `monster-giant-spider.png`
- `monster-spider-matriarch.png`

---

## 后续（暂不画，等第二地图开做）

第二地图（灰脊矿道 greyspine-mines）：
- Skeleton, Ghoul, Mimic, Shadow, **Shadow Weaver** (boss)

第三地图（荒石塔 ruined-watchtower）：
- Hobgoblin, Orc Warrior, **Eclipsed Beast** (boss)
