import { Handle, Position, type NodeProps } from "@xyflow/react"
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

export function TextNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="text">
      <div>
        <Handle type="target" position={Position.Left} />
        <TextNodeCard config={data as TextNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function PromptNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="prompt">
      <div>
        <Handle type="target" position={Position.Left} />
        <PromptNodeCard config={data as PromptNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function SwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  const branches = (data as { branches?: Array<{ id: string; label: string }> }).branches ?? []
  return (
    <NodeContextMenu nodeId={id} nodeType="switch">
      <div>
        <Handle type="target" position={Position.Left} />
        <SwitchNodeCard config={data as SwitchNodeConfig} name={name} selected={selected} nodeId={id} />
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
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="end">
      <div>
        <Handle type="target" position={Position.Left} />
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
        <Handle type="target" position={Position.Left} />
        <HttpRequestNodeCard config={data as HttpRequestNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function ScriptNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="script">
      <div>
        <Handle type="target" position={Position.Left} />
        <ScriptNodeCard config={data as ScriptNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function WorkflowCallNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="workflow_call">
      <div>
        <Handle type="target" position={Position.Left} />
        <WorkflowCallNodeCard config={data as WorkflowCallNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function CodexNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="codex">
      <div>
        <Handle type="target" position={Position.Left} />
        <CodexNodeCard config={data as CodexNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function ClaudeCodeNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="claude_code">
      <div>
        <Handle type="target" position={Position.Left} />
        <ClaudeCodeNodeCard config={data as ClaudeCodeNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function FileOpenerNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="file_opener_file_open">
      <div>
        <Handle type="target" position={Position.Left} />
        <FileOpenerNodeCard config={data as FileOpenerNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function DocumentTemplateNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="document_template_docx_generate">
      <div>
        <Handle type="target" position={Position.Left} />
        <DocumentTemplateNodeCard config={data as DocumentTemplateNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function TextExtractNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="text_extract">
      <div>
        <Handle type="target" position={Position.Left} />
        <TextExtractNodeCard
          config={data as TextExtractNodeConfig}
          name={name}
          selected={selected}
          nodeId={id}
        />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export function TextFileWriterNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="text_file_writer_file_write">
      <div>
        <Handle type="target" position={Position.Left} />
        <TextFileWriterNodeCard config={data as TextFileWriterNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
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
}
