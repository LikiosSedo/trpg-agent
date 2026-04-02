/**
 * 任务管理器
 *
 * 管理任务生命周期：接取 → 追踪目标 → 完成/失败 → 发放奖励 → 升级。
 */

import type { GameSession, Quest, PlayerCharacter } from './types.js'
import { getFacts } from './game-state.js'

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
  { level: 2, xp: 100 },
  { level: 3, xp: 300 },
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

  completeQuest(questName: string): { gold: number; xp: number; levelUp: number | null } | null {
    const quest = this.session.quests.find(q => q.name === questName && q.status === 'active')
    if (!quest) return null

    quest.status = 'completed'
    const { gold, xp } = quest.reward
    this.session.player.gold += gold
    this.session.player.xp += xp
    getFacts().addEvent(`完成任务：${quest.name}（+${gold}金, +${xp}XP）`, 'critical')

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

  /** 检查升级。返回新等级，或 null 表示没升级 */
  checkLevelUp(player: PlayerCharacter): number | null {
    for (const { level, xp } of LEVEL_THRESHOLDS) {
      if (player.level < level && player.xp >= xp) {
        player.level = level
        player.maxHp += 5
        player.hp = Math.min(player.hp + 5, player.maxHp)

        // Lv3 法师解锁 Fireball
        if (level === 3 && player.spells.length > 0) {
          player.spells.push({
            name: 'Fireball',
            description: '爆裂火球，范围伤害',
            effect: 'Deal 8d6 fire damage in a 20-foot radius (DEX save for half).',
            usesPerRest: 1,
            remaining: 1,
          })
        }

        getFacts().addEvent(`升级！达到 Lv${level}（HP+5${level === 3 && player.spells.length > 0 ? ', 解锁Fireball' : ''}）`, 'critical')
        return level
      }
    }
    return null
  }

  /** 根据击杀数按怪物名检查所有活跃任务的击杀目标 */
  checkCombatObjectives(): { questName: string; objectiveIndex: number; text: string }[] {
    const results: { questName: string; objectiveIndex: number; text: string }[] = []

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
          results.push({ questName: quest.name, objectiveIndex: i, text: quest.objectives[i] })
        }
      }
    }

    return results
  }
}
