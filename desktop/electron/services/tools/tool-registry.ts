import type { SynapseToolDefinition, SynapseToolId } from "../../../src/types/tools"
import type { BuiltinToolWindowBounds, BuiltinToolWindowDescriptor } from "../builtin-tools/types"
import { listBuiltinToolDescriptors, listRendererBuiltinToolDescriptors } from "../builtin-tools/registry"

const DEFAULT_BOUNDS = {
  width: 760,
  height: 560,
  minWidth: 560,
  minHeight: 420,
} as const

export type SynapseToolWindowDefinition = SynapseToolDefinition & {
  readonly windowTitle: string
  readonly bounds: BuiltinToolWindowBounds
}

export function listToolDefinitions(): readonly SynapseToolDefinition[] {
  return listRendererBuiltinToolDescriptors() as readonly SynapseToolDefinition[]
}

export function getToolDefinition(toolId: string): SynapseToolWindowDefinition | null {
  const tool = listToolDefinitions().find((definition) => definition.id === toolId)
  if (!tool) return null
  const builtinTool = listBuiltinToolDescriptors().find((definition) => definition.id === tool.id)
  return {
    ...tool,
    windowTitle: tool.title,
    bounds: resolveToolWindowBounds(builtinTool ?? {}),
  }
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

export function resolveToolWindowBounds(tool: { readonly window?: BuiltinToolWindowDescriptor }): BuiltinToolWindowBounds {
  return { ...DEFAULT_BOUNDS, ...tool.window?.bounds }
}
