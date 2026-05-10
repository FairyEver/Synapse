import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowParam } from "@/types/workflow"
import type { VariableBinding } from "./schemas/variable-binding"

const OUTPUT_FIELD = "output"

interface VariableBindingEditorProps {
  variables: VariableBinding[]
  onChange: (variables: VariableBinding[]) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function VariableBindingEditor({ variables, onChange, upstreamNodes, workflowParams }: VariableBindingEditorProps) {
  const add = () => onChange([...variables, { name: "", source: { type: "static", value: "" } }])
  const remove = (i: number) => onChange(variables.filter((_, j) => j !== i))
  const update = (i: number, patch: Partial<VariableBinding>) =>
    onChange(variables.map((v, j) => (j === i ? { ...v, ...patch } : v)))

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">变量绑定</Label>
      {variables.map((v, i) => (
        <div key={i} className="border rounded-md p-2 grid gap-1.5">
          <div className="flex items-center gap-1">
            <Input
              className="h-6 text-xs flex-1"
              value={v.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="变量名"
            />
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Select
            value={v.source.type}
            onValueChange={(type) => {
              if (type === "node_output") update(i, { source: { type: "node_output", node: "" } })
              else if (type === "param") update(i, { source: { type: "param", param: "" } })
              else update(i, { source: { type: "static", value: "" } })
            }}
          >
            <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="node_output" className="text-xs">上游节点输出</SelectItem>
                <SelectItem value="param" className="text-xs">工作流参数</SelectItem>
                <SelectItem value="static" className="text-xs">固定值</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {v.source.type === "node_output" && (
            <div className="grid grid-cols-2 gap-1.5">
              <Select
                value={v.source.node}
                onValueChange={(node) => update(i, { source: { type: "node_output", node } })}
              >
                <SelectTrigger className="h-6 text-xs"><SelectValue placeholder="上游节点" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {upstreamNodes.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select value={OUTPUT_FIELD} disabled>
                <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={OUTPUT_FIELD} className="text-xs">输出</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
          {v.source.type === "param" && (
            <Select
              value={v.source.param}
              onValueChange={(param) => update(i, { source: { type: "param", param } })}
            >
              <SelectTrigger className="h-6 text-xs"><SelectValue placeholder="选择参数" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {workflowParams.map((p) => (
                    <SelectItem key={p.name} value={p.name} className="text-xs">{p.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {v.source.type === "static" && (
            <Input
              className="h-6 text-xs"
              value={v.source.value}
              onChange={(e) => update(i, { source: { type: "static", value: e.target.value } })}
              placeholder="固定值"
            />
          )}
        </div>
      ))}
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" />添加变量
      </Button>
    </div>
  )
}
