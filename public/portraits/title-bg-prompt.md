# 入口背景图 Prompt v3 — 破晓镇 · 蚀目之影

> **用途**：游戏登录页 / 欢迎回来页全屏背景
> **文件名**：`title-bg.png`
> **尺寸**：512×288（前端 image-rendering: pixelated 放大）
> **核心思路**：不画场景，画海报。晨光石碑 = 游戏标志。孤影面对巨碑 = 叙事起点。

---

## Prompt

```
TRUE pixel art, hard pixel edges, NO anti-aliasing, NO blur, NO soft gradients. Each pixel block has sharp staircase boundaries. Style of Octopath Traveler HD-2D pixel backgrounds meets Darkest Dungeon atmosphere. 512×288 canvas, 16:9. NO text, NO UI, NO readable characters.

=== COMPOSITION: VERTICAL POSTER — "THE STELE AND THE STRANGER" ===

CENTER OF FRAME: A tall ancient stone monolith (the Dawn Stele) rises from the ground, occupying roughly 20% of the frame width and stretching from the lower third to the upper third of the image. The stele is weathered grey stone covered in faintly carved rune patterns.

THE LIGHT: The stele emits a warm golden luminescence from within — not fire, not flame, but light TRAPPED INSIDE the stone itself, seeping through the carved rune lines like veins of molten gold. This golden glow radiates outward, illuminating the cobblestone ground in a pool of amber warmth (~40% of the frame width). The light catches rain droplets in the air as tiny golden sparks. The rune lines glow brightest at the stele's center and fade toward its edges.

THE FIGURE: At the base of the stele, a VERY SMALL human silhouette (maybe 30 pixels tall) stands looking up at the monolith. Just a dark shape — hooded cloak, travel pack, one hand slightly raised as if reaching toward the stone. This tiny figure against the towering stele creates the sense of scale and loneliness.

THE DARKNESS: Beyond the stele's golden light radius, everything falls into deep shadow. We can barely make out: the outlines of sleeping town buildings on both sides, low stone walls, a few dark rooftops. One or two faint amber dots of candlelight in distant windows. The darkness is not empty — it has depth and texture, layers of deep navy and charcoal suggesting structures just beyond visibility.

THE SKY: Above the stele and town rooftops, jagged mountain silhouettes (sharp pixel sawtooth edges). Above the mountains, a deep indigo sky with a thin crescent moon. CRITICAL: Two or three hairline CRACKS in the sky — purple-violet fractures in reality, like a dark mirror beginning to shatter. Faint violet glow along the crack edges. Stars near the cracks glow reddish. These are subtle but unmistakable once you notice them.

THE GROUND: Wet cobblestones reflecting the stele's golden light in sharp pixel highlights. A few puddles. At the very bottom edge of the frame, barely visible: muddy carriage wheel ruts trailing off the left side — a hint that someone just arrived.

=== LIGHT/DARK CONTRAST (THIS IS KEY) ===
The image should read as a dramatic chiaroscuro: a strong warm golden core (the stele and its light pool, ~30% of frame) surrounded by vast cold darkness (~70% of frame). The transition from light to dark should be visible but not gradual — pixel art dithering patterns at the light boundary, not smooth gradients. The contrast ratio should be extreme: the stele runes are the brightest pixels in the entire image, the sky corners are nearly pure black.

=== COLOR PALETTE (STRICT) ===
- Deep darkness: #090b12, #0e1019, #151825 (navy-black tones)
- Stone/buildings: #2a2a35, #3a3845 (cool grey)
- Stele runes (brightest): #e6c866, #d4a030 (golden)
- Light pool on ground: #4a3520, #6b4a28 (warm reflected amber, muted)
- Sky cracks: #6b2050, #4a1a5a (crimson-violet, thin lines only)
- Moon: #aabbcc (silver, small)
- NOTHING else should be bright. 90% dark, 10% golden light.

=== MOOD ===
A lone traveler stands before something ancient and luminous, in a town swallowed by night, under a sky that is beginning to break. Beautiful, quiet, ominous. The kind of image that makes you hold your breath.
```
