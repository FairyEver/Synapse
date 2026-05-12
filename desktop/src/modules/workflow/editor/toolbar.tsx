import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Play, SlidersHorizontal, Loader2 } from "lucide-react"
import type { WorkflowDefinition } from "@/types/workflow"
import { ParamsEditorDialog } from "../components/params-editor-dialog"
import { RunParamsDialog } from "../components/run-params-dialog"

interface WorkflowToolbarProps {
  definition: WorkflowDefinition
  saving?: boolean
  running?: boolean
  onSave: (def: WorkflowDefinition) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<string | null>
  onChange: (def: WorkflowDefinition) => void
}

export function WorkflowToolbar({ definition, saving, running, onSave, onRun, onChange }: WorkflowToolbarProps) {
  const [paramsOpen, setParamsOpen] = useState(false)
  const [runParamsOpen, setRunParamsOpen] = useState(false)
  // Remember the last-submitted param values so the dialog pre-fills them on
  // subsequent opens (avoids forcing re-entry during iterative testing).
  const [lastRunValues, setLastRunValues] = useState<Record<string, string>>({})
  const busy = saving || running
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 bg-background">
      <Input
        className="h-7 w-48 text-sm"
        value={definition.name}
        onChange={(e) => onChange({ ...definition, name: e.target.value })}
      />
      <Input
        className="h-7 w-64 text-xs text-muted-foreground"
        value={definition.description ?? ""}
        onChange={(e) => onChange({ ...definition, description: e.target.value || undefined })}
        placeholder="描述（可选）"
      />
      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setParamsOpen(true)} disabled={busy}>
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />参数
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onSave(definition)} disabled={busy}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          保存
        </Button>
        <Button size="sm" onClick={() => definition.params.length === 0 ? void onRun({}) : setRunParamsOpen(true)} disabled={busy}>
          {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          运行
        </Button>
      </div>
      <ParamsEditorDialog
        open={paramsOpen}
        params={definition.params}
        onChange={(params) => onChange({ ...definition, params })}
        onClose={() => setParamsOpen(false)}
      />
      <RunParamsDialog
        open={runParamsOpen}
        params={definition.params}
        lastValues={lastRunValues}
        onConfirm={(params, rawValues) => { setRunParamsOpen(false); setLastRunValues(rawValues); void onRun(params) }}
        onCancel={() => setRunParamsOpen(false)}
      />
    </div>
  )
}
