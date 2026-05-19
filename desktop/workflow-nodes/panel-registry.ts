import type { ComponentType } from "react"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"
import { PromptNodePanel } from "./prompt/panel"
import { SwitchNodePanel } from "./switch/panel"
import { EndNodePanel } from "./end/panel"
import { HttpRequestNodePanel } from "./http-request/panel"
import { ScriptNodePanel } from "./script/panel"

export interface NodePanelProps {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
  validationItems?: readonly WorkflowValidationDisplayItem[]
}

type PanelComponent = ComponentType<NodePanelProps>

// Renderer-side panel registry: maps node type string → config panel component.
// Cast is required because each panel uses a narrower config type; the cast is
// safe because node.config is always passed as Record<string, unknown> at the call site.
const panelRegistry = new Map<string, PanelComponent>([
  ["prompt", PromptNodePanel as unknown as PanelComponent],
  ["switch", SwitchNodePanel as unknown as PanelComponent],
  ["end", EndNodePanel as unknown as PanelComponent],
  ["http_request", HttpRequestNodePanel as unknown as PanelComponent],
  ["script", ScriptNodePanel as unknown as PanelComponent],
])

export function getPanel(type: string): PanelComponent | undefined {
  return panelRegistry.get(type)
}
