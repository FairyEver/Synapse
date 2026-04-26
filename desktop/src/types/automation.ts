export type SynapseCronMode =
  | ""
  | "default"
  | "bypassPermissions"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"

export type SynapseCronSessionMode = "" | "new_per_run"

export type SynapseCronJob = {
  id: string
  project: string
  sessionKey: string
  cronExpr: string
  prompt: string
  exec: string
  workDir: string
  description: string
  enabled: boolean
  silent: boolean
  mute: boolean
  sessionMode: SynapseCronSessionMode
  mode: SynapseCronMode
  timeoutMins: number | null
  createdAt: string
  lastRun: string | null
  lastError: string
  nextRunAt: string | null
  scheduleText: string
  requiresPermission: boolean
}

export type SynapseCronJobDraft = {
  project: string
  sessionKey: string
  cronExpr: string
  prompt: string
  exec: string
  workDir?: string
  description?: string
  enabled?: boolean
  silent?: boolean
  mute?: boolean
  sessionMode?: SynapseCronSessionMode
  mode?: SynapseCronMode
  timeoutMins?: number | null
  permissionDecision?: "allow" | "deny"
}

export type SynapseCronListPayload = {
  project?: string
}

export type SynapseCronListResult = {
  jobs: SynapseCronJob[]
}

export type SynapseCronMutationResult = {
  status: "ok" | "permission_required" | "denied"
  job: SynapseCronJob | null
  error: string | null
}

export type SynapseCronUpdatePayload = {
  id: string
  patch: Partial<SynapseCronJobDraft>
}

export type SynapseCronTogglePayload = {
  id: string
  enabled: boolean
}

export type SynapseCronDeletePayload = {
  id: string
}

export type SynapseHeartbeatStatus = {
  project: string
  enabled: boolean
  paused: boolean
  intervalMins: number
  onlyWhenIdle: boolean
  sessionKey: string
  prompt: string
  silent: boolean
  timeoutMins: number
  workDir: string
  runCount: number
  errorCount: number
  skippedBusy: number
  lastRun: string | null
  lastError: string
}

export type SynapseHeartbeatDraft = {
  project: string
  enabled?: boolean
  intervalMins?: number
  onlyWhenIdle?: boolean
  sessionKey?: string
  prompt?: string
  silent?: boolean
  timeoutMins?: number
  workDir?: string
}

export type SynapseHeartbeatListResult = {
  heartbeats: SynapseHeartbeatStatus[]
}

export type SynapseHeartbeatMutationPayload = {
  project: string
}

export type SynapseHeartbeatIntervalPayload = {
  project: string
  intervalMins: number
}

export type SynapseHeartbeatRunResult =
  | { status: "completed"; prompt: string; silent: boolean }
  | { status: "skipped_busy"; sessionKey: string }
  | { status: "not_found"; project: string }
  | { status: "failed"; error: string; prompt: string }
  | { status: "timed_out"; error: string; prompt: string }

export type SynapseHookEventType =
  | "message.received"
  | "message.sent"
  | "session.started"
  | "session.ended"
  | "cron.triggered"
  | "permission.requested"
  | "error"

export type SynapseHookHandlerType = "command" | "http"

export type SynapseHook = {
  id: string
  project: string
  event: SynapseHookEventType | "*"
  type: SynapseHookHandlerType
  command: string
  url: string
  timeout: number | null
  async: boolean
  createdAt: string
  lastRun: string | null
  lastError: string
  lastResult: string
}

export type SynapseHookDraft = {
  project: string
  event: SynapseHookEventType | "*"
  type: SynapseHookHandlerType
  command?: string
  url?: string
  timeout?: number | null
  async?: boolean
}

export type SynapseHookListPayload = {
  project?: string
}

export type SynapseHookListResult = {
  hooks: SynapseHook[]
}

export type SynapseHookUpdatePayload = {
  id: string
  patch: Partial<SynapseHookDraft>
}

export type SynapseHookDeletePayload = {
  id: string
}

export type SynapseHookRunResult =
  | {
    status: "permission_required"
    type: "command"
    event: string
    command: string
    env: Record<string, string>
    timeoutMs: number
    requiresPermission: true
  }
  | {
    status: "delivered"
    type: "http"
    event: string
    url: string
    statusCode: number
    timeoutMs: number
  }
  | {
    status: "failed"
    type: SynapseHookHandlerType
    event: string
    error: string
    statusCode?: number
    timeoutMs: number
  }
  | {
    status: "queued"
    type: SynapseHookHandlerType
    event: string
  }

export type SynapseHookTestPayload = {
  id: string
  event?: SynapseHookEventType
}

export type SynapseHookTestResult = {
  results: SynapseHookRunResult[]
}
