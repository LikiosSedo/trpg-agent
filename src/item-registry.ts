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
    return this.items.get(name)
  }

  has(name: string): boolean {
    return this.items.has(name)
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
