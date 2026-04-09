# Lore 索引

这是 lore 系统的人肉可读索引（**DM 查询时用 ListLore / ReadLore / GrepLore 工具，不要读这个文件**）。

## 组织原则

- 按类型分目录：`characters/` `places/` `events/` `factions/` `world/`
- 文件名（去 `.md` 后缀）即条目 id，例如 `characters/greg.md` 的 id 是 `greg`
- YAML frontmatter 控制可见性：`chapter_visible` 字段决定从第几章起 DM 能查到
- Frontmatter 的 `name` 是显示名，`aliases` 允许多个名字命中同一条目

## 当前条目

### characters/
- **greg** — 格雷格·铁拳头（ch1+），碎盾亭老板，前银月佣兵团突击手
- **xiaoli** — 小莉（ch1+），12 岁，格雷格收留的帮工女孩
- **elena** — 艾琳娜·银叶（ch1+），340 岁高等精灵，冒险者公会会长

### places/
- **shattered-shield-tavern** — 碎盾亭（ch1+），格雷格的酒馆，第一章起点

### events/
- **darian-death** — 达里安之死（ch2+），格雷格和艾琳娜之间那条无形裂缝的源头

## 预留目录

- `factions/` — 派系（冒险者公会、银月佣兵团、蚀目者邪教……）
- `world/` — 世界观（神祇、时间线、地理概况……）

## 添加新条目的检查清单

1. 选对目录（type 和目录不一致时以 frontmatter 为准）
2. frontmatter 必须包含 `name` 和 `type`
3. 如果是包含剧透/隐藏信息的条目，设 `chapter_visible` 到正确的章节号
4. 正文用 Markdown，保持简洁（50KB 以上会被截断）
5. 用 `related:` 字段互相引用相关条目，方便 DM 顺藤摸瓜
