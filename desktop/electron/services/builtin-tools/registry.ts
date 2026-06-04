import { csvToMarkdownTool } from "./tools/csv-to-markdown"
import { docxToMarkdownTool } from "./tools/docx-to-markdown"
import { pdfToMarkdownTool } from "./tools/pdf-to-markdown"
import { pptxToMarkdownTool } from "./tools/pptx-to-markdown"
import { xlsxToMarkdownTool } from "./tools/xlsx-to-markdown"
import type { BuiltinToolDescriptor, BuiltinToolOutputKind, RendererBuiltinToolDescriptor } from "./types"

export interface BuiltinToolRegistry {
  readonly tools: readonly BuiltinToolDescriptor[]
  readonly byId: ReadonlyMap<string, BuiltinToolDescriptor>
}

const DEFAULT_REGISTRY = createBuiltinToolRegistry([
  docxToMarkdownTool,
  xlsxToMarkdownTool,
  csvToMarkdownTool,
  pdfToMarkdownTool,
  pptxToMarkdownTool,
])

export function listBuiltinToolDescriptors(registry: BuiltinToolRegistry = DEFAULT_REGISTRY): readonly BuiltinToolDescriptor[] {
  return registry.tools
}

export function getBuiltinToolDescriptor(toolId: string, registry: BuiltinToolRegistry = DEFAULT_REGISTRY): BuiltinToolDescriptor | null {
  return registry.byId.get(toolId) ?? null
}

export function requireBuiltinToolDescriptor(toolId: string, registry: BuiltinToolRegistry = DEFAULT_REGISTRY): BuiltinToolDescriptor {
  const descriptor = getBuiltinToolDescriptor(toolId, registry)
  if (!descriptor) {
    throw new Error(`Unknown builtin tool: ${toolId}`)
  }
  return descriptor
}

export function listRendererBuiltinToolDescriptors(registry: BuiltinToolRegistry = DEFAULT_REGISTRY): readonly RendererBuiltinToolDescriptor[] {
  return registry.tools.map(projectBuiltinToolDescriptor)
}

export function projectBuiltinToolDescriptor(descriptor: BuiltinToolDescriptor): RendererBuiltinToolDescriptor {
  return {
    id: descriptor.id,
    title: descriptor.title,
    description: descriptor.description,
    category: descriptor.category,
    inputFields: descriptor.ui.fields,
    outputPreview: descriptor.ui.resultPreview,
    input: descriptor.input,
    output: descriptor.output,
  }
}

export function findBuiltinTools(
  query: { readonly inputExtension: string; readonly outputKind: BuiltinToolOutputKind },
  registry: BuiltinToolRegistry = DEFAULT_REGISTRY,
): readonly BuiltinToolDescriptor[] {
  const normalizedExtension = query.inputExtension.toLowerCase()
  return registry.tools.filter((tool) =>
    tool.output.kind === query.outputKind &&
    tool.input.extensions.map((extension) => extension.toLowerCase()).includes(normalizedExtension),
  )
}

export function createBuiltinToolRegistryForTests(tools: readonly BuiltinToolDescriptor[]): BuiltinToolRegistry {
  return createBuiltinToolRegistry(tools)
}

function createBuiltinToolRegistry(tools: readonly BuiltinToolDescriptor[]): BuiltinToolRegistry {
  const byId = new Map<string, BuiltinToolDescriptor>()
  for (const tool of tools) {
    if (byId.has(tool.id)) {
      throw new Error(`Duplicate builtin tool id: ${tool.id}`)
    }
    byId.set(tool.id, tool)
  }
  return { tools: [...tools], byId }
}

