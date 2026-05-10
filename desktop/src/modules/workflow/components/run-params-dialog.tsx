import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { WorkflowParam } from "@/types/workflow"

interface RunParamsDialogProps { open: boolean; params: WorkflowParam[]; onConfirm: (values: Record<string, unknown>) => void; onCancel: () => void }

export function RunParamsDialog({ open, params, onConfirm, onCancel }: RunParamsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.name, String(p.default ?? "")])))

  useEffect(() => {
    if (open) setValues(Object.fromEntries(params.map((p) => [p.name, String(p.default ?? "")])))
  }, [open, params])

  const handleSubmit = () => {
    const parsed: Record<string, unknown> = {}
    for (const p of params) parsed[p.name] = p.type === "number" ? Number(values[p.name]) : values[p.name]
    onConfirm(parsed)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
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
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button onClick={handleSubmit}>运行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
