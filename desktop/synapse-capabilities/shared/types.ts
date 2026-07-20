import type { CapabilityId } from "./naming"

export type SynapseActionSource = "api" | "mcp-stdio" | "mcp-http"

export type DispatchActorIdentity =
  | { readonly kind: "user"; readonly id?: string; readonly display?: string }
  | { readonly kind: "extension"; readonly id: string }
  | { readonly kind: "agent"; readonly id: string }
  | { readonly kind: "connector"; readonly id: string }
  | { readonly kind: "system"; readonly id?: string }

export type DispatchContext = {
  readonly source?: SynapseActionSource
  readonly actor?: DispatchActorIdentity
}

export function mcpClientActorForSource(source: Extract<SynapseActionSource, "mcp-http" | "mcp-stdio">): DispatchActorIdentity {
  return source === "mcp-http"
    ? { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" }
    : { kind: "user", id: "mcp-client:synapse-mcp/stdio", display: "Synapse MCP stdio" }
}

export type DispatchResult =
  | {
    readonly ok: true
    readonly data?: unknown
    readonly affected?: number
    readonly total?: number
  }
  | {
    readonly ok: false
    readonly error?: string
    readonly errors?: readonly unknown[]
    readonly data?: unknown
    readonly code?: string
  }

export type McpToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties: Record<string, unknown>
    readonly required?: readonly string[]
    readonly additionalProperties?: boolean
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
