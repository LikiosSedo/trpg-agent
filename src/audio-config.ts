/**
 * 音频拓扑配置 — 自动 BGM + 环境音映射
 *
 * 两层设计：
 * 1. 代码驱动（确定性）：位置×时间×战斗状态 → BGM + 环境音
 * 2. DM 驱动（可选覆盖）：关键剧情节点 → 特殊 BGM
 *
 * 音频文件放在 public/audio/ 目录，MP3 格式，循环播放。
 */

// ─── 音频 ID 注册表 ──────────────────────────

/**
 * BGM 轨道（循环）
 *
 * 来源（attribution）：
 * - 小镇/酒馆/森林等基础轨：commit e8d5140 引入，OpenGameArt CC0
 *   作者：RandomMind / cynicmusic / CleytonRX / Joth
 * - 室内子地点轨（铁砧铺/银鳞商会/草药堂/破晓旅店）：本次新增
 *   - blacksmith.mp3 — Joth "Medieval: Harvest Season" (CC0)
 *   - guild.mp3      — RandomMind "Fame Town" (CC-BY，需署名)
 *   - apothecary.mp3 — Matthew Pablo "Woodland Fantasy" (CC-BY，需署名)
 *                       温暖小提琴+长笛+原声吉他民谣，替换原 Mystical Theme
 *   - inn.mp3        — cynicmusic "Small Sleepy Town (Major)" (CC-BY，需署名)
 */
export const BGM_TRACKS: Record<string, { file: string; label: string }> = {
  // 位置 BGM（区域级）
  'town-day':      { file: 'town-day.mp3',      label: '小镇白日' },
  'town-night':    { file: 'town-night.mp3',     label: '小镇夜晚' },
  'tavern':        { file: 'tavern.mp3',         label: '酒馆温暖' },
  'forest':        { file: 'forest.mp3',         label: '森林探索' },
  'mines':         { file: 'mines.mp3',          label: '矿道深沉' },
  'wasteland':     { file: 'wasteland.mp3',      label: '荒原苍凉' },
  // 室内子地点 BGM（破晓镇内部各家店铺）
  'blacksmith':    { file: 'blacksmith.mp3',     label: '铁砧铺' },
  'guild':         { file: 'guild.mp3',          label: '银鳞商会' },
  'apothecary':    { file: 'apothecary.mp3',     label: '草药堂' },
  'inn':           { file: 'inn.mp3',            label: '破晓旅店' },
  // 战斗 BGM
  'battle':        { file: 'battle.mp3',         label: '战斗' },
  'boss-battle':   { file: 'boss-battle.mp3',    label: 'BOSS战' },
  // 特殊剧情 BGM（DM 调用）
  'tension':       { file: 'tension.mp3',        label: '紧张悬疑' },
  'sad':           { file: 'sad.mp3',            label: '阵亡哀乐' },
  'sorrow':        { file: 'sorrow.mp3',         label: '沉痛悲怆' },
  'revelation':    { file: 'revelation.mp3',     label: '史诗揭示' },
  'reflection':    { file: 'reflection.mp3',     label: '往事回望' },
  'triumph':       { file: 'triumph.mp3',        label: '凯旋' },
  'mystery':       { file: 'mystery.mp3',        label: '神秘' },
  'danger':        { file: 'danger.mp3',         label: '危险逼近' },
  'peaceful':      { file: 'peaceful.mp3',       label: '宁静' },
}

/** 环境音轨道（循环，可叠加） */
export const AMBIENT_TRACKS: Record<string, { file: string; label: string }> = {
  'rain':          { file: 'amb-rain.mp3',       label: '雨声' },
  'thunder':       { file: 'amb-thunder.mp3',    label: '雷雨' },
  'fire':          { file: 'amb-fire.mp3',       label: '壁炉' },
  'wind':          { file: 'amb-wind.mp3',       label: '风声' },
  'birds':         { file: 'amb-birds.mp3',      label: '鸟鸣' },
  'crickets':      { file: 'amb-crickets.mp3',   label: '蟋蟀' },
  'drip':          { file: 'amb-drip.mp3',       label: '水滴' },
  'crowd':         { file: 'amb-crowd.mp3',      label: '人声嘈杂' },
  'silence':       { file: '',                   label: '寂静' },
}

// ─── 自动选择规则（代码驱动，不靠 LLM）──────────

export interface AudioState {
  bgm: string       // BGM track id
  ambient: string   // ambient track id
}

/** 根据游戏状态自动选择音频（纯确定性） */
export function resolveAudio(
  location: string,
  subLocation: string | undefined,
  timeOfDay: string,
  inCombat: boolean,
): AudioState {
  // 战斗优先
  if (inCombat) {
    return { bgm: 'battle', ambient: 'silence' }
  }

  // 子地点特殊覆盖（破晓镇室内场景，每家店铺独立 BGM）
  if (subLocation === 'shattered-shield-tavern') {
    return { bgm: 'tavern', ambient: 'fire' }
  }
  if (subLocation === 'sturdy-anvil') {
    return { bgm: 'blacksmith', ambient: 'fire' }  // 锻炉炉火
  }
  if (subLocation === 'silver-scale-guild') {
    return { bgm: 'guild', ambient: 'crowd' }  // 公会大厅人声
  }
  if (subLocation === 'greenleaf-apothecary') {
    return { bgm: 'apothecary', ambient: 'silence' }  // 草药堂保持安静
  }
  if (subLocation === 'dawns-rest-inn') {
    return { bgm: 'inn', ambient: 'fire' }  // 旅店壁炉
  }

  // 位置 × 时间
  const isNight = timeOfDay === 'night' || timeOfDay === 'evening'

  switch (location) {
    case 'dawnbreak-town':
      return {
        bgm: isNight ? 'town-night' : 'town-day',
        ambient: isNight ? 'crickets' : 'birds',
      }
    case 'twilight-woods':
      return { bgm: 'forest', ambient: isNight ? 'crickets' : 'birds' }
    case 'greyspine-mines':
      return { bgm: 'mines', ambient: 'drip' }
    case 'shatterstone-wastes':
      return { bgm: 'wasteland', ambient: 'wind' }
    default:
      return { bgm: 'town-day', ambient: 'silence' }
  }
}

// ─── DM 可用的特殊 BGM 列表（少而精）──────────

/** DM 只在这些高冲击场景调用 SetAmbiance */
export const DM_OVERRIDE_OPTIONS = [
  { id: 'boss-battle',  when: 'BOSS级怪物或关键NPC战斗' },
  { id: 'tension',      when: '揭示重大阴谋、教团真相、关键证据' },
  { id: 'sorrow',       when: 'NPC死亡、重大牺牲、沉痛叙事（弦乐+钢琴，5分钟）' },
  { id: 'revelation',   when: '重大真相揭示、命运转折、从沉寂到壮烈的史诗展开（管弦乐渐强，99秒）' },
  { id: 'reflection',   when: '章节回顾、往事回忆、凝望不可能的未来（RPG管弦乐，4分钟）' },
  { id: 'triumph',      when: '章节通关、重大胜利、获得关键道具' },
  { id: 'mystery',      when: '发现神秘遗迹、未知力量、虚空棱镜相关' },
  { id: 'danger',       when: '即将遭遇伏击、陷入绝境、教团包围' },
  { id: 'peaceful',     when: '温馨对话、信任突破、NPC打开心扉' },
]
