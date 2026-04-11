/**
 * ⚔️ 攻击工具
 *
 * 执行完整战斗回合：先攻 → 玩家攻击 → 怪物反击 → 战利品。
 * 战斗结果由 rules-engine / combat-manager 确定性计算，DM 只负责叙事描写。
 */

import { z } from 'zod'
import type { Tool } from '../agent/types.js'
import type { Monster } from '../types.js'
import { getSession } from '../game-state.js'
import { startCombat, executePlayerTurn, getCombatSummary, attemptFlee, isBuffSpell, castBuffSpell, executeMonsterPhase } from '../combat-manager.js'
import { changeTrust } from '../trust-system.js'
import { getPersonality } from '../npc-relationships.js'

export const AttackTool: Tool = {
  name: 'Attack',
  description: `对目标发动攻击，自动处理完整战斗回合。

首次攻击时自动开始战斗：
1. 为所有参战者掷先攻 (d20 + DEX修正)，排出行动顺序
2. 按先攻顺序依次执行每个参战者的回合

每个回合自动处理：
- 玩家回合：攻击掷骰 (d20 + 修正 vs 目标AC)，命中则掷伤害，暴击(自然20)伤害翻倍
- 怪物回合：怪物自动反击玩家，伤害由系统计算
- 战斗结束：所有怪物死亡 → 自动发放战利品；玩家倒下 → 战斗失败

首次调用时通过 encounterMonsters 指定所有参战怪物（可包含多个同类怪物）。
后续回合只需指定 targetId 和 method。`,
  inputSchema: z.object({
    targetId: z.string().describe('攻击目标的名称或ID'),
    method: z.enum(['weapon', 'spell', 'flee']).describe('"weapon" 使用装备武器, "spell" 使用法术, "flee" 尝试逃跑'),
    spellId: z.string().optional().describe('使用的法术名 (method 为 "spell" 时必填)'),
    encounterMonsters: z.array(z.string()).optional().describe(
      '首次攻击时，参战的所有怪物名称列表（如 ["Goblin", "Goblin"]）。不提供则默认只有 targetId 对应的怪物。',
    ),
  }),
  isConcurrencySafe: false,
  isReadOnly: false,
  async execute(input: any) {
    const session = getSession()
    const { targetId, method, spellId, encounterMonsters } = input

    // 逃跑处理
    if (method === 'flee') {
      if (!session.combat?.active) {
        return { output: '当前没有进行中的战斗，无需逃跑。', isError: true }
      }
      try {
        const fleeResult = await attemptFlee(session)
        const combatStatus = !fleeResult.ended ? getCombatSummary(session) : null
        return {
          output: [
            ...fleeResult.log,
            '',
            combatStatus ?? '',
          ].filter(Boolean).join('\n'),
        }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    // 加载怪物 + NPC 战斗数据库（统一格式）
    const monstersJson = await import('../../data/monsters.json', { with: { type: 'json' } })
    const npcCombatJson = await import('../../data/npc-combatants.json', { with: { type: 'json' } })
    const monstersDb = monstersJson.default as Monster[]
    const npcDb = npcCombatJson.default as Monster[]

    // 检查目标是否是 NPC
    const targetNpc = session.npcs.find(n => n.name === targetId)
    const isNPCTarget = !!targetNpc && npcDb.some(n => n.name === targetId)

    if (isNPCTarget && !session.combat?.active) {
      // 昏迷/重伤 NPC 不能再攻击
      if (targetNpc!.condition === 'unconscious') {
        return { output: `${targetId}已经昏迷倒地了，无法再攻击。`, isError: true }
      }
      if (targetNpc!.condition === 'recovering') {
        return { output: `${targetId}正在恢复中，处于虚弱状态。`, isError: true }
      }

      // 攻击 NPC → 信任暴跌 + 关系网连坐
      const personality = getPersonality(targetId)
      const grudgeTag = targetId === '小莉' ? 'harm_小莉' : undefined

      // 用 reputation channel 避免 cascadeReputation 立即传播
      // 全镇传播由 violence_alert 延迟后的 propagateViolenceTrust 统一处理
      changeTrust(session, {
        npcName: targetId,
        channel: 'reputation',
        delta: -5,
        reason: `玩家攻击了${targetId}`,
        turn: session.turnCount,
        grudgeTag,
      })

      // NPC 必须在同一位置
      if (targetNpc!.location !== session.worldState.currentLocation) {
        return { output: `${targetId}不在这里。`, isError: true }
      }

      // 护卫机制：攻击重要 NPC 时，护卫挡在前面
      // 层级防护：卫兵+韩猛 → 只有全倒了才能碰到本体
      const NPC_GUARDS: Record<string, { shields: string[]; canFightSelf: boolean }> = {
        '维克多': { shields: ['镇长府卫兵', '韩猛'], canFightSelf: false },  // 镇长 8HP，不参战
        '艾琳娜': { shields: ['韩猛'], canFightSelf: true },  // 公会长自己也能打
        '小莉': { shields: ['格雷格'], canFightSelf: false },  // 格雷格保护小莉（bond 2.0），小莉不参战
      }
      const guardConfig = NPC_GUARDS[targetId]
      let combatNames: string[]

      if (guardConfig) {
        // 筛选可用护卫（未昏迷/恢复中，有战斗数据）
        const playerLoc = session.worldState.currentLocation
        const playerSub = session.worldState.currentSubLocation
        const availableShields = guardConfig.shields.filter(name => {
          const npc = session.npcs.find(n => n.name === name)
          if (npc) {
            // 护卫必须在同一子区域且状态正常
            if (npc.condition === 'unconscious' || npc.condition === 'recovering') return false
            if (npc.location !== playerLoc) return false
            if ((npc.subLocation ?? npc.homeBase) !== playerSub) return false
            return true
          }
          // 非 NPC 护卫（如卫兵 monster）直接可用
          return npcDb.some(n => n.name === name) || monstersDb.some(n => n.name === name)
        })

        if (availableShields.length > 0) {
          // 护卫挡在前面，本体不参战
          for (const name of availableShields) {
            const npc = session.npcs.find(n => n.name === name)
            if (npc) changeTrust(session, { npcName: name, channel: 'reputation', delta: -5, reason: `玩家攻击了${targetId}`, turn: session.turnCount })
          }
          combatNames = guardConfig.canFightSelf ? [targetId, ...availableShields] : availableShields
          if (!guardConfig.canFightSelf) {
            // 信任暴跌但本体不参战
            return {
              output: (() => {
                const allDb = [...monstersDb, ...npcDb]
                const combat = startCombat(session, combatNames, allDb)
                return [
                  `⚠️ 你对${targetId}拔出了武器！${availableShields.join('和')}挡在了前面！`,
                  combat.log.join('\n'),
                ].filter(Boolean).join('\n')
              })(),
            }
          }
        } else {
          // 所有护卫都倒了，可以直接打本体
          combatNames = [targetId]
        }
      } else {
        combatNames = encounterMonsters ?? [targetId]
      }

      // 进入对峙状态
      const allDb = [...monstersDb, ...npcDb]
      try {
        const combat = startCombat(session, combatNames, allDb)
        return {
          output: [
            `⚠️ 你对${targetId}拔出了武器！这将产生严重后果。`,
            combat.log.join('\n'),
          ].filter(Boolean).join('\n'),
        }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    // 位置检查 + 中文名解析：怪物战斗只能在对应区域
    const locationMonsters: Record<string, string[]> = {
      'twilight-woods': ['Wolf', 'Giant Spider', 'Goblin', 'Cockatrice', 'Hobgoblin', 'Spider Matriarch'],
      'greyspine-mines': ['Skeleton', 'Shadow', 'Ghoul', 'Mimic', 'Giant Spider', 'Shadow Weaver'],
      'shatterstone-wastes': ['Orc Warrior', 'Ghoul', 'Skeleton', 'Eclipsed Beast'],
      'dawnbreak-town': [],
    }
    // 中文名 → 英文名映射（用于玩家用中文指定目标）
    const zhToEn: Record<string, string> = {}
    for (const m of monstersDb) {
      if (m.nameZh) zhToEn[m.nameZh] = m.name
      // 也映射简称：野狼→Wolf, 蜘蛛→Giant Spider, 狼→Wolf
      const zh = m.nameZh || ''
      if (zh.includes('狼')) zhToEn['狼'] = m.name
      if (zh.includes('蜘蛛')) { zhToEn['蜘蛛'] = m.name; zhToEn['大蜘蛛'] = m.name }
      if (zh.includes('骷髅')) zhToEn['骷髅'] = m.name
      if (zh.includes('暗影') && m.name === 'Shadow') zhToEn['暗影'] = m.name
      if (zh.includes('食尸鬼')) zhToEn['食尸鬼'] = m.name
      if (zh.includes('兽人')) zhToEn['兽人'] = m.name
    }
    // Boss 简称
    zhToEn['蛛母'] = 'Spider Matriarch'
    zhToEn['暗影编织者'] = 'Shadow Weaver'
    zhToEn['蚀日兽'] = 'Eclipsed Beast'
    zhToEn['狼群'] = 'Wolf'  // 狼群 → 生成多只狼

    // 解析目标：先尝试中文映射，再尝试英文匹配
    let resolvedTarget = targetId
    if (zhToEn[targetId]) {
      resolvedTarget = zhToEn[targetId]
    } else {
      // 模糊匹配：遍历中文映射看是否包含
      for (const [zh, en] of Object.entries(zhToEn)) {
        if (targetId.includes(zh) || zh.includes(targetId)) {
          resolvedTarget = en; break
        }
      }
    }

    const allowedHere = locationMonsters[session.worldState.currentLocation] ?? []

    if (!session.combat?.active) {
      // 检查解析后的目标是否在当前区域允许
      const isAllowed = allowedHere.some(m => m.toLowerCase() === resolvedTarget.toLowerCase())

      if (!isAllowed) {
        // 兜底：如果玩家想打架但目标不明确，从当前区域随机生成遭遇
        if (allowedHere.length > 0 && (targetId === '' || targetId === '怪物' || targetId === '敌人')) {
          const randomMonster = allowedHere[Math.floor(Math.random() * allowedHere.length)]
          resolvedTarget = randomMonster
        } else if (allowedHere.length === 0) {
          return { output: `这里是安全区域，没有可战斗的敌人。`, isError: true }
        } else {
          return { output: `这里没有${targetId}。当前区域可能遇到：${allowedHere.map(m => {
            const template = monstersDb.find(t => t.name === m)
            return template?.nameZh || m
          }).join('、')}`, isError: true }
        }
      }
    }

    // 如果没有进行中的战斗，进入战斗状态（不执行第一击）
    if (!session.combat?.active) {
      // "狼群" 特殊处理：生成多只狼
      let monsterNames: string[] = encounterMonsters ?? [resolvedTarget]
      if (targetId.includes('群') || targetId.includes('们')) {
        monsterNames = [resolvedTarget, resolvedTarget] // 2 只
      }
      try {
        const allDb = [...monstersDb, ...npcDb]
        const combat = startCombat(session, monsterNames, allDb)
        return {
          output: [
            '=== 战斗开始 ===',
            combat.log.join('\n'),
          ].filter(Boolean).join('\n'),
        }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    // 战斗已在进行中

    // Buff 法术：施放增益后，怪物照常行动（不消耗攻击行动）
    if (method === 'spell' && spellId && isBuffSpell(spellId)) {
      try {
        const buffResult = castBuffSpell(session, spellId)
        if (!buffResult.success) {
          return { output: buffResult.log.join('\n'), isError: true }
        }
        const roundLog = [...buffResult.log]

        // 敌方回合
        const monsterPhase = executeMonsterPhase(session)
        if (monsterPhase.log.length > 0) {
          const isNpcFight = session.combat?.monsters.some(m => session.npcs.some(n => n.name === m.name))
          roundLog.push('', isNpcFight ? '[敌方回合]' : '[怪物回合]', ...monsterPhase.log)
        }
        if (!monsterPhase.ended && session.combat?.active) {
          roundLog.push('', getCombatSummary(session) ?? '')
        }

        return { output: roundLog.filter(Boolean).join('\n') }
      } catch (e: any) {
        return { output: e.message, isError: true }
      }
    }

    // 攻击性法术或武器攻击
    try {
      const round = executePlayerTurn(session, targetId, method, spellId)

      return {
        output: [
          ...round.roundLog,
        ].filter(Boolean).join('\n'),
        firstInnocentKill: round.firstInnocentKill,
      }
    } catch (e: any) {
      return { output: e.message, isError: true }
    }
  },
}
