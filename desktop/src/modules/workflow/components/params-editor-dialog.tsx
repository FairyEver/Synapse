import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, ChevronUp, ChevronDown, FolderOpen } from "lucide-react"
import type { WorkflowParam, WorkflowParamDefault, WorkflowResourceEntryType, WorkflowResourceRef } from "@/types/workflow"

type DraftParam = WorkflowParam & { _key: string }
function toDraft(p: WorkflowParam): DraftParam {
  return { ...p, _key: crypto.randomUUID() }
}
function fromDraft(d: DraftParam): WorkflowParam {
  return {
    name: d.name,
    type: d.type,
    default: d.default,
    description: d.description,
  }
}

// ─── WorkflowParamCard ────────────────────────────────────────────────────────

interface WorkflowParamCardProps {
  param: WorkflowParam
  index: number
  total: number
  isDuplicate?: boolean
  onChange: (patch: Partial<WorkflowParam>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function WorkflowParamCard({ param, index, total, isDuplicate, onChange, onDelete, onMoveUp, onMoveDown }: WorkflowParamCardProps) {
  const resourceEntryType: WorkflowResourceEntryType | null = param.type === "file" || param.type === "directory" ? param.type : null
  const handleChooseResourceDefault = async () => {
    if (!resourceEntryType) return
    const selectedPath = resourceEntryType === "file"
      ? await window.synapse?.workflow.chooseParamFile?.()
      : await window.synapse?.workflow.chooseParamDirectory?.()
    if (selectedPath) {
      onChange({ default: toLocalPathDefault(resourceEntryType, selectedPath) })
    }
  }

  return (
    <div className={`rounded-lg bg-muted/50 p-3 grid gap-2 ${isDuplicate ? "ring-1 ring-destructive" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">参数 {index + 1}</span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground"
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label="上移参数"
          >
            <ChevronUp className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground"
            disabled={index === total - 1}
            onClick={onMoveDown}
            aria-label="下移参数"
          >
            <ChevronDown className="size-3" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="删除参数"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">参数名</Label>
          <Input
            value={param.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="param_name"
            className={isDuplicate ? "border-destructive" : undefined}
          />
          {isDuplicate && <p className="text-xs text-destructive">参数名称重复</p>}
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">类型</Label>
          <Select
            value={param.type}
            onValueChange={(v) => onChange({ type: v as WorkflowParam["type"], default: null })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">文本</SelectItem>
              <SelectItem value="number">数字</SelectItem>
              <SelectItem value="file">文件</SelectItem>
              <SelectItem value="directory">文件夹</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">默认值</Label>
        {param.type === "number" ? (
          <Input
            type="number"
            value={typeof param.default === "number" ? param.default : ""}
            onChange={(e) =>
              onChange({ default: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="可选"
          />
        ) : resourceEntryType ? (
          <InputGroup>
            <InputGroupInput
              value={resourceDefaultPath(param.default)}
              onChange={(e) =>
                onChange({ default: toLocalPathDefault(resourceEntryType, e.target.value) })
              }
              placeholder="可选"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={handleChooseResourceDefault} aria-label="选择路径">
                <FolderOpen className="size-3.5" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        ) : (
          <Textarea
            className="resize-none"
            rows={2}
            value={textDefaultValue(param.default)}
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
  return a.every((p, i) =>
    p.name === b[i]?.name
    && p.type === b[i]?.type
    && p.description === b[i]?.description
    && paramDefaultEqual(p.default, b[i]?.default)
  )
}

export function ParamsEditorDialog({ open, params, onChange, onClose }: ParamsEditorDialogProps) {
  const [draft, setDraft] = useState<DraftParam[]>(() => params.map(toDraft))
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)

  useEffect(() => {
    if (open) setDraft(params.map(toDraft))
  }, [open, params])

  const isDirty = useMemo(() => !paramsEqual(draft.map(fromDraft), params), [draft, params])

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
    setDraft((d) => [...d, toDraft({ name: "", type: "text", default: null })])
  }

  const removeParam = (i: number) => {
    setDraft((d) => d.filter((_, j) => j !== i))
  }

  const updateParam = (i: number, patch: Partial<WorkflowParam>) => {
    setDraft((d) => d.map((p, j) => j === i ? { ...p, ...patch } : p))
  }

  const moveParam = (from: number, to: number) => {
    setDraft((d) => {
      const next = [...d]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const handleSave = () => {
    onChange(draft
      .map((p) => ({ ...fromDraft(p), name: p.name.trim() }))
      .filter((p) => p.name !== ""))
    onClose()
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>编辑工作流参数</DialogTitle></DialogHeader>
        <ScrollArea className="max-h-[60vh] py-2 pr-1">
          <div className="grid gap-2">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无参数。</p>
          )}
          {draft.map((p, i) => (
            <WorkflowParamCard
              key={p._key}
              param={p}
              index={i}
              total={draft.length}
              isDuplicate={!!p.name.trim() && duplicateNames.has(p.name.trim())}
              onChange={(patch) => updateParam(i, patch)}
              onDelete={() => removeParam(i)}
              onMoveUp={() => moveParam(i, i - 1)}
              onMoveDown={() => moveParam(i, i + 1)}
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
        </ScrollArea>
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
          <Button onClick={() => { setShowCloseConfirm(false); handleSave() }} disabled={hasDuplicates}>保存</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  return typeof value === "object" && value !== null && "kind" in value
}

function resourceDefaultPath(value: WorkflowParamDefault): string {
  if (isWorkflowResourceRef(value) && value.kind === "local_path") return value.path
  if (typeof value === "string") return value
  return ""
}

function textDefaultValue(value: WorkflowParamDefault): string {
  return typeof value === "string" ? value : ""
}

function toLocalPathDefault(entryType: WorkflowResourceEntryType, rawPath: string): WorkflowParamDefault {
  const path = rawPath.trim()
  if (!path) return null
  return { kind: "local_path", entryType, path }
}

function paramDefaultEqual(a: WorkflowParamDefault, b: WorkflowParamDefault): boolean {
  if (a === b) return true
  if (isWorkflowResourceRef(a) || isWorkflowResourceRef(b)) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}
