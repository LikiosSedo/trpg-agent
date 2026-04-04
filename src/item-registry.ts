import type { ItemType } from './types.js'

export interface RegisteredItem {
  name: string
  type: ItemType
  description: string
  bonus?: number
  basePrice: number
  sourceHint?: string // 'blacksmith' | 'herbalist' | 'loot' | 'quest' etc
}

export class ItemRegistry {
  private items = new Map<string, RegisteredItem>()

  // 中英文名映射（玩家可能用中文搜索）
  private aliases = new Map<string, string>()

  private registerAliases(name: string): void {
    // 英文别名 → 中文主键（支持玩家用英文输入时仍能找到物品）
    const ALIASES: Record<string, string[]> = {
      '短剑': ['Shortsword', '短刀'],
      '短剑 +1': ['Shortsword +1'],
      '长剑': ['Longsword', '大剑'],
      '短弓': ['Shortbow', '弓'],
      '皮甲': ['Leather Armor', '皮革甲'],
      '锁子甲': ['Chain Shirt', '链甲', '锁甲'],
      '治疗药水': ['Healing Potion', '血瓶', '红药水'],
      '解毒剂': ['Antidote', '解毒药'],
      '暗影防护药水': ['Shadow Ward Potion', '防护药水'],
      '麻绳': ['Hempen Rope', '绳子'],
      '火把': ['Torch', '火炬'],
      '矿道钥匙': ['Mine Key'],
      '达里安的日志': ["Darian's Journal"],
    }
    const aliasList = ALIASES[name]
    if (aliasList) {
      for (const alias of aliasList) this.aliases.set(alias, name)
    }
  }

  /** Seed from equipment.json + loot-items.json */
  load(equipmentData: any[], lootData: any[]): void {
    for (const e of equipmentData) {
      this.items.set(e.name, {
        name: e.name,
        type: e.type ?? 'misc',
        description: e.description ?? '',
        bonus: e.bonus,
        basePrice: e.basePrice ?? e.price ?? this.estimatePrice(e),
        sourceHint: e.sourceHint,
      })
      this.registerAliases(e.name)
    }
    for (const l of lootData) {
      const name = l.nameEn ?? l.name
      this.items.set(name, {
        name: l.name,
        type: l.type ?? 'misc',
        description: l.description ?? '',
        bonus: l.bonus,
        basePrice: l.basePrice ?? 1,
        sourceHint: 'loot',
      })
      // Also register by Chinese name if different
      if (l.name !== name) {
        this.items.set(l.name, this.items.get(name)!)
      }
    }
  }

  get(name: string): RegisteredItem | undefined {
    return this.items.get(name) ?? this.items.get(this.aliases.get(name) ?? '')
  }

  has(name: string): boolean {
    return this.items.has(name) || this.aliases.has(name)
  }

  register(item: RegisteredItem): void {
    this.items.set(item.name, item)
  }

  getByType(type: ItemType): RegisteredItem[] {
    return [...this.items.values()].filter(i => i.type === type)
  }

  private estimatePrice(item: any): number {
    const base = { weapon: 15, armor: 20, potion: 25, quest: 0, misc: 5 }
    return (base[item.type as keyof typeof base] ?? 5) + (item.bonus ?? 0) * 10
  }
}
