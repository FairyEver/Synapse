export type SynapseCategoryDefinition = {
  id: string
  label: string
  description: string
  order: number
  icon?: string
}

export type SynapseCategoryViewItem = SynapseCategoryDefinition & {
  count: number
  isAll?: boolean
  isFallback?: boolean
}

export type SynapseCategoryStatsResult = {
  items: SynapseCategoryViewItem[]
  totalCount: number
  unknownCategoryIds: string[]
}
