import { useEffect, useId, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Plus, Trash2, ChevronUp, ChevronDown, FolderOpen } from "lucide-react"
import type { WorkflowParam, WorkflowParamDefault, WorkflowResourceEntryType, WorkflowResourceRef } from "@/types/workflow"
import { MultiResourcePathField } from "./multi-resource-path-field"
import { useWorkflowResourcePicker } from "../hooks/use-workflow-resource-picker"

type DraftParam = WorkflowParam & { _key: string }
const REQUIRED_OPTION_VALUE = "__required__"

function toDraft(p: WorkflowParam): DraftParam {
  return { ...p, _key: crypto.randomUUID() }
}
function fromDraft(d: DraftParam): WorkflowParam {
  const param: WorkflowParam = {
    name: d.name,
    type: d.type,
    default: d.default,
  }
  if (d.description !== undefined) param.description = d.description
  if (d.type === "option") {
    param.options = d.options
    param.allowCustomOption = d.allowCustomOption
  }
  if ((d.type === "file" || d.type === "directory") && d.allowMultiple === true) param.allowMultiple = true
  return param
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
  const allowCustomId = useId()
  const allowMultipleId = useId()
  const { chooseResource } = useWorkflowResourcePicker()
  const resourceEntryType: WorkflowResourceEntryType | null = param.type === "file" || param.type === "directory" ? param.type : null
  const optionRows = param.options ?? []
  const normalizedOptions = normalizeOptionValues(optionRows)
  const optionDefault = typeof param.default === "string" && normalizedOptions.includes(param.default.trim())
    ? param.default.trim()
    : REQUIRED_OPTION_VALUE

  const handleChooseResourceDefault = async () => {
    if (!resourceEntryType) return
    const selectedPath = await chooseResource(resourceEntryType)
    if (selectedPath) {
      onChange({ default: toLocalPathDefault(resourceEntryType, selectedPath) })
    }
  }
  const handleAllowMultipleChange = (checked: boolean) => {
    if (!resourceEntryType) return
    onChange({ allowMultiple: checked, default: null })
  }
  const handleTypeChange = (value: string) => {
    const type = value as WorkflowParam["type"]
    if (type === "option") {
      onChange({ type, default: null, options: [], allowCustomOption: false })
      return
    }
    onChange({ type, default: null, options: undefined, allowCustomOption: undefined, allowMultiple: undefined })
  }
  const updateOption = (optionIndex: number, value: string) => {
    onChange({ options: optionRows.map((option, i) => i === optionIndex ? value : option) })
  }
  const addOption = () => {
    onChange({ options: [...optionRows, ""] })
  }
  const removeOption = (optionIndex: number) => {
    onChange({ options: optionRows.filter((_, i) => i !== optionIndex) })
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
            onValueChange={handleTypeChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">文本</SelectItem>
              <SelectItem value="number">数字</SelectItem>
              <SelectItem value="file">文件</SelectItem>
              <SelectItem value="directory">文件夹</SelectItem>
              <SelectItem value="option">选项</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">默认值</Label>
          {resourceEntryType && (
            <div className="flex items-center gap-2">
              <Label htmlFor={allowMultipleId} className="text-xs text-muted-foreground">允许多选</Label>
              <Switch
                id={allowMultipleId}
                size="sm"
                checked={param.allowMultiple ?? false}
                onCheckedChange={handleAllowMultipleChange}
              />
            </div>
          )}
        </div>
        {param.type === "number" ? (
          <Input
            type="number"
            value={typeof param.default === "number" ? param.default : ""}
            onChange={(e) =>
              onChange({ default: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="可选"
          />
        ) : resourceEntryType && param.allowMultiple ? (
          <MultiResourcePathField
            entryType={resourceEntryType}
            paths={resourceDefaultPaths(param.default)}
            onChange={(paths) => onChange({ default: paths.length > 0 ? paths.map((path) => toLocalPathRef(resourceEntryType, path)) : null })}
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
        ) : param.type === "option" ? (
          <Select
            value={optionDefault}
            onValueChange={(value) => onChange({ default: value === REQUIRED_OPTION_VALUE ? null : value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={REQUIRED_OPTION_VALUE}>必填</SelectItem>
              {normalizedOptions.map((option, optionIndex) => (
                <SelectItem key={`${option}-${optionIndex}`} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      {param.type === "option" && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">选项</Label>
            <div className="flex items-center gap-2">
              <Label htmlFor={allowCustomId} className="text-xs text-muted-foreground">允许自定义</Label>
              <Switch
                id={allowCustomId}
                size="sm"
                checked={param.allowCustomOption ?? false}
                onCheckedChange={(checked) => onChange({ allowCustomOption: checked })}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            {optionRows.map((option, optionIndex) => (
              <div key={optionIndex} className="flex items-center gap-1.5">
                <Input
                  value={option}
                  onChange={(e) => updateOption(optionIndex, e.target.value)}
                  aria-label={`选项 ${optionIndex + 1}`}
                  placeholder="选项"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeOption(optionIndex)}
                  aria-label="删除选项"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground justify-start gap-1.5 px-2 border border-dashed w-fit"
              onClick={addOption}
            >
              <Plus className="h-3 w-3" />添加选项
            </Button>
          </div>
        </div>
      )}
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
    && Boolean(p.allowMultiple) === Boolean(b[i]?.allowMultiple)
    && optionMetadataEqual(p, b[i])
  )
}

function optionMetadataEqual(a: WorkflowParam, b?: WorkflowParam): boolean {
  if (!b) return false
  if (a.type !== "option" && b.type !== "option") return true
  return a.allowCustomOption === b.allowCustomOption
    && stringArrayEqual(a.options, b.options)
}

function stringArrayEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export function ParamsEditorDialog({ open, params, onChange, onClose }: ParamsEditorDialogProps) {
  const [draft, setDraft] = useState<DraftParam[]>(() => params.map(toDraft))
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(params.map(toDraft))
      setSaveError(null)
    }
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
    setSaveError(null)
    setDraft((d) => [...d, toDraft({ name: "", type: "text", default: null })])
  }

  const removeParam = (i: number) => {
    setSaveError(null)
    setDraft((d) => d.filter((_, j) => j !== i))
  }

  const updateParam = (i: number, patch: Partial<WorkflowParam>) => {
    setSaveError(null)
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
    const namedParams = draft
      .map((p) => ({ ...fromDraft(p), name: p.name.trim() }))
      .filter((p) => p.name !== "")
    const error = namedParams.map(optionValidationError).find(Boolean)
    if (error) {
      setSaveError(error)
      return
    }
    onChange(namedParams.map(sanitizeParamForSave))
    onClose()
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl" aria-describedby={undefined}>
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
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
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

function resourceDefaultPaths(value: WorkflowParamDefault): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((resource): resource is Extract<WorkflowResourceRef, { kind: "local_path" }> => resource.kind === "local_path")
    .map((resource) => resource.path)
}

function textDefaultValue(value: WorkflowParamDefault): string {
  return typeof value === "string" ? value : ""
}

function toLocalPathDefault(entryType: WorkflowResourceEntryType, rawPath: string): WorkflowParamDefault {
  const path = rawPath.trim()
  if (!path) return null
  return { kind: "local_path", entryType, path }
}

function toLocalPathRef(entryType: WorkflowResourceEntryType, rawPath: string): WorkflowResourceRef {
  return { kind: "local_path", entryType, path: rawPath.trim() }
}

function normalizeOptionValues(options?: readonly string[]): string[] {
  return options?.map((option) => option.trim()).filter(Boolean) ?? []
}

function optionValidationError(param: WorkflowParam): string | null {
  if (param.type !== "option") return null
  const options = normalizeOptionValues(param.options)
  if (options.length === 0) return "至少保留一个选项"
  if (new Set(options).size !== options.length) return "选项不能重复"
  return null
}

function sanitizeParamForSave(param: WorkflowParam): WorkflowParam {
  const defaultValue = (param.type === "file" || param.type === "directory")
    && (Array.isArray(param.default) !== (param.allowMultiple === true))
    ? null
    : param.default
  const base: WorkflowParam = {
    name: param.name,
    type: param.type,
    default: defaultValue,
  }
  if (param.description !== undefined) base.description = param.description
  if ((param.type === "file" || param.type === "directory") && param.allowMultiple === true) base.allowMultiple = true
  if (param.type !== "option") return base

  const options = normalizeOptionValues(param.options)
  const optionDefaultValue = typeof param.default === "string" ? param.default.trim() : null
  return {
    ...base,
    default: optionDefaultValue && options.includes(optionDefaultValue) ? optionDefaultValue : null,
    options,
    allowCustomOption: param.allowCustomOption ?? false,
  }
}

function paramDefaultEqual(a: WorkflowParamDefault, b: WorkflowParamDefault): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b) || isWorkflowResourceRef(a) || isWorkflowResourceRef(b)) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}
