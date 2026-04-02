/**
 * NPC 档案系统 — 成长型角色资料卡
 *
 * 设计原则:
 * 1. 首次遇见 → 解锁基础档案（画像 + 外貌）
 * 2. 每次交互 → 根据信任度揭示预定义的信息层
 * 3. 信息揭示是确定性的（不依赖 LLM）
 * 4. 支持序列化（存档/读档）
 */

import chalk from 'chalk'

// ─── ASCII 人物画像 ───────────────────────────
// 每个角色有独特的视觉标识

const PORTRAITS: Record<string, string[]> = {
  '格雷格': [
    '      ╭━━━━━╮      ',
    '     ╭┃ ◣ ◢ ┃╮     ',
    '     ┃┃  ▬  ┃┃     ',
    '     ╰┃ ╭─╮ ┃╯     ',
    '      ╰━┥▓┝━╯      ',
    '     ╭──┴─┴──╮     ',
    '     │ ▓▓▓▓▓ │     ',
    '     │ 围 裙  │     ',
    '     ╰───────╯     ',
  ],
  '小莉': [
    '       ╭━━━╮       ',
    '      ╭┃•̀ •́┃╮      ',
    '      ┃┃ ◡ ┃┃      ',
    '      ╰┃   ┃╯      ',
    '       ╰┬─┬╯       ',
    '       ╭┴─┴╮       ',
    '       │   │       ',
    '       │ ♡ │       ',
    '       ╰───╯       ',
  ],
  '艾琳娜': [
    '     ⋮╭━━━━━╮      ',
    '    ⋮╭┃ ◈ ◈ ┃╮     ',
    '     ┃┃  ─  ┃┃     ',
    '     ╰┃     ┃╯⋎    ',
    '      ╰━┬─┬━╯      ',
    '    ╭───┴─┴───╮    ',
    '    │ ░ 斗篷 ░ │    ',
    '    │    ⚔    │    ',
    '    ╰─────────╯    ',
  ],
  '维克多': [
    '      ╭▓▓▓▓▓╮      ',
    '      ┃° _ °┃      ',
    '      ┃  ~  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │ ┃   ┃ │     ',
    '     │ 礼 服  │     ',
    '     │   ◇   │     ',
    '     ╰───────╯     ',
  ],
  '卡恩': [
    '     ~╭━━━━━╮~     ',
    '      ┃⊙   ⊙┃      ',
    '      ┃  ▽  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │  ♪♫   │     ',
    '     │ 琴 师  │     ',
    '     │  ♩    │     ',
    '     ╰───────╯     ',
  ],
}

// ─── 信息揭示层（每个 NPC 预定义） ──────────
// 按信任度门槛排列，交互时自动解锁

interface RevelationLayer {
  trustRequired: number   // 需要的最低信任度
  fact: string
  category: '性格' | '背景' | '关系' | '秘密' | '线索'
}

const REVELATION_LAYERS: Record<string, RevelationLayer[]> = {
  '格雷格': [
    { trustRequired: 0, fact: '说话时总在擦同一个已经干净的杯子', category: '性格' },
    { trustRequired: 0, fact: '碎盾亭酒馆老板，经营十六年', category: '背景' },
    { trustRequired: 1, fact: '左手小指是银质假指套——从不解释原因', category: '背景' },
    { trustRequired: 1, fact: '口头禅是"听着——"，说完会停顿确认你在听', category: '性格' },
    { trustRequired: 2, fact: '年轻时是银月佣兵团的突击手', category: '背景' },
    { trustRequired: 2, fact: '不自在时会下意识摩挲假指套', category: '性格' },
    { trustRequired: 3, fact: '20年前挚友达里安死在矿洞里，他选了带伤员先撤', category: '秘密' },
    { trustRequired: 3, fact: '吧台后墙上挂着达里安的旧佩剑', category: '线索' },
    { trustRequired: 4, fact: '在矿洞中层曾看到墙壁上移动的符号和一股"拉"他往深处的力量', category: '秘密' },
    { trustRequired: 5, fact: '保留着达里安日记本最后几页，上面画着类似蚀目者的符号', category: '秘密' },
  ],
  '小莉': [
    { trustRequired: 0, fact: '头发是格雷格用厨刀剪的，歪歪扭扭', category: '背景' },
    { trustRequired: 0, fact: '说话语速偏快，会突然停住像在听什么', category: '性格' },
    { trustRequired: 1, fact: '三年前的雨夜被格雷格收留，记不清自己从哪来', category: '背景' },
    { trustRequired: 1, fact: '口头禅"我觉得……不太对"（会压低声音）', category: '性格' },
    { trustRequired: 2, fact: '能感知到人身上的异常气息——某种直觉天赋', category: '秘密' },
    { trustRequired: 3, fact: '看卡恩时感觉像"照镜子被弹回来"', category: '线索' },
    { trustRequired: 3, fact: '感觉维克多身上缠着"灰色扭动的东西"', category: '线索' },
    { trustRequired: 4, fact: '脖子后面有一个银色的远古印记', category: '秘密' },
  ],
  '艾琳娜': [
    { trustRequired: 0, fact: '说话极慢，每个字像精挑细选', category: '性格' },
    { trustRequired: 0, fact: '发尾系着一颗褪色翡翠珠——已故朋友的遗物', category: '背景' },
    { trustRequired: 1, fact: '口头禅"……有意思"，通常意味着发现了矛盾或谎言', category: '性格' },
    { trustRequired: 1, fact: '340岁的高等精灵，左耳尖有缺损被头发遮住', category: '背景' },
    { trustRequired: 2, fact: '真正愤怒时不提高音量，而是变得极其礼貌', category: '性格' },
    { trustRequired: 2, fact: '每周二四教小莉读书识字', category: '关系' },
    { trustRequired: 3, fact: '用占卜法术检测过卡恩，被某种力量弹开了', category: '线索' },
    { trustRequired: 4, fact: '来到破晓镇不是偶然——她在追踪200年前的虚空棱镜线索', category: '秘密' },
  ],
  '维克多': [
    { trustRequired: 0, fact: '签文件时手在发抖', category: '性格' },
    { trustRequired: 0, fact: '面容憔悴，眼下浓重黑眼圈', category: '背景' },
    { trustRequired: 1, fact: '曾经是个好镇长，承诺改善矿工安全条件', category: '背景' },
    { trustRequired: 2, fact: '半年前开始回避与人交流，眼神总往门口瞟', category: '线索' },
    { trustRequired: 3, fact: '女儿索菲亚一年前失踪，对外称"去远方亲戚家"', category: '秘密' },
    { trustRequired: 4, fact: '被暗影教团胁迫——他们绑架了索菲亚', category: '秘密' },
    { trustRequired: 5, fact: '壁炉暗格里藏着被他删除的石碑封印记录', category: '秘密' },
  ],
  '卡恩': [
    { trustRequired: 0, fact: '弹琴技艺精湛，常在酒馆演奏吸引客人', category: '背景' },
    { trustRequired: 0, fact: '说话温和有礼，笑容从未到达眼睛', category: '性格' },
    { trustRequired: 1, fact: '自称来自东方，文件"完美得太可疑"', category: '线索' },
    { trustRequired: 2, fact: '出手极其阔绰，不像一般游吟诗人', category: '线索' },
    { trustRequired: 3, fact: '指甲修剪得比镇长夫人还整齐——不像风餐露宿的人', category: '线索' },
    { trustRequired: 4, fact: '琴箱有隐藏夹层，里面的东西散发微弱暗影能量', category: '秘密' },
    { trustRequired: 5, fact: '暗影教团高阶执行者，计划在仪式中篡夺虚空棱镜的力量', category: '秘密' },
  ],
}

// ─── 档案条目 ─────────────────────────────────

export interface DossierEntry {
  name: string
  title: string
  appearance: string
  discovered: Array<{ fact: string; category: string; turn: number }>
  relationship: string
  firstMet: number
}

const BASE_INFO: Record<string, { name: string; title: string; appearance: string }> = {
  '格雷格': { name: '格雷格·铁拳头', title: '碎盾亭酒馆老板', appearance: '六尺二，右眉旧疤，左手银质假指套。围着发白的皮围裙。' },
  '小莉': { name: '小莉', title: '酒馆帮工女孩', appearance: '12岁，黑色短发剪得歪歪扭扭，深灰色大眼睛。' },
  '艾琳娜': { name: '艾琳娜·银叶', title: '冒险者公会会长', appearance: '银白长发侧辫，琥珀色瞳，墨绿皮甲灰色斗篷。' },
  '维克多': { name: '维克多·黑石', title: '破晓镇镇长', appearance: '50岁灰发绅士，深色礼服，浓重黑眼圈。' },
  '卡恩': { name: '「旅者」卡恩', title: '游吟诗人', appearance: '年轻俊朗，衣着考究，指甲异常整齐。' },
}

// ─── 档案管理器 ───────────────────────────────

export class DossierManager {
  private entries = new Map<string, DossierEntry>()

  /** 首次遇见 NPC — 解锁档案，显示画像 */
  unlock(name: string, turn: number): string | null {
    if (this.entries.has(name)) return null
    const base = BASE_INFO[name]
    if (!base) return null

    this.entries.set(name, {
      ...base,
      discovered: [],
      relationship: '陌生人',
      firstMet: turn,
    })

    // 自动揭示信任度0的信息
    this.revealByTrust(name, 0, turn)

    // 返回解锁通知
    const portrait = PORTRAITS[name]
    let notice = '\n'
    notice += chalk.yellow.bold('  🔔 新角色档案已解锁！\n')
    notice += chalk.yellow('  ┌────────────────────────────────────┐\n')
    notice += chalk.yellow(`  │ ${chalk.bold.white(base.name.padEnd(34))} │\n`)
    notice += chalk.yellow(`  │ ${chalk.dim(base.title.padEnd(34))} │\n`)
    if (portrait) {
      notice += chalk.yellow('  ├────────────────────────────────────┤\n')
      for (const line of portrait) {
        notice += chalk.yellow('  │') + chalk.cyan(line.padEnd(36)) + chalk.yellow('│\n')
      }
    }
    notice += chalk.yellow('  └────────────────────────────────────┘')
    return notice
  }

  /** 和 NPC 交互后调用 — 根据信任度揭示新信息 */
  onInteraction(name: string, trust: number, turn: number): string | null {
    const entry = this.entries.get(name)
    if (!entry) return null

    const newFacts = this.revealByTrust(name, trust, turn)
    if (newFacts.length === 0) return null

    // 更新关系描述
    if (trust <= -2) entry.relationship = '敌对'
    else if (trust < 0) entry.relationship = '冷淡'
    else if (trust === 0) entry.relationship = '陌生人'
    else if (trust <= 2) entry.relationship = '熟人'
    else if (trust <= 4) entry.relationship = '朋友'
    else entry.relationship = '挚友'

    let notice = chalk.dim(`\n  📋 你对${name}有了新的了解:`)
    for (const f of newFacts) {
      notice += chalk.dim(`\n    · [${f.category}] ${f.fact}`)
    }
    return notice
  }

  private revealByTrust(name: string, trust: number, turn: number): Array<{ fact: string; category: string }> {
    const entry = this.entries.get(name)
    if (!entry) return []
    const layers = REVELATION_LAYERS[name] ?? []
    const knownFacts = new Set(entry.discovered.map(d => d.fact))
    const newFacts: Array<{ fact: string; category: string }> = []

    for (const layer of layers) {
      if (layer.trustRequired <= trust && !knownFacts.has(layer.fact)) {
        entry.discovered.push({ fact: layer.fact, category: layer.category, turn })
        newFacts.push({ fact: layer.fact, category: layer.category })
      }
    }
    return newFacts
  }

  /** 列出已解锁的 NPC */
  renderList(): string {
    if (this.entries.size === 0) {
      return chalk.dim('  你还没有遇到任何值得记录的人物。\n  继续探索吧！')
    }
    let output = chalk.cyan('\n  ── 人物档案 ──\n')
    for (const [name, entry] of this.entries) {
      const total = (REVELATION_LAYERS[name] ?? []).length
      const known = entry.discovered.length
      const pct = total > 0 ? Math.round((known / total) * 100) : 0
      const bar = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)))
      output += `  ${chalk.bold(entry.name)} — ${chalk.dim(entry.title)}\n`
      output += `    关系: ${entry.relationship} | 了解度: ${bar} ${pct}% (${known}/${total})\n\n`
    }
    output += chalk.dim('  输入 /npc <名字> 查看详细档案\n')
    return output
  }

  /** 完整档案卡 */
  renderProfile(name: string): string {
    // 模糊匹配
    const key = Array.from(this.entries.keys()).find(k => k.includes(name) || name.includes(k))
    const entry = key ? this.entries.get(key) : undefined
    if (!entry) return chalk.red(`  未找到 "${name}" 的档案。输入 /npc 查看已知角色。`)

    const portrait = PORTRAITS[key!]
    const layers = REVELATION_LAYERS[key!] ?? []
    const total = layers.length
    const known = entry.discovered.length
    const pct = total > 0 ? Math.round((known / total) * 100) : 0

    let out = '\n'
    out += chalk.yellow('  ╔════════════════════════════════════════╗\n')
    out += chalk.yellow('  ║ ') + chalk.bold.white(entry.name.padEnd(38)) + chalk.yellow(' ║\n')
    out += chalk.yellow('  ║ ') + chalk.dim(entry.title.padEnd(38)) + chalk.yellow(' ║\n')
    out += chalk.yellow('  ╠════════════════════════════════════════╣\n')

    // 画像
    if (portrait) {
      for (const line of portrait) {
        out += chalk.yellow('  ║ ') + chalk.cyan(line.padEnd(38)) + chalk.yellow(' ║\n')
      }
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
    }

    // 外貌
    out += chalk.yellow('  ║ ') + chalk.white('外貌').padEnd(38) + chalk.yellow(' ║\n')
    const appLines = entry.appearance.match(/.{1,36}/g) ?? [entry.appearance]
    for (const line of appLines) {
      out += chalk.yellow('  ║  ') + line.padEnd(37) + chalk.yellow(' ║\n')
    }

    // 状态
    out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
    const bar = chalk.green('█'.repeat(Math.round(pct / 10))) + chalk.dim('░'.repeat(10 - Math.round(pct / 10)))
    out += chalk.yellow('  ║ ') + `关系: ${entry.relationship}`.padEnd(38) + chalk.yellow(' ║\n')
    out += chalk.yellow('  ║ ') + `了解: ${bar} ${pct}%`.padEnd(38) + chalk.yellow(' ║\n')
    out += chalk.yellow('  ║ ') + chalk.dim(`初遇: 第${entry.firstMet}轮`).padEnd(47) + chalk.yellow(' ║\n')

    // 已知信息（按类别分组）
    if (entry.discovered.length > 0) {
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
      const categories = ['性格', '背景', '关系', '线索', '秘密']
      for (const cat of categories) {
        const facts = entry.discovered.filter(d => d.category === cat)
        if (facts.length === 0) continue
        out += chalk.yellow('  ║ ') + chalk.bold(`[${cat}]`).padEnd(41) + chalk.yellow(' ║\n')
        for (const f of facts) {
          const lines = f.fact.match(/.{1,34}/g) ?? [f.fact]
          out += chalk.yellow('  ║  ') + `· ${lines[0]}`.padEnd(37) + chalk.yellow(' ║\n')
          for (let i = 1; i < lines.length; i++) {
            out += chalk.yellow('  ║    ') + lines[i].padEnd(35) + chalk.yellow(' ║\n')
          }
        }
      }
    } else {
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
      out += chalk.yellow('  ║ ') + chalk.dim('（暂无更多信息，继续交流吧）').padEnd(47) + chalk.yellow(' ║\n')
    }

    // 未解锁提示
    const locked = total - known
    if (locked > 0) {
      out += chalk.yellow('  ╠════════════════════════════════════════╣\n')
      out += chalk.yellow('  ║ ') + chalk.dim(`🔒 还有 ${locked} 条信息待解锁`).padEnd(47) + chalk.yellow(' ║\n')
    }

    out += chalk.yellow('  ╚════════════════════════════════════════╝')
    return out
  }

  isUnlocked(name: string): boolean { return this.entries.has(name) }
  listUnlocked(): string[] { return Array.from(this.entries.keys()) }

  toJSON(): Record<string, DossierEntry> { return Object.fromEntries(this.entries) }

  static fromJSON(data: Record<string, DossierEntry>): DossierManager {
    const dm = new DossierManager()
    for (const [name, entry] of Object.entries(data)) {
      dm.entries.set(name, entry)
    }
    return dm
  }
}
