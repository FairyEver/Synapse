import type { SynapseToolDefinition, SynapseToolId } from "../../../src/types/tools"

const TOOL_DEFINITIONS = [
  {
    id: "file-conversion",
    label: "文件转换",
    windowTitle: "文件转换",
    description: "转为 Markdown",
    supportedExtensions: [".docx", ".xlsx", ".pdf", ".pptx"],
    bounds: {
      width: 760,
      height: 560,
      minWidth: 560,
      minHeight: 420,
    },
  },
] as const satisfies readonly SynapseToolDefinition[]

export function listToolDefinitions(): readonly SynapseToolDefinition[] {
  return TOOL_DEFINITIONS
}

export function getToolDefinition(toolId: string): SynapseToolDefinition | null {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId) ?? null
}

export function requireToolDefinition(toolId: string): SynapseToolDefinition {
  const tool = getToolDefinition(toolId)
  if (!tool) {
    throw new Error(`Unknown tool: ${toolId}`)
  }
  return tool
}

export function isSynapseToolId(toolId: string): toolId is SynapseToolId {
  return getToolDefinition(toolId) !== null
}
