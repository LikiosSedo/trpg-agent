/**
 * 战斗叙事模板 — 每次交手随机选一句画面感描写
 */

type NarrativeOutcome = 'player_hit' | 'player_miss' | 'player_critical' | 'player_kill'
  | 'player_kill_npc'
  | 'monster_hit' | 'monster_miss' | 'monster_critical'
  | 'npc_hit' | 'npc_miss' | 'npc_critical'

const TEMPLATES: Record<NarrativeOutcome, string[]> = {
  player_hit: [
    '你抓住空隙一击命中，{target}踉跄后退。',
    '{weapon}划过{target}，留下一道伤口。',
    '你的攻击精准落下，{target}发出痛苦的嚎叫。',
    '一击命中，{target}被力量震得后退半步。',
  ],
  player_miss: [
    '{target}灵巧地闪过了你的攻击。',
    '你的{weapon}扑了个空，时机差了一瞬。',
    '{target}挡开了这一击。',
  ],
  player_critical: [
    '完美时机！{weapon}直击{target}的要害！',
    '暴击！{target}被猛烈的攻势打得踉跄后退。',
    '致命一击！{target}的身体剧烈一震。',
  ],
  player_kill: [
    '最后一击落下，{target}轰然倒地。',
    '{target}发出最后的嚎叫，缓缓倒下。',
    '尘埃落定——{target}不再动弹了。',
  ],
  player_kill_npc: [
    '{target}双膝跪地，缓缓倒下，失去了意识。',
    '最后一击命中，{target}瘫倒在地，昏了过去。',
    '{target}的眼神逐渐涣散，身体软软地滑倒在地。',
  ],
  // 怪物攻击玩家
  monster_hit: [
    '{monster}的攻击命中了你，你咬牙站稳。',
    '你没能完全格开这一击，痛感传来。',
    '{monster}趁你破绽，一击得手。',
  ],
  monster_miss: [
    '你侧步闪开了{monster}的攻击。',
    '{monster}的攻击擦肩而过。',
    '你举起武器格挡，化解了攻击。',
  ],
  monster_critical: [
    '{monster}以惊人的速度命中了你的要害！',
    '暴击！{monster}的猛攻突破了你的防御！',
  ],
  // NPC 攻击玩家（语气不同于怪物——NPC 是人）
  npc_hit: [
    '{monster}的攻击命中了你，眼中满是愤怒。',
    '你没能挡住{monster}凌厉的一击。',
    '{monster}趁你不备，一击得手。',
  ],
  npc_miss: [
    '你闪开了{monster}的攻击。',
    '{monster}的攻击被你挡住了。',
    '你堪堪避开了{monster}怒气冲冲的一击。',
  ],
  npc_critical: [
    '{monster}暴怒之下命中了你的要害！',
    '暴击！{monster}的攻击带着绝对的杀意！',
  ],
}

// 避免短期内重复：记录最近用过的模板索引
const recentPicks: Map<NarrativeOutcome, number[]> = new Map()

export function pickNarrative(
  outcome: NarrativeOutcome,
  vars: { target?: string; weapon?: string; monster?: string },
): string {
  const pool = TEMPLATES[outcome]
  if (!pool?.length) return ''

  // 从未用过的里选，如果都用过了就重置
  let recent = recentPicks.get(outcome) ?? []
  if (recent.length >= pool.length - 1) recent = []

  const available = pool.map((_, i) => i).filter(i => !recent.includes(i))
  const idx = available[Math.floor(Math.random() * available.length)]
  recent.push(idx)
  recentPicks.set(outcome, recent)

  let text = pool[idx]
  if (vars.target) text = text.replace(/\{target\}/g, vars.target)
  if (vars.weapon) text = text.replace(/\{weapon\}/g, vars.weapon)
  if (vars.monster) text = text.replace(/\{monster\}/g, vars.monster)
  return text
}
