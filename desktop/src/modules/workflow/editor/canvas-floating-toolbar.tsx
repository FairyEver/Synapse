import { useState } from "react"
import { Save, Play, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkflowDefinition, WorkflowParamPresetValue } from "@/types/workflow"
import { RunParamsDialog } from "../components/run-params-dialog"

interface CanvasFloatingToolbarProps {
  definition: WorkflowDefinition
  saving?: boolean
  running?: boolean
  dirty?: boolean
  onSave: (def: WorkflowDefinition, silent?: boolean) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<string | null>
}

export function CanvasFloatingToolbar({ definition, saving, running, dirty, onSave, onRun }: CanvasFloatingToolbarProps) {
  const [runParamsOpen, setRunParamsOpen] = useState(false)
  const [lastRunValues, setLastRunValues] = useState<Record<string, WorkflowParamPresetValue>>({})
  const busy = saving || running
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm border rounded-lg shadow-sm px-2 py-1.5">
      <Button size="sm" variant="ghost" data-track="workflow-editor-save" onClick={() => void onSave(definition)} disabled={busy} className="relative">
        {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
        保存
        {dirty && !saving && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />}
      </Button>
      <Button size="sm" data-track="workflow-editor-run" onClick={() => definition.params.length === 0 ? void onRun({}) : setRunParamsOpen(true)} disabled={busy}>
        {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
        运行
      </Button>
      <RunParamsDialog
        open={runParamsOpen}
        workflowId={definition.id}
        params={definition.params}
        lastValues={lastRunValues}
        onConfirm={async (params, rawValues) => {
          setLastRunValues(rawValues)
          try {
            await onRun(params)
            setRunParamsOpen(false)
          } catch {
            // Dialog stays open, submitting will be reset
          }
        }}
        onCancel={() => setRunParamsOpen(false)}
      />
    </div>
  )
}
