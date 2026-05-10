import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Play, Square } from "lucide-react"
import type { WorkflowDefinition } from "@/types/workflow"
import type { RunState } from "../hooks/use-workflow-run"

interface WorkflowToolbarProps {
  definition: WorkflowDefinition
  runState: RunState
  onSave: (def: WorkflowDefinition) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<string | null>
  onCancel: () => Promise<void>
  onChange: (def: WorkflowDefinition) => void
}

export function WorkflowToolbar({ definition, runState, onSave, onRun, onCancel, onChange }: WorkflowToolbarProps) {
  const isRunning = runState === "running"
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 bg-background">
      <Input
        className="h-7 w-48 text-sm"
        value={definition.name}
        onChange={(e) => onChange({ ...definition, name: e.target.value })}
      />
      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => void onSave(definition)}><Save className="h-3.5 w-3.5 mr-1" />保存</Button>
        {isRunning
          ? <Button size="sm" variant="destructive" onClick={() => void onCancel()}><Square className="h-3.5 w-3.5 mr-1" />停止</Button>
          : <Button size="sm" onClick={() => void onRun({})}><Play className="h-3.5 w-3.5 mr-1" />运行</Button>
        }
      </div>
    </div>
  )
}
