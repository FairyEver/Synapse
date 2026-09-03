import type { Options } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import type { ConnectorProbeErrorCodeV1 } from "../../../electron/runtime/data-repo/schemas/connectors"

export type McpStreamableHttpIntegration = {
  readonly kind: "mcp-streamable-http"
  readonly endpoint: string
  readonly requiredTools?: readonly string[]
}

export type ConnectorIntegration = McpStreamableHttpIntegration

export type BuiltinConnectorDefinition = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly documentationUrl?: string
  readonly skillPackageId: string
  readonly integration: ConnectorIntegration
}

export type ConnectorProbeErrorCode = ConnectorProbeErrorCodeV1

export type ProbeResult =
  | { readonly ok: true; readonly toolCount: number }
  | { readonly ok: false; readonly errorCode: ConnectorProbeErrorCode }

export type AgentMcpServerConfig = {
  readonly name: string
  readonly config: NonNullable<Options["mcpServers"]>[string]
}

export type AgentContribution = {
  readonly mcpServers: readonly AgentMcpServerConfig[]
  readonly skillPackageIds: readonly string[]
}

export type ConnectorDriver = {
  probe(definition: BuiltinConnectorDefinition): Promise<ProbeResult>
  createAgentContribution(definition: BuiltinConnectorDefinition): AgentContribution
}
