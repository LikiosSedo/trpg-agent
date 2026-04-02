import * as fs from 'fs'
import type { GameSession, GameEvent, NPC } from './types.js'

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
      .map(q => `- ${q.name}: ${q.objectives.join(', ')}`)

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
    ].filter(Boolean).join('\n')
  }

  /** 一段话总结玩家状态 */
  getPlayerSummary(): string {
    const { player } = this.session
    const mods = player.abilityModifiers
    const equip = [player.equipped.weapon?.name, player.equipped.armor?.name].filter(Boolean).join(', ')
    const spellsLeft = player.spells.filter(s => s.remaining > 0 || s.usesPerRest === 0).map(s => s.name)
    return (
      `${player.name} is a level ${player.level} adventurer with ${player.hp}/${player.maxHp} HP and ${player.gold} gold. ` +
      `Abilities: STR${mods.STR >= 0 ? '+' : ''}${mods.STR} DEX${mods.DEX >= 0 ? '+' : ''}${mods.DEX} CON${mods.CON >= 0 ? '+' : ''}${mods.CON} ` +
      `INT${mods.INT >= 0 ? '+' : ''}${mods.INT} WIS${mods.WIS >= 0 ? '+' : ''}${mods.WIS} CHA${mods.CHA >= 0 ? '+' : ''}${mods.CHA}. ` +
      (equip ? `Equipped: ${equip}. ` : '') +
      `Skills: ${player.skills.join(', ')}. ` +
      (spellsLeft.length ? `Available spells: ${spellsLeft.join(', ')}. ` : '') +
      `Carrying ${player.inventory.length} items, knows ${player.clues.length} clues.`
    )
  }

  /** 获取指定 NPC 视角下对玩家的了解 */
  getNPCContext(name: string): string {
    const npc = this.session.npcs.find(n => n.name === name)
    if (!npc) throw new Error(`NPC not found: ${name}`)
    const promises = npc.playerPromises.length
      ? `Player promised: ${npc.playerPromises.join('; ')}.`
      : 'Player has made no promises.'
    const facts = npc.knownFacts.length
      ? `Known facts: ${npc.knownFacts.join('; ')}.`
      : 'Knows nothing special.'
    return (
      `${npc.name} (trust: ${npc.trust}/10, mood: ${npc.mood}, at: ${npc.location}). ` +
      `${facts} ${promises}`
    )
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
