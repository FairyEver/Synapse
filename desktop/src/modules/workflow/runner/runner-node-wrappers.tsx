import { createContext, useContext } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"
import { EndNodeCard } from "../../../../workflow-nodes/end/card"
import { HttpRequestNodeCard } from "../../../../workflow-nodes/http-request/card"
import { ScriptNodeCard } from "../../../../workflow-nodes/script/card"
import { WorkflowCallNodeCard } from "../../../../workflow-nodes/workflow-call/card"
import { CodexNodeCard } from "../../../../workflow-nodes/codex/card"
import { ClaudeCodeNodeCard } from "../../../../workflow-nodes/claude-code/card"
import { DocumentTemplateNodeCard } from "../../../../app-capabilities/document-template/workflow-node/card"
import { ScreenshotNodeCard } from "../../../../app-capabilities/screenshot/workflow-node/card"
import { SwarmTaskNodeCard } from "../../../../app-capabilities/swarm-task/workflow-node/card"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "../../../../workflow-nodes/switch/constants"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig } from "../../../../workflow-nodes/switch/schema"
import type { EndNodeConfig } from "../../../../workflow-nodes/end/schema"
import type { HttpRequestNodeConfig } from "../../../../workflow-nodes/http-request/schema"
import type { ScriptNodeConfig } from "../../../../workflow-nodes/script/schema"
import type { WorkflowCallNodeConfig } from "../../../../workflow-nodes/workflow-call/schema"
import type { CodexNodeConfig } from "../../../../workflow-nodes/codex/schema"
import type { ClaudeCodeNodeConfig } from "../../../../workflow-nodes/claude-code/schema"
import type { DocumentTemplateNodeConfig } from "../../../../app-capabilities/document-template/workflow-node/schema"
import type { ScreenshotNodeConfig } from "../../../../app-capabilities/screenshot/workflow-node/schema"
import type { SwarmTaskNodeConfig } from "../../../../app-capabilities/swarm-task/workflow-node/schema"
import type { NodeRunResult } from "@/types/workflow"
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { agentConversationTargetFromOutputs } from "@/lib/agent-conversation-target"

export const RunnerNodeResultsContext = createContext<Record<string, NodeRunResult>>({})
export const RunnerOpenAgentConversationContext = createContext<
  ((target: SynapseAgentConversationTarget) => void) | undefined
>(undefined)

function AgentConversationNodeAction({ result }: { result?: NodeRunResult }) {
  const onOpenAgentConversation = useContext(RunnerOpenAgentConversationContext)
  const agentConversation = agentConversationTargetFromOutputs(result?.outputs)
  if (!agentConversation || !onOpenAgentConversation) return null
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            className="absolute -right-3 -top-3 z-10 rounded-full p-1"
            aria-label="打开对话"
            onClick={(event) => {
              event.stopPropagation()
              onOpenAgentConversation(agentConversation)
            }}
          >
            <MessageSquare className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>打开对话</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function RunnerPromptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <PromptNodeCard
        config={data as PromptNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function RunnerSwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  const branches = (data as { branches?: Array<{ id: string; label: string }> }).branches ?? []
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <SwitchNodeCard
        config={data as SwitchNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
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

function RunnerEndNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <EndNodeCard
        config={data as EndNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
    </div>
  )
}

function RunnerHttpRequestNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <HttpRequestNodeCard
        config={data as HttpRequestNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function RunnerScriptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <ScriptNodeCard
        config={data as ScriptNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function RunnerWorkflowCallNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <WorkflowCallNodeCard
        config={data as WorkflowCallNodeConfig}
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

function RunnerCodexNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <CodexNodeCard
        config={data as CodexNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function RunnerClaudeCodeNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <ClaudeCodeNodeCard
        config={data as ClaudeCodeNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function RunnerDocumentTemplateNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <DocumentTemplateNodeCard
        config={data as DocumentTemplateNodeConfig}
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

function RunnerScreenshotNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <ScreenshotNodeCard
        config={data as ScreenshotNodeConfig}
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

function RunnerSwarmTaskNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <SwarmTaskNodeCard
        config={data as SwarmTaskNodeConfig}
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
  workflow_call: RunnerWorkflowCallNodeWrapper,
  codex: RunnerCodexNodeWrapper,
  claude_code: RunnerClaudeCodeNodeWrapper,
  document_template_docx_generate: RunnerDocumentTemplateNodeWrapper,
  screenshot_capture: RunnerScreenshotNodeWrapper,
  swarm_task_run: RunnerSwarmTaskNodeWrapper,
}
