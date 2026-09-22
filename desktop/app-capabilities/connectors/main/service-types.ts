export type ReturnTypeOfConnectorsService = {
  initialize(): Promise<void>
  list(): Promise<{ items: import("../shared/schema").ConnectorItem[] }>
  connect(id: string): Promise<import("../shared/schema").ConnectorItem>
  disconnect(id: string): Promise<void>
  retry(id: string): Promise<import("../shared/schema").ConnectorItem>
  handleCallback(id: string, url: string): Promise<void>
  getSessionInput(id: string): Promise<{ connectionGeneration: string; baseUrl: string; userId: string; language: string; credential: { token: string; tenantId: string } }>
  dispose(): void
  getEnabledConnectorIds(): Promise<string[]>
  createAgentContribution(connectorIds: readonly string[]): import("./types").AgentContribution
  onChanged(listener: (event: { items: import("../shared/schema").ConnectorItem[] }) => void): () => void
}
