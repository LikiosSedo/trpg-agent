/**
 * 💬 对话工具
 *
 * 与 NPC 进行对话交互。
 */

import { z } from 'zod'
import type { Tool } from 'open-claude-cli/engine'
import { getSession, getFacts } from '../game-state.js'
import { skillCheck } from '../rules-engine.js'
import { QuestManager } from '../quest-manager.js'

export const TalkTool: Tool = {
  name: 'Talk',
  description: `与 NPC 对话。DM Agent 用此工具将对话请求转发给对应的 NPC Agent。
NPC Agent 会根据自己的性格、记忆和对玩家的态度生成回应。
特殊对话行为 (说服/欺骗/威吓) 可能触发对抗检定。`,
  inputSchema: z.object({
    npcId: z.string().describe('目标 NPC 的 ID'),
    message: z.string().describe('玩家对 NPC 说的话'),
    approach: z.enum(['normal', 'persuade', 'deceive', 'intimidate']).optional()
      .describe('对话策略。非 normal 时触发对应的技能对抗检定'),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const facts = getFacts()
    const { npcId, message, approach } = input

    const npc = session.npcs.find(n => n.name === npcId)
    if (!npc) return { output: `NPC"${npcId}"不存在。`, isError: true }

    // 位置检查：玩家必须和 NPC 在同一地点
    if (npc.location !== session.worldState.currentLocation) {
      const locationNames: Record<string, string> = {
        'dawnbreak-town': '破晓镇', 'twilight-woods': '暮色森林',
        'greyspine-mines': '灰脊矿道', 'shatterstone-wastes': '碎石荒原',
      }
      const npcLoc = locationNames[npc.location] ?? npc.location
      return { output: `${npc.name}不在这里。上次见到${npc.name}是在${npcLoc}。`, isError: true }
    }

    const npcContext = facts.getNPCContext(npcId)

    // Social skill check if non-normal approach
    if (approach && approach !== 'normal') {
      const skillMap = { persuade: 'CHA', deceive: 'CHA', intimidate: 'CHA' } as const
      const mod = session.player.abilityModifiers[skillMap[approach as keyof typeof skillMap]]
      const proficient = (approach === 'persuade' && session.player.skills.includes('persuasion'))
        || (approach === 'deceive' && session.player.skills.includes('deception'))
        || (approach === 'intimidate' && session.player.skills.includes('intimidation'))
      const totalMod = mod + (proficient ? 2 : 0)
      const dc = 10 + Math.max(0, -npc.trust) // Higher DC if NPC distrusts player
      const result = skillCheck(totalMod, dc)

      // Trust changes based on check result
      if (result.success) {
        npc.trust = Math.min(10, npc.trust + 1)
      } else {
        npc.trust = Math.max(-10, npc.trust - 1)
      }

      const approachZh = { persuade: '说服', deceive: '欺骗', intimidate: '威吓' }
      return {
        output: [
          `对话(${approachZh[approach as keyof typeof approachZh]})：玩家对${npc.name}说"${message}"。`,
          `${approachZh[approach as keyof typeof approachZh]}检定：d20=${result.roll}, 修正+${totalMod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。`,
          `信任度变化: ${npc.trust + (result.success ? -1 : 1)} → ${npc.trust}`,
          `NPC上下文：${npcContext}`,
        ].join('\n'),
      }
    }

    // ── 任务自动完成 + 分配 ──
    const completionInfo = tryAutoComplete(session, npc.name)
    const questInfo = tryAssignQuest(session, npc.name)

    return {
      output: [
        `对话：玩家对${npc.name}说"${message}"。`,
        `NPC上下文：${npcContext}`,
        completionInfo ?? '',
        questInfo ?? '',
      ].filter(Boolean).join('\n'),
    }
  },
}

/** 与公会 NPC 对话时，自动完成已达成全部目标的任务 */
function tryAutoComplete(session: import('../types.js').GameSession, npcName: string): string | null {
  if (npcName !== '艾琳娜' && npcName !== '韩猛') return null

  const qm = new QuestManager(session)
  const active = qm.getActiveQuests()
  const results: string[] = []

  for (const quest of active) {
    if (quest.objectivesCompleted.every(Boolean)) {
      const reward = qm.completeQuest(quest.name)
      if (reward) {
        let msg = `\n★ 任务"${quest.name}"完成！奖励：${reward.gold}金币, ${reward.xp}经验！`
        if (reward.levelUp) msg += `\n\n★★★ 升级！你现在是 Lv${reward.levelUp} 了！HP+5, 新能力已解锁！ ★★★`
        results.push(msg)
      }
    }
  }

  return results.length > 0 ? results.join('\n') : null
}

/** 与公会相关 NPC 对话时自动分配任务 */
function tryAssignQuest(session: import('../types.js').GameSession, npcName: string): string | null {
  if (npcName !== '艾琳娜' && npcName !== '韩猛') return null

  const qm = new QuestManager(session)
  const active = qm.getActiveQuests()

  // 没有活跃任务 → 分配"森林试炼"
  if (active.length === 0) {
    const completed = session.quests.find(q => q.name === '森林试炼' && q.status === 'completed')
    if (!completed) {
      const quest = qm.createQuest('森林试炼')
      if (quest) {
        return `[系统：${npcName}分配了新任务"${quest.name}"——${quest.description}]`
      }
    }
  }

  // 完成"森林试炼"后回来报告 → 分配"矿道调查"
  const forestDone = session.quests.find(q => q.name === '森林试炼' && q.status === 'completed')
  const mineExists = session.quests.find(q => q.name === '矿道调查')
  if (forestDone && !mineExists) {
    const quest = qm.createQuest('矿道调查')
    if (quest) {
      return `[系统：${npcName}分配了新任务"${quest.name}"——${quest.description}]`
    }
  }

  // 完成"矿道调查"后 → 分配"荒原侦察"
  const mineDone = session.quests.find(q => q.name === '矿道调查' && q.status === 'completed')
  const wastelandExists = session.quests.find(q => q.name === '荒原侦察')
  if (mineDone && !wastelandExists) {
    const quest = qm.createQuest('荒原侦察')
    if (quest) {
      return `[系统：${npcName}分配了新任务"${quest.name}"——${quest.description}]`
    }
  }

  return null
}
