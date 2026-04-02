/**
 * 防卡事件系统 + 早期引导
 *
 * - 前2轮硬编码场景提示（引导到酒馆→公会）
 * - 空闲检测：连续2轮无明确行动时触发NPC事件
 */

import { getSession } from './game-state.js'

// ─── 早期引导：硬编码前2轮场景提示 ─────────────

const EARLY_GUIDANCE: Record<number, string> = {
  1: [
    '[DM场景指令：这是玩家的第一个行动回合]',
    '无论玩家说什么，请确保场景引导包含以下要素：',
    '- 雨还在下，天很冷，玩家浑身湿透',
    '- 破晓镇街道空荡，唯一亮着灯的是碎盾亭酒馆',
    '- 自然引导玩家进入酒馆',
    '- 格雷格在酒馆内主动搭话，给热汤，问玩家来历',
    '- 结束时让玩家有机会与格雷格互动',
  ].join('\n'),

  2: [
    '[DM场景指令：这是玩家的第二个行动回合]',
    '无论玩家说什么，请确保场景推进包含以下要素：',
    '- 格雷格在对话中自然提到：镇上最近不太平，矿洞出了怪事',
    '- 格雷格建议：明天去冒险者公会找会长艾琳娜，他们在招人',
    '- 小莉端着盘子路过，停下看玩家一眼，说一句奇怪的话（伏笔）',
    '- 格雷格提供免费住宿：楼上有间空房',
    '- 玩家获得明确的下一步方向：去公会找艾琳娜',
  ].join('\n'),
}

/**
 * 获取早期引导提示（前2轮）
 * 返回 null 表示当前轮次无需硬编码引导
 */
export function getEarlyGuidance(turnCount: number): string | null {
  return EARLY_GUIDANCE[turnCount] ?? null
}

// ─── 防卡事件系统 ─────────────────────────────

const IDLE_PATTERNS = [
  /^[嗯呃啊哦额唔哼]+$/,
  /^(不知道|不确定|不清楚|没什么|随便)$/,
  /^(看看|等等|想想|等一下|想一下)$/,
  /^.{0,4}$/,
]

function isIdleInput(input: string): boolean {
  const trimmed = input.trim()
  return IDLE_PATTERNS.some(p => p.test(trimmed))
}

const TAVERN_EVENTS = [
  '[防卡事件] 小莉从厨房探出头来："有人在门口徘徊了好一会儿了，要不要出去看看？"',
  '[防卡事件] 格雷格放下杯子："你打算在这里坐一晚上？明天去公会看看吧，那里有适合你的活。"',
  '[防卡事件] 酒馆门被推开，一个满身泥泞的矿工冲进来："又出事了！矿道上层传来怪声！"',
]

const LOCATION_EVENTS: Record<string, string[]> = {
  'dawnbreak-town': [
    '[防卡事件] 一个路过的矿工停下脚步看了看玩家："你是新来的冒险者吧？公会在东边，会长今天在。"',
    '[防卡事件] 广场上传来一声金属碰撞——铁匠格罗姆在门口捶打一把弯曲的镐头，朝玩家点了点头。',
    '[防卡事件] 一个小孩跑过来："你是公会的人吗？我妈妈说矿洞里有鬼！"然后被大人叫走了。',
  ],
  'twilight-woods': [
    '[防卡事件] 远处传来树枝折断的声音，似乎有什么东西在灌木丛中移动。',
    '[防卡事件] 玩家注意到地上有一串新鲜的爪印，比普通狼的要大得多，向林深处延伸。',
    '[防卡事件] 一只受伤的鹿从前方跑过，身上有不自然的焦痕。',
  ],
  'greyspine-mines': [
    '[防卡事件] 矿壁上的一道符文突然发出微弱的冷光，持续了几秒后熄灭。',
    '[防卡事件] 远处传来一声低沉的回响，像是什么东西在矿道深处倒塌。',
    '[防卡事件] 脚下的碎石微微震动，空气中弥漫着一股金属的腥味。',
  ],
}

let idleCount = 0
let eventIndex: Record<string, number> = {}

/**
 * 检测玩家输入是否为空闲状态，连续2轮空闲时返回NPC事件提示。
 * 返回 null 表示玩家正常行动，无需干预。
 */
export function checkIdleEvent(input: string): string | null {
  if (!isIdleInput(input)) {
    idleCount = 0
    return null
  }

  idleCount++
  if (idleCount < 2) return null

  // 触发防卡事件
  const session = getSession()
  const location = session.worldState.currentLocation

  const isTavernPhase = session.turnCount <= 4 && location === 'dawnbreak-town'
  const events = isTavernPhase
    ? TAVERN_EVENTS
    : (LOCATION_EVENTS[location] ?? LOCATION_EVENTS['dawnbreak-town'])
  const key = isTavernPhase ? 'tavern' : location

  if (!eventIndex[key]) eventIndex[key] = 0
  const idx = eventIndex[key] % events.length
  eventIndex[key]++

  idleCount = 0
  return events[idx]
}

/**
 * 重置防卡计数（加载存档时调用）
 */
export function resetIdleTracking(): void {
  idleCount = 0
  eventIndex = {}
}
