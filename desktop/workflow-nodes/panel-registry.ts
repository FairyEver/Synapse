import type { ComponentType } from "react"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"
import { TextNodePanel } from "./text/panel"
import { PromptNodePanel } from "./prompt/panel"
import { SwitchNodePanel } from "./switch/panel"
import { EndNodePanel } from "./end/panel"
import { HttpRequestNodePanel } from "./http-request/panel"
import { ScriptNodePanel } from "./script/panel"
import { WorkflowCallNodePanel } from "./workflow-call/panel"
import { CodexNodePanel } from "./codex/panel"
import { ClaudeCodeNodePanel } from "./claude-code/panel"
import { FileOpenerNodePanel } from "../app-capabilities/file-opener/workflow-node/panel"
import { DocumentTemplateNodePanel } from "../app-capabilities/document-template/workflow-node/panel"
import { TextExtractNodePanel } from "../app-capabilities/text-extractor/workflow-node/panel"

export interface NodePanelProps {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
  defaultNodeTimeoutMins?: number
  validationItems?: readonly WorkflowValidationDisplayItem[]
  currentWorkflowId?: string
}

type PanelComponent = ComponentType<NodePanelProps>

// Renderer-side panel registry: maps node type string → config panel component.
// Cast is required because each panel uses a narrower config type; the cast is
// safe because node.config is always passed as Record<string, unknown> at the call site.
const panelRegistry = new Map<string, PanelComponent>([
  ["text", TextNodePanel as unknown as PanelComponent],
  ["prompt", PromptNodePanel as unknown as PanelComponent],
  ["switch", SwitchNodePanel as unknown as PanelComponent],
  ["end", EndNodePanel as unknown as PanelComponent],
  ["http_request", HttpRequestNodePanel as unknown as PanelComponent],
  ["script", ScriptNodePanel as unknown as PanelComponent],
  ["workflow_call", WorkflowCallNodePanel as unknown as PanelComponent],
  ["codex", CodexNodePanel as unknown as PanelComponent],
  ["claude_code", ClaudeCodeNodePanel as unknown as PanelComponent],
  ["file_opener_file_open", FileOpenerNodePanel as unknown as PanelComponent],
  ["document_template_docx_generate", DocumentTemplateNodePanel as unknown as PanelComponent],
  ["text_extract", TextExtractNodePanel as unknown as PanelComponent],
])

export function getPanel(type: string): PanelComponent | undefined {
  return panelRegistry.get(type)
}
