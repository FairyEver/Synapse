import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Command as CommandPrimitive } from "cmdk"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@/components/ui/command"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"
import { track } from "@/lib/ui-tracking"
import { CheckIcon, ChevronsUpDown, FolderOpen, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type {
  WorkflowParam,
  WorkflowParamDefault,
  WorkflowParamPreset,
  WorkflowParamPresetValue,
  WorkflowResourceEntryType,
  WorkflowResourceRef,
} from "@/types/workflow"
import { MultiResourcePathField } from "./multi-resource-path-field"
import { useWorkflowResourcePicker } from "../hooks/use-workflow-resource-picker"

const NO_PRESET_VALUE = "__none__"

interface RunParamsDialogProps {
  open: boolean
  workflowId: string
  params: WorkflowParam[]
  lastValues?: Record<string, WorkflowParamPresetValue>
  onConfirm: (values: Record<string, unknown>, rawValues: Record<string, WorkflowParamPresetValue>) => Promise<void>
  onCancel: () => void
}

export function RunParamsDialog({ open, workflowId, params, lastValues, onConfirm, onCancel }: RunParamsDialogProps) {
  const { chooseResource } = useWorkflowResourcePicker()
  const [values, setValues] = useState<Record<string, WorkflowParamPresetValue>>(() => buildInitialValues(params, lastValues))
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [incompatibleValueErrors, setIncompatibleValueErrors] = useState<Record<string, string>>(() => buildResourceCardinalityErrors(params, lastValues))
  const [presets, setPresets] = useState<WorkflowParamPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string>(NO_PRESET_VALUE)
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [presetNameError, setPresetNameError] = useState("")
  const [savingPreset, setSavingPreset] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingPreset, setDeletingPreset] = useState(false)
  const [overwriteConfirm, setOverwriteConfirm] = useState<WorkflowParamPreset | null>(null)

  const paramCounts = useMemo(() => ({
    number: params.filter((param) => param.type === "number").length,
    text: params.filter((param) => param.type === "text").length,
    file: params.filter((param) => param.type === "file").length,
    directory: params.filter((param) => param.type === "directory").length,
    option: params.filter((param) => param.type === "option").length,
  }), [params])

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  )

  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    const initialErrors = buildResourceCardinalityErrors(params, lastValues)
    setErrors(initialErrors)
    setIncompatibleValueErrors(initialErrors)
    setSelectedPresetId(NO_PRESET_VALUE)
    setSaveDialogOpen(false)
    setPresetName("")
    setPresetNameError("")
    setOverwriteConfirm(null)
    setDeleteConfirmOpen(false)
    setValues(buildInitialValues(params, lastValues))

    const presetBridge = window.synapse?.workflowParamPresets
    if (!presetBridge || !workflowId || params.length === 0) {
      setPresets([])
      setPresetsLoading(false)
      return
    }

    let cancelled = false
    setPresetsLoading(true)
    presetBridge.list(workflowId)
      .then((items) => {
        if (!cancelled) setPresets(items)
      })
      .catch(() => {
        if (!cancelled) {
          setPresets([])
          toast.error("读取预设失败")
        }
      })
      .finally(() => {
        if (!cancelled) setPresetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, params, lastValues, workflowId])

  function validate(): boolean {
    const next: Record<string, string> = { ...incompatibleValueErrors }
    for (const param of params) {
      const raw = values[param.name]
      if (param.type === "number") {
        const input = stringParamValue(raw)
        if (param.default === null && (input === "" || Number.isNaN(Number(input)))) {
          next[param.name] = "此项为必填"
        }
      } else if (param.type === "option") {
        const trimmed = stringParamValue(raw).trim()
        if (param.default === null && !trimmed) {
          next[param.name] = "此项为必填"
          continue
        }
        const options = normalizeOptionValues(param.options)
        if (param.allowCustomOption !== true && trimmed && !options.includes(trimmed)) {
          next[param.name] = "请选择预设选项"
        }
      } else if ((param.type === "file" || param.type === "directory") && param.allowMultiple) {
        if (resourcePathValues(raw).length === 0) next[param.name] = "此项为必填"
      } else if (param.default === null && !stringParamValue(raw)) {
        next[param.name] = "此项为必填"
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function parseValues(): Record<string, unknown> {
    const parsed: Record<string, unknown> = {}
    for (const param of params) {
      if (param.type === "number") {
        const raw = stringParamValue(values[param.name])
        const num = Number(raw)
        parsed[param.name] = raw === "" || Number.isNaN(num) ? (param.default ?? 0) : num
      } else if (param.type === "file" || param.type === "directory") {
        if (param.allowMultiple) {
          const paths = resourcePathValues(values[param.name])
          parsed[param.name] = paths.map((resourcePath) => toLocalPathParam(param.type as WorkflowResourceEntryType, resourcePath))
        } else {
          const resourcePath = stringParamValue(values[param.name]).trim()
          parsed[param.name] = resourcePath ? toLocalPathParam(param.type, resourcePath) : param.default
        }
      } else if (param.type === "option") {
        const trimmed = stringParamValue(values[param.name]).trim()
        parsed[param.name] = trimmed || param.default || ""
      } else {
        parsed[param.name] = stringParamValue(values[param.name])
      }
    }
    return parsed
  }

  function clearError(paramName: string): void {
    if (!errors[paramName]) return
    setErrors((current) => {
      const next = { ...current }
      delete next[paramName]
      return next
    })
  }

  function updateValue(name: string, nextValue: WorkflowParamPresetValue): void {
    setValues((current) => ({ ...current, [name]: nextValue }))
    setIncompatibleValueErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
    clearError(name)
  }

  function trackSubmit(savedPreset: boolean, presetId?: string): void {
    track({
      component: "workflow",
      name: "workflow-run-params-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.workflow.run-params.submit",
        workflowId,
        paramCount: params.length,
        numberParamCount: paramCounts.number,
        textParamCount: paramCounts.text,
        fileParamCount: paramCounts.file,
        directoryParamCount: paramCounts.directory,
        optionParamCount: paramCounts.option,
        hasLastValues: Boolean(lastValues),
        selectedPresetId: presetId,
        savedPreset,
      },
    })
  }

  async function runWithCurrentValues(savedPreset?: WorkflowParamPreset): Promise<void> {
    trackSubmit(Boolean(savedPreset), savedPreset?.id ?? selectedPreset?.id)
    await onConfirm(parseValues(), values)
  }

  async function handleSubmit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (submitting || savingPreset) return
    if (!validate()) return
    setSubmitting(true)
    try {
      await runWithCurrentValues()
    } finally {
      setSubmitting(false)
    }
  }

  function handlePresetSelect(presetId: string): void {
    setSelectedPresetId(presetId)
    const preset = presets.find((item) => item.id === presetId)
    if (!preset) {
      setValues(buildInitialValues(params, lastValues))
      const nextErrors = buildResourceCardinalityErrors(params, lastValues)
      setIncompatibleValueErrors(nextErrors)
      setErrors(nextErrors)
      return
    }
    setValues(buildInitialValues(params, preset.values))
    const nextErrors = buildResourceCardinalityErrors(params, preset.values)
    setIncompatibleValueErrors(nextErrors)
    setErrors(nextErrors)
  }

  function handleOpenSaveDialog(): void {
    if (submitting || savingPreset) return
    if (!validate()) return
    setPresetName(selectedPreset?.name ?? nextPresetName(presets))
    setPresetNameError("")
    setSaveDialogOpen(true)
  }

  async function savePresetAndRun(overwritePresetId?: string): Promise<void> {
    if (!validate()) return
    const name = presetName.trim()
    if (!name) {
      setPresetNameError("请输入名称")
      return
    }

    const existing = presets.find((preset) => preset.name === name)
    if (existing && !overwritePresetId) {
      setSaveDialogOpen(false)
      setOverwriteConfirm(existing)
      return
    }

    const presetBridge = window.synapse?.workflowParamPresets
    if (!presetBridge) {
      toast.error("保存预设失败")
      return
    }

    setSavingPreset(true)
    try {
      const saved = await presetBridge.save({
        workflowId,
        name,
        values,
        ...(overwritePresetId ? { overwritePresetId } : {}),
      })
      setPresets((current) => upsertPreset(current, saved))
      setSelectedPresetId(saved.id)
      setSaveDialogOpen(false)
      setOverwriteConfirm(null)
      toast("预设已保存")
      setSubmitting(true)
      try {
        await runWithCurrentValues(saved)
      } finally {
        setSubmitting(false)
      }
    } catch {
      if (existing && !overwritePresetId) {
        setSaveDialogOpen(false)
        setOverwriteConfirm(existing)
      } else {
        toast.error("保存预设失败")
      }
    } finally {
      setSavingPreset(false)
    }
  }

  async function handleDeletePreset(): Promise<void> {
    if (!selectedPreset) return
    const presetBridge = window.synapse?.workflowParamPresets
    if (!presetBridge) return
    setDeletingPreset(true)
    try {
      await presetBridge.delete(selectedPreset.id)
      setPresets((current) => current.filter((preset) => preset.id !== selectedPreset.id))
      setSelectedPresetId(NO_PRESET_VALUE)
      setDeleteConfirmOpen(false)
      toast("预设已删除")
    } catch {
      toast.error("删除预设失败")
    } finally {
      setDeletingPreset(false)
    }
  }

  async function chooseResourcePath(param: WorkflowParam): Promise<void> {
    if (param.type !== "file" && param.type !== "directory") return
    const selectedPath = await chooseResource(param.type)
    if (!selectedPath) return
    updateValue(param.name, selectedPath)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting && !savingPreset) onCancel() }}>
        <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
          <form onSubmit={(event) => { void handleSubmit(event) }} className="grid min-w-0 gap-4">
            <DialogHeader>
              <DialogTitle>设置运行参数</DialogTitle>
            </DialogHeader>
            {params.length > 0 && (
              <div className="grid gap-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-center">
                <Label htmlFor="workflow-run-param-preset" className="leading-5">预设</Label>
                <div className="flex min-w-0 items-center gap-2">
                  <Select
                    value={selectedPresetId}
                    onValueChange={handlePresetSelect}
                    disabled={presetsLoading || submitting || savingPreset}
                  >
                    <SelectTrigger id="workflow-run-param-preset" className="w-full">
                      <SelectValue placeholder="未选择预设" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PRESET_VALUE}>未选择预设</SelectItem>
                      {presets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!selectedPreset || deletingPreset || submitting || savingPreset}
                    onClick={(event) => {
                      if (shouldBypassDeleteConfirm(event)) {
                        void handleDeletePreset()
                        return
                      }
                      setDeleteConfirmOpen(true)
                    }}
                    aria-label="删除预设"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            )}
            <ScrollArea
              className="min-w-0 max-h-[56vh] pr-2"
              viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
            >
              <div className="grid gap-3 py-1">
                {params.length === 0 && <p className="text-sm text-muted-foreground">无需参数</p>}
                {params.map((param, paramIndex) => {
                  const isMultiResource = (param.type === "file" || param.type === "directory") && param.allowMultiple === true
                  const labelId = `workflow-run-param-${paramIndex}-label`
                  return (
                    <div key={param.name} className="grid gap-1.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-start">
                      <Label id={labelId} htmlFor={isMultiResource ? undefined : param.name} className="pt-1.5 leading-5">
                        {param.description ?? param.name}
                      </Label>
                      <div className="grid min-w-0 gap-1.5">
                        {param.type === "number" ? (
                          <Input
                            id={param.name}
                            type="number"
                            value={stringParamValue(values[param.name])}
                            onChange={(event) => updateValue(param.name, event.target.value)}
                            aria-invalid={!!errors[param.name]}
                          />
                        ) : (param.type === "file" || param.type === "directory") && param.allowMultiple ? (
                          <MultiResourcePathField
                            entryType={param.type}
                            paths={resourcePathValues(values[param.name])}
                            onChange={(paths) => updateValue(param.name, paths)}
                            disabled={submitting || savingPreset}
                            labelledBy={labelId}
                          />
                        ) : param.type === "file" || param.type === "directory" ? (
                          <InputGroup>
                            <InputGroupInput
                              id={param.name}
                              value={stringParamValue(values[param.name])}
                              onChange={(event) => updateValue(param.name, event.target.value)}
                              aria-invalid={!!errors[param.name]}
                            />
                            <InputGroupAddon align="inline-end">
                              <InputGroupButton
                                size="icon-xs"
                                onClick={() => { void chooseResourcePath(param) }}
                                aria-label="选择路径"
                              >
                                <FolderOpen className="size-3.5" />
                              </InputGroupButton>
                            </InputGroupAddon>
                          </InputGroup>
                        ) : param.type === "option" ? (
                          <OptionParamControl
                            param={param}
                            value={stringParamValue(values[param.name])}
                            hasError={!!errors[param.name]}
                            onChange={(nextValue) => updateValue(param.name, nextValue)}
                          />
                        ) : (
                          <Textarea
                            id={param.name}
                            rows={3}
                            value={stringParamValue(values[param.name])}
                            onChange={(event) => updateValue(param.name, event.target.value)}
                            aria-invalid={!!errors[param.name]}
                          />
                        )}
                        {errors[param.name] && <p className="text-xs text-destructive">{errors[param.name]}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting || savingPreset}>取消</Button>
              {params.length > 0 && (
                <Button type="button" variant="outline" onClick={handleOpenSaveDialog} disabled={submitting || savingPreset}>
                  保存为预设并运行
                </Button>
              )}
              <Button type="submit" disabled={submitting || savingPreset}>运行</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={saveDialogOpen} onOpenChange={(nextOpen) => { if (!nextOpen && !savingPreset) setSaveDialogOpen(false) }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <form onSubmit={(event) => { event.preventDefault(); void savePresetAndRun() }} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>保存预设</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="workflow-run-param-preset-name">名称</Label>
              <Input
                id="workflow-run-param-preset-name"
                aria-label="预设名称"
                value={presetName}
                onChange={(event) => {
                  setPresetName(event.target.value)
                  if (presetNameError) setPresetNameError("")
                }}
                aria-invalid={!!presetNameError}
                autoFocus
              />
              {presetNameError && <p className="text-xs text-destructive">{presetNameError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSaveDialogOpen(false)} disabled={savingPreset}>取消</Button>
              <Button type="submit" disabled={savingPreset || !presetName.trim()}>保存并运行</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!overwriteConfirm}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !savingPreset) setOverwriteConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖预设？</AlertDialogTitle>
            <AlertDialogDescription>已存在同名预设。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingPreset} onClick={() => setSaveDialogOpen(true)}>取消</AlertDialogCancel>
            <Button onClick={() => overwriteConfirm && void savePresetAndRun(overwriteConfirm.id)} disabled={savingPreset}>
              覆盖并运行
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预设？</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPreset}>取消</AlertDialogCancel>
            <Button variant="destructive" onClick={() => { void handleDeletePreset() }} disabled={deletingPreset}>删除</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface OptionParamControlProps {
  param: WorkflowParam
  value: string
  hasError: boolean
  onChange: (value: string) => void
}

function OptionParamControl({ param, value, hasError, onChange }: OptionParamControlProps) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const options = useMemo(() => normalizeOptionValues(param.options), [param.options])
  const trimmedValue = value.trim()
  const visibleOptions = useMemo(() => {
    const search = searchValue.trim().toLocaleLowerCase()
    if (!search) return options
    return options.filter((option) => option.toLocaleLowerCase().includes(search))
  }, [options, searchValue])

  if (param.allowCustomOption !== true) {
    return (
      <select
        id={param.name}
        value={trimmedValue}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={hasError}
        className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg border border-input bg-background px-2.5 py-1 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
      >
        <option value="" disabled>选择选项</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setSearchValue("")
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={param.name}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-invalid={hasError}
          className="inline-flex h-8 w-full shrink-0 cursor-pointer items-center justify-between gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none select-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-muted aria-expanded:text-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
          onClick={() => setOpen(true)}
        >
          <span className="truncate">{trimmedValue || "选择或输入"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" data-icon="inline-end" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-1.5">
        <Command>
          <CommandInput
            id={`${param.name}-input`}
            aria-label={param.name}
            value={searchValue}
            onValueChange={(nextValue) => {
              setSearchValue(nextValue)
              onChange(nextValue)
            }}
            placeholder="输入或选择"
            data-track="workflow-run-param-option-input"
          />
          <CommandList>
            <CommandGroup>
              {visibleOptions.map((option) => (
                <CommandPrimitive.Item
                  key={option}
                  value={option}
                  data-checked={trimmedValue === option}
                  className="group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-muted data-selected:text-foreground"
                  onSelect={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{option}</span>
                  <CheckIcon className="ml-auto size-4 opacity-0 group-data-[checked=true]/command-item:opacity-100" />
                </CommandPrimitive.Item>
              ))}
              {visibleOptions.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">无匹配选项</p>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function buildInitialValues(
  params: WorkflowParam[],
  source?: Record<string, WorkflowParamPresetValue>,
): Record<string, WorkflowParamPresetValue> {
  return Object.fromEntries(params.map((param) => [
    param.name,
    initialParamInputValue(param, source?.[param.name]),
  ]))
}

function buildResourceCardinalityErrors(
  params: WorkflowParam[],
  source?: Record<string, WorkflowParamPresetValue>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const param of params) {
    if (param.type !== "file" && param.type !== "directory") continue
    const sourceValue = source?.[param.name]
    if (sourceValue === undefined) continue
    if ((param.allowMultiple === true && typeof sourceValue === "string")
      || (param.allowMultiple !== true && Array.isArray(sourceValue))) {
      errors[param.name] = "已保存值与当前单选/多选设置不兼容，请重新选择"
    }
  }
  return errors
}

function normalizeOptionValues(options?: readonly string[]): string[] {
  const normalized: string[] = []
  for (const option of options ?? []) {
    const value = option.trim()
    if (value && !normalized.includes(value)) normalized.push(value)
  }
  return normalized
}

function nextPresetName(existing: readonly WorkflowParamPreset[]): string {
  const date = new Date().toISOString().slice(0, 10)
  const base = `新预设 ${date}`
  const names = new Set(existing.map((preset) => preset.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

function upsertPreset(presets: WorkflowParamPreset[], nextPreset: WorkflowParamPreset): WorkflowParamPreset[] {
  const next = presets.filter((preset) => preset.id !== nextPreset.id)
  next.push(nextPreset)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  return typeof value === "object" && value !== null && "kind" in value
}

function initialParamInputValue(param: WorkflowParam, sourceValue?: WorkflowParamPresetValue): WorkflowParamPresetValue {
  if ((param.type === "file" || param.type === "directory") && param.allowMultiple) {
    if (sourceValue !== undefined) return resourcePathValues(sourceValue)
    return resourceDefaultInputPaths(param.default)
  }
  if (typeof sourceValue === "string") return sourceValue
  return paramDefaultInputValue(param.default)
}

function paramDefaultInputValue(value: WorkflowParamDefault): string {
  if (isWorkflowResourceRef(value) && value.kind === "local_path") return value.path
  if (typeof value === "number" || typeof value === "string") return String(value)
  return ""
}

function resourceDefaultInputPaths(value: WorkflowParamDefault): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((resource): resource is Extract<WorkflowResourceRef, { kind: "local_path" }> => resource.kind === "local_path")
    .map((resource) => resource.path)
}

function resourcePathValues(value: WorkflowParamPresetValue | undefined): string[] {
  return Array.isArray(value) ? value : []
}

function stringParamValue(value: WorkflowParamPresetValue | undefined): string {
  return typeof value === "string" ? value : ""
}

function toLocalPathParam(entryType: WorkflowResourceEntryType, rawPath: string): WorkflowResourceRef {
  return {
    kind: "local_path",
    entryType,
    path: rawPath.trim(),
  }
}
