/**
 * 章节管理器 — 状态机
 *
 * 追踪当前章节、已完成的 beat/discovery、防卡提示。
 * 章节内时间冻结，关键 beat 全部完成后推进到下一章。
 */

import type { GameSession, ChapterState } from './types.js'
import { getChapter, getFirstChapterId, type ChapterDef, type Beat } from './story-script.js'

// ─── 初始化 ──────────────────────────────────

export function createChapterState(): ChapterState {
  return {
    currentChapter: getFirstChapterId(),
    completedBeats: [],
    discoveries: [],
    idleTurns: 0,
    nudgeIndex: 0,
  }
}

// ─── 章节管理器 ──────────────────────────────────

export class ChapterManager {
  constructor(private session: GameSession) {}

  private get state(): ChapterState {
    if (!this.session.chapter) {
      this.session.chapter = createChapterState()
    }
    return this.session.chapter
  }

  private get chapter(): ChapterDef | undefined {
    return getChapter(this.state.currentChapter)
  }

  // ─── 事件处理 ────────────────────────────

  /**
   * 当玩家执行操作时调用。检查是否触发 beat 或 discovery。
   * @param type 事件类型：'talk' | 'arrive' | 'search' | 'quest' | 'combat_end'
   * @param target 事件目标：NPC名 / 地点id / 任务名
   * @returns 触发的 beat（含 facts），或 null
   */
  onEvent(type: string, target?: string): Beat | null {
    const ch = this.chapter
    if (!ch) return null

    const trigger = target ? `${type}:${target}` : type

    // 检查 beat 触发
    const beat = this.findPendingBeat(ch, trigger)
    if (beat) {
      this.state.completedBeats.push(beat.id)
      this.state.idleTurns = 0
      this.state.nudgeIndex = 0

      // beat 完成后重新评估 auto beat（新的前置条件可能已满足）
      this.processAutoBeats()

      // 检查章节推进
      if (this.shouldAdvance(ch)) {
        this.advance(ch)
      }

      return beat
    }

    // 检查 discovery 触发
    this.checkDiscovery(ch, trigger)

    return null
  }

  /**
   * 处理 auto 类型的 beat（章节开始时 + 每次 beat 完成后自动触发）
   * auto beat 的 facts 暂存到 pendingFacts，下轮由 getPromptContext() 注入 DM prompt
   */
  processAutoBeats(): Beat[] {
    const ch = this.chapter
    if (!ch) return []

    if (!this.state.pendingFacts) this.state.pendingFacts = []

    const results: Beat[] = []
    for (const beat of ch.beats) {
      if (beat.trigger !== 'auto') continue
      if (this.state.completedBeats.includes(beat.id)) continue
      if (beat.requires && !beat.requires.every(r => this.state.completedBeats.includes(r))) continue

      this.state.completedBeats.push(beat.id)
      // 将 auto beat 的 facts 暂存，等待 getPromptContext() 传递给 DM
      this.state.pendingFacts.push(...beat.facts)
      results.push(beat)
    }
    return results
  }

  // ─── DM Prompt 注入 ────────────────────────

  /**
   * 生成当前章节的上下文，注入 DM prompt。
   * 包含：章节背景 + 待传达的 beat facts + 防卡提示
   */
  getPromptContext(): string {
    const ch = this.chapter
    if (!ch) return ''

    const parts: string[] = [
      `=== ${ch.title} ===`,
      ch.worldContext,
    ]

    // 交付 auto beat 暂存的 facts（触发后首轮必须传达）
    if (this.state.pendingFacts && this.state.pendingFacts.length > 0) {
      parts.push('')
      parts.push('【必须立即传达】以下事件已发生，本轮必须自然融入叙事：')
      for (const fact of this.state.pendingFacts) {
        parts.push(`  - ${fact}`)
      }
      this.state.pendingFacts = []
    }

    // 找到下一个待触发的必需 beat，告诉 DM 该传达什么
    const pendingBeats = this.getPendingBeats(ch)
    if (pendingBeats.length > 0) {
      parts.push('')
      parts.push('【当前待传达要点】以下是本阶段需要传达给玩家的信息，在合适的时机自然地融入叙事：')
      for (const beat of pendingBeats) {
        const triggerDesc = this.describeTrigger(beat.trigger)
        parts.push(`[${triggerDesc}]`)
        for (const fact of beat.facts) {
          parts.push(`  - ${fact}`)
        }
      }
    }

    // 防卡提示
    const nudge = this.getNudge(ch)
    if (nudge) {
      parts.push('')
      parts.push(`【引导提示】玩家似乎在原地徘徊，请自然地融入以下引导：`)
      parts.push(nudge)
    }

    // 探索度摘要
    const exploration = this.getExploration()
    const exploredLocations = Object.entries(exploration)
      .filter(([, v]) => v.total > 0)
      .map(([loc, v]) => `${loc}: ${v.found}/${v.total}`)
    if (exploredLocations.length > 0) {
      parts.push('')
      parts.push(`探索进度：${exploredLocations.join(' | ')}`)
    }

    return parts.join('\n')
  }

  // ─── 每轮推进 ────────────────────────────

  /**
   * 每轮结束时调用，递增空闲计数。
   */
  advanceTurn(): void {
    this.state.idleTurns++
  }

  // ─── 探索度 ────────────────────────────

  /**
   * 获取各地点探索度（当前章节）
   */
  getExploration(): Record<string, { found: number; total: number }> {
    const ch = this.chapter
    if (!ch) return {}

    const locationNames: Record<string, string> = {
      'dawnbreak-town': '破晓镇',
      'twilight-woods': '暮色森林',
      'greyspine-mines': '灰脊矿道',
      'shatterstone-wastes': '碎石荒原',
    }

    const result: Record<string, { found: number; total: number }> = {}

    for (const disc of ch.discoveries) {
      const locName = locationNames[disc.location] ?? disc.location
      if (!result[locName]) result[locName] = { found: 0, total: 0 }
      result[locName].total++
      if (this.state.discoveries.includes(disc.id)) {
        result[locName].found++
      }
    }

    return result
  }

  /**
   * 获取已发现内容的标签列表（用于 recap 面板）
   */
  getDiscoveryLabels(): string[] {
    const ch = this.chapter
    if (!ch) return []
    return ch.discoveries
      .filter(d => this.state.discoveries.includes(d.id))
      .map(d => d.label)
  }

  // ─── 章节信息 ────────────────────────────

  getChapterTitle(): string {
    return this.chapter?.title ?? '未知章节'
  }

  getChapterId(): string {
    return this.state.currentChapter
  }

  isActive(): boolean {
    return !!this.chapter
  }

  // ─── 内部方法 ────────────────────────────

  private findPendingBeat(ch: ChapterDef, trigger: string): Beat | null {
    for (const beat of ch.beats) {
      if (this.state.completedBeats.includes(beat.id)) continue
      if (beat.trigger !== trigger) continue
      if (beat.requires && !beat.requires.every(r => this.state.completedBeats.includes(r))) continue
      return beat
    }
    return null
  }

  private getPendingBeats(ch: ChapterDef): Beat[] {
    return ch.beats.filter(beat => {
      if (this.state.completedBeats.includes(beat.id)) return false
      if (beat.trigger === 'auto') return false
      // 只显示前置条件已满足的 beat
      if (beat.requires && !beat.requires.every(r => this.state.completedBeats.includes(r))) return false
      return true
    })
  }

  private checkDiscovery(ch: ChapterDef, trigger: string): void {
    for (const disc of ch.discoveries) {
      if (this.state.discoveries.includes(disc.id)) continue

      // 匹配触发条件：精确匹配 or trigger 前缀匹配（search 不需要 target）
      const matches = disc.trigger === trigger
        || (disc.trigger === 'search' && trigger.startsWith('search'))
        || (disc.trigger === trigger.split(':')[0] && !disc.trigger.includes(':'))

      if (!matches) continue

      // 检查前置条件
      if (disc.requires) {
        const allMet = disc.requires.every(r =>
          this.state.completedBeats.includes(r) || this.state.discoveries.includes(r))
        if (!allMet) continue
      }

      // 位置检查
      if (disc.location !== this.session.worldState.currentLocation) continue

      this.state.discoveries.push(disc.id)
    }
  }

  private shouldAdvance(ch: ChapterDef): boolean {
    return ch.advanceWhen.every(id => this.state.completedBeats.includes(id))
  }

  private advance(ch: ChapterDef): void {
    // 应用世界变化
    if (ch.onAdvance) {
      if (ch.onAdvance.timeOfDay) {
        this.session.worldState.timeOfDay = ch.onAdvance.timeOfDay
      }
      if (ch.onAdvance.flags) {
        Object.assign(this.session.worldState.flags, ch.onAdvance.flags)
      }
    }

    // 推进到下一章
    if (ch.nextChapter) {
      this.state.currentChapter = ch.nextChapter
      this.state.idleTurns = 0
      this.state.nudgeIndex = 0
      // 不清空 completedBeats 和 discoveries — 它们是全局累积的

      // 处理新章节的 auto beats
      this.processAutoBeats()
    }
  }

  private getNudge(ch: ChapterDef): string | null {
    if (this.state.idleTurns < ch.nudge.afterIdleTurns) return null
    if (ch.nudge.hints.length === 0) return null

    // 循环使用 hints，不会用完
    const idx = this.state.nudgeIndex % ch.nudge.hints.length
    // nudgeIndex 在 getPromptContext 被读取后才递增（下次轮次）
    if (this.state.idleTurns === ch.nudge.afterIdleTurns + this.state.nudgeIndex) {
      this.state.nudgeIndex++
    }
    return ch.nudge.hints[idx]
  }

  private describeTrigger(trigger: string): string {
    if (trigger === 'auto') return '自动'
    const [type, target] = trigger.split(':')
    switch (type) {
      case 'talk': return `当玩家与${target}交谈时`
      case 'arrive': return `当玩家到达${target}时`
      case 'search': return '当玩家搜索时'
      case 'quest': return `当"${target}"任务完成时`
      case 'combat_end': return '当战斗结束时'
      default: return trigger
    }
  }
}
