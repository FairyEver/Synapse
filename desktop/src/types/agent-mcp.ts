export type AgentMcpItem = {
  name: string
  source: string
  enabled: boolean
  configurable: boolean
}

export type AgentMcpInventory = {
  items: AgentMcpItem[]
  projects: { id: string; name: string }[]
  disabledServerNames: string[]
  warnings: string[]
}

export type AgentMcpListInput = { projectId?: string }
export type AgentMcpToggleInput = { name: string; enabled: boolean }
