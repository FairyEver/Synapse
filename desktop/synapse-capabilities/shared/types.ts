export type SynapseActionSource = "api" | "cli" | "mcp-stdio" | "mcp-http"

export type DispatchContext = {
  readonly source?: SynapseActionSource
}

export type DispatchResult = {
  readonly ok: true
  readonly data?: unknown
  readonly affected?: number
  readonly total?: number
}

export type McpToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties: Record<string, unknown>
    readonly required?: readonly string[]
  }
}

export type CapabilityDefinition = {
  readonly action: string
  readonly mcpTool?: string
  readonly cliCommand?: string
  readonly mutates: boolean
}

export type CapabilityDomainDefinition = {
  readonly id: string
  readonly capabilities: readonly CapabilityDefinition[]
}
