import type { SynapseToolDefinition } from "@/types/tools"

export const FALLBACK_TOOL_DEFINITIONS = [
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
