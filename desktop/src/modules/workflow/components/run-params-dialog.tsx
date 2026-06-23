import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { track } from "@/lib/ui-tracking"
import { FolderOpen } from "lucide-react"
import type { WorkflowParam, WorkflowParamDefault, WorkflowResourceEntryType, WorkflowResourceRef } from "@/types/workflow"

interface RunParamsDialogProps {
  open: boolean
  params: WorkflowParam[]
  lastValues?: Record<string, string>
  onConfirm: (values: Record<string, unknown>, rawValues: Record<string, string>) => Promise<void>
  onCancel: () => void
}

export function RunParamsDialog({ open, params, lastValues, onConfirm, onCancel }: RunParamsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.name, paramDefaultInputValue(p.default)])))
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      setSubmitting(false)
      setErrors({})
      // Pre-fill with last-submitted values when available; fall back to defaults
      setValues(Object.fromEntries(params.map((p) => [
        p.name,
        lastValues?.[p.name] ?? paramDefaultInputValue(p.default),
      ])))
    }
  }, [open, params, lastValues])

  function validate(): boolean {
    const next: Record<string, string> = {}
    for (const p of params) {
      if (p.default !== null) continue
      const raw = values[p.name]
      if (p.type === "number") {
        if (raw === "" || Number.isNaN(Number(raw))) {
          next[p.name] = "此项为必填"
        }
      } else if (!raw) {
        next[p.name] = "此项为必填"
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (submitting) return
    if (!validate()) return
    setSubmitting(true)
    const parsed: Record<string, unknown> = {}
    for (const p of params) {
      if (p.type === "number") {
        const raw = values[p.name]
        const num = Number(raw)
        parsed[p.name] = raw === "" || Number.isNaN(num) ? (p.default ?? 0) : num
      } else if (p.type === "file" || p.type === "directory") {
        parsed[p.name] = values[p.name]?.trim()
          ? toLocalPathParam(p.type, values[p.name])
          : p.default
      } else {
        parsed[p.name] = values[p.name]
      }
    }
    track({
      component: "workflow",
      name: "workflow-run-params-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.workflow.run-params.submit",
        paramCount: params.length,
        numberParamCount: params.filter((param) => param.type === "number").length,
        textParamCount: params.filter((param) => param.type === "text").length,
        fileParamCount: params.filter((param) => param.type === "file").length,
        directoryParamCount: params.filter((param) => param.type === "directory").length,
        hasLastValues: Boolean(lastValues),
      },
    })
    try {
      await onConfirm(parsed, values)
    } finally {
      setSubmitting(false)
    }
  }

  const chooseResourcePath = async (param: WorkflowParam) => {
    if (param.type !== "file" && param.type !== "directory") return
    const selectedPath = param.type === "file"
      ? await window.synapse?.workflow.chooseParamFile?.()
      : await window.synapse?.workflow.chooseParamDirectory?.()
    if (!selectedPath) return
    setValues((current) => ({ ...current, [param.name]: selectedPath }))
    if (errors[param.name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[param.name]
        return next
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submitting) onCancel() }}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader><DialogTitle>设置运行参数</DialogTitle></DialogHeader>
          <div className="grid gap-2 py-4">
            {params.length === 0 && <p className="text-sm text-muted-foreground">此工作流无需参数。</p>}
            {params.map((p) => (
              <div key={p.name} className="grid gap-1.5">
                <Label htmlFor={p.name}>{p.description ?? p.name}</Label>
                {p.type === "file" || p.type === "directory" ? (
                  <InputGroup>
                    <InputGroupInput
                      id={p.name}
                      value={values[p.name] ?? ""}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [p.name]: e.target.value }))
                        if (errors[p.name]) setErrors((prev) => { const next = { ...prev }; delete next[p.name]; return next })
                      }}
                      aria-invalid={!!errors[p.name]}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton onClick={() => void chooseResourcePath(p)} aria-label="选择路径">
                        <FolderOpen className="size-3.5" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                ) : (
                  <Input id={p.name} type={p.type === "number" ? "number" : "text"} value={values[p.name] ?? ""} onChange={(e) => {
                    setValues((v) => ({ ...v, [p.name]: e.target.value }))
                    if (errors[p.name]) setErrors((prev) => { const next = { ...prev }; delete next[p.name]; return next })
                  }} aria-invalid={!!errors[p.name]} />
                )}
                {errors[p.name] && <p className="text-xs text-destructive">{errors[p.name]}</p>}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
            <Button type="submit" disabled={submitting}>运行</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
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
