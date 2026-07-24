import { createContext, useContext } from "react"
import { Handle, type NodeProps } from "@xyflow/react"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TextNodeCard } from "../../../../workflow-nodes/text/card"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"
import { EndNodeCard } from "../../../../workflow-nodes/end/card"
import { HttpRequestNodeCard } from "../../../../workflow-nodes/http-request/card"
import { ScriptNodeCard } from "../../../../workflow-nodes/script/card"
import { WorkflowCallNodeCard } from "../../../../workflow-nodes/workflow-call/card"
import { CodexNodeCard } from "../../../../workflow-nodes/codex/card"
import { ClaudeCodeNodeCard } from "../../../../workflow-nodes/claude-code/card"
import { FileOpenerNodeCard } from "../../../../app-capabilities/file-opener/workflow-node/card"
import { DocumentTemplateNodeCard } from "../../../../app-capabilities/document-template/workflow-node/card"
import { TextExtractNodeCard } from "../../../../app-capabilities/text-extractor/workflow-node/card"
import { TextFileWriterNodeCard } from "../../../../app-capabilities/text-file-writer/workflow-node/card"
import { HtmlGeneratorEjsFileNodeCard, HtmlGeneratorEjsNodeCard } from "../../../../app-capabilities/html-generator/workflow-node/card"
import { SystemNotifierNodeCard } from "../../../../app-capabilities/system-notifier/workflow-node/card"
import { JsonRepairNodeCard } from "../../../../app-capabilities/json-repair/workflow-node/card"
import { JavascriptRunNodeCard } from "../../../../app-capabilities/javascript-run/workflow-node/card"
import { NodejsRunNodeCard } from "../../../../app-capabilities/nodejs-run/workflow-node/card"
import { ClipboardNodeCard } from "../../../../app-capabilities/clipboard/workflow-node/card"
import {
  clipboardTextReadNodeManifest,
  clipboardTextWriteNodeManifest,
} from "../../../../app-capabilities/clipboard/workflow-node/manifest"
import type { LucideIcon } from "lucide-react"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "../../../../workflow-nodes/switch/constants"
import type { TextNodeConfig } from "../../../../workflow-nodes/text/schema"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig } from "../../../../workflow-nodes/switch/schema"
import type { EndNodeConfig } from "../../../../workflow-nodes/end/schema"
import type { HttpRequestNodeConfig } from "../../../../workflow-nodes/http-request/schema"
import type { ScriptNodeConfig } from "../../../../workflow-nodes/script/schema"
import type { WorkflowCallNodeConfig } from "../../../../workflow-nodes/workflow-call/schema"
import type { CodexNodeConfig } from "../../../../workflow-nodes/codex/schema"
import type { ClaudeCodeNodeConfig } from "../../../../workflow-nodes/claude-code/schema"
import type { FileOpenerNodeConfig } from "../../../../app-capabilities/file-opener/workflow-node/schema"
import type { DocumentTemplateNodeConfig } from "../../../../app-capabilities/document-template/workflow-node/schema"
import type { TextExtractNodeConfig } from "../../../../app-capabilities/text-extractor/workflow-node/schema"
import type { TextFileWriterNodeConfig } from "../../../../app-capabilities/text-file-writer/workflow-node/schema"
import type { HtmlGeneratorEjsFileNodeConfig, HtmlGeneratorEjsNodeConfig } from "../../../../app-capabilities/html-generator/workflow-node/schema"
import type { SystemNotifierNodeConfig } from "../../../../app-capabilities/system-notifier/workflow-node/schema"
import type { JsonRepairNodeConfig } from "../../../../app-capabilities/json-repair/workflow-node/schema"
import type { JavascriptWorkflowConfig, NodejsWorkflowConfig } from "../../../../app-capabilities/script-runtime/shared/schema"
import type { NodeRunResult } from "@/types/workflow"
import type { SynapseAgentConversationReference } from "@/types/agent-navigation"
import { agentConversationTargetFromOutputs } from "@/lib/agent-conversation-target"
import {
  useWorkflowHandlePositions,
  useWorkflowLayoutDirection,
} from "../workflow-layout-direction-context"
import {
  resolveSwitchBranchHandlePercent,
  resolveSwitchNodeWidth,
} from "@/lib/workflow-layout-direction"

export const RunnerNodeResultsContext = createContext<Record<string, NodeRunResult>>({})
export const RunnerOpenAgentConversationContext = createContext<
  ((target: SynapseAgentConversationReference) => void) | undefined
>(undefined)

function WorkflowTargetHandle() {
  const { target } = useWorkflowHandlePositions()
  return <Handle type="target" position={target} />
}

function WorkflowSourceHandle() {
  const { source } = useWorkflowHandlePositions()
  return <Handle type="source" position={source} />
}

function RunnerTextNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <TextNodeCard
        config={data as TextNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

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
      <WorkflowTargetHandle />
      <PromptNodeCard
        config={data as PromptNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerSwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  const branches = (data as { branches?: Array<{ id: string; label: string }> }).branches ?? []
  const layoutDirection = useWorkflowLayoutDirection()
  const { source } = useWorkflowHandlePositions()
  const width = layoutDirection === "vertical"
    ? resolveSwitchNodeWidth(layoutDirection, branches.length)
    : undefined
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <SwitchNodeCard
        config={data as SwitchNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
        width={width}
      />
      <AgentConversationNodeAction result={result} />
      {branches.map((b, i) => (
        <Handle
          key={b.id}
          type="source"
          position={source}
          id={b.id}
          style={layoutDirection === "vertical"
            ? { left: `${resolveSwitchBranchHandlePercent(i, branches.length)}%` }
            : { top: `${SWITCH_HEADER_H + (i + 0.5) * SWITCH_BRANCH_H}px` }}
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
      <WorkflowTargetHandle />
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
      <WorkflowTargetHandle />
      <HttpRequestNodeCard
        config={data as HttpRequestNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerScriptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <ScriptNodeCard
        config={data as ScriptNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerWorkflowCallNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <WorkflowCallNodeCard
        config={data as WorkflowCallNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerCodexNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <CodexNodeCard
        config={data as CodexNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerClaudeCodeNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <ClaudeCodeNodeCard
        config={data as ClaudeCodeNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <AgentConversationNodeAction result={result} />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerDocumentTemplateNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <DocumentTemplateNodeCard
        config={data as DocumentTemplateNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerTextExtractNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <TextExtractNodeCard
        config={data as TextExtractNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerFileOpenerNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <FileOpenerNodeCard
        config={data as FileOpenerNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerTextFileWriterNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <TextFileWriterNodeCard
        config={data as TextFileWriterNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerHtmlGeneratorEjsNodeWrapper({ id, data, selected }: NodeProps) {
  const result = useContext(RunnerNodeResultsContext)[id]
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <HtmlGeneratorEjsNodeCard
        config={data as HtmlGeneratorEjsNodeConfig}
        name={(data as { name?: string }).name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerHtmlGeneratorEjsFileNodeWrapper({ id, data, selected }: NodeProps) {
  const result = useContext(RunnerNodeResultsContext)[id]
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <HtmlGeneratorEjsFileNodeCard
        config={data as HtmlGeneratorEjsFileNodeConfig}
        name={(data as { name?: string }).name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerSystemNotifierNodeWrapper({ id, data, selected }: NodeProps) {
  const result = useContext(RunnerNodeResultsContext)[id]
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <SystemNotifierNodeCard
        config={data as SystemNotifierNodeConfig}
        name={(data as { name?: string }).name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerJsonRepairNodeWrapper({ id, data, selected }: NodeProps) {
  const result = useContext(RunnerNodeResultsContext)[id]
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <JsonRepairNodeCard
        config={data as JsonRepairNodeConfig}
        name={(data as { name?: string }).name}
        selected={selected}
        status={result?.status}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerJavascriptRunNodeWrapper({ id, data, selected }: NodeProps) {
  const result = useContext(RunnerNodeResultsContext)[id]
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <JavascriptRunNodeCard
        config={data as JavascriptWorkflowConfig}
        name={(data as { name?: string }).name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerNodejsRunNodeWrapper({ id, data, selected }: NodeProps) {
  const result = useContext(RunnerNodeResultsContext)[id]
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <NodejsRunNodeCard
        config={data as NodejsWorkflowConfig}
        name={(data as { name?: string }).name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerClipboardNodeWrapper({
  id,
  data,
  selected,
  manifest,
}: NodeProps & { manifest: { readonly title: string; readonly icon: LucideIcon } }) {
  const result = useContext(RunnerNodeResultsContext)[id]
  return (
    <div className="relative">
      <WorkflowTargetHandle />
      <ClipboardNodeCard
        manifest={manifest}
        name={(data as { name?: string }).name}
        selected={selected}
        status={result?.status}
        startedAt={result?.startedAt}
      />
      <WorkflowSourceHandle />
    </div>
  )
}

function RunnerClipboardTextWriteNodeWrapper(props: NodeProps) {
  return <RunnerClipboardNodeWrapper {...props} manifest={clipboardTextWriteNodeManifest} />
}

function RunnerClipboardTextReadNodeWrapper(props: NodeProps) {
  return <RunnerClipboardNodeWrapper {...props} manifest={clipboardTextReadNodeManifest} />
}

export const runnerNodeTypes = {
  text: RunnerTextNodeWrapper,
  prompt: RunnerPromptNodeWrapper,
  switch: RunnerSwitchNodeWrapper,
  end: RunnerEndNodeWrapper,
  http_request: RunnerHttpRequestNodeWrapper,
  script: RunnerScriptNodeWrapper,
  workflow_call: RunnerWorkflowCallNodeWrapper,
  codex: RunnerCodexNodeWrapper,
  claude_code: RunnerClaudeCodeNodeWrapper,
  document_template_docx_generate: RunnerDocumentTemplateNodeWrapper,
  text_extract: RunnerTextExtractNodeWrapper,
  file_opener_file_open: RunnerFileOpenerNodeWrapper,
  text_file_writer_file_write: RunnerTextFileWriterNodeWrapper,
  html_generator_ejs_generate: RunnerHtmlGeneratorEjsNodeWrapper,
  html_generator_ejs_file_generate: RunnerHtmlGeneratorEjsFileNodeWrapper,
  system_notifier_notification_trigger: RunnerSystemNotifierNodeWrapper,
  json_repair_text_repair: RunnerJsonRepairNodeWrapper,
  javascript_run: RunnerJavascriptRunNodeWrapper,
  nodejs_run: RunnerNodejsRunNodeWrapper,
  clipboard_text_write: RunnerClipboardTextWriteNodeWrapper,
  clipboard_text_read: RunnerClipboardTextReadNodeWrapper,
}
