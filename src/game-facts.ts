import * as fs from 'fs'
import type { GameSession, GameEvent, NPC } from './types.js'
import { getCombatSummary } from './combat-manager.js'

export class GameFactStore {
  constructor(private session: GameSession) {}

  addEvent(fact: string, importance: 'critical' | 'normal' = 'normal'): void {
    this.session.events.push({
      turn: this.session.turnCount,
      fact,
      importance,
    })
  }

  updateNPC(name: string, updates: Partial<Omit<NPC, 'name'>>): void {
    const npc = this.session.npcs.find(n => n.name === name)
    if (!npc) throw new Error(`NPC not found: ${name}`)
    Object.assign(npc, updates)
  }

  addClue(clue: string): void {
    if (!this.session.player.clues.includes(clue)) {
      this.session.player.clues.push(clue)
    }
  }

  /** 生成结构化上下文供 DM prompt 注入 */
  toPromptContext(): string {
    const { player, npcs, quests, worldState, events, turnCount } = this.session
    const criticalEvents = events
      .filter(e => e.importance === 'critical')
      .map(e => `[Turn ${e.turn}] ${e.fact}`)
    const recentEvents = events
      .slice(-5)
      .map(e => `[Turn ${e.turn}] ${e.fact}`)
    const activeQuests = quests
      .filter(q => q.status === 'active')
      .map(q => {
        const objs = q.objectives.map((o, i) => `${q.objectivesCompleted[i] ? '[x]' : '[ ]'} ${o}`).join(', ')
        return `- ${q.name}: ${objs}`
      })

    const locationNames: Record<string, string> = {
      'dawnbreak-town': '破晓镇', 'twilight-woods': '暮色森林',
      'greyspine-mines': '灰脊矿道', 'shatterstone-wastes': '碎石荒原',
    }
    const timeNames: Record<string, string> = {
      morning: '清晨', noon: '正午', evening: '黄昏', night: '深夜',
    }
    const loc = locationNames[worldState.currentLocation] ?? worldState.currentLocation
    const time = timeNames[worldState.timeOfDay] ?? worldState.timeOfDay

    return [
      `=== 游戏状态（第${turnCount}轮） ===`,
      `位置: ${loc} | 时间: ${time}`,
      `玩家: ${player.name}（等级${player.level}）生命:${player.hp}/${player.maxHp} 金币:${player.gold}`,
      player.equipped.weapon ? `武器: ${player.equipped.weapon.name}` : '',
      player.equipped.armor ? `护甲: ${player.equipped.armor.name}` : '',
      '',
      activeQuests.length ? `进行中的任务:\n${activeQuests.join('\n')}` : '',
      player.clues.length ? `已知线索: ${player.clues.join('；')}` : '',
      criticalEvents.length ? `关键事件:\n${criticalEvents.join('\n')}` : '',
      recentEvents.length ? `最近发生:\n${recentEvents.join('\n')}` : '',
      npcs.length ? `NPC状态:\n${npcs.map(n => `- ${n.name}（信任:${n.trust}, 情绪:${n.mood}, 位于:${locationNames[n.location] ?? n.location}）`).join('\n')}` : '',
      (() => {
        const shopNpcs = this.session.npcs.filter(n => n.shopPricing && (n.inventory ?? []).length > 0)
        if (!shopNpcs.length) return ''
        const shopInfo = shopNpcs.map(n => {
          const items = (n.inventory ?? []).map(i => {
            const price = n.shopPricing?.[i.name]
            return price ? `${i.name}(${price}金)` : i.name
          })
          // Deduplicate and count
          const counts = new Map<string, number>()
          for (const desc of items) counts.set(desc, (counts.get(desc) ?? 0) + 1)
          const itemList = [...counts.entries()].map(([d, c]) => c > 1 ? `${d}×${c}` : d).join('、')
          return `- ${n.name}: ${itemList}`
        }).join('\n')
        return `商店库存:\n${shopInfo}`
      })(),
      getCombatSummary(this.session) ?? '',
    ].filter(Boolean).join('\n')
  }

  /** 一段话总结玩家状态（中文） */
  getPlayerSummary(): string {
    const { player } = this.session
    const m = player.abilityModifiers
    const fmt = (v: number) => v >= 0 ? `+${v}` : `${v}`

    // 装备详情（含效果）
    const equipLines: string[] = []
    if (player.equipped.weapon) {
      const w = player.equipped.weapon
      const atkMod = m.STR + 2 + (w.bonus ?? 0) // STR + proficiency + weapon bonus
      equipLines.push(`  武器: ${w.name} (攻击${fmt(atkMod)}, ${w.description.match(/\d+d\d+/)?.[0] ?? '?'}伤害)`)
    }
    if (player.equipped.armor) {
      const a = player.equipped.armor
      equipLines.push(`  护甲: ${a.name} (AC+${a.bonus ?? 0})`)
    }

    // 法术详情（含剩余次数）
    const spellLines = player.spells.map(s => {
      const uses = s.usesPerRest === 0 ? '无限' : `${s.remaining}/${s.usesPerRest}`
      return `  ${s.name} — ${s.description} [${uses}]`
    })

    // 可用动作
    const actions: string[] = ['weapon(武器攻击)']
    if (player.spells.some(s => s.remaining > 0 || s.usesPerRest === 0)) {
      actions.push('spell(施法)')
    }
    actions.push('flee(逃跑)')

    return [
      `${player.name} — ${player.level}级冒险者`,
      `生命: ${player.hp}/${player.maxHp} | 金币: ${player.gold} | 经验: ${player.xp}`,
      `属性: 力${fmt(m.STR)} 敏${fmt(m.DEX)} 体${fmt(m.CON)} 智${fmt(m.INT)} 感${fmt(m.WIS)} 魅${fmt(m.CHA)}`,
      equipLines.length ? `装备:\n${equipLines.join('\n')}` : '',
      player.skills.length ? `技能: ${player.skills.join('、')}` : '',
      spellLines.length ? `法术:\n${spellLines.join('\n')}` : '',
      `战斗动作: ${actions.join(' / ')}`,
      `背包: ${player.inventory.length}件 | 线索: ${player.clues.length}条`,
    ].filter(Boolean).join('\n')
  }

  /** 获取指定 NPC 的上下文（中文，注入 DM prompt） */
  getNPCContext(name: string): string {
    const npc = this.session.npcs.find(n => n.name === name)
    if (!npc) throw new Error(`NPC not found: ${name}`)
    const promises = npc.playerPromises.length ? `玩家承诺: ${npc.playerPromises.join('；')}` : ''
    const facts = npc.knownFacts.length ? `掌握情报: ${npc.knownFacts.join('；')}` : ''
    const log = (npc.interactionLog ?? []).length
      ? `最近交互: ${(npc.interactionLog ?? []).slice(-3).join('；')}`
      : ''
    return [
      `${npc.name}（信任:${npc.trust}, 情绪:${npc.mood}, 位于:${npc.location}）`,
      facts, promises, log,
    ].filter(Boolean).join('。')
  }

  /** 不在场 NPC 的回顾摘要（玩家问起不在身边的人时用） */
  getNPCRecap(name: string): string {
    const npc = this.session.npcs.find(n => n.name === name)
    if (!npc) return `不认识叫${name}的人。`
    const locationNames: Record<string, string> = {
      'dawnbreak-town': '破晓镇', 'twilight-woods': '暮色森林',
      'greyspine-mines': '灰脊矿道', 'shatterstone-wastes': '碎石荒原',
    }
    const loc = locationNames[npc.location] ?? npc.location
    const log = npc.interactionLog ?? []
    if (log.length === 0) return `你还没有和${npc.name}交谈过。${npc.name}目前在${loc}。`
    return `你和${npc.name}的交互回顾（${npc.name}目前在${loc}）:\n${log.map(l => `  · ${l}`).join('\n')}`
  }

  /** 保存到 saves/ 目录，文件名含角色名和时间 */
  save(slotName?: string): string {
    const dir = 'saves'
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const name = slotName ?? `${this.session.player.name}_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`
    const path = `${dir}/${name}.json`
    fs.writeFileSync(path, JSON.stringify(this.session, null, 2), 'utf-8')
    return path
  }

  /** 列出所有存档 */
  static listSaves(): Array<{ file: string; name: string; turn: number; date: string }> {
    const dir = 'saves'
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf-8')) as GameSession
          return {
            file: f.replace('.json', ''),
            name: `${data.player.name} Lv${data.player.level}`,
            turn: data.turnCount,
            date: fs.statSync(`${dir}/${f}`).mtime.toLocaleString(),
          }
        } catch { return null }
      })
      .filter(Boolean) as any[]
  }

  static load(slotName: string): GameFactStore {
    const path = slotName.includes('/') ? slotName : `saves/${slotName}.json`
    const data = JSON.parse(fs.readFileSync(path, 'utf-8')) as GameSession
    return new GameFactStore(data)
  }
}
