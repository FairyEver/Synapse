import { useEffect, useMemo, useState } from "react"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { track } from "@/lib/ui-tracking"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { WorkflowParam, WorkflowParamPreset } from "@/types/workflow"

const NO_PRESET_VALUE = "__none__"

interface RunParamsDialogProps {
  open: boolean
  workflowId: string
  params: WorkflowParam[]
  lastValues?: Record<string, string>
  onConfirm: (values: Record<string, unknown>, rawValues: Record<string, string>) => Promise<void>
  onCancel: () => void
}

function valuesFromParams(params: WorkflowParam[], lastValues?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(params.map((param) => [
    param.name,
    lastValues?.[param.name] ?? String(param.default ?? ""),
  ]))
}

function rawValuesForParams(params: WorkflowParam[], values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(params.map((param) => [param.name, values[param.name] ?? String(param.default ?? "")]))
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

export function RunParamsDialog({ open, workflowId, params, lastValues, onConfirm, onCancel }: RunParamsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => valuesFromParams(params))
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [presets, setPresets] = useState<WorkflowParamPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string>(NO_PRESET_VALUE)
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [savingPreset, setSavingPreset] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingPreset, setDeletingPreset] = useState(false)
  const [overwriteConfirm, setOverwriteConfirm] = useState<WorkflowParamPreset | null>(null)

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  )

  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    setErrors({})
    setSelectedPresetId(NO_PRESET_VALUE)
    setSaveDialogOpen(false)
    setOverwriteConfirm(null)
    setValues(valuesFromParams(params, lastValues))
    if (!workflowId || params.length === 0) {
      setPresets([])
      return
    }
    let cancelled = false
    setPresetsLoading(true)
    window.synapse?.workflowParamPresets.list(workflowId)
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

  function parseValues(): Record<string, unknown> {
    const parsed: Record<string, unknown> = {}
    for (const param of params) {
      if (param.type === "number") {
        const raw = values[param.name]
        const num = Number(raw)
        parsed[param.name] = raw === "" || Number.isNaN(num) ? (param.default ?? 0) : num
      } else {
        parsed[param.name] = values[param.name]
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

  function trackSubmit(savedPreset: boolean, presetId?: string): void {
    track({
      component: "workflow",
      name: "workflow-run-params-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.workflow.run-params.submit",
        workflowId,
        paramCount: params.length,
        numberParamCount: params.filter((param) => param.type === "number").length,
        textParamCount: params.filter((param) => param.type === "text").length,
        hasLastValues: Boolean(lastValues),
        selectedPresetId: presetId,
        savedPreset,
      },
    })
  }

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (submitting) return
    if (!validate()) return
    setSubmitting(true)
    trackSubmit(false, selectedPreset?.id)
    try {
      await onConfirm(parseValues(), values)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePresetSelect = (presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = presets.find((item) => item.id === presetId)
    if (!preset) {
      setValues(valuesFromParams(params, lastValues))
      return
    }
    setValues(rawValuesForParams(params, preset.values))
    setErrors({})
  }

  const handleOpenSaveDialog = () => {
    if (submitting || savingPreset) return
    if (!validate()) return
    setPresetName(selectedPreset?.name ?? nextPresetName(presets))
    setSaveDialogOpen(true)
  }

  const savePresetAndRun = async (overwritePresetId?: string) => {
    const name = presetName.trim()
    if (!name) return
    setSavingPreset(true)
    try {
      const saved = await window.synapse?.workflowParamPresets.save({
        workflowId,
        name,
        values,
        ...(overwritePresetId ? { overwritePresetId } : {}),
      })
      if (saved) {
        setPresets((current) => [saved, ...current.filter((preset) => preset.id !== saved.id)])
        setSelectedPresetId(saved.id)
      }
      trackSubmit(true, saved?.id)
      setSaveDialogOpen(false)
      setOverwriteConfirm(null)
      setSubmitting(true)
      try {
        await onConfirm(parseValues(), values)
      } finally {
        setSubmitting(false)
      }
    } catch {
      const existing = presets.find((preset) => preset.name === name)
      if (existing && !overwritePresetId) {
        setOverwriteConfirm(existing)
      } else {
        toast.error("保存预设失败")
      }
    } finally {
      setSavingPreset(false)
    }
  }

  const handleDeletePreset = async () => {
    if (!selectedPreset) return
    setDeletingPreset(true)
    try {
      await window.synapse?.workflowParamPresets.delete(selectedPreset.id)
      setPresets((current) => current.filter((preset) => preset.id !== selectedPreset.id))
      setSelectedPresetId(NO_PRESET_VALUE)
      setDeleteConfirmOpen(false)
    } catch {
      toast.error("删除预设失败")
    } finally {
      setDeletingPreset(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting && !savingPreset) onCancel() }}>
        <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
          <form onSubmit={handleSubmit} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>设置运行参数</DialogTitle>
            </DialogHeader>
            {params.length > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="workflow-run-param-preset">预设</Label>
                <div className="flex items-center gap-2">
                  <Select value={selectedPresetId} onValueChange={handlePresetSelect} disabled={presetsLoading || submitting || savingPreset}>
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
                    onClick={() => setDeleteConfirmOpen(true)}
                    aria-label="删除预设"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            )}
            <ScrollArea className="max-h-[60vh] pr-2">
              <div className="grid gap-3 py-1">
                {params.length === 0 && <p className="text-sm text-muted-foreground">此工作流无需参数。</p>}
                {params.map((param) => (
                  <div key={param.name} className="grid gap-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-start">
                    <Label htmlFor={param.name} className="pt-2 leading-5">
                      {param.description ?? param.name}
                    </Label>
                    <div className="grid gap-1.5">
                      {param.type === "number" ? (
                        <Input
                          id={param.name}
                          type="number"
                          value={values[param.name] ?? ""}
                          onChange={(event) => {
                            setValues((current) => ({ ...current, [param.name]: event.target.value }))
                            clearError(param.name)
                          }}
                          aria-invalid={!!errors[param.name]}
                        />
                      ) : (
                        <Textarea
                          id={param.name}
                          rows={3}
                          value={values[param.name] ?? ""}
                          onChange={(event) => {
                            setValues((current) => ({ ...current, [param.name]: event.target.value }))
                            clearError(param.name)
                          }}
                          aria-invalid={!!errors[param.name]}
                        />
                      )}
                      {errors[param.name] && <p className="text-xs text-destructive">{errors[param.name]}</p>}
                    </div>
                  </div>
                ))}
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
          <DialogHeader>
            <DialogTitle>保存预设</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="workflow-run-param-preset-name">名称</Label>
            <Input
              id="workflow-run-param-preset-name"
              aria-label="预设名称"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSaveDialogOpen(false)} disabled={savingPreset}>取消</Button>
            <Button type="button" onClick={() => void savePresetAndRun()} disabled={savingPreset || !presetName.trim()}>保存并运行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!overwriteConfirm} onOpenChange={(nextOpen) => { if (!nextOpen) setOverwriteConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖预设？</AlertDialogTitle>
            <AlertDialogDescription>已存在同名预设。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingPreset}>取消</AlertDialogCancel>
            <Button onClick={() => overwriteConfirm && void savePresetAndRun(overwriteConfirm.id)} disabled={savingPreset}>覆盖并运行</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预设？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPreset}>取消</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void handleDeletePreset()} disabled={deletingPreset}>删除</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
