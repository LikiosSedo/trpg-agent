/**
 * 💬 对话工具
 *
 * 与 NPC 进行对话交互。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import type { Monster } from '../types.js'
import { getSession, getFacts } from '../game-state.js'
import { skillCheck } from '../rules-engine.js'
import { QuestManager } from '../quest-manager.js'
import { ChapterManager } from '../chapter-manager.js'
import { getNPCSubLocation, getPlayerSubLocation, getSubLocationName, moveNPC } from '../npc-mobility.js'
import { evaluateResponse, getAttitudeDirective, changeTrust } from '../trust-system.js'
import { checkNPCCanReveal, discoverWeakness, discoverResistance, discoverImmunity } from '../bestiary.js'

/**
 * normal 对话自动获得 +1 信任的概率。
 * 当前值：10%。与 trust-system.ts 的 DIALOGUE_TRUST_COOLDOWN_TURNS 配合使用，
 * 平均每 3 轮最多触发一次（因为冷却锁）。待调参，详见 CLAUDE.md §4 + 信任度系统章节。
 */
const NORMAL_DIALOGUE_TRUST_CHANCE = 0.10

// ─── 对话中的 NPC 追踪（供引擎读取） ───
const speakingNPCs: string[] = []

/** 消费本轮所有说话的 NPC 列表 */
export function consumeSpeakingNPCs(): string[] {
  const result = [...speakingNPCs]
  speakingNPCs.length = 0
  return result
}

// ─── 怪物图鉴情报发现（关键词触发） ───

/** 每种怪物的对话触发关键词（中文，匹配玩家输入） */
const MONSTER_KEYWORDS: Record<string, string[]> = {
  'Spider Matriarch': ['蜘蛛', '蛛', '森林', '蛛母', '蛛丝', '紫色丝', '毒', '虫'],
  'Wolf': ['狼', '森林', '野兽'],
  'Cockatrice': ['鸡蛇', '石化', '森林'],
  'Giant Spider': ['蜘蛛', '蛛', '蛛丝', '毒'],
  'Shadow Weaver': ['暗影', '矿道', '黑暗', '影子', '阴影', '祭坛', '教团'],
  'Shadow': ['暗影', '影子', '矿道', '黑暗'],
  'Skeleton': ['骷髅', '不死', '矿道', '骨'],
  'Ghoul': ['食尸鬼', '麻痹', '矿道', '尸'],
  'Eclipsed Beast': ['蚀日', '虚空', '荒原', '棱镜', '封印', '怪物', '破晓', '那个东西'],
  'Orc Warrior': ['兽人', '荒原', '斧'],
  'Mimic': ['箱子', '拟态', '矿道', '陷阱'],
}

let monstersDbCache: Monster[] | null = null
async function loadMonstersDb(): Promise<Monster[]> {
  if (!monstersDbCache) {
    monstersDbCache = (await import('../../data/monsters.json', { with: { type: 'json' } })).default as Monster[]
  }
  return monstersDbCache
}

/** 检查 NPC 是否能提供怪物弱点情报，返回附加文本（空数组=无新发现）。
 *  只有当 playerMessage 中包含该怪物的相关关键词时才触发解锁。 */
async function checkBestiaryReveals(
  session: import('../types.js').GameSession,
  npcId: string,
  npcTrust: number,
  playerMessage: string,
): Promise<string[]> {
  const monstersDb = await loadMonstersDb()
  const reveals: string[] = []

  for (const monster of monstersDb) {
    if (!monster.discoveryHints) continue
    const check = checkNPCCanReveal(monster, npcId, npcTrust)
    if (!check.canReveal) continue

    // 关键词匹配：玩家消息中必须包含至少一个相关关键词
    const keywords = MONSTER_KEYWORDS[monster.name] || []
    const messageHasKeyword = keywords.some(kw => playerMessage.includes(kw))
    if (!messageHasKeyword) continue

    const monsterZh = monster.nameZh || monster.name
    // 尝试解锁弱点
    if (monster.vulnerability?.length) {
      const result = discoverWeakness(session, monster.name, `${npcId}的情报`)
      if (result) reveals.push(`📖 ${npcId}告诉你：${monsterZh}的弱点是 ${monster.vulnerability.join('/')} 类型伤害`)
    }
    // 尝试解锁抗性
    if (monster.resistance?.length) {
      const result = discoverResistance(session, monster.name, `${npcId}的情报`)
      if (result) reveals.push(`📖 ${npcId}提醒你：${monsterZh}对 ${monster.resistance.join('/')} 类型伤害有抗性`)
    }
    // 尝试解锁免疫
    if (monster.immunity?.length) {
      const result = discoverImmunity(session, monster.name, `${npcId}的情报`)
      if (result) reveals.push(`📖 ${npcId}警告你：${monsterZh}完全免疫 ${monster.immunity.join('/')} 类型伤害`)
    }
  }

  return reveals
}

export const TalkTool: Tool = {
  name: 'Talk',
  description: `与 NPC 对话。DM Agent 用此工具将对话请求转发给对应的 NPC Agent。
NPC Agent 会根据自己的性格、记忆和对玩家的态度生成回应。

approach 的判断标准（请严格区分，不要把"表达自己"误判为"说服"）：
- normal: 日常对话、问候、自我介绍、真诚陈述、合理请求、提问。不触发检定。
    例：打招呼、询问任务、"我是来找工作的冒险者"、"我的实力不错"、"这里最近有什么消息？"
- persuade: 试图让 NPC 做她原本不太愿意做的事 —— 请求特权、讨要折扣、请求破例、改变立场。触发 CHA 说服对抗。
    例："请给我打个折"、"让我破例带队"、"能不能先不交定金"
- deceive: 编造谎言、伪造身份、隐瞒事实。触发 CHA 欺骗对抗。
    例："我是公会长老派来的"、伪装身份、虚构来历
- intimidate: 威胁、恐吓、施加心理压力。触发 CHA 威吓对抗。
    例："不给我任务你会后悔"、暗示暴力

核心原则：单纯的自我表达或陈述属于 normal，不是 persuade。persuade 的本质是"请求特权或改变决定"。`,
  inputSchema: z.object({
    npcId: z.string().describe('目标 NPC 的 ID'),
    message: z.string().describe('玩家对 NPC 说的话'),
    approach: z.enum(['normal', 'persuade', 'deceive', 'intimidate']).optional()
      .describe('对话策略。normal=日常/真诚陈述（不检定），persuade=请求特权，deceive=说谎，intimidate=威胁。详见工具 description。'),
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
      const oldTrust = npc.trust
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
      if (npc.trust >= 7) trustMod = -6       // 挚友
      else if (npc.trust >= 4) trustMod = -3  // 熟人
      else if (npc.trust <= -6) {             // 极度敌对，拒绝沟通
        return { output: `${npcId}完全拒绝和你交流。` }
      }
      else if (npc.trust <= -3) trustMod = 4  // 敌对，非常难说服
      else if (npc.trust <= -1) trustMod = 2  // 不信任
      const dc = baseDC + trustMod
      const result = skillCheck(totalMod, dc)

      const approachZh = { persuade: '说服', deceive: '欺骗', intimidate: '威吓' }

      // 信任变化规则（见 CLAUDE.md §4 数值平衡修改规范 + 当前系统关键设计/信任度系统）：
      //   - persuade 成功 → +1（对话层的主要正向路径）
      //   - persuade 失败 → 0（D&D 5e RAW: nothing happens，不双重惩罚）
      //   - deceive 成功 → 0（骗过 NPC 不代表她更信任你，只是暂时没拆穿）
      //   - deceive 失败 → 0（失败本身就是惩罚，不扣信任）
      //   - intimidate 成功 → 0（威胁屈服不等于信任提升）
      //   - intimidate 失败 → 0（同上）
      //   信任的主要下降路径是"实际的坏行为"（攻击/偷窃），由 attack.ts + trust-system.ts
      //   propagateViolenceTrust 承担，不走这里。
      const trustDelta = (approach === 'persuade' && result.success) ? 1 : 0
      if (trustDelta !== 0) {
        changeTrust(session, {
          npcName: npc.name,
          channel: 'dialogue',
          delta: trustDelta,
          reason: `${approachZh[approach as keyof typeof approachZh]}成功`,
          turn: session.turnCount,
        })
      }
      const skillAttitude = getAttitudeDirective(npc)

      // 怪物图鉴情报：仅成功的 persuade 且玩家提到相关话题时触发
      let bestiaryAppend = ''
      if (approach === 'persuade' && result.success) {
        const reveals = await checkBestiaryReveals(session, npcId, npc.trust, message)
        if (reveals.length > 0) {
          bestiaryAppend = '\n\n[怪物图鉴更新]\n' + reveals.join('\n')
        }
      }

      return {
        output: [
          `对话(${approachZh[approach as keyof typeof approachZh]})：玩家对${npc.name}说"${message}"。`,
          `${approachZh[approach as keyof typeof approachZh]}检定：d20=${result.roll}, 修正+${totalMod}, 总计=${result.total} vs DC${dc} → ${result.isCritical ? '大成功！' : result.isCritFail ? '大失败！' : result.success ? '成功' : '失败'}。`,
          `信任度变化: ${oldTrust} → ${npc.trust}`,
          `NPC上下文：${npcContext}${skillAttitude ? '\n' + skillAttitude : ''}`,
        ].join('\n') + bestiaryAppend,
      }
    }

    // 记录交互摘要（供后续不在场时回顾）
    if (!npc.interactionLog) npc.interactionLog = []
    npc.interactionLog.push(`第${session.turnCount}轮：玩家对${npc.name}说"${message.slice(0, 40)}"`)
    if (npc.interactionLog.length > 10) npc.interactionLog.shift()

    // ── normal 对话的小概率正向信任 ──
    // 见 CLAUDE.md §4 数值平衡规范 / 信任度系统：
    //   - 概率：NORMAL_DIALOGUE_TRUST_CHANCE（当前 10%，待调参）
    //   - 冷却：与 DM 主动 ChangeTrust(dialogue) 共享 3 轮锁（trust-system.ts）
    //   - 天花板：trustCeiling 章节软上限自然衰减，后期无效
    // 只在正常态（normal/礼貌/友好，非 curt/hostile/avoidance/combat_trigger）下触发。
    const currentResp = evaluateResponse(npc).type
    let autoTrustBumped = false
    if (currentResp === 'normal' && Math.random() < NORMAL_DIALOGUE_TRUST_CHANCE) {
      const bumped = changeTrust(session, {
        npcName: npc.name,
        channel: 'dialogue',
        delta: 1,
        reason: '日常对话建立好感',
        turn: session.turnCount,
      })
      if (bumped.applied) autoTrustBumped = true
    }

    // ── 任务自动完成 + 分配 ──
    const completionInfo = tryAutoComplete(session, npc.name)
    const questInfo = tryAssignQuest(session, npc.name)

    // ── 怪物图鉴情报（关键词触发） ──
    const bestiaryReveals = await checkBestiaryReveals(session, npcId, npc.trust, message)
    let bestiaryAppend = ''
    if (bestiaryReveals.length > 0) {
      bestiaryAppend = '\n\n[怪物图鉴更新]\n' + bestiaryReveals.join('\n')
    }

    const attitude = getAttitudeDirective(npc)
    return {
      output: [
        `对话：玩家对${npc.name}说"${message}"。`,
        autoTrustBumped ? `[系统：此次对话自然建立了一点好感 (trust +1)]` : '',
        // DM 主动加信任的引导：仅在玩家明显展现真诚/共情/建设性态度时使用。
        // 冷却由 trust-system 的 dialogue 通道锁控制（3 轮一次），超出冷却的调用会被静默拒绝。
        `[DM 信任指导：若本轮玩家明显展现真诚、共情或建设性态度（不是普通问答），可调用 ChangeTrust(channel='dialogue', delta=+1) 给 ${npc.name} 一点正向信任。请克制使用，同一 NPC 在冷却期内只能生效一次。]`,
        `NPC上下文：${npcContext}${attitude ? '\n' + attitude : ''}`,
        completionInfo ?? '',
        questInfo ?? '',
      ].filter(Boolean).join('\n') + bestiaryAppend,
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
