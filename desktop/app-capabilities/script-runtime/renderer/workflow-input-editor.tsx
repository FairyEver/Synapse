import type { WorkflowParam } from "../../../src/types/workflow"
import {
  parseScriptJsonText,
  parseScriptPathText,
  type WorkflowScriptInputBinding,
} from "../shared/input"
import { Button } from "../../../src/components/ui/button"
import { Input } from "../../../src/components/ui/input"
import { Label } from "../../../src/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import { DraftInput } from "./draft-input"

export function WorkflowScriptInputEditor({
  value,
  onChange,
  upstreamNodes,
  workflowParams,
}: {
  readonly value: WorkflowScriptInputBinding[]
  readonly onChange: (value: WorkflowScriptInputBinding[]) => void
  readonly upstreamNodes: readonly { id: string; name: string }[]
  readonly workflowParams: readonly WorkflowParam[]
}) {
  const update = (index: number, binding: WorkflowScriptInputBinding) => {
    onChange(value.map((item, itemIndex) => itemIndex === index ? binding : item))
  }

  return (
    <div className="grid gap-2">
      <Label>输入</Label>
      {value.map((binding, index) => (
        <div key={index} className="grid gap-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <Input
              value={binding.name}
              placeholder="名称"
              onChange={(event) => update(index, { ...binding, name: event.target.value })}
            />
            <Select
              value={binding.source.type}
              onValueChange={(type) => update(index, {
                name: binding.name,
                source: defaultSource(type),
              })}
            >
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="static_json">固定 JSON</SelectItem>
                <SelectItem value="param">工作流参数</SelectItem>
                <SelectItem value="node_output">节点字符串</SelectItem>
                <SelectItem value="node_value">节点结构化值</SelectItem>
                <SelectItem value="secret">密钥</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="删除输入"
              onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          <WorkflowSourceControl
            binding={binding}
            upstreamNodes={upstreamNodes}
            workflowParams={workflowParams}
            onChange={(source) => update(index, { ...binding, source })}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([
          ...value,
          { name: "", source: { type: "static_json", value: null } },
        ])}
      >
        <Plus className="size-4" />
        添加输入
      </Button>
    </div>
  )
}

function WorkflowSourceControl({
  binding,
  upstreamNodes,
  workflowParams,
  onChange,
}: {
  readonly binding: WorkflowScriptInputBinding
  readonly upstreamNodes: readonly { id: string; name: string }[]
  readonly workflowParams: readonly WorkflowParam[]
  readonly onChange: (source: WorkflowScriptInputBinding["source"]) => void
}) {
  const source = binding.source
  if (source.type === "static_json") {
    return (
      <DraftInput
        value={source.value}
        parse={parseScriptJsonText}
        onChange={(value) => onChange({ type: "static_json", value })}
      />
    )
  }
  if (source.type === "param") {
    return (
      <Select value={source.param} onValueChange={(param) => onChange({ type: "param", param })}>
        <SelectTrigger><SelectValue placeholder="选择参数" /></SelectTrigger>
        <SelectContent>
          {workflowParams.map((param) => (
            <SelectItem key={param.name} value={param.name}>{param.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (source.type === "secret") {
    return <Input value={source.name} placeholder="密钥名称" onChange={(event) => onChange({ type: "secret", name: event.target.value })} />
  }
  return (
    <div className="flex items-center gap-2">
      <Select
        value={source.node}
        onValueChange={(node) => onChange({ ...source, node })}
      >
        <SelectTrigger><SelectValue placeholder="选择节点" /></SelectTrigger>
        <SelectContent>
          {upstreamNodes.map((node) => (
            <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {source.type === "node_value" ? (
        <>
          <Input
            className="w-28"
            value={source.output}
            placeholder="输出名"
            onChange={(event) => onChange({ ...source, output: event.target.value })}
          />
          <DraftInput
            value={source.path}
            placeholder="路径 JSON"
            parse={parseScriptPathText}
            onChange={(path) => onChange({ ...source, path })}
          />
        </>
      ) : null}
    </div>
  )
}

function defaultSource(type: string): WorkflowScriptInputBinding["source"] {
  if (type === "param") return { type: "param", param: "" }
  if (type === "node_output") return { type: "node_output", node: "" }
  if (type === "node_value") return { type: "node_value", node: "", output: "result", path: [] }
  if (type === "secret") return { type: "secret", name: "" }
  return { type: "static_json", value: null }
}
