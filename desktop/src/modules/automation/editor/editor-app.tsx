import { useMemo } from "react"

import { AutomationEditorForm } from "./editor-form"
import type { AutomationEditorMode } from "../types"

function parseAutomationEditorMode(search: string): AutomationEditorMode | null {
  const params = new URLSearchParams(search)
  const mode = params.get("mode")
  if (mode === "create") return { mode: "create" }
  if (mode === "edit") {
    const automationId = params.get("automationId")
    return automationId ? { mode: "edit", automationId } : null
  }
  return null
}

export function AutomationEditorApp() {
  const mode = useMemo(() => parseAutomationEditorMode(window.location.search), [])

  if (!mode) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        自动化窗口不可用
      </div>
    )
  }

  return <AutomationEditorForm mode={mode} />
}
