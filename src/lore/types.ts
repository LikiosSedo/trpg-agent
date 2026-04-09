/**
 * Lore System — 类型定义
 *
 * 剧本级记忆的数据结构。每个 lore 条目就是一个 markdown 文件，
 * 带 YAML frontmatter 元信息 + Markdown 正文。
 */

/** Lore 条目的类型分类 */
export type LoreType = 'character' | 'place' | 'event' | 'faction' | 'world'

/**
 * Frontmatter 元信息 —— 决定条目能否被看到、能否被检索到。
 *
 * **设计原则**：能从文件内容推断的字段（如标题）不要放 frontmatter，
 * 只放"用于过滤/门控/索引"的元数据。
 */
export interface LoreFrontmatter {
  /** 显示名称，用于 DM 查询时的友好匹配，例 '铁匠格雷格' */
  name: string

  /** 条目类型，决定目录归属和 ListLore 的过滤 */
  type: LoreType

  /** 别名数组，允许多个名字命中同一条目，例 ['格雷格', '格雷格大叔'] */
  aliases?: string[]

  /** 相关地点 id（可选），例 'dawnbreak-town' */
  location?: string

  /**
   * 章节门控 —— 当前章节号 >= 这个值时才对 DM 可见。
   * 未设置时视为 1（第 1 章起就能看）。
   * 包含隐藏信息的条目应该设成更高章节号。
   */
  chapter_visible?: number

  /** 自由标签，用于 ListLore 过滤 */
  tags?: string[]

  /** 相关条目 id（可选），供 DM 顺藤摸瓜 */
  related?: string[]
}

/**
 * 运行时的 lore 条目。filename（去掉 .md 后缀）即 id。
 */
export interface LoreEntry {
  /** 唯一 id，等于文件名去掉扩展名，例 'greg' */
  id: string

  /** 相对 lore/ 根的路径，例 'characters/greg.md' */
  path: string

  /** YAML frontmatter 解析结果 */
  frontmatter: LoreFrontmatter

  /** Markdown 正文（不含 frontmatter） */
  body: string
}

/**
 * ListLore 返回的精简条目（不含 body，节省 token）
 */
export interface LoreSummary {
  id: string
  name: string
  type: LoreType
  tags?: string[]
  location?: string
}
