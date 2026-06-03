import type { AutomationItem } from "@/types/automation"
import type { ActionConfig } from "../../../action-packages/types"

type AutomationFormTriggerType = "cron" | "interval"

type AutomationFormState = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  activeDays: number[]
  triggerType: AutomationFormTriggerType
  cronExpr: string
  cronTimezone: string
  everyMinutes: string
  intervalAnchor: "created_at" | "last_completed_at"
  executorType: string
  executorConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}

type AutomationFormDialogState =
  | { mode: "create"; item?: undefined }
  | { mode: "edit"; item: AutomationItem }

type AutomationEditorMode =
  | { mode: "create" }
  | { mode: "edit"; automationId: string }

type AutomationEditorDraft = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  triggerType: string | null
  triggerConfig: Record<string, unknown>
  executorType: string | null
  executorConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}

type AutomationEditorLoadState =
  | { status: "loading" }
  | { status: "ready"; draft: AutomationEditorDraft; item?: AutomationItem }
  | { status: "error"; message: string }

export type {
  AutomationEditorDraft,
  AutomationEditorLoadState,
  AutomationEditorMode,
  AutomationFormDialogState,
  AutomationFormState,
  AutomationFormTriggerType,
}
