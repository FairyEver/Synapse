import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowParam } from "@/types/workflow"

// ─── WorkflowParamCard ────────────────────────────────────────────────────────

interface WorkflowParamCardProps {
  param: WorkflowParam
  index: number
  onChange: (patch: Partial<WorkflowParam>) => void
  onDelete: () => void
}

function WorkflowParamCard({ param, index, onChange, onDelete }: WorkflowParamCardProps) {
  return (
    <div className="rounded-md border border-border p-3 grid gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">参数 {index + 1}</span>
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
      <div className="grid gap-1.5">
        <Label className="text-xs">参数名</Label>
        <Input
          className="h-7 text-xs"
          value={param.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="param_name"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">类型</Label>
          <Select
            value={param.type}
            onValueChange={(v) => onChange({ type: v as WorkflowParam["type"] })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text" className="text-xs">文本</SelectItem>
              <SelectItem value="number" className="text-xs">数字</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">描述</Label>
          <Input
            className="h-7 text-xs"
            value={param.description ?? ""}
            onChange={(e) => onChange({ description: e.target.value || undefined })}
            placeholder="可选"
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">默认值</Label>
        {param.type === "number" ? (
          <Input
            className="h-7 text-xs"
            type="number"
            value={param.default ?? ""}
            onChange={(e) =>
              onChange({ default: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="可选"
          />
        ) : (
          <Textarea
            className="text-xs resize-none"
            rows={2}
            value={String(param.default ?? "")}
            onChange={(e) =>
              onChange({ default: e.target.value === "" ? null : e.target.value })
            }
            placeholder="可选"
          />
        )}
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
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>编辑工作流参数</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-auto pr-1">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无参数。</p>
          )}
          {draft.map((p, i) => (
            <WorkflowParamCard
              key={i}
              param={p}
              index={i}
              onChange={(patch) => updateParam(i, patch)}
              onDelete={() => removeParam(i)}
            />
          ))}
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
