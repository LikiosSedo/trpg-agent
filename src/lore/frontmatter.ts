/**
 * Frontmatter 解析器 —— 手写 YAML 子集
 *
 * 我们只支持 lore 文件实际需要的语法,不拉 gray-matter 依赖:
 *   - 单行 key: value
 *   - 字符串(带/不带引号)
 *   - 数字
 *   - 布尔(true/false)
 *   - 行内数组 [a, b, c] 和 ["x", "y"]
 *   - 注释行(#)
 *
 * 不支持(也不需要):嵌套对象、多行字符串、YAML 锚点、复杂转义。
 *
 * 如果 frontmatter 需求变复杂,再迁移到 gray-matter —— 但要警惕:
 * frontmatter 复杂说明 lore 的元数据设计可能跑偏了。
 */

export interface ParsedFrontmatter {
  /** 解析出来的键值对 */
  frontmatter: Record<string, any>
  /** frontmatter 之后的正文 */
  body: string
}

const DELIMITER_RE = /^---\r?\n/
const END_DELIMITER_RE = /\n---\r?\n/

/**
 * 解析带 frontmatter 的 markdown 文件。
 * 如果文件不以 `---` 开头,返回空 frontmatter + 原文作为 body。
 * 如果 frontmatter 格式错误,尽量解析已经能解析的部分,不抛异常。
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  if (!DELIMITER_RE.test(text)) {
    return { frontmatter: {}, body: text }
  }

  // 跳过开头的 '---\n'(3 或 4 个字符,取决于是否 CRLF)
  const firstLineEnd = text.indexOf('\n') + 1
  const afterFirst = text.slice(firstLineEnd)

  // 找结束分隔符
  const endMatch = afterFirst.match(END_DELIMITER_RE)
  if (!endMatch || endMatch.index === undefined) {
    // 没找到结束符 —— 视为无 frontmatter
    return { frontmatter: {}, body: text }
  }

  const yamlText = afterFirst.slice(0, endMatch.index)
  // 去掉 body 开头的空白行 —— 结束分隔符后面通常有 "\n\n# 标题" 之类的空行,
  // 调用方几乎肯定不想看到这些。
  const body = afterFirst.slice(endMatch.index + endMatch[0].length).replace(/^\n+/, '')

  const frontmatter: Record<string, any> = {}
  for (const rawLine of yamlText.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue

    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (!key) continue

    frontmatter[key] = parseValue(value)
  }

  return { frontmatter, body }
}

/**
 * 解析一个 YAML 标量值(或行内数组)。
 * 不支持多行、嵌套对象 —— 只覆盖 lore frontmatter 的实际需求。
 */
function parseValue(raw: string): any {
  if (raw === '' || raw === 'null' || raw === '~') return null
  if (raw === 'true') return true
  if (raw === 'false') return false

  // 行内数组: [a, b, c] 或 ["a", "b"]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim()
    if (!inner) return []
    // 简单 split —— 不处理嵌套数组(lore 不需要)
    return inner.split(',').map(s => parseValue(s.trim()))
  }

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)

  // 带引号的字符串 —— 去掉引号
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1)
  }

  // 裸字符串
  return raw
}
