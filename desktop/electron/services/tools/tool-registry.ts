import type { SynapseToolDefinition, SynapseToolId } from "../../../src/types/tools"
import { listRendererBuiltinToolDescriptors } from "../builtin-tools/registry"

const DEFAULT_BOUNDS = {
  width: 760,
  height: 560,
  minWidth: 560,
  minHeight: 420,
} as const

export type SynapseToolWindowDefinition = SynapseToolDefinition & {
  readonly windowTitle: string
  readonly bounds: typeof DEFAULT_BOUNDS
}

export function listToolDefinitions(): readonly SynapseToolDefinition[] {
  return listRendererBuiltinToolDescriptors() as readonly SynapseToolDefinition[]
}

export function getToolDefinition(toolId: string): SynapseToolWindowDefinition | null {
  const tool = listToolDefinitions().find((definition) => definition.id === toolId)
  if (!tool) return null
  return { ...tool, windowTitle: tool.title, bounds: DEFAULT_BOUNDS }
}

export function requireToolDefinition(toolId: string): SynapseToolWindowDefinition {
  const tool = getToolDefinition(toolId)
  if (!tool) {
    throw new Error(`Unknown tool: ${toolId}`)
  }
  return tool
}

export function isSynapseToolId(toolId: string): toolId is SynapseToolId {
  return getToolDefinition(toolId) !== null
}
