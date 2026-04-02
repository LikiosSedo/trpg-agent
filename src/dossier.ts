/**
 * NPC 档案系统 — 成长型角色资料卡
 *
 * 初次遇到 NPC 时解锁基础档案（名字 + 外貌 + 画像）
 * 随着交互逐渐揭示更多信息（性格、秘密、关系等）
 */

import chalk from 'chalk'

// ─── ASCII 人物画像 ───────────────────────────

const PORTRAITS: Record<string, string> = {
  '格雷格': `
    ╭─────────╮
    │  ╭───╮  │
    │  │ō ō│  │
    │  │ ▬ │  │
    │  ╰─┬─╯  │
    │ ╭──┴──╮ │
    │ │ ████ │ │
    │ │ 围裙 │ │
    ╰─┴─────┴─╯`,

  '小莉': `
    ╭─────────╮
    │  ╭───╮  │
    │  │• •│  │
    │  │ ◡ │  │
    │  ╰─┬─╯  │
    │   ╭┴╮   │
    │   │ │   │
    │   ╰─╯   │
    ╰─────────╯`,

  '艾琳娜': `
    ╭─────────╮
    │ ╭─⋏─╮  │
    │ │◈ ◈│  │
    │ │ ─ │  │
    │ ╰─┬─╯  │
    │╭──┴──╮ │
    ││ 斗篷 │ │
    ││  ⚔  │ │
    ╰┴─────┴─╯`,

  '维克多': `
    ╭─────────╮
    │  ╭▓▓╮  │
    │  │° °│  │
    │  │ ~ │  │
    │  ╰─┬─╯  │
    │ ╭──┴──╮ │
    │ │ 礼服 │ │
    │ │  ◇  │ │
    ╰─┴─────┴─╯`,

  '卡恩': `
    ╭─────────╮
    │  ╭~~~╮  │
    │  │⊙ ⊙│  │
    │  │ ▽ │  │
    │  ╰─┬─╯  │
    │ ╭──┴──╮ │
    │ │ 琴师 │ │
    │ │  ♪  │ │
    ╰─┴─────┴─╯`,
}

// ─── 档案内容层级 ─────────────────────────────

interface DossierEntry {
  name: string
  title: string           // 一句话描述
  appearance: string      // 外貌
  discovered: string[]    // 玩家已发现的信息（随交互增长）
  relationship: string    // 当前关系状态
  firstMet: number        // 首次遇见的回合
}

// 初始档案（首次遇见时显示的基础信息）
const BASE_DOSSIERS: Record<string, Omit<DossierEntry, 'discovered' | 'relationship' | 'firstMet'>> = {
  '格雷格': {
    name: '格雷格·铁拳头',
    title: '碎盾亭酒馆老板',
    appearance: '六尺二，右眉旧疤，左手银质假指套。围着发白的皮围裙，总在擦杯子。',
  },
  '小莉': {
    name: '小莉',
    title: '酒馆帮工小女孩',
    appearance: '12岁，黑色短发（剪得歪歪扭扭），深灰色大眼睛，总是歪着头看人。',
  },
  '艾琳娜': {
    name: '艾琳娜·银叶',
    title: '冒险者公会会长',
    appearance: '银白长发侧辫，琥珀色眼瞳带着疲倦。墨绿皮甲灰色斗篷，腰间短剑从未拔出。',
  },
  '维克多': {
    name: '维克多·黑石',
    title: '破晓镇镇长',
    appearance: '50岁，体面的灰发绅士，总穿一丝不苟的深色礼服。但眼下有浓重黑眼圈。',
  },
  '卡恩': {
    name: '「旅者」卡恩',
    title: '游吟诗人',
    appearance: '年轻俊朗，总带着温和微笑。衣着考究得不像旅人，指甲修剪得异常整齐。',
  },
}

// ─── 档案管理器 ───────────────────────────────

export class DossierManager {
  private entries = new Map<string, DossierEntry>()

  /** 解锁 NPC 档案（首次遇见时调用） */
  unlock(name: string, turn: number): boolean {
    if (this.entries.has(name)) return false // 已解锁
    const base = BASE_DOSSIERS[name]
    if (!base) return false // 不是可建档的 NPC

    this.entries.set(name, {
      ...base,
      discovered: [],
      relationship: '陌生人',
      firstMet: turn,
    })
    return true
  }

  /** 添加发现的信息 */
  addDiscovery(name: string, fact: string): void {
    const entry = this.entries.get(name)
    if (!entry) return
    if (!entry.discovered.includes(fact)) {
      entry.discovered.push(fact)
    }
  }

  /** 更新关系状态 */
  updateRelationship(name: string, rel: string): void {
    const entry = this.entries.get(name)
    if (entry) entry.relationship = rel
  }

  /** 是否已解锁 */
  isUnlocked(name: string): boolean {
    return this.entries.has(name)
  }

  /** 获取所有已解锁的 NPC 名单 */
  listUnlocked(): string[] {
    return Array.from(this.entries.keys())
  }

  /** 显示 NPC 列表 */
  renderList(): string {
    if (this.entries.size === 0) {
      return chalk.dim('  你还没有遇到任何值得记录的人物。')
    }

    let output = chalk.cyan('  ── 人物档案 ──\n')
    for (const [name, entry] of this.entries) {
      const stars = entry.discovered.length
      const bar = '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(0, 5 - stars))
      output += `  ${chalk.bold(entry.name)} — ${chalk.dim(entry.title)}\n`
      output += `  ${chalk.dim(`关系: ${entry.relationship} | 了解度: ${bar} (${stars}条)`)}\n\n`
    }
    output += chalk.dim('  使用 /npc <名字> 查看详细档案')
    return output
  }

  /** 显示单个 NPC 的完整档案 */
  renderProfile(name: string): string {
    const entry = this.entries.get(name)
    if (!entry) return chalk.red(`  未找到 "${name}" 的档案。`)

    const portrait = PORTRAITS[name] ?? ''
    const stars = entry.discovered.length
    const bar = '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(0, 5 - stars))

    let output = '\n'
    output += chalk.yellow('  ┌────────────────────────────────────┐\n')
    output += chalk.yellow(`  │ ${chalk.bold.white(entry.name.padEnd(34))} │\n`)
    output += chalk.yellow(`  │ ${chalk.dim(entry.title.padEnd(34))} │\n`)
    output += chalk.yellow('  ├────────────────────────────────────┤\n')

    // 画像
    if (portrait) {
      for (const line of portrait.trim().split('\n')) {
        output += chalk.yellow('  │') + chalk.cyan(line.padEnd(36)) + chalk.yellow('│\n')
      }
      output += chalk.yellow('  ├────────────────────────────────────┤\n')
    }

    // 外貌
    output += chalk.yellow('  │') + chalk.dim(' 外貌:'.padEnd(36)) + chalk.yellow('│\n')
    const appWords = entry.appearance.match(/.{1,32}/g) ?? [entry.appearance]
    for (const line of appWords) {
      output += chalk.yellow('  │') + `  ${line}`.padEnd(36) + chalk.yellow('│\n')
    }

    // 关系
    output += chalk.yellow('  ├────────────────────────────────────┤\n')
    output += chalk.yellow('  │') + ` 关系: ${entry.relationship}`.padEnd(36) + chalk.yellow('│\n')
    output += chalk.yellow('  │') + ` 了解度: ${bar}`.padEnd(36) + chalk.yellow('│\n')
    output += chalk.yellow('  │') + ` 初遇: 第${entry.firstMet}轮`.padEnd(36) + chalk.yellow('│\n')

    // 已发现的信息
    if (entry.discovered.length > 0) {
      output += chalk.yellow('  ├────────────────────────────────────┤\n')
      output += chalk.yellow('  │') + chalk.dim(' 已知信息:'.padEnd(36)) + chalk.yellow('│\n')
      for (const fact of entry.discovered) {
        const lines = fact.match(/.{1,30}/g) ?? [fact]
        output += chalk.yellow('  │') + `  · ${lines[0]}`.padEnd(36) + chalk.yellow('│\n')
        for (let i = 1; i < lines.length; i++) {
          output += chalk.yellow('  │') + `    ${lines[i]}`.padEnd(36) + chalk.yellow('│\n')
        }
      }
    } else {
      output += chalk.yellow('  ├────────────────────────────────────┤\n')
      output += chalk.yellow('  │') + chalk.dim('  （暂无更多信息）'.padEnd(34)) + chalk.yellow('│\n')
    }

    output += chalk.yellow('  └────────────────────────────────────┘')
    return output
  }

  /** 序列化（存档） */
  toJSON(): Record<string, DossierEntry> {
    return Object.fromEntries(this.entries)
  }

  /** 反序列化（读档） */
  static fromJSON(data: Record<string, DossierEntry>): DossierManager {
    const dm = new DossierManager()
    for (const [name, entry] of Object.entries(data)) {
      dm.entries.set(name, entry)
    }
    return dm
  }
}
