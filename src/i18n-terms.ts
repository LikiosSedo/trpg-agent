/**
 * 术语中文化安全网
 *
 * 目的：DM 叙事中可能会漏出少量英文怪物名 / D&D 术语，
 * 在文本最终发送到前端前做一次全词替换（不是删除），保证沉浸感。
 *
 * 根源修复：monsters.json 加 nameZh + buildCombatContext 用 nameZh。
 * 本模块是兜底安全网：万一 DM 凭空说出 "Cockatrice"/"CON save" 之类，
 * 这里把它们替换成中文。
 *
 * 流式场景用 StreamingLocalizer：边收 text_delta 边 buffer，保证一个 term
 * 不会被 token 边界切成两段漏掉。
 */

import monstersJson from '../data/monsters.json' with { type: 'json' }

// ─── 额外术语（非怪物名）──────────────────────
// 怪物英→中的源头是 monsters.json 的 nameZh 字段，这里不重复。
// 只列：DM 可能联想到的、在 monsters.json 之外的怪物，以及 D&D 术语。

const EXTRA_TERMS: Record<string, string> = {
  // 世界设定里提到过、DM 可能联想的怪物
  'Owlbear': '枭熊',
  'Hell Hound': '地狱犬',
  'Ogre': '食人魔',
  'Zombie': '僵尸',

  // 常见 D&D 术语（DM 偶尔会脱口而出）
  'CON save': '体质豁免',
  'STR save': '力量豁免',
  'DEX save': '敏捷豁免',
  'WIS save': '感知豁免',
  'INT save': '智力豁免',
  'CHA save': '魅力豁免',
  'CON check': '体质检定',
  'STR check': '力量检定',
  'DEX check': '敏捷检定',
  'WIS check': '感知检定',
  'INT check': '智力检定',
  'CHA check': '魅力检定',
  'Saving throw': '豁免检定',
  'Initiative': '先攻',
  'critical hit': '暴击',
}

// 术语表 = monsters.json 的英→中 + EXTRA_TERMS
export const TERMS: Record<string, string> = (() => {
  const merged: Record<string, string> = { ...EXTRA_TERMS }
  for (const m of monstersJson as Array<{ name: string; nameZh?: string }>) {
    if (m.nameZh && /^[A-Za-z ]+$/.test(m.name)) {
      merged[m.name] = m.nameZh
    }
  }
  return merged
})()

// 按长度降序，保证多词短语先于单词匹配（"Giant Spider" 先于 "Giant"）
const SORTED_KEYS = Object.keys(TERMS).sort((a, b) => b.length - a.length)

// 转义正则元字符
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 词边界：前后不能是英文字母（中文字符、标点、空格均 OK）
const REGEX = new RegExp(
  '(?<![A-Za-z])(' + SORTED_KEYS.map(escapeRegex).join('|') + ')(?![A-Za-z])',
  'gi',
)

// 小写查找表（大小写不敏感）
const LOWER_TERMS: Record<string, string> = Object.fromEntries(
  Object.entries(TERMS).map(([k, v]) => [k.toLowerCase(), v]),
)

/** 一次性替换文本中的所有英文术语为中文。 */
export function localize(text: string): string {
  if (!text) return text
  return text.replace(REGEX, (m) => LOWER_TERMS[m.toLowerCase()] ?? m)
}

// ─── 流式 buffer ───────────────────────────────
// 问题：DM 流式输出时 "Cockatrice" 可能被 LLM token 切成 "Cock"+"atrice"，
// 逐片 replace 会漏掉。解决：buffer 住任何"可能仍在扩展成某个 term 的尾巴"，
// 只 flush 可以确定不会被 term 匹配截断的前缀。

const LOWER_KEYS = SORTED_KEYS.map(k => k.toLowerCase())

/** 安全 buffer 上限，防止纯英文输出让 buffer 无限增长 */
const MAX_BUFFER_LEN = 300

/**
 * 流式文本本地化器。
 *
 * 用法：
 *   const lz = new StreamingLocalizer()
 *   for (const chunk of stream) yield lz.feed(chunk)  // 可能是空串
 *   yield lz.flush()  // 收尾
 */
export class StreamingLocalizer {
  private buffer = ''

  /** 喂入一段增量文本，返回可安全发送的已本地化文本（可能为空）。 */
  feed(chunk: string): string {
    if (!chunk) return ''
    this.buffer += chunk

    // 找最小的 i，使得 buffer[i..] 仍然可能是某个 key 的前缀。
    // 那就是"不能截断"的尾部起点；buffer[0..i] 可以放心 flush。
    const lower = this.buffer.toLowerCase()
    const n = this.buffer.length
    let safeSplit = n  // 默认全部 flush

    for (let i = 0; i < n; i++) {
      const tail = lower.substring(i)
      // 空串是所有 key 的前缀，跳过
      if (!tail) break
      if (LOWER_KEYS.some(k => k.startsWith(tail))) {
        safeSplit = i
        break
      }
    }

    // 安全阀：buffer 超长强制 flush（防异常情况下内存无限增长）
    if (n > MAX_BUFFER_LEN) safeSplit = n

    if (safeSplit === 0) return ''
    const flushable = this.buffer.substring(0, safeSplit)
    this.buffer = this.buffer.substring(safeSplit)
    return localize(flushable)
  }

  /** 流结束时调用：flush 所有剩余 buffer。 */
  flush(): string {
    if (!this.buffer) return ''
    const remaining = this.buffer
    this.buffer = ''
    return localize(remaining)
  }
}
