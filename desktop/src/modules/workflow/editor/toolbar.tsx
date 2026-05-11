import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Play, Square, SlidersHorizontal, PenLine } from "lucide-react"
import type { WorkflowDefinition } from "@/types/workflow"
import type { RunState } from "../hooks/use-workflow-run"
import { ParamsEditorDialog } from "../components/params-editor-dialog"
import { RunParamsDialog } from "../components/run-params-dialog"

interface WorkflowToolbarProps {
  definition: WorkflowDefinition
  runState: RunState
  onSave: (def: WorkflowDefinition) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<string | null>
  onCancel: () => Promise<void>
  onReset: () => void
  onChange: (def: WorkflowDefinition) => void
}

export function WorkflowToolbar({ definition, runState, onSave, onRun, onCancel, onReset, onChange }: WorkflowToolbarProps) {
  const isRunning = runState === "running"
  const isResultMode = !isRunning && runState !== "idle"
  const [paramsOpen, setParamsOpen] = useState(false)
  const [runParamsOpen, setRunParamsOpen] = useState(false)
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
        <Button size="sm" variant="ghost" onClick={() => setParamsOpen(true)}>
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />参数
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onSave(definition)}><Save className="h-3.5 w-3.5 mr-1" />保存</Button>
        {isRunning
          ? <Button size="sm" variant="destructive" onClick={() => void onCancel()}><Square className="h-3.5 w-3.5 mr-1" />停止</Button>
          : isResultMode
            ? <Button size="sm" variant="outline" onClick={onReset}><PenLine className="h-3.5 w-3.5 mr-1" />返回编辑</Button>
            : <Button size="sm" onClick={() => definition.params.length === 0 ? void onRun({}) : setRunParamsOpen(true)}><Play className="h-3.5 w-3.5 mr-1" />运行</Button>
        }
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
        onConfirm={(params) => { setRunParamsOpen(false); void onRun(params) }}
        onCancel={() => setRunParamsOpen(false)}
      />
    </div>
  )
}
