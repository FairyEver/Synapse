import type { CapabilityId } from "./naming"

export type SynapseActionSource = "api" | "mcp-stdio" | "mcp-http"

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
    readonly anyOf?: readonly {
      readonly required: readonly string[]
    }[]
  }
}

export type CapabilityDefinition = {
  readonly id: CapabilityId
  readonly title: string
  readonly description: string
  readonly mutates: boolean
  readonly risk?: "normal" | "high"
}

export type CapabilityDomainDefinition = {
  readonly id: string
  readonly capabilities: readonly CapabilityDefinition[]
}
