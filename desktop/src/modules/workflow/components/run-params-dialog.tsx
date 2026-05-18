import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { track } from "@/lib/ui-tracking"
import type { WorkflowParam } from "@/types/workflow"

interface RunParamsDialogProps {
  open: boolean
  params: WorkflowParam[]
  lastValues?: Record<string, string>
  onConfirm: (values: Record<string, unknown>, rawValues: Record<string, string>) => Promise<void>
  onCancel: () => void
}

export function RunParamsDialog({ open, params, lastValues, onConfirm, onCancel }: RunParamsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.name, String(p.default ?? "")])))
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setSubmitting(false)
      // Pre-fill with last-submitted values when available; fall back to defaults
      setValues(Object.fromEntries(params.map((p) => [
        p.name,
        lastValues?.[p.name] ?? String(p.default ?? ""),
      ])))
    }
  }, [open, params, lastValues])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (submitting) return
    setSubmitting(true)
    const parsed: Record<string, unknown> = {}
    for (const p of params) {
      if (p.type === "number") {
        const raw = values[p.name]
        const num = Number(raw)
        parsed[p.name] = raw === "" || Number.isNaN(num) ? (p.default ?? 0) : num
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
        hasLastValues: Boolean(lastValues),
      },
    })
    try {
      await onConfirm(parsed, values)
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submitting) onCancel() }}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader><DialogTitle>设置运行参数</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            {params.length === 0 && <p className="text-sm text-muted-foreground">此工作流无需参数。</p>}
            {params.map((p) => (
              <div key={p.name} className="grid gap-1.5">
                <Label htmlFor={p.name}>{p.description ?? p.name}</Label>
                <Input id={p.name} type={p.type === "number" ? "number" : "text"} value={values[p.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} />
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
