import { createContext, useContext } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { NodeContextMenu } from "./node-context-menu"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"
import { EndNodeCard } from "../../../../workflow-nodes/end/card"
import { HttpRequestNodeCard } from "../../../../workflow-nodes/http-request/card"
import { ScriptNodeCard } from "../../../../workflow-nodes/script/card"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "../../../../workflow-nodes/switch/constants"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig } from "../../../../workflow-nodes/switch/schema"
import type { EndNodeConfig } from "../../../../workflow-nodes/end/schema"
import type { HttpRequestNodeConfig } from "../../../../workflow-nodes/http-request/schema"
import type { ScriptNodeConfig } from "../../../../workflow-nodes/script/schema"
import type { NodeRunResult } from "@/types/workflow"

export const NodeResultsContext = createContext<Record<string, NodeRunResult>>({})

export function PromptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="prompt">
      <div>
        <Handle type="target" position={Position.Left} />
        <PromptNodeCard config={data as PromptNodeConfig} name={name} selected={selected} status={status} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function SwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  const branches = (data as { branches?: Array<{ id: string; label: string }> }).branches ?? []
  return (
    <NodeContextMenu nodeId={id} nodeType="switch">
      <div>
        <Handle type="target" position={Position.Left} />
        <SwitchNodeCard config={data as SwitchNodeConfig} name={name} selected={selected} status={status} />
        {branches.map((b, i) => (
          <Handle
            key={b.id}
            type="source"
            position={Position.Right}
            id={b.id}
            style={{ top: `${SWITCH_HEADER_H + (i + 0.5) * SWITCH_BRANCH_H}px` }}
          />
        ))}
      </div>
    </NodeContextMenu>
  )
}

export function EndNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="end">
      <div>
        <Handle type="target" position={Position.Left} />
        <EndNodeCard config={data as EndNodeConfig} name={name} selected={selected} status={status} />
      </div>
    </NodeContextMenu>
  )
}

export function HttpRequestNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="http_request">
      <div>
        <Handle type="target" position={Position.Left} />
        <HttpRequestNodeCard config={data as HttpRequestNodeConfig} name={name} selected={selected} status={status} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function ScriptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="script">
      <div>
        <Handle type="target" position={Position.Left} />
        <ScriptNodeCard config={data as ScriptNodeConfig} name={name} selected={selected} status={status} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export const nodeTypes = {
  prompt: PromptNodeWrapper,
  switch: SwitchNodeWrapper,
  end: EndNodeWrapper,
  http_request: HttpRequestNodeWrapper,
  script: ScriptNodeWrapper,
}
