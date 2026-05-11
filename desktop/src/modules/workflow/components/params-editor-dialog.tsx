import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowParam } from "@/types/workflow"

// ─── Cell style tokens (dedicated — not shared with variable-binding-editor) ──

const CELL_INPUT =
  "h-full w-full bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"

const CELL_TRIGGER =
  "h-full w-full border-0 rounded-none shadow-none bg-transparent focus-visible:ring-0 focus-visible:border-transparent text-xs px-2"

// ─── WorkflowParamRow ─────────────────────────────────────────────────────────

interface WorkflowParamRowProps {
  param: WorkflowParam
  onChange: (patch: Partial<WorkflowParam>) => void
  onDelete: () => void
}

function WorkflowParamRow({ param, onChange, onDelete }: WorkflowParamRowProps) {
  return (
    <div className="flex items-stretch h-9 divide-x divide-border">
      <div className="w-[120px] shrink-0 flex items-center">
        <input
          className={CELL_INPUT}
          value={param.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="参数名"
        />
      </div>
      <div className="w-[80px] shrink-0 flex items-center">
        <Select
          value={param.type}
          onValueChange={(v) => onChange({ type: v as WorkflowParam["type"] })}
        >
          <SelectTrigger className={CELL_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text" className="text-xs">文本</SelectItem>
            <SelectItem value="number" className="text-xs">数字</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="w-[120px] shrink-0 flex items-center">
        <input
          className={CELL_INPUT}
          type={param.type === "number" ? "number" : "text"}
          value={param.default ?? ""}
          onChange={(e) =>
            onChange({
              default:
                e.target.value === ""
                  ? null
                  : param.type === "number"
                  ? Number(e.target.value)
                  : e.target.value,
            })
          }
          placeholder="默认值"
        />
      </div>
      <div className="flex-1 flex items-center min-w-0">
        <input
          className={CELL_INPUT}
          value={param.description ?? ""}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder="描述（可选）"
        />
      </div>
      <div className="w-8 shrink-0 flex items-center justify-center">
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

// ─── ParamsEditorDialog ───────────────────────────────────────────────────────

interface ParamsEditorDialogProps {
  open: boolean
  params: WorkflowParam[]
  onChange: (params: WorkflowParam[]) => void
  onClose: () => void
}

export function ParamsEditorDialog({ open, params, onChange, onClose }: ParamsEditorDialogProps) {
  const [draft, setDraft] = useState<WorkflowParam[]>(params)

  useEffect(() => {
    if (open) setDraft(params)
  }, [open, params])

  const handleOpenChange = (o: boolean) => { if (!o) onClose() }

  const addParam = () => {
    setDraft((d) => [...d, { name: "", type: "text", default: null }])
  }

  const removeParam = (i: number) => {
    setDraft((d) => d.filter((_, j) => j !== i))
  }

  const updateParam = (i: number, patch: Partial<WorkflowParam>) => {
    setDraft((d) => d.map((p, j) => j === i ? { ...p, ...patch } : p))
  }

  const handleSave = () => {
    onChange(draft.filter((p) => p.name.trim() !== ""))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>编辑工作流参数</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无参数。</p>
          )}
          {draft.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              <div className="flex items-center h-7 text-xs text-muted-foreground divide-x divide-border bg-muted/50">
                <div className="w-[120px] shrink-0 px-2">参数名</div>
                <div className="w-[80px] shrink-0 px-2">类型</div>
                <div className="w-[120px] shrink-0 px-2">默认值</div>
                <div className="flex-1 px-2">描述</div>
                <div className="w-8 shrink-0" />
              </div>
              {draft.map((p, i) => (
                <WorkflowParamRow
                  key={i}
                  param={p}
                  onChange={(patch) => updateParam(i, patch)}
                  onDelete={() => removeParam(i)}
                />
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground justify-start gap-1.5 px-2 border border-dashed w-fit"
            onClick={addParam}
          >
            <Plus className="h-3 w-3" />添加参数
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
