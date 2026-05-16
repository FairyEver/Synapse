import { createContext, useContext } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
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

export const RunnerNodeResultsContext = createContext<Record<string, NodeRunResult>>({})

export function RunnerPromptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div>
      <Handle type="target" position={Position.Left} />
      <PromptNodeCard
        config={data as PromptNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function RunnerSwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  const branches = (data as { branches?: Array<{ id: string; label: string }> }).branches ?? []
  return (
    <div>
      <Handle type="target" position={Position.Left} />
      <SwitchNodeCard
        config={data as SwitchNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
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
  )
}

export function RunnerEndNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div>
      <Handle type="target" position={Position.Left} />
      <EndNodeCard
        config={data as EndNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
    </div>
  )
}

export function RunnerHttpRequestNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div>
      <Handle type="target" position={Position.Left} />
      <HttpRequestNodeCard
        config={data as HttpRequestNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function RunnerScriptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div>
      <Handle type="target" position={Position.Left} />
      <ScriptNodeCard
        config={data as ScriptNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const runnerNodeTypes = {
  prompt: RunnerPromptNodeWrapper,
  switch: RunnerSwitchNodeWrapper,
  end: RunnerEndNodeWrapper,
  http_request: RunnerHttpRequestNodeWrapper,
  script: RunnerScriptNodeWrapper,
}
