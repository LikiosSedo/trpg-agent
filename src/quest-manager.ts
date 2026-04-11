/**
 * 任务管理器
 *
 * 管理任务生命周期：接取 → 追踪目标 → 完成/失败 → 发放奖励 → 升级。
 */

import type { GameSession, Quest, PlayerCharacter, Spell, Ability } from './types.js'
import { getFacts, getSession } from './game-state.js'
import { changeTrust } from './trust-system.js'
import { computeModifiers } from './game-data.js'

// ─── 怪物中英名映射（用于击杀目标匹配）──────────

const MONSTER_NAME_ZH: Record<string, string> = {
  '狼': 'Wolf',
  '哥布林': 'Goblin',
  '骷髅': 'Skeleton',
  '巨型蜘蛛': 'Giant Spider',
  '暗影': 'Shadow',
  '食尸鬼': 'Ghoul',
  '兽人战士': 'Orc Warrior',
  '拟态怪': 'Mimic',
  '蚀日兽': 'Eclipsed Beast',
}

// ─── 预定义任务 ────────────────────────────────

export interface QuestTemplate {
  name: string
  description: string
  objectives: string[]
  reward: { gold: number; xp: number }
}

export const QUEST_TEMPLATES: Record<string, QuestTemplate> = {
  '森林试炼': {
    name: '森林试炼',
    description: '清除暮色森林边缘的狼群威胁，确认猎人老林的安全。',
    objectives: ['击杀3只狼 [暮色森林]', '在猎人石屋找到老林并交谈 [暮色森林深处]'],
    reward: { gold: 50, xp: 100 },
  },
  '矿道调查': {
    name: '矿道调查',
    description: '失踪矿工和搜救队两周未归。深入矿道中层，找到他们的下落。',
    objectives: ['进入灰脊矿道中层 [从镇北矿道入口进入]', '在废弃矿工宿舍搜索失踪队伍痕迹 [矿道中层]'],
    reward: { gold: 100, xp: 200 },
  },
  '荒原侦察': {
    name: '荒原侦察',
    description: '碎石荒原的兽人异常好斗，可能和矿洞事件有关。调查并搜集情报。',
    objectives: ['前往碎石荒原调查兽人营地 [荒原西部]', '在废弃瞭望塔找到冒险者调查笔记 [荒原东北]'],
    reward: { gold: 80, xp: 150 },
  },
}

// ─── 等级阈值 ──────────────────────────────────

const LEVEL_THRESHOLDS: { level: number; xp: number }[] = [
  { level: 6, xp: 100 },
  { level: 7, xp: 300 },
  { level: 8, xp: 600 },
]

// ─── QuestManager ──────────────────────────────

export class QuestManager {
  constructor(private session: GameSession) {}

  createQuest(templateName: string): Quest | null {
    const template = QUEST_TEMPLATES[templateName]
    if (!template) return null

    // 不重复接同名任务
    if (this.session.quests.some(q => q.name === templateName)) return null

    const quest: Quest = {
      name: template.name,
      description: template.description,
      status: 'active',
      objectives: [...template.objectives],
      objectivesCompleted: template.objectives.map(() => false),
      reward: { ...template.reward },
    }

    this.session.quests.push(quest)
    getFacts().addEvent(`接取任务：${quest.name}`, 'critical')
    return quest
  }

  completeObjective(questName: string, objectiveIndex: number): { allDone: boolean } | null {
    const quest = this.session.quests.find(q => q.name === questName && q.status === 'active')
    if (!quest) return null
    if (objectiveIndex < 0 || objectiveIndex >= quest.objectives.length) return null

    quest.objectivesCompleted[objectiveIndex] = true
    getFacts().addEvent(`任务进度[${quest.name}]：完成 "${quest.objectives[objectiveIndex]}"`, 'normal')

    const allDone = quest.objectivesCompleted.every(Boolean)
    return { allDone }
  }

  completeQuest(questName: string): { gold: number; xp: number; levelUp: { level: number; flavor: string } | null } | null {
    const quest = this.session.quests.find(q => q.name === questName && q.status === 'active')
    if (!quest) return null

    quest.status = 'completed'
    const { gold, xp } = quest.reward
    this.session.player.gold += gold
    this.session.player.xp += xp
    getFacts().addEvent(`完成任务：${quest.name}（+${gold}金, +${xp}XP）`, 'critical')

    // 任务完成信任提升
    const questGivers: Record<string, string> = {
      '森林试炼': '艾琳娜',
      '矿道调查': '艾琳娜',
      '荒原侦察': '艾琳娜',
    }
    const giver = questGivers[quest.name]
    if (giver) {
      const session = getSession()
      changeTrust(session, {
        npcName: giver,
        channel: 'quest',
        delta: 2,
        reason: `完成任务: ${quest.name}`,
        turn: session.turnCount,
      })
    }

    const levelUp = this.checkLevelUp(this.session.player)
    return { gold, xp, levelUp }
  }

  failQuest(questName: string): boolean {
    const quest = this.session.quests.find(q => q.name === questName && q.status === 'active')
    if (!quest) return false
    quest.status = 'failed'
    getFacts().addEvent(`任务失败：${quest.name}`, 'critical')
    return true
  }

  getActiveQuests(): Quest[] {
    return this.session.quests.filter(q => q.status === 'active')
  }

  /** 检查升级。返回新等级和职业特色描述，或 null 表示没升级 */
  checkLevelUp(player: PlayerCharacter): { level: number; flavor: string } | null {
    for (const { level, xp } of LEVEL_THRESHOLDS) {
      if (player.level < level && player.xp >= xp) {
        player.level = level

        // ── 所有等级：HP +5 ──
        player.maxHp += 5
        player.hp = Math.min(player.hp + 5, player.maxHp)

        const log: string[] = ['生命上限+5']

        // ── Level 6：主属性 +1 ──
        if (level === 6) {
          const primary = detectPrimaryAbility(player)
          player.abilities[primary] += 1
          player.abilityModifiers = computeModifiers(player.abilities)
          log.push(`${primary} 提升至 ${player.abilities[primary]}`)
        }

        // ── Level 7：职业新技能 ──
        if (level === 7) {
          const newSpell = getLevel7Spell(player)
          if (newSpell && !player.spells.some(s => s.name === newSpell.name)) {
            player.spells.push(newSpell)
            log.push(`习得新技能: ${newSpell.name}`)
          }
        }

        // ── Level 8：被动特技（存入 worldState.flags）──
        if (level === 8) {
          const passive = getLevel8Passive(player)
          if (passive) {
            this.session.worldState.flags[`passive_${passive.id}`] = 'true'
            log.push(`获得被动特技: ${passive.name} — ${passive.description}`)
          }
        }

        const flavor = this.getLevelUpFlavor(player, level, log)
        getFacts().addEvent(`升级！达到 Lv${level}（${log.join(', ')}）`, 'critical')
        return { level, flavor }
      }
    }
    return null
  }

  /** 升级时的职业特色描述 */
  private getLevelUpFlavor(player: PlayerCharacter, level: number, log: string[]): string {
    const rewards = log.join('，')

    // 按职业和等级生成不同的叙事
    const isCleric = player.spells.some(s => s.name === 'Cure Wounds') && player.skills.includes('medicine')
    const isMage = player.skills.includes('arcana')
    const isRanger = player.skills.includes('stealth') && player.skills.includes('perception')
    // Fighter: fallback

    if (level === 6) {
      if (isCleric) return `神圣之光在你掌心凝聚，信仰的力量更加坚定。你感到神祇的恩赐流入身体的每一寸。${rewards}。`
      if (isMage) return `魔力在血管中奔涌，奥术符文在脑海中更加清晰。你的智慧达到了新的境界。${rewards}。`
      if (isRanger) return `你的感官变得更加敏锐，风中最细微的气息也逃不过你的觉察。${rewards}。`
      return `力量涌上手臂，肌肉在战斗的磨砺中变得更加坚韧。每一次挥剑都比昨天更有力。${rewards}。`
    }

    if (level === 7) {
      if (isCleric) return `你与神祇的联结愈发紧密——一股神圣的怒意在指尖凝聚，足以斥退亡灵。${rewards}。`
      if (isMage) return `奥术领悟加深——你的手指间跳动着新的火焰，更强大的法术已在掌握之中。${rewards}。`
      if (isRanger) return `你的眼睛适应了黑暗与距离——箭矢将比以往任何时候都更加精准致命。${rewards}。`
      return `无数次战斗的磨砺赋予了你超越常人的战斗直觉——你学会了如何让每一击都命中要害。${rewards}。`
    }

    if (level === 8) {
      if (isCleric) return `神恩如潮水般涌来，你的治愈之力获得了质的飞跃。伤者在你手下将恢复得更快。${rewards}。`
      if (isMage) return `奥术之力在你体内共鸣——每一个法术都被增幅，威力远超从前。${rewards}。`
      if (isRanger) return `你的反射速度已经超越了凡人的极限——在敌人反应过来之前，你就已经完成了动作。${rewards}。`
      return `你对战斗的理解已臻化境——致命一击的时机，你比任何人都看得更准。${rewards}。`
    }

    return `你变得更加强大了。${rewards}。`
  }

  /** 根据击杀数按怪物名检查所有活跃任务的击杀目标。
   *  返回已完成的目标 + 所有进行中击杀目标的进度。 */
  checkCombatObjectives(): {
    completed: { questName: string; objectiveIndex: number; text: string }[]
    progress: { questName: string; text: string; current: number; required: number }[]
  } {
    const completed: { questName: string; objectiveIndex: number; text: string }[] = []
    const progress: { questName: string; text: string; current: number; required: number }[] = []

    for (const quest of this.session.quests.filter(q => q.status === 'active')) {
      for (let i = 0; i < quest.objectives.length; i++) {
        if (quest.objectivesCompleted[i]) continue

        // Parse kill objectives like "击杀3只狼"
        const killMatch = quest.objectives[i].match(/击杀(\d+)只(.+)/)
        if (!killMatch) continue

        const required = Number(killMatch[1])
        const targetZh = killMatch[2]
        const monsterName = MONSTER_NAME_ZH[targetZh]
        if (!monsterName) continue

        const kills = Number(this.session.worldState.flags[`kills_${monsterName}`] ?? 0)
        if (kills >= required) {
          this.completeObjective(quest.name, i)
          completed.push({ questName: quest.name, objectiveIndex: i, text: quest.objectives[i] })
        } else if (kills > 0) {
          progress.push({ questName: quest.name, text: `击杀${targetZh} ${kills}/${required}`, current: kills, required })
        }
      }
    }

    return { completed, progress }
  }
}

// ─── 升级辅助函数 ─────────────────────────────

/** 根据职业推断主属性 */
function detectPrimaryAbility(player: PlayerCharacter): Ability {
  // 按职业技能推断，比盲目取最高值更准确
  if (player.skills.includes('arcana')) return 'INT'        // Mage
  if (player.skills.includes('medicine')) return 'WIS'      // Cleric
  if (player.skills.includes('stealth') && player.skills.includes('perception')) return 'DEX'  // Ranger
  if (player.skills.includes('athletics')) return 'STR'     // Fighter
  // fallback: 取最高属性
  let best: Ability = 'STR'
  let bestVal = 0
  for (const key of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as Ability[]) {
    if (player.abilities[key] > bestVal) { bestVal = player.abilities[key]; best = key }
  }
  return best
}

/** Level 7 职业技能。法师已在 game-data 模板中自带 Fireball，此处为其他职业补充新技能。 */
function getLevel7Spell(player: PlayerCharacter): Spell | null {
  if (player.skills.includes('arcana')) {
    // 法师：已有 Fireball，解锁 Ice Storm
    return {
      name: 'Ice Storm',
      description: '冰风暴',
      effect: 'Deal 2d8 bludgeoning + 4d6 cold damage in a 20ft radius. DEX save DC 14 for half.',
      usesPerRest: 1,
      remaining: 1,
    }
  }
  if (player.skills.includes('athletics')) {
    // Fighter: 战术打击
    return {
      name: 'Tactical Strike',
      description: '战术打击——精准一击，自动命中并额外造成1d6伤害',
      effect: 'Next attack auto-hits. Deal extra 1d6 damage.',
      usesPerRest: 2,
      remaining: 2,
    }
  }
  if (player.skills.includes('stealth') && player.skills.includes('perception')) {
    // Ranger: 精准射击
    return {
      name: 'Precise Shot',
      description: '精准射击——瞄准要害，攻击+4命中，额外造成2d6伤害',
      effect: '+4 to hit. Deal extra 2d6 damage.',
      usesPerRest: 2,
      remaining: 2,
    }
  }
  if (player.skills.includes('medicine')) {
    // Cleric: 神圣斥责
    return {
      name: 'Turn Undead',
      description: '神圣斥责——释放神圣之力，对所有不死系怪物造成3d6光辉伤害',
      effect: 'Deal 3d6 radiant damage to all undead enemies.',
      usesPerRest: 2,
      remaining: 2,
    }
  }
  return null
}

/** Level 8 被动特技定义 */
function getLevel8Passive(player: PlayerCharacter): { id: string; name: string; description: string } | null {
  if (player.skills.includes('athletics')) {
    return { id: 'fighter_crit_range', name: '致命精准', description: '暴击范围扩展至19-20' }
  }
  if (player.skills.includes('arcana')) {
    return { id: 'mage_spell_power', name: '奥术增幅', description: '所有法术伤害+2' }
  }
  if (player.skills.includes('stealth') && player.skills.includes('perception')) {
    return { id: 'ranger_quick_reflexes', name: '超凡反射', description: '先攻永久+3' }
  }
  if (player.skills.includes('medicine')) {
    return { id: 'cleric_divine_grace', name: '神恩', description: '治疗法术恢复量+50%' }
  }
  return null
}
