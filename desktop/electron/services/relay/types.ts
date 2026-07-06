export const AGENT_RELAY_SERVICE_ID = "core.relay"

export interface RelayProjectSummary {
  readonly projectId: string
  readonly name?: string
  readonly workspacePath?: string
  readonly managedKnowledgeBase?: boolean
}

export interface RelaySendRequest {
  readonly sourceProjectId: string
  readonly sourceSessionKey: string
  readonly targetProjectId: string
  readonly message: string
  readonly timeoutMs?: number
  readonly visible?: boolean
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly metadata?: Record<string, unknown>
}

export interface RelaySendResult {
  readonly ok: true
  readonly runId: string
  readonly sourceProjectId: string
  readonly targetProjectId: string
  readonly targetSessionKey: string
  readonly timedOut: boolean
  readonly resultText?: string
  readonly partialText?: string
  readonly error?: string
}
