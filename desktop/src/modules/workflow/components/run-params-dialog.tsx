import { useEffect, useMemo, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { track } from "@/lib/ui-tracking"
import { FolderOpen, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type {
  WorkflowParam,
  WorkflowParamDefault,
  WorkflowParamPreset,
  WorkflowResourceEntryType,
  WorkflowResourceRef,
} from "@/types/workflow"

const NO_PRESET_VALUE = "__none__"

interface RunParamsDialogProps {
  open: boolean
  workflowId: string
  params: WorkflowParam[]
  lastValues?: Record<string, string>
  onConfirm: (values: Record<string, unknown>, rawValues: Record<string, string>) => Promise<void>
  onCancel: () => void
}

export function RunParamsDialog({ open, workflowId, params, lastValues, onConfirm, onCancel }: RunParamsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => buildInitialValues(params, lastValues))
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [presets, setPresets] = useState<WorkflowParamPreset[]>([])
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState(NO_PRESET_VALUE)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [presetNameError, setPresetNameError] = useState("")
  const [overwriteCandidate, setOverwriteCandidate] = useState<WorkflowParamPreset | null>(null)

  const paramCounts = useMemo(() => ({
    number: params.filter((param) => param.type === "number").length,
    text: params.filter((param) => param.type === "text").length,
    file: params.filter((param) => param.type === "file").length,
    directory: params.filter((param) => param.type === "directory").length,
  }), [params])

  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId)
  const hasSelectedPreset = selectedPresetId !== NO_PRESET_VALUE && selectedPresetId.length > 0

  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    setErrors({})
    setSelectedPresetId(NO_PRESET_VALUE)
    setSaveDialogOpen(false)
    setOverwriteCandidate(null)
    setPresetName("")
    setPresetNameError("")
    setPresets([])
    setValues(buildInitialValues(params, lastValues))
  }, [open, params, lastValues])

  useEffect(() => {
    if (!open || params.length === 0) {
      setPresets([])
      return
    }
    const presetBridge = window.synapse?.workflowParamPresets
    if (!presetBridge) return
    let cancelled = false
    setPresetsLoading(true)
    presetBridge.list(workflowId)
      .then((nextPresets) => {
        if (!cancelled) setPresets((current) => mergePresetLists(nextPresets, current))
      })
      .catch(() => {
        if (!cancelled) toast.error("读取预设失败")
      })
      .finally(() => {
        if (!cancelled) setPresetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, params.length, workflowId])

  function validate(): boolean {
    const next: Record<string, string> = {}
    for (const param of params) {
      if (param.default !== null) continue
      const raw = values[param.name]
      if (param.type === "number") {
        if (raw === "" || Number.isNaN(Number(raw))) {
          next[param.name] = "此项为必填"
        }
      } else if (!raw) {
        next[param.name] = "此项为必填"
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const parseValues = (): Record<string, unknown> => {
    const parsed: Record<string, unknown> = {}
    for (const param of params) {
      if (param.type === "number") {
        const raw = values[param.name]
        const num = Number(raw)
        parsed[param.name] = raw === "" || Number.isNaN(num) ? (param.default ?? 0) : num
      } else if (param.type === "file" || param.type === "directory") {
        parsed[param.name] = values[param.name]?.trim()
          ? toLocalPathParam(param.type, values[param.name])
          : param.default
      } else {
        parsed[param.name] = values[param.name]
      }
    }
    return parsed
  }

  const runWithCurrentValues = async (savedPreset?: WorkflowParamPreset) => {
    const parsed = parseValues()
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
        hasLastValues: Boolean(lastValues),
        selectedPresetId: savedPreset?.id ?? (selectedPresetId === NO_PRESET_VALUE ? undefined : selectedPresetId),
        savedPreset: Boolean(savedPreset),
      },
    })
    await onConfirm(parsed, values)
  }

  const submitRun = async (savedPreset?: WorkflowParamPreset) => {
    if (submitting) return
    if (!validate()) return
    setSubmitting(true)
    try {
      await runWithCurrentValues(savedPreset)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault()
    void submitRun()
  }

  const openSavePresetDialog = () => {
    if (submitting) return
    if (!validate()) return
    setPresetName(defaultPresetName(selectedPreset))
    setPresetNameError("")
    setSaveDialogOpen(true)
  }

  const handlePresetNameSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault()
    const trimmedName = presetName.trim()
    if (!trimmedName) {
      setPresetNameError("请输入名称")
      return
    }
    const duplicate = presets.find((preset) => preset.name === trimmedName)
    if (duplicate) {
      setSaveDialogOpen(false)
      setOverwriteCandidate(duplicate)
      return
    }
    await savePresetAndSubmit(trimmedName)
  }

  const savePresetAndSubmit = async (name: string, overwritePresetId?: string) => {
    const presetBridge = window.synapse?.workflowParamPresets
    if (!presetBridge) {
      toast.error("保存预设失败")
      return
    }
    setSubmitting(true)
    try {
      const saved = await presetBridge.save({
        workflowId,
        name,
        values,
        overwritePresetId,
      })
      setPresets((current) => upsertPreset(current, saved))
      setSelectedPresetId(saved.id)
      setSaveDialogOpen(false)
      setOverwriteCandidate(null)
      toast("预设已保存")
      await runWithCurrentValues(saved)
    } catch {
      toast.error("保存预设失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleSelectPreset = (presetId: string) => {
    if (!presetId) return
    setSelectedPresetId(presetId)
    if (presetId === NO_PRESET_VALUE) return
    const preset = presets.find((item) => item.id === presetId)
    if (!preset) return
    setValues(buildInitialValues(params, preset.values))
    setErrors({})
  }

  const handleDeleteSelectedPreset = async () => {
    if (!hasSelectedPreset) return
    const presetBridge = window.synapse?.workflowParamPresets
    if (!presetBridge) return
    const presetId = selectedPreset?.id ?? selectedPresetId
    try {
      await presetBridge.delete(presetId)
      setPresets((current) => current.filter((preset) => preset.id !== presetId))
      setSelectedPresetId(NO_PRESET_VALUE)
      toast("预设已删除")
    } catch {
      toast.error("删除预设失败")
    }
  }

  const chooseResourcePath = async (param: WorkflowParam) => {
    if (param.type !== "file" && param.type !== "directory") return
    const selectedPath = param.type === "file"
      ? await window.synapse?.workflow.chooseParamFile?.()
      : await window.synapse?.workflow.chooseParamDirectory?.()
    if (!selectedPath) return
    updateValue(param.name, selectedPath)
  }

  const updateValue = (name: string, nextValue: string) => {
    setValues((current) => ({ ...current, [name]: nextValue }))
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting) onCancel() }}>
        <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>设置运行参数</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {params.length === 0 ? (
                <p className="text-sm text-muted-foreground">此工作流无需参数。</p>
              ) : (
                <>
                  <div className="grid gap-2 border-b pb-4">
                    <div className="grid gap-1.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
                      <Label htmlFor="workflow-param-preset">从预设选择</Label>
                      <div className="flex min-w-0 items-center gap-2">
                        <Select value={selectedPresetId} onValueChange={handleSelectPreset}>
                          <SelectTrigger id="workflow-param-preset" className="w-full">
                            <SelectValue placeholder={presetsLoading ? "读取中" : "选择预设"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_PRESET_VALUE}>不使用预设</SelectItem>
                            {presets.map((preset) => (
                              <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="删除预设"
                          disabled={!hasSelectedPreset || submitting}
                          onClick={() => void handleDeleteSelectedPreset()}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <ScrollArea className="max-h-[60vh] pr-2">
                    <div className="grid gap-4">
                      {params.map((param) => (
                        <div key={param.name} className="grid gap-1.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
                          <Label htmlFor={param.name} className="pt-2">{param.description ?? param.name}</Label>
                          <div className="grid min-w-0 gap-1.5">
                            {param.type === "file" || param.type === "directory" ? (
                              <InputGroup>
                                <InputGroupInput
                                  id={param.name}
                                  value={values[param.name] ?? ""}
                                  onChange={(event) => updateValue(param.name, event.target.value)}
                                  aria-invalid={!!errors[param.name]}
                                />
                                <InputGroupAddon align="inline-end">
                                  <InputGroupButton onClick={() => void chooseResourcePath(param)} aria-label="选择路径">
                                    <FolderOpen className="size-3.5" />
                                  </InputGroupButton>
                                </InputGroupAddon>
                              </InputGroup>
                            ) : param.type === "text" ? (
                              <Textarea
                                id={param.name}
                                value={values[param.name] ?? ""}
                                onChange={(event) => updateValue(param.name, event.target.value)}
                                aria-invalid={!!errors[param.name]}
                                className="min-h-20"
                              />
                            ) : (
                              <Input
                                id={param.name}
                                type="number"
                                value={values[param.name] ?? ""}
                                onChange={(event) => updateValue(param.name, event.target.value)}
                                aria-invalid={!!errors[param.name]}
                              />
                            )}
                            {errors[param.name] && <p className="text-xs text-destructive">{errors[param.name]}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>取消</Button>
              <Button type="button" variant="outline" onClick={openSavePresetDialog} disabled={submitting || params.length === 0}>
                保存为预设并运行
              </Button>
              <Button type="submit" disabled={submitting}>运行</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={saveDialogOpen} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting) setSaveDialogOpen(false) }}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <form onSubmit={(event) => { void handlePresetNameSubmit(event) }}>
            <DialogHeader>
              <DialogTitle>保存预设</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5 py-4">
              <Label htmlFor="workflow-param-preset-name">名称</Label>
              <Input
                id="workflow-param-preset-name"
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
              <Button type="button" variant="ghost" onClick={() => setSaveDialogOpen(false)} disabled={submitting}>取消</Button>
              <Button type="submit" disabled={submitting}>保存并运行</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(overwriteCandidate)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOverwriteCandidate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖同名预设</AlertDialogTitle>
            <AlertDialogDescription>已存在同名预设，是否覆盖？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSaveDialogOpen(true)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!overwriteCandidate) return
                void savePresetAndSubmit(overwriteCandidate.name, overwriteCandidate.id)
              }}
            >
              覆盖并运行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function buildInitialValues(params: WorkflowParam[], source?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(params.map((param) => [
    param.name,
    source?.[param.name] ?? paramDefaultInputValue(param.default),
  ]))
}

function defaultPresetName(selectedPreset?: WorkflowParamPreset): string {
  if (selectedPreset) return selectedPreset.name
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  const hours = String(now.getHours()).padStart(2, "0")
  const minutes = String(now.getMinutes()).padStart(2, "0")
  return `运行预设 ${month}-${day} ${hours}:${minutes}`
}

function upsertPreset(presets: WorkflowParamPreset[], nextPreset: WorkflowParamPreset): WorkflowParamPreset[] {
  const next = presets.filter((preset) => preset.id !== nextPreset.id)
  next.push(nextPreset)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

function mergePresetLists(loaded: WorkflowParamPreset[], current: WorkflowParamPreset[]): WorkflowParamPreset[] {
  const byId = new Map<string, WorkflowParamPreset>()
  for (const preset of loaded) byId.set(preset.id, preset)
  for (const preset of current) byId.set(preset.id, preset)
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  return typeof value === "object" && value !== null && "kind" in value
}

function paramDefaultInputValue(value: WorkflowParamDefault): string {
  if (isWorkflowResourceRef(value) && value.kind === "local_path") return value.path
  if (typeof value === "number" || typeof value === "string") return String(value)
  return ""
}

function toLocalPathParam(entryType: WorkflowResourceEntryType, rawPath: string): WorkflowResourceRef {
  return {
    kind: "local_path",
    entryType,
    path: rawPath.trim(),
  }
}
