import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowParam } from "@/types/workflow"
import type { VariableBinding, VariableSource } from "./schemas/variable-binding"

// ─── Shared style tokens ──────────────────────────────────────────────────────

const CELL_INPUT =
  "h-full w-full bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"

const CELL_TRIGGER =
  "h-full w-full border-0 rounded-none shadow-none bg-transparent focus-visible:ring-0 focus-visible:border-transparent text-xs px-2"

// ─── VariableSourceControl ────────────────────────────────────────────────────

interface VariableSourceControlProps {
  source: VariableSource
  onChange: (source: VariableSource) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

function VariableSourceControl({
  source,
  onChange,
  upstreamNodes,
  workflowParams,
}: VariableSourceControlProps) {
  const handleTypeChange = (type: string) => {
    if (type === "node_output") onChange({ type: "node_output", node: "" })
    else if (type === "param") onChange({ type: "param", param: "" })
    else onChange({ type: "static", value: "" })
  }

  return (
    <div className="flex items-stretch flex-1 min-w-0">
      <div className="w-[100px] shrink-0 flex items-center">
        <Select value={source.type} onValueChange={handleTypeChange}>
          <SelectTrigger className={CELL_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="static" className="text-xs">固定值</SelectItem>
            <SelectItem value="param" className="text-xs">工作流参数</SelectItem>
            <SelectItem value="node_output" className="text-xs">上游节点</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="w-px bg-border shrink-0" />
      <div className="flex-1 flex items-center min-w-0">
        {source.type === "static" && (
          <input
            className={CELL_INPUT}
            value={source.value}
            onChange={(e) => onChange({ type: "static", value: e.target.value })}
            placeholder="值"
          />
        )}
        {source.type === "param" && (
          <Select
            value={source.param}
            onValueChange={(param) => onChange({ type: "param", param })}
          >
            <SelectTrigger className={CELL_TRIGGER}>
              <SelectValue placeholder="选择参数" />
            </SelectTrigger>
            <SelectContent>
              {workflowParams.map((p) => (
                <SelectItem key={p.name} value={p.name} className="text-xs">{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {source.type === "node_output" && (
          <Select
            value={source.node}
            onValueChange={(node) => onChange({ type: "node_output", node })}
          >
            <SelectTrigger className={CELL_TRIGGER}>
              <SelectValue placeholder="选择节点" />
            </SelectTrigger>
            <SelectContent>
              {upstreamNodes.map((n) => (
                <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}

// ─── VariableBindingRow ───────────────────────────────────────────────────────

interface VariableBindingRowProps {
  binding: VariableBinding
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  onChange: (patch: Partial<VariableBinding>) => void
  onDelete: () => void
}

function VariableBindingRow({
  binding,
  upstreamNodes,
  workflowParams,
  onChange,
  onDelete,
}: VariableBindingRowProps) {
  return (
    <div className="flex items-stretch h-8">
      <div className="w-[72px] shrink-0 border-r border-border">
        <input
          className={CELL_INPUT}
          value={binding.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="变量名"
        />
      </div>
      <VariableSourceControl
        source={binding.source}
        onChange={(source) => onChange({ source })}
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
      <div className="w-8 shrink-0 border-l border-border flex items-center justify-center">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  )
}

// ─── VariableBindingEditor (exported) ────────────────────────────────────────

interface VariableBindingEditorProps {
  variables: VariableBinding[]
  onChange: (variables: VariableBinding[]) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function VariableBindingEditor({
  variables,
  onChange,
  upstreamNodes,
  workflowParams,
}: VariableBindingEditorProps) {
  const add = () => onChange([...variables, { name: "", source: { type: "static", value: "" } }])
  const remove = (i: number) => onChange(variables.filter((_, j) => j !== i))
  const update = (i: number, patch: Partial<VariableBinding>) =>
    onChange(variables.map((v, j) => (j === i ? { ...v, ...patch } : v)))

  return (
    <div className="grid gap-2">
      <Label className="text-xs text-muted-foreground">变量绑定</Label>
      {variables.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
          {variables.map((v, i) => (
            <VariableBindingRow
              key={i}
              binding={v}
              upstreamNodes={upstreamNodes}
              workflowParams={workflowParams}
              onChange={(patch) => update(i, patch)}
              onDelete={() => remove(i)}
            />
          ))}
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 text-xs text-muted-foreground justify-start gap-1.5 px-2 border border-dashed"
        onClick={add}
      >
        <Plus className="h-3 w-3" />
        添加变量
      </Button>
    </div>
  )
}
