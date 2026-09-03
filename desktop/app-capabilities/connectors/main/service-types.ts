export type ReturnTypeOfConnectorsService = {
  initialize(): Promise<void>
  list(): Promise<{ items: import("../shared/schema").ConnectorItem[] }>
  connect(id: string): Promise<import("../shared/schema").ConnectorItem>
  disconnect(id: string): Promise<void>
  getEnabledConnectorIds(): Promise<string[]>
  createAgentContribution(connectorIds: readonly string[]): import("./types").AgentContribution
  onChanged(listener: (event: { items: import("../shared/schema").ConnectorItem[] }) => void): () => void
}
