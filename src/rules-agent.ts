/**
 * 规则预处理器 — 分级意图识别 + 动作执行
 *
 * 两级分类：
 * 1. 快速匹配：代码正则，覆盖常见简单操作（零延迟）
 * 2. 智能分类：Rules Agent LLM，处理复杂/模糊意图（~500ms）
 *
 * 分类后由代码执行对应工具，结果注入 DM 上下文。
 */

import type { GameSession } from './types.js'
import { Agent } from 'open-claude-cli/engine'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { MAX_LOCATION_NAME_LENGTH } from './data/maps.js'

// ─── 动作类型 ──────────────────────────────

export type PlayerAction =
  | { type: 'ATTACK'; target: string; method?: 'weapon' | 'spell' | 'sneak'; spellId?: string }
  | { type: 'TALK'; npc: string; approach?: 'normal' | 'persuade' | 'deceive' | 'intimidate'; message: string }
  | { type: 'GIVE'; item: string; target: string }
  | { type: 'BUY'; item: string; npc: string }
  | { type: 'SELL'; item: string; npc: string }
  | { type: 'MOVE'; destination: string }
  | { type: 'SEARCH'; target?: string }
  | { type: 'USE'; item: string; target?: string }
  | { type: 'REST'; restType: 'short' | 'long' }
  | { type: 'LOOK'; target?: string }
  | { type: 'FLEE' }
  | { type: 'NARRATIVE' }

export interface ActionResult {
  action: PlayerAction
  success: boolean
  output: string
  toolsCalled: string[]
  firstInnocentKill?: boolean  // 首次击败无辜NPC标记
  unknownDestination?: boolean // Move 目的地不在地图注册表中（降级为叙事）
  notFound?: boolean           // Look 目标不在注册表中（降级为叙事）
  discoveredPoi?: { id: string; nameZh: string; description: string } // Search 发现的新 POI
  /** Search 工具系统发放的物品/金币（用于前端发现弹窗，与 discoveredPoi 可同时存在） */
  lootGranted?: { items: Array<{ name: string; description?: string }>; gold: number }
}

// ─── 第一级：快速正则匹配 ────────────────────

const QUICK_PATTERNS: Array<{ pattern: RegExp; build: (m: RegExpMatchArray, input: string) => PlayerAction | null }> = [
  // 战斗意图（无具体目标 → ATTACK target=''，由 engine 解析为 POI 遭遇）
  { pattern: /^(?:突袭|偷袭|袭击|发动攻击|先下手|冲上去|发动突袭|进攻|开打)/,
    build: () => ({ type: 'ATTACK', target: '', method: 'weapon' as const }) },

  // 移动（含标点或超过最长地名长度 → 可能有附加意图，交给 LLM）
  { pattern: /^(?:去|前往|走到|移动到|回到)\s*(.+)/,
    build: (m) => {
      const dest = m[1].trim()
      if (/[，。、！？；：…]/.test(dest) || dest.length > MAX_LOCATION_NAME_LENGTH) return null
      return { type: 'MOVE', destination: dest }
    } },
  { pattern: /^(?:我(?:要)?去)\s*(.+)/,
    build: (m) => {
      const dest = m[1].trim()
      if (/[，。、！？；：…]/.test(dest) || dest.length > MAX_LOCATION_NAME_LENGTH) return null
      return { type: 'MOVE', destination: dest }
    } },

  // 泛化观察（四处看看/看看周围）→ 交给 DM 叙事，不走 Look 工具
  { pattern: /^(?:四处看看|看看(?:四周|周围|环境)|观察(?:四周|周围|环境))$/,
    build: () => ({ type: 'NARRATIVE' }) },
  // 具体目标观察（看看叶绿/观察柜台）→ Look 工具
  { pattern: /^(?:看看|观察|查看)\s*(.+)/,
    build: (m) => ({ type: 'LOOK', target: m[1].trim() }) },
  { pattern: /^(?:打量|仔细看)\s*(.+)/,
    build: (m) => ({ type: 'LOOK', target: m[1].trim() }) },

  // 对话（简单形式）
  { pattern: /^(?:和|跟|找)\s*(.{2,6})\s*(?:说话|聊聊|交谈|对话)$/,
    build: (m) => ({ type: 'TALK', npc: m[1].trim(), message: '', approach: 'normal' }) },

  // 休息
  { pattern: /^(?:休息|短休|长休|睡觉|歇息)/,
    build: (m, input) => ({ type: 'REST', restType: /长休|睡觉/.test(input) ? 'long' : 'short' }) },

  // 搜索
  { pattern: /^(?:搜索|搜查|检查|调查)\s*(.*)/,
    build: (m) => ({ type: 'SEARCH', target: m[1].trim() || undefined }) },

  // 逃跑
  { pattern: /^(?:逃跑|跑|撤退|逃)/,
    build: () => ({ type: 'FLEE' }) },
]

/**
 * 第一级匹配：能用正则解决的不调 LLM
 */
export function quickMatch(input: string): PlayerAction | null {
  const trimmed = input.trim()
  for (const { pattern, build } of QUICK_PATTERNS) {
    const m = trimmed.match(pattern)
    if (m) return build(m, trimmed)
  }
  return null
}

// ─── 第二级：Rules Agent LLM 分类 ────────────────

const RULES_AGENT_PROMPT = `你是TRPG规则解析器。分析玩家输入，输出JSON动作分类。

规则：
1. 只输出一个JSON对象，不要任何其他文字
2. 根据玩家意图选择最匹配的type
3. 不确定时用 {"type":"NARRATIVE"}
4. 如果有"当前对话:NPC名"，玩家的TALK/BUY/SELL默认指向该NPC（除非明确提到了其他NPC）

动作类型和字段：
{"type":"ATTACK","target":"NPC/怪物名","method":"weapon|spell|sneak"}
{"type":"TALK","npc":"NPC名","approach":"normal|persuade|deceive|intimidate","message":"对话内容"}
{"type":"GIVE","item":"物品名","target":"NPC名"}
{"type":"BUY","item":"物品名","npc":"商人名"}
{"type":"SELL","item":"物品名","npc":"商人名"}
{"type":"MOVE","destination":"目的地"}
{"type":"SEARCH","target":"搜索目标"}
{"type":"USE","item":"物品名","target":"使用目标"}
{"type":"REST","restType":"short|long"}
{"type":"LOOK","target":"观察目标"}
{"type":"FLEE"}
{"type":"NARRATIVE"}

TALK approach 严格区分（常见错分：单纯的自我陈述≠persuade）：
- normal: 日常对话、问候、自我介绍、真诚陈述、合理请求、提问
    例："我是来找工作的冒险者"、"我的实力不错"、"这里最近怎么样？"
- persuade: 试图让 NPC 做她本不想做的事（请求特权、讨要折扣、请求破例）
    例："请给我打个折"、"让我破例带队"
- deceive: 编造谎言、伪造身份、隐瞒事实
    例："我是公会长老派来的"
- intimidate: 威胁、恐吓、施加心理压力
    例："不给我任务你会后悔"
核心：persuade 的本质是"请求特权或改变决定"，不是"表达自己"。`

function loadConfig() {
  if (process.env.TRPG_API_KEY) {
    return {
      apiKey: process.env.TRPG_API_KEY,
      baseUrl: process.env.TRPG_BASE_URL ?? 'https://your-llm-endpoint/v1',
      model: process.env.TRPG_MODEL ?? 'moonshotai/Kimi-K2.5',
      type: process.env.TRPG_PROVIDER_TYPE ?? 'openai',
      headers: process.env.TRPG_HEADERS ? JSON.parse(process.env.TRPG_HEADERS) : undefined,
      streamUsage: process.env.TRPG_STREAM_USAGE === 'false' ? false : undefined,
    }
  }
  const configPath = join(homedir(), '.occ', 'config.json')
  if (existsSync(configPath)) return JSON.parse(readFileSync(configPath, 'utf-8'))
  return null
}

/**
 * 第二级分类：用 LLM 理解复杂意图
 */
async function llmClassify(input: string, session: GameSession): Promise<PlayerAction> {
  const config = loadConfig()
  if (!config) return { type: 'NARRATIVE' }

  // 构建紧凑的游戏上下文
  const npcsHere = session.npcs
    .filter(n => n.location === session.worldState.currentLocation)
    .map(n => n.name)
  const inventory = session.player.inventory.map(i => i.name)

  const context = [
    `位置:${session.worldState.currentLocation}`,
    `附近NPC:${npcsHere.join(',') || '无'}`,
    session.interactionNpc ? `当前对话:${session.interactionNpc}` : '',
    `背包:${inventory.join(',') || '空'}`,
    session.combat?.active ? '状态:战斗中' : '',
  ].filter(Boolean).join(' | ')

  const prompt = `${context}\n\n玩家输入：${input}`
  console.log(`[rules-agent] LLM 分类请求: ${prompt.slice(0, 100)}...`)

  try {
    const agent = new Agent({
      provider: {
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        type: config.type ?? 'openai',
        headers: config.headers,
        streamUsage: config.streamUsage,
      },
      tools: [],
      systemPrompt: RULES_AGENT_PROMPT,
      maxTurns: 1,
      apiThrottleMs: 0,
    })

    let text = ''
    for await (const event of agent.run(prompt)) {
      if (event.type === 'text_delta') text += event.text ?? ''
    }

    console.log(`[rules-agent] LLM 原始返回: "${text.slice(0, 200)}"`)
    const parsed = parseClassification(text)
    console.log(`[rules-agent] 解析结果: ${JSON.stringify(parsed)}`)
    return parsed
  } catch (err) {
    console.error(`[rules-agent] LLM 分类失败:`, (err as Error).message)
    return { type: 'NARRATIVE' }
  }
}

/**
 * 解析 LLM 返回的 JSON 分类
 */
function parseClassification(raw: string): PlayerAction {
  try {
    // 去掉 markdown code fences
    let json = raw.trim()
    if (json.startsWith('```')) {
      json = json.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()
    }
    const parsed = JSON.parse(json)
    if (!parsed.type) return { type: 'NARRATIVE' }

    const validTypes = ['ATTACK', 'TALK', 'GIVE', 'BUY', 'SELL', 'MOVE', 'SEARCH', 'USE', 'REST', 'LOOK', 'FLEE', 'NARRATIVE']
    if (!validTypes.includes(parsed.type)) return { type: 'NARRATIVE' }

    return parsed as PlayerAction
  } catch {
    return { type: 'NARRATIVE' }
  }
}

// ─── 公开 API ──────────────────────────────

/**
 * 分级意图识别：先尝试正则，不行再用 LLM
 */
export async function classifyIntent(input: string, session: GameSession): Promise<PlayerAction> {
  // 第一级：快速正则
  const quick = quickMatch(input)
  if (quick) return quick

  // 战斗中的简单指令
  if (session.combat?.active) {
    if (/攻击|打|砍|刺/.test(input)) {
      const target = session.combat.monsters.find(m => m.hp > 0)?.id
      if (target) return { type: 'ATTACK', target, method: 'weapon' }
    }
  }

  // 第二级：LLM 分类（只有复杂意图才触发）
  return llmClassify(input, session)
}

/**
 * 格式化动作结果，注入 DM 上下文
 */
export function formatActionResult(result: ActionResult): string {
  const descMap: Record<string, (a: any) => string> = {
    ATTACK: (a) => `攻击${a.target}`,
    MOVE: (a) => `移动至${a.destination}`,
    SEARCH: (a) => `搜索${a.target ?? '区域'}`,
    USE: (a) => `使用${a.item}`,
    REST: (a) => `${a.restType === 'short' ? '短' : '长'}休息`,
    LOOK: (a) => `观察${a.target ?? '周围'}`,
    GIVE: (a) => `将${a.item}交给${a.target}`,
    BUY: (a) => `购买${a.item}`,
    SELL: (a) => `出售${a.item}`,
    FLEE: () => '尝试逃跑',
  }

  const desc = descMap[result.action.type]?.(result.action) ?? result.action.type
  return [
    `[规则系统执行结果]`,
    `玩家意图：${desc}`,
    `执行${result.success ? '成功' : '失败'}：`,
    result.output,
    '',
    '请基于以上结果进行叙事描写。不要修改任何数值，不要重复调用已执行的工具。',
  ].join('\n')
}

/**
 * 判断动作是否需要预执行（机械性动作）
 * 只有 NARRATIVE 不预执行——其他全走代码
 * TALK 也预执行：位置检查 + NPC 上下文获取 + 章节触发
 */
export function shouldPreExecute(action: PlayerAction): boolean {
  // BUY/SELL 不预执行：交给 DM 通过 ProposeTradeAction 弹出交易卡片，让玩家确认
  // TALK/NARRATIVE 不预执行：交给 DM 处理对话
  return action.type !== 'NARRATIVE'
    && action.type !== 'BUY'
    && action.type !== 'SELL'
}
