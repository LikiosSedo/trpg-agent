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
  '陈妈': [
    '      ╭━━━━━╮      ',
    '      ┃ ◠ ◠ ┃      ',
    '      ┃  ─  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │ ┃   ┃ │     ',
    '     │ 旅 店  │     ',
    '     │  ☕   │     ',
    '     ╰───────╯     ',
  ],
  '格罗姆': [
    '      ╭━━━━━╮      ',
    '     ╭┃ ▪ ▪ ┃╮     ',
    '     ┃┃ ═══ ┃┃     ',
    '     ╰┃  ▬  ┃╯     ',
    '      ╰━┥█┝━╯      ',
    '    ╭───┴─┴───╮    ',
    '    │ ▓▓▓▓▓▓▓ │    ',
    '    │  铁 匠   │    ',
    '    ╰─────────╯    ',
  ],
  '叶绿': [
    '     ⋮╭━━━━━╮      ',
    '      ┃ ◡ ◡ ┃      ',
    '      ┃  ◡  ┃      ',
    '      ╰┬───┬╯⋎    ',
    '     ╭──┴─┴──╮     ',
    '     │ ░ ░ ░ │     ',
    '     │ 药 师  │     ',
    '     │  ❀    │     ',
    '     ╰───────╯     ',
  ],
  '韩猛': [
    '      ╭━━━━━╮      ',
    '      ┃ ◣ ◢ ┃      ',
    '      ┃  ▬  ┃      ',
    '      ╰┬───┬╯      ',
    '     ╭─┴───┴─╮     ',
    '     │ ┃     │     ',
    '     │ 独 臂  │     ',
    '     │  ⚔    │     ',
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
  '陈妈': [
    { trustRequired: 0, fact: '说话爽利，手脚麻利，对旅客既热情又精明', category: '性格' },
    { trustRequired: 0, fact: '破晓旅店老板娘，经营二十余年', category: '背景' },
    { trustRequired: 1, fact: '消息灵通，镇上大小事都瞒不过她', category: '背景' },
    { trustRequired: 2, fact: '年轻时丈夫死于矿难，独自拉扯旅店和两个孩子', category: '背景' },
    { trustRequired: 3, fact: '最近注意到有些"陌生面孔"频繁出入镇外', category: '线索' },
    { trustRequired: 4, fact: '曾在夜里看到卡恩独自往暮色森林方向走', category: '线索' },
  ],
  '格罗姆': [
    { trustRequired: 0, fact: '矮人铁匠，锤子比他脑袋还大', category: '背景' },
    { trustRequired: 0, fact: '说话直来直去，不喜欢拐弯抹角', category: '性格' },
    { trustRequired: 1, fact: '从北方矮人堡垒迁来，据说是为了追随某条矿脉', category: '背景' },
    { trustRequired: 2, fact: '对矿石品质极为敏感，最近发现矿道出产的矿石"味道不对"', category: '线索' },
    { trustRequired: 3, fact: '矿石中夹杂着一种他从未见过的黑色晶体碎片', category: '线索' },
    { trustRequired: 4, fact: '悄悄保留了几块黑色晶体样本，怀疑跟矿道深处的异变有关', category: '秘密' },
  ],
  '叶绿': [
    { trustRequired: 0, fact: '半精灵药剂师，总是带着草药的清香', category: '背景' },
    { trustRequired: 0, fact: '温柔耐心，对每位病人都仔细问诊', category: '性格' },
    { trustRequired: 1, fact: '草药堂传承三代，她是最年轻的堂主', category: '背景' },
    { trustRequired: 2, fact: '最近她的助手行为越来越古怪，常常深夜外出', category: '线索' },
    { trustRequired: 3, fact: '在助手的抽屉里发现过一张画着奇怪符号的纸', category: '线索' },
    { trustRequired: 4, fact: '怀疑助手加入了某种秘密组织，但不敢声张', category: '秘密' },
  ],
  '韩猛': [
    { trustRequired: 0, fact: '退役战士，右臂在一次讨伐中失去', category: '背景' },
    { trustRequired: 0, fact: '嗓门大，脾气火爆，但对新手冒险者格外照顾', category: '性格' },
    { trustRequired: 1, fact: '艾琳娜的老部下，是她推荐他来管理公会分部的', category: '关系' },
    { trustRequired: 2, fact: '最近派出去调查矿道的小队接连失联，他很焦虑', category: '线索' },
    { trustRequired: 3, fact: '偷偷在公会地下室囤积了一批武器，以防"最坏的情况"', category: '秘密' },
    { trustRequired: 4, fact: '从失联小队最后的报告中发现了暗影教团的蛛丝马迹', category: '秘密' },
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
  '陈妈': { name: '陈妈', title: '破晓旅店老板娘', appearance: '四十多岁，圆脸利落短发，围着花围裙，笑起来很爽朗。' },
  '格罗姆': { name: '格罗姆·铁砧', title: '铁砧铺矮人铁匠', appearance: '矮壮结实，络腮胡编成两条辫子，手臂粗如小腿。' },
  '叶绿': { name: '叶绿', title: '草药堂药剂师', appearance: '半精灵，浅绿色眼瞳，总带着淡淡的草药香气。' },
  '韩猛': { name: '「独臂」韩猛', title: '冒险者公会分部管理员', appearance: '魁梧的独臂战士，右袖空荡，但左手足以掰断桌腿。' },
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

  /** 完整档案卡 (trust: NPC当前信任度, 用于显示信任条) */
  renderProfile(name: string, trust?: number): string {
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
    // 信任度条 (0-5)
    if (trust !== undefined) {
      const t = Math.max(0, Math.min(5, trust))
      const trustBar = '▓'.repeat(t) + '░'.repeat(5 - t)
      out += chalk.yellow('  ║ ') + `信任: ${trustBar} ${t}/5`.padEnd(38) + chalk.yellow(' ║\n')
    }
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

  /** 获取 NPC 的初始展示信息（首次解锁时用） */
  getFirstFacts(name: string): string[] {
    const base = BASE_INFO[name]
    if (!base) return []
    const layers = REVELATION_LAYERS[name] ?? []
    // 返回信任度0就能看到的事实
    return layers.filter(l => l.trustRequired === 0).map(l => l.fact)
  }

  /** 获取 NPC 的基本信息（标题、外貌描述） */
  getBaseInfo(name: string): { title: string; appearance: string } | null {
    const base = BASE_INFO[name]
    if (!base) return null
    return { title: base.title, appearance: base.appearance }
  }

  /** Structured list data for panel rendering */
  toListData(trustMap: Record<string, number>): Array<{
    name: string; title: string; trust: number;
    totalLayers: number; knownLayers: number; unlocked: boolean
  }> {
    return Array.from(this.entries).map(([key, entry]) => ({
      name: entry.name,
      title: entry.title,
      trust: trustMap[key] ?? 0,
      totalLayers: (REVELATION_LAYERS[key] ?? []).length,
      knownLayers: entry.discovered.length,
      unlocked: true,
    }))
  }

  /** Structured profile data for panel rendering */
  toProfileData(name: string, trust?: number): {
    name: string; title: string; appearance: string; trust: number;
    discovered: Array<{ fact: string; category: string }>;
    portrait: string[]; locked: number
  } | null {
    const key = Array.from(this.entries.keys()).find(k => k.includes(name) || name.includes(k))
    const entry = key ? this.entries.get(key) : undefined
    if (!entry) return null

    const total = (REVELATION_LAYERS[key!] ?? []).length
    const known = entry.discovered.length

    return {
      name: entry.name,
      title: entry.title,
      appearance: entry.appearance,
      trust: trust ?? 0,
      discovered: entry.discovered.map(d => ({ fact: d.fact, category: d.category })),
      portrait: PORTRAITS[key!] ?? [],
      locked: total - known,
    }
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
