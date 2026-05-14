import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
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
  isDuplicate?: boolean
  onChange: (patch: Partial<WorkflowParam>) => void
  onDelete: () => void
}

function WorkflowParamCard({ param, index, isDuplicate, onChange, onDelete }: WorkflowParamCardProps) {
  return (
    <div className={`rounded-lg bg-muted/50 p-3 grid gap-3 ${isDuplicate ? "ring-1 ring-destructive" : ""}`}>
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
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">参数名</Label>
          <Input
            value={param.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="param_name"
            className={isDuplicate ? "border-destructive" : undefined}
          />
          {isDuplicate && <p className="text-[11px] text-destructive">参数名称重复</p>}
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">类型</Label>
          <Select
            value={param.type}
            onValueChange={(v) => onChange({ type: v as WorkflowParam["type"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">文本</SelectItem>
              <SelectItem value="number">数字</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">默认值</Label>
        {param.type === "number" ? (
          <Input
            type="number"
            value={param.default ?? ""}
            onChange={(e) =>
              onChange({ default: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="可选"
          />
        ) : (
          <Textarea
            className="resize-none"
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

function paramsEqual(a: WorkflowParam[], b: WorkflowParam[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => p.name === b[i]?.name && p.type === b[i]?.type && p.default === b[i]?.default)
}

export function ParamsEditorDialog({ open, params, onChange, onClose }: ParamsEditorDialogProps) {
  const [draft, setDraft] = useState<WorkflowParam[]>(params)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  useEffect(() => {
    if (open) setDraft(params)
  }, [open, params])

  const isDirty = useMemo(() => !paramsEqual(draft, params), [draft, params])

  // Compute duplicate param names for real-time feedback
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of draft) {
      const trimmed = p.name.trim()
      if (!trimmed) continue
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1)
    }
    const dupes = new Set<string>()
    for (const [name, count] of counts) { if (count > 1) dupes.add(name) }
    return dupes
  }, [draft])

  const hasDuplicates = duplicateNames.size > 0

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      if (isDirty) { setShowCloseConfirm(true); return }
      onClose()
    }
  }

  const handleCancel = () => {
    if (isDirty) { setShowCloseConfirm(true); return }
    onClose()
  }

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
    onChange(draft
      .map((p) => ({ ...p, name: p.name.trim() }))
      .filter((p) => p.name !== ""))
    onClose()
  }

  return (
    <>
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
              isDuplicate={!!p.name.trim() && duplicateNames.has(p.name.trim())}
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
          <Button variant="ghost" onClick={handleCancel}>取消</Button>
          <Button onClick={handleSave} disabled={hasDuplicates}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>未保存的参数更改</AlertDialogTitle>
          <AlertDialogDescription>参数已修改，是否保存？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button variant="ghost" onClick={() => { setShowCloseConfirm(false); onClose() }}>放弃</Button>
          <Button onClick={() => { setShowCloseConfirm(false); handleSave() }}>保存</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
