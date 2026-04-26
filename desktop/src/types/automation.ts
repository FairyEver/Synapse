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
