import { Handle, type NodeProps } from "@xyflow/react"
import { NodeContextMenu } from "./node-context-menu"
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
import {
  useWorkflowHandlePositions,
  useWorkflowLayoutDirection,
} from "../workflow-layout-direction-context"
import {
  resolveSwitchBranchHandlePercent,
  resolveSwitchNodeWidth,
} from "@/lib/workflow-layout-direction"

function WorkflowTargetHandle() {
  const { target } = useWorkflowHandlePositions()
  return <Handle type="target" position={target} />
}

function WorkflowSourceHandle() {
  const { source } = useWorkflowHandlePositions()
  return <Handle type="source" position={source} />
}

export function TextNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="text">
      <div>
        <WorkflowTargetHandle />
        <TextNodeCard config={data as TextNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function PromptNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="prompt">
      <div>
        <WorkflowTargetHandle />
        <PromptNodeCard config={data as PromptNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function SwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  const branches = (data as { branches?: Array<{ id: string; label: string }> }).branches ?? []
  const layoutDirection = useWorkflowLayoutDirection()
  const { source } = useWorkflowHandlePositions()
  const width = layoutDirection === "vertical"
    ? resolveSwitchNodeWidth(layoutDirection, branches.length)
    : undefined
  return (
    <NodeContextMenu nodeId={id} nodeType="switch">
      <div>
        <WorkflowTargetHandle />
        <SwitchNodeCard
          config={data as SwitchNodeConfig}
          name={name}
          selected={selected}
          nodeId={id}
          width={width}
        />
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
    </NodeContextMenu>
  )
}

export function EndNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="end">
      <div>
        <WorkflowTargetHandle />
        <EndNodeCard config={data as EndNodeConfig} name={name} selected={selected} nodeId={id} />
      </div>
    </NodeContextMenu>
  )
}

export function HttpRequestNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="http_request">
      <div>
        <WorkflowTargetHandle />
        <HttpRequestNodeCard config={data as HttpRequestNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function ScriptNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="script">
      <div>
        <WorkflowTargetHandle />
        <ScriptNodeCard config={data as ScriptNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function WorkflowCallNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="workflow_call">
      <div>
        <WorkflowTargetHandle />
        <WorkflowCallNodeCard config={data as WorkflowCallNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function CodexNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="codex">
      <div>
        <WorkflowTargetHandle />
        <CodexNodeCard config={data as CodexNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function ClaudeCodeNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="claude_code">
      <div>
        <WorkflowTargetHandle />
        <ClaudeCodeNodeCard config={data as ClaudeCodeNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function FileOpenerNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="file_opener_file_open">
      <div>
        <WorkflowTargetHandle />
        <FileOpenerNodeCard config={data as FileOpenerNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function DocumentTemplateNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="document_template_docx_generate">
      <div>
        <WorkflowTargetHandle />
        <DocumentTemplateNodeCard config={data as DocumentTemplateNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function TextExtractNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="text_extract">
      <div>
        <WorkflowTargetHandle />
        <TextExtractNodeCard
          config={data as TextExtractNodeConfig}
          name={name}
          selected={selected}
          nodeId={id}
        />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function TextFileWriterNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="text_file_writer_file_write">
      <div>
        <WorkflowTargetHandle />
        <TextFileWriterNodeCard config={data as TextFileWriterNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function HtmlGeneratorEjsNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="html_generator_ejs_generate">
      <div>
        <WorkflowTargetHandle />
        <HtmlGeneratorEjsNodeCard config={data as HtmlGeneratorEjsNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function HtmlGeneratorEjsFileNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="html_generator_ejs_file_generate">
      <div>
        <WorkflowTargetHandle />
        <HtmlGeneratorEjsFileNodeCard config={data as HtmlGeneratorEjsFileNodeConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function SystemNotifierNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="system_notifier_notification_trigger">
      <div>
        <WorkflowTargetHandle />
        <SystemNotifierNodeCard
          config={data as SystemNotifierNodeConfig}
          name={name}
          selected={selected}
          nodeId={id}
        />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function JsonRepairNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="json_repair_text_repair">
      <div>
        <WorkflowTargetHandle />
        <JsonRepairNodeCard
          config={data as JsonRepairNodeConfig}
          name={name}
          selected={selected}
          nodeId={id}
        />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function JavascriptRunNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="javascript_run">
      <div>
        <WorkflowTargetHandle />
        <JavascriptRunNodeCard config={data as JavascriptWorkflowConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function NodejsRunNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="nodejs_run">
      <div>
        <WorkflowTargetHandle />
        <NodejsRunNodeCard config={data as NodejsWorkflowConfig} name={name} selected={selected} nodeId={id} />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function ClipboardTextWriteNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="clipboard_text_write">
      <div>
        <WorkflowTargetHandle />
        <ClipboardNodeCard
          manifest={clipboardTextWriteNodeManifest}
          name={name}
          selected={selected}
          nodeId={id}
        />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export function ClipboardTextReadNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="clipboard_text_read">
      <div>
        <WorkflowTargetHandle />
        <ClipboardNodeCard
          manifest={clipboardTextReadNodeManifest}
          name={name}
          selected={selected}
          nodeId={id}
        />
        <WorkflowSourceHandle />
      </div>
    </NodeContextMenu>
  )
}

export const nodeTypes = {
  text: TextNodeWrapper,
  prompt: PromptNodeWrapper,
  switch: SwitchNodeWrapper,
  end: EndNodeWrapper,
  http_request: HttpRequestNodeWrapper,
  script: ScriptNodeWrapper,
  workflow_call: WorkflowCallNodeWrapper,
  codex: CodexNodeWrapper,
  claude_code: ClaudeCodeNodeWrapper,
  file_opener_file_open: FileOpenerNodeWrapper,
  document_template_docx_generate: DocumentTemplateNodeWrapper,
  text_extract: TextExtractNodeWrapper,
  text_file_writer_file_write: TextFileWriterNodeWrapper,
  html_generator_ejs_generate: HtmlGeneratorEjsNodeWrapper,
  html_generator_ejs_file_generate: HtmlGeneratorEjsFileNodeWrapper,
  system_notifier_notification_trigger: SystemNotifierNodeWrapper,
  json_repair_text_repair: JsonRepairNodeWrapper,
  javascript_run: JavascriptRunNodeWrapper,
  nodejs_run: NodejsRunNodeWrapper,
  clipboard_text_write: ClipboardTextWriteNodeWrapper,
  clipboard_text_read: ClipboardTextReadNodeWrapper,
}
