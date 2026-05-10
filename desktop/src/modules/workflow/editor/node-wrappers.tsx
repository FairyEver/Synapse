import { Handle, Position, type NodeProps } from "@xyflow/react"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig } from "../../../../workflow-nodes/switch/schema"

export function PromptNodeWrapper({ data, selected }: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <PromptNodeCard config={data as PromptNodeConfig} selected={selected} />
      <Handle type="source" position={Position.Right} />
    </>
  )
}

export function SwitchNodeWrapper({ data, selected }: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <SwitchNodeCard config={data as SwitchNodeConfig} selected={selected} />
      {(data as { branches?: Array<{ id: string; label: string }> }).branches?.map((b, i, arr) => (
        <Handle key={b.id} type="source" position={Position.Right} id={b.id} style={{ top: `${((i + 0.5) / arr.length) * 100}%` }} />
      ))}
    </>
  )
}

export const nodeTypes = {
  prompt: PromptNodeWrapper,
  switch: SwitchNodeWrapper,
}
