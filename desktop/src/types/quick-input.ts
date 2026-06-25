export type SynapseQuickInputItem = {
  readonly id: string
  readonly schemaVersion: 1
  readonly content: string
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
}

export type SynapseQuickInputChangedEvent = {
  readonly items: SynapseQuickInputItem[]
}
