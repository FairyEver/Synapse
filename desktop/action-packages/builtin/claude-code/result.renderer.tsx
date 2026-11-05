import { useState } from "react"
import { Terminal } from "lucide-react"
import { ActionResultView } from "../../../src/action-runtime/action-result-view"
import { Button } from "../../../src/components/ui/button"
import { openTerminalSession } from "../../../src/lib/open-terminal-session"
import { runTrackedOperation } from "../../../src/lib/ui-tracking"
import type { ActionRunResult } from "../../types"

export function ClaudeCodeResultView({ result, showDuration = true }: { readonly result: ActionRunResult; readonly showDuration?: boolean }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { projectId, sessionId } = result.outputs ?? {}
  const target = typeof projectId === "string" && typeof sessionId === "string" ? { projectId, sessionId } : null

  async function handleOpen() {
    if (!target || opening) return
    setOpening(true)
    setError(null)
    try {
      await runTrackedOperation({ component: "automation", eventKey: "automation.history.open-terminal" }, () => openTerminalSession(target))
    } catch (error) {
      setError(error instanceof Error && error.message === "终端会话已不可用" ? error.message : "无法打开终端")
    } finally { setOpening(false) }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ActionResultView result={result} showDuration={showDuration} />
      {target ? <Button variant="outline" className="self-start" disabled={opening} onClick={() => { void handleOpen() }}><Terminal />打开终端</Button> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
