import { createContext, useContext } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"
import { EndNodeCard } from "../../../../workflow-nodes/end/card"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig } from "../../../../workflow-nodes/switch/schema"
import type { EndNodeConfig } from "../../../../workflow-nodes/end/schema"
import type { NodeRunResult } from "@/types/workflow"

export const NodeResultsContext = createContext<Record<string, NodeRunResult>>({})

export function PromptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <PromptNodeCard config={data as PromptNodeConfig} name={name} selected={selected} status={status} />
      <Handle type="source" position={Position.Right} />
    </>
  )
}

export function SwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <SwitchNodeCard config={data as SwitchNodeConfig} name={name} selected={selected} status={status} />
      {(data as { branches?: Array<{ id: string; label: string }> }).branches?.map((b, i, arr) => (
        <Handle key={b.id} type="source" position={Position.Right} id={b.id} style={{ top: `${((i + 0.5) / arr.length) * 100}%` }} />
      ))}
    </>
  )
}

export function EndNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <EndNodeCard config={data as EndNodeConfig} name={name} selected={selected} status={status} />
    </>
  )
}

export const nodeTypes = {
  prompt: PromptNodeWrapper,
  switch: SwitchNodeWrapper,
  end: EndNodeWrapper,
}
