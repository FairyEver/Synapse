import type { SynapseToolDefinition } from "@/types/tools"

export const FALLBACK_TOOL_DEFINITIONS = [
  {
    id: "file-conversion",
    label: "文件转换",
    windowTitle: "文件转换",
    description: "转为 Markdown",
    supportedExtensions: [".docx", ".xlsx", ".pdf", ".pptx"],
    bounds: {
      width: 920,
      height: 680,
      minWidth: 720,
      minHeight: 520,
    },
  },
] as const satisfies readonly SynapseToolDefinition[]
