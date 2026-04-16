/**
 * NPC 闲置微事件 — 让世界有呼吸感
 *
 * 当玩家在某个子地点时，同场景的 NPC 偶尔会有"生活片段"描写。
 * 这些是预写模板，按 NPC + 时段组合，零 LLM 成本。
 *
 * 注入方式：每轮 5% 概率，最多 1 条，追加到 [游戏状态] 末尾。
 * DM 可以选择性融入叙事（"远处传来锤打声"），也可以忽略。
 */

import type { GameSession } from './types.js'

// ─── 微事件模板 ──────────────────────────────

interface IdleSnippet {
  npc: string
  time?: 'morning' | 'evening' | 'night'  // 不填 = 全时段
  text: string
}

const IDLE_SNIPPETS: IdleSnippet[] = [
  // 格雷格
  { npc: '格雷格', text: '格雷格在柜台后擦着杯子，偶尔抬眼扫一下门口。' },
  { npc: '格雷格', time: 'night', text: '格雷格往壁炉里添了一块柴，火光在他的旧疤上跳动。' },
  { npc: '格雷格', time: 'morning', text: '格雷格单手把桌椅排整齐，动作利落得不像他的体型。' },
  // 小莉
  { npc: '小莉', text: '小莉抱着一摞碗从厨房跑过，差点撞到门框。' },
  { npc: '小莉', time: 'night', text: '小莉趴在柜台上打盹，手里还攥着抹布。' },
  { npc: '小莉', text: '小莉突然停下脚步，歪着头像在听什么，然后摇摇头继续干活。' },
  // 格罗姆
  { npc: '格罗姆', text: '远处传来格罗姆锤打铁砧的节奏声，铿锵有力。' },
  { npc: '格罗姆', time: 'morning', text: '格罗姆正在磨石上打磨一把短刀，金属摩擦声尖锐而稳定。' },
  { npc: '格罗姆', text: '格罗姆把一件刚出炉的铁器放进水桶，蒸汽嘶嘶升起。' },
  // 叶绿
  { npc: '叶绿', text: '叶绿在门口晾药草，空气中弥漫着薄荷和艾蒿的味道。' },
  { npc: '叶绿', time: 'morning', text: '叶绿蹲在花圃前修剪枝叶，嘴里低声念着植物的名字。' },
  { npc: '叶绿', text: '叶绿将几瓶药水排在架子上，琥珀色的液体在晨光中微微发亮。' },
  // 艾琳娜
  { npc: '艾琳娜', text: '艾琳娜坐在公会大厅深处翻阅文件，食指有节奏地敲着桌面。' },
  { npc: '艾琳娜', text: '艾琳娜站在公告板前，用羽毛笔划掉了一条旧委托。' },
  { npc: '艾琳娜', time: 'evening', text: '艾琳娜站在窗边望向矿道方向，银白侧辫在余晖中微微发亮。' },
  // 陈妈
  { npc: '陈妈', text: '陈妈在旅店前台整理账本，算盘珠子噼啪作响。' },
  { npc: '陈妈', time: 'morning', text: '陈妈端着一锅热粥穿过大堂，香气飘散开来。' },
  { npc: '陈妈', text: '陈妈拿着鸡毛掸子一边打扫一边嘟囔着什么。' },
  // 韩猛
  { npc: '韩猛', text: '韩猛独自坐在角落，用独臂慢慢擦拭着他的佩剑。' },
  { npc: '韩猛', text: '韩猛靠在墙上闭目养神，但他的手始终没离开剑柄。' },
  { npc: '韩猛', time: 'morning', text: '韩猛在公会院子里单臂做引体向上，额头上青筋暴起。' },
  // 卡恩
  { npc: '卡恩', text: '卡恩坐在广场石碑旁，手指在黑木琴弦上漫不经心地拨弄。' },
  { npc: '卡恩', time: 'night', text: '卡恩的琴声从广场那边飘来，旋律低回，带着异域风情。' },
  { npc: '卡恩', text: '卡恩翻着一本旧笔记，目光在某一页上停了很久。' },
  // 维克多
  { npc: '维克多', text: '维克多匆匆穿过走廊，衣领扣子又系错了一颗。' },
  { npc: '维克多', time: 'night', text: '镇长府的窗户透出昏暗的灯光，维克多的影子在窗帘后来回踱步。' },
  { npc: '维克多', text: '维克多站在书架前发呆，手指不自觉地摩挲右手中指。' },
]

// ─── 冷却控制 ──────────────────────────────

const IDLE_EVENT_CHANCE = 0.06  // 6% 概率
const IDLE_COOLDOWN_TURNS = 5   // 同一 NPC 的闲置事件冷却

/** 获取本轮的闲置微事件（最多 1 条），返回空字符串表示没有 */
export function getIdleEvent(session: GameSession): string {
  if (Math.random() > IDLE_EVENT_CHANCE) return ''

  const playerLoc = session.worldState.currentLocation
  const time = session.worldState.timeOfDay

  // 找同场景、状态正常、不是当前交互对象的 NPC
  const candidates = session.npcs.filter(n =>
    n.location === playerLoc
    && n.condition === 'normal'
    && n.name !== session.interactionNpc
  )
  if (candidates.length === 0) return ''

  // 冷却检查 + 筛选可用片段
  const available: IdleSnippet[] = []
  for (const npc of candidates) {
    const cooldownKey = `idle_event_${npc.name}`
    const lastTurn = Number(session.worldState.flags[cooldownKey] ?? 0)
    if (session.turnCount - lastTurn < IDLE_COOLDOWN_TURNS) continue

    const snippets = IDLE_SNIPPETS.filter(s =>
      s.npc === npc.name && (!s.time || s.time === time)
    )
    available.push(...snippets)
  }
  if (available.length === 0) return ''

  // 随机选一条
  const picked = available[Math.floor(Math.random() * available.length)]
  session.worldState.flags[`idle_event_${picked.npc}`] = session.turnCount
  return `[氛围] ${picked.text}`
}
