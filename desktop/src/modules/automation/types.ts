import type { AutomationItem } from "@/types/automation"
import type { ActionConfig } from "../../../action-packages/types"

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
}
