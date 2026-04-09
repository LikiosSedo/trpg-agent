/**
 * LoreStore — lore 文件的加载、索引、查询
 *
 * 核心职责:
 *   1. 启动时(首次访问时)扫描 lore/ 目录,加载所有 .md 文件
 *   2. 提供 list / read / grep 三个查询原语
 *   3. 按当前章节号做"可见性门控"(chapter_visible)
 *   4. 每 turn 限流 5 次查询(Phase 5 节奏控制)
 *
 * 非职责(留给工具层):
 *   - 冷却计数 / 战斗禁用 → tools/list-lore.ts 等里处理
 *   - turn 推进 → engine 调用 resetTurnCounter()
 *
 * 文件组织:
 *   lore/
 *     characters/greg.md
 *     places/shattered-shield-tavern.md
 *     events/darian-death.md
 *     ...
 *   文件名(去扩展名)即 id, 目录即 type(但 type 以 frontmatter 为准)。
 *
 * 加载策略:
 *   懒加载 + 内存缓存。首次访问时一次性扫描整个 lore/,扫描失败时
 *   log 并返回空(fail soft —— lore 系统缺失不应该让游戏崩)。
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, basename, extname } from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import type { LoreEntry, LoreSummary, LoreType, LoreFrontmatter } from './types.js'

// ─── 配置 ────────────────────────────────────

/** 单文件最大字节数,超出时截断并加提示 */
const MAX_FILE_SIZE = 50 * 1024

/** 每 turn 最多允许的 lore 调用次数 */
const MAX_CALLS_PER_TURN = 5

// ─── 章节号提取 ──────────────────────────────

/**
 * 从章节 id 提取章节号。当前 story-script 的 id 格式是 'ch1'/'ch2'/...
 * 解析失败时返回 1(最宽容,让 DM 看到最多内容)。
 */
export function parseChapterNumber(chapterId: string | undefined): number {
  if (!chapterId) return 1
  const match = chapterId.match(/(\d+)/)
  return match ? Number(match[1]) : 1
}

// ─── 单例 ────────────────────────────────────

let instance: LoreStore | null = null

/** 获取全局 LoreStore 单例(首次访问时懒加载) */
export function getLoreStore(): LoreStore {
  if (!instance) {
    instance = new LoreStore()
  }
  return instance
}

/** 测试用:重置单例(主要给 test script 用) */
export function resetLoreStore(): void {
  instance = null
}

// ─── 主类 ────────────────────────────────────

export class LoreStore {
  private entries: Map<string, LoreEntry> = new Map()
  private loaded = false
  private rootDir: string
  private callsThisTurn = 0

  constructor(rootDir?: string) {
    // 默认从项目根下的 lore/ 目录加载。允许注入方便测试。
    this.rootDir = rootDir ?? join(process.cwd(), 'lore')
  }

  // ─── 加载 ──────────────────────────────────

  /**
   * 扫描 rootDir 下所有 .md 文件,解析 frontmatter,存入 Map。
   * 失败时 log 警告,不抛异常(fail soft)。
   */
  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true

    if (!existsSync(this.rootDir)) {
      console.warn(`[lore-store] 目录不存在: ${this.rootDir} — lore 系统将为空`)
      return
    }

    const files = this.walk(this.rootDir)
    for (const absPath of files) {
      try {
        const entry = this.loadFile(absPath)
        if (entry) this.entries.set(entry.id, entry)
      } catch (err) {
        console.warn(
          `[lore-store] 加载失败 ${absPath}: ${(err as Error).message}`,
        )
      }
    }

    console.log(`[lore-store] 已加载 ${this.entries.size} 个 lore 条目`)
  }

  /** 递归扫描目录,返回所有 .md 文件的绝对路径 */
  private walk(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      // 跳过 INDEX.md —— 那是给人看的入口,不作为 lore 条目
      if (name === 'INDEX.md') continue
      const abs = join(dir, name)
      const stat = statSync(abs)
      if (stat.isDirectory()) {
        out.push(...this.walk(abs))
      } else if (stat.isFile() && name.endsWith('.md')) {
        out.push(abs)
      }
    }
    return out
  }

  /** 加载单个文件为 LoreEntry,frontmatter 缺失或非法时返回 null */
  private loadFile(absPath: string): LoreEntry | null {
    const stat = statSync(absPath)
    let text = readFileSync(absPath, 'utf-8')
    if (stat.size > MAX_FILE_SIZE) {
      text = text.slice(0, MAX_FILE_SIZE) +
        `\n\n[系统] 文件超过 ${MAX_FILE_SIZE} 字节,已截断。`
    }

    const { frontmatter, body } = parseFrontmatter(text)

    // 必需字段:name 和 type
    if (!frontmatter.name || !frontmatter.type) {
      console.warn(
        `[lore-store] 跳过 ${absPath}: 缺少 name 或 type frontmatter`,
      )
      return null
    }

    const id = basename(absPath, extname(absPath))
    const path = relative(this.rootDir, absPath)

    return {
      id,
      path,
      frontmatter: frontmatter as LoreFrontmatter,
      body: body.trim(),
    }
  }

  // ─── 可见性门控 ────────────────────────────

  /**
   * 判断一条 lore 在当前章节号下是否可见。
   * chapter_visible 未设置视为 1。
   */
  private isVisible(entry: LoreEntry, currentChapter: number): boolean {
    const required = entry.frontmatter.chapter_visible ?? 1
    return currentChapter >= required
  }

  // ─── 查询 API ──────────────────────────────

  /**
   * 列出所有可见条目(精简版,不含 body)。
   * 可按 type / tag 过滤。
   */
  list(options: {
    currentChapter: number
    type?: LoreType
    tag?: string
  }): LoreSummary[] {
    this.ensureLoaded()
    const out: LoreSummary[] = []
    for (const entry of this.entries.values()) {
      if (!this.isVisible(entry, options.currentChapter)) continue
      if (options.type && entry.frontmatter.type !== options.type) continue
      if (options.tag && !(entry.frontmatter.tags ?? []).includes(options.tag)) continue
      out.push({
        id: entry.id,
        name: entry.frontmatter.name,
        type: entry.frontmatter.type,
        tags: entry.frontmatter.tags,
        location: entry.frontmatter.location,
      })
    }
    // 按 type → name 排序,结果稳定
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    return out
  }

  /**
   * 读取单个条目的完整内容。
   * 支持按 id / name / alias 查找。
   * 被章节门控挡住时,静默返回 null(不告诉 DM "有但不可看")。
   */
  read(options: { query: string; currentChapter: number }): LoreEntry | null {
    this.ensureLoaded()
    const q = options.query.trim().toLowerCase()
    if (!q) return null

    for (const entry of this.entries.values()) {
      if (!this.isVisible(entry, options.currentChapter)) continue
      if (entry.id.toLowerCase() === q) return entry
      if (entry.frontmatter.name.toLowerCase() === q) return entry
      const aliases = entry.frontmatter.aliases ?? []
      if (aliases.some(a => a.toLowerCase() === q)) return entry
    }

    // 精确匹配失败,尝试模糊匹配(包含关系)
    for (const entry of this.entries.values()) {
      if (!this.isVisible(entry, options.currentChapter)) continue
      if (entry.frontmatter.name.toLowerCase().includes(q)) return entry
      const aliases = entry.frontmatter.aliases ?? []
      if (aliases.some(a => a.toLowerCase().includes(q))) return entry
    }

    return null
  }

  /**
   * 跨文件关键词搜索。返回命中的条目 id + 最多 3 行上下文。
   * 只搜 body,不搜 frontmatter(frontmatter 的 name/alias 交给 read())。
   */
  grep(options: {
    query: string
    currentChapter: number
    type?: LoreType
    maxResults?: number
  }): Array<{ id: string; name: string; snippets: string[] }> {
    this.ensureLoaded()
    const q = options.query.trim().toLowerCase()
    if (!q) return []

    const maxResults = options.maxResults ?? 5
    const out: Array<{ id: string; name: string; snippets: string[] }> = []

    for (const entry of this.entries.values()) {
      if (!this.isVisible(entry, options.currentChapter)) continue
      if (options.type && entry.frontmatter.type !== options.type) continue

      const lines = entry.body.split('\n')
      const matches: string[] = []
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          matches.push(lines[i].trim())
          if (matches.length >= 3) break  // 单文件最多 3 行
        }
      }
      if (matches.length > 0) {
        out.push({
          id: entry.id,
          name: entry.frontmatter.name,
          snippets: matches,
        })
        if (out.length >= maxResults) break
      }
    }

    return out
  }

  // ─── 限流 ──────────────────────────────────

  /**
   * 检查当前 turn 是否还能继续调用 lore 工具。
   * 调用方在 execute() 里先 check + 若返回 false 则拒绝。
   */
  checkAndIncrementCall(): { allowed: boolean; remaining: number } {
    if (this.callsThisTurn >= MAX_CALLS_PER_TURN) {
      return { allowed: false, remaining: 0 }
    }
    this.callsThisTurn += 1
    return { allowed: true, remaining: MAX_CALLS_PER_TURN - this.callsThisTurn }
  }

  /** engine 在每个 user turn 开始时调用,重置 lore 调用计数 */
  resetTurnCounter(): void {
    this.callsThisTurn = 0
  }

  // ─── 调试 ──────────────────────────────────

  /** 返回所有条目(含不可见的),仅用于测试 */
  _getAllEntries(): ReadonlyMap<string, LoreEntry> {
    this.ensureLoaded()
    return this.entries
  }
}
