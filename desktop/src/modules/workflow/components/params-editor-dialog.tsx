import { useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowParam } from "@/types/workflow"

interface ParamsEditorDialogProps {
  open: boolean
  params: WorkflowParam[]
  onChange: (params: WorkflowParam[]) => void
  onClose: () => void
}

export function ParamsEditorDialog({ open, params, onChange, onClose }: ParamsEditorDialogProps) {
  const [draft, setDraft] = useState<WorkflowParam[]>(params)

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
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>编辑工作流参数</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-96 overflow-auto">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无参数。</p>
          )}
          {draft.map((p, i) => (
            <div key={i} className="grid gap-2 border rounded-md p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="grid gap-1 flex-1">
                  <Label className="text-xs">参数名</Label>
                  <Input
                    className="h-7 text-xs"
                    value={p.name}
                    onChange={(e) => updateParam(i, { name: e.target.value })}
                    placeholder="param_name"
                  />
                </div>
                <div className="grid gap-1 w-24">
                  <Label className="text-xs">类型</Label>
                  <Select value={p.type} onValueChange={(v) => updateParam(i, { type: v as WorkflowParam["type"] })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text" className="text-xs">文本</SelectItem>
                      <SelectItem value="number" className="text-xs">数字</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 self-end"
                  onClick={() => removeParam(i)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">默认值</Label>
                <Input
                  className="h-7 text-xs"
                  type={p.type === "number" ? "number" : "text"}
                  value={p.default ?? ""}
                  onChange={(e) => updateParam(i, { default: e.target.value === "" ? null : (p.type === "number" ? Number(e.target.value) : e.target.value) })}
                  placeholder="可选"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">描述</Label>
                <Input
                  className="h-7 text-xs"
                  value={p.description ?? ""}
                  onChange={(e) => updateParam(i, { description: e.target.value || undefined })}
                  placeholder="可选"
                />
              </div>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addParam}>
            <Plus className="h-3 w-3 mr-1" />添加参数
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
