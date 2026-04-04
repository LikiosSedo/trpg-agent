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
import { ChapterManager } from '../chapter-manager.js'
import { getNPCSubLocation, getPlayerSubLocation, getSubLocationName, moveNPC } from '../npc-mobility.js'
import { evaluateResponse, getAttitudeDirective, changeTrust } from '../trust-system.js'

// ─── 对话中的 NPC 追踪（供引擎读取） ───
const speakingNPCs: string[] = []

/** 消费本轮所有说话的 NPC 列表 */
export function consumeSpeakingNPCs(): string[] {
  const result = [...speakingNPCs]
  speakingNPCs.length = 0
  return result
}

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

    // 昏迷检查：昏迷 NPC 无法对话
    if (npc.condition === 'unconscious') {
      return { output: `${npc.name}正处于昏迷状态，无法对话。`, isError: true }
    }

    // 位置检查：玩家必须和 NPC 在同一地点
    if (npc.location !== session.worldState.currentLocation) {
      const locationNames: Record<string, string> = {
        'dawnbreak-town': '破晓镇', 'twilight-woods': '暮色森林',
        'greyspine-mines': '灰脊矿道', 'shatterstone-wastes': '碎石荒原',
      }
      const npcLoc = locationNames[npc.location] ?? npc.location
      const recap = facts.getNPCRecap(npcId)
      return { output: `${npc.name}不在这里（目前在${npcLoc}），无法直接对话。\n${recap}`, isError: true }
    }

    // 子地点检查：玩家必须和NPC在同一子地点
    const npcSub = getNPCSubLocation(npc)
    const playerSub = getPlayerSubLocation(session)
    if (npcSub && playerSub && npcSub !== playerSub) {
      const poiName = getSubLocationName(npcSub)
      return {
        output: `${npc.name}不在这里，目前在${poiName}。你需要先去那里（Move到${npcSub}）。`,
        isError: true,
      }
    }

    // 信任梯度检查
    const npcResponse = evaluateResponse(npc)
    if (npcResponse.type === 'combat_trigger') {
      return {
        output: `[信任度触发敌对] ${npcResponse.description}\nNPC反应: ${npcResponse.combatResponse}。信任度: ${npc.trust}`,
      }
    }
    if (npcResponse.type === 'avoidance') {
      moveNPC(npc, npc.homeBase ?? '', session)
      return {
        output: `${npcResponse.description}（信任度: ${npc.trust}）`,
      }
    }

    // 记录正在说话的 NPC（供引擎发射立绘事件）
    if (!speakingNPCs.includes(npcId)) speakingNPCs.push(npcId)

    // 通知章节系统（位置检查通过后才触发）
    if (session.chapter) {
      new ChapterManager(session).onEvent('talk', npcId)
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
      // Per-NPC social DC from combat data + trust penalty
      const npcCombatData = (await import('../../data/npc-combatants.json', { with: { type: 'json' } })).default
      const npcEntry = npcCombatData.find((n: any) => n.name === npcId)
      const baseDC = npcEntry?.socialDC ?? 10
      // 信任度分段影响说服难度
      let trustMod = 0
      if (npc.trust >= 7) trustMod = -4       // 挚友，几乎有求必应
      else if (npc.trust >= 4) trustMod = -2  // 熟人，愿意帮忙
      else if (npc.trust <= -6) {             // 极度敌对，拒绝沟通
        return { output: `${npcId}完全拒绝和你交流。` }
      }
      else if (npc.trust <= -3) trustMod = 4  // 敌对，非常难说服
      else if (npc.trust <= -1) trustMod = 2  // 不信任
      const dc = baseDC + trustMod
      const result = skillCheck(totalMod, dc)

      const approachZh = { persuade: '说服', deceive: '欺骗', intimidate: '威吓' }

      // Trust changes based on check result
      const trustDelta = result.success ? 1 : -1
      changeTrust(session, {
        npcName: npc.name,
        channel: 'dialogue',
        delta: trustDelta,
        reason: `${approachZh[approach as keyof typeof approachZh]}${result.success ? '成功' : '失败'}`,
        turn: session.turnCount,
      })
      const skillAttitude = getAttitudeDirective(npc)
      return {
        output: [
          `对话(${approachZh[approach as keyof typeof approachZh]})：玩家对${npc.name}说"${message}"。`,
          `${approachZh[approach as keyof typeof approachZh]}检定：d20=${result.roll}, 修正+${totalMod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。`,
          `信任度变化: ${npc.trust + (result.success ? -1 : 1)} → ${npc.trust}`,
          `NPC上下文：${npcContext}${skillAttitude ? '\n' + skillAttitude : ''}`,
        ].join('\n'),
      }
    }

    // 记录交互摘要（供后续不在场时回顾）
    if (!npc.interactionLog) npc.interactionLog = []
    npc.interactionLog.push(`第${session.turnCount}轮：玩家对${npc.name}说"${message.slice(0, 40)}"`)
    if (npc.interactionLog.length > 10) npc.interactionLog.shift()

    // ── 任务自动完成 + 分配 ──
    const completionInfo = tryAutoComplete(session, npc.name)
    const questInfo = tryAssignQuest(session, npc.name)

    const attitude = getAttitudeDirective(npc)
    return {
      output: [
        `对话：玩家对${npc.name}说"${message}"。`,
        `NPC上下文：${npcContext}${attitude ? '\n' + attitude : ''}`,
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
      // 通知章节系统任务完成
      if (session.chapter) {
        new ChapterManager(session).onEvent('quest', quest.name)
      }
      if (reward) {
        let msg = `\n★ 任务"${quest.name}"完成！奖励：${reward.gold}金币, ${reward.xp}经验！`
        if (reward.levelUp) msg += `\n\n★★★ 升级！Lv${reward.levelUp.level}！${reward.levelUp.flavor} ★★★`
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
