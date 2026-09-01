import { Copy } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import { Field, FieldLabel } from "../../../src/components/ui/field"
import { Textarea } from "../../../src/components/ui/textarea"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import { utf8ByteLength } from "../shared/schema"
import { useJsonRepair } from "./use-json-repair"

const logger = createRendererLogger("json-repair.app")

export function JsonRepairModule() {
  const repair = useJsonRepair()

  const copyJson = async () => {
    if (repair.json === null) return
    const finishTracking = startTrackedOperation({ component: "json-repair", eventKey: "json-repair.result.copy" })
    try {
      await navigator.clipboard.writeText(repair.json)
      finishTracking("success")
      toast.success("已复制")
    } catch {
      finishTracking("failure")
      logger.error("JSON repair copy failed.", {
        stage: "clipboard_write",
        reason: "write_failed",
      })
      toast.error("复制失败")
    }
  }

  const actions = repair.json !== null ? (
    <SystemAppTopBarActionButton onClick={() => void copyJson()}>
      <Copy data-icon="inline-start" />
      复制 JSON
    </SystemAppTopBarActionButton>
  ) : undefined

  return (
    <SystemAppWindowShell actions={actions}>
      <main className="grid h-full min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-2 lg:overflow-hidden">
        <Field className="min-h-0 grid-rows-[auto_minmax(16rem,1fr)_auto_auto]">
          <FieldLabel htmlFor="json-repair-input">输入文本</FieldLabel>
          <Textarea
            id="json-repair-input"
            value={repair.text}
            onChange={(event) => repair.setText(event.target.value)}
            disabled={repair.busy}
            className="h-full min-h-64 resize-none font-mono text-sm"
            spellCheck={false}
            autoFocus
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {formatBytes(repair.inputBytes)} / 128 KiB
            </p>
            <Button
              data-track="json-repair.text.repair"
              type="button"
              disabled={!repair.canRepair}
              onClick={() => void repair.repair()}
            >
              {repair.busy ? "修复中" : "修复 JSON"}
            </Button>
          </div>
          {repair.error ? (
            <Alert variant="destructive">
              <AlertDescription>{repair.error.message}</AlertDescription>
            </Alert>
          ) : null}
        </Field>

        <Field className="min-h-0 grid-rows-[auto_minmax(16rem,1fr)_auto]">
          <FieldLabel htmlFor="json-repair-output">JSON 文本</FieldLabel>
          <Textarea
            id="json-repair-output"
            value={repair.json ?? ""}
            readOnly
            className="h-full min-h-64 resize-none font-mono text-sm"
            spellCheck={false}
          />
          {repair.json !== null ? (
            <p className="text-xs text-muted-foreground">
              {formatBytes(utf8ByteLength(repair.json))}
            </p>
          ) : null}
        </Field>
      </main>
    </SystemAppWindowShell>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KiB`
}
