export type ReturnTypeOfConnectorsService = {
  initialize(): Promise<void>
  list(): Promise<{ items: import("../shared/schema").ConnectorItem[] }>
  connect(id: string): Promise<import("../shared/schema").ConnectorItem>
  disconnect(id: string): Promise<void>
  getMcpServers(): Promise<NonNullable<import("@anthropic-ai/claude-agent-sdk", { with: { "resolution-mode": "import" } }).Options["mcpServers"]>>
  onChanged(listener: (event: { items: import("../shared/schema").ConnectorItem[] }) => void): () => void
}
