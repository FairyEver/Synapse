import type { SynapseToolDefinition } from "@/types/tools"

export const FALLBACK_TOOL_DEFINITIONS = [
  {
    id: "docx-to-markdown",
    title: "DOCX 转 Markdown",
    description: "转换一个 DOCX 文件",
    category: "conversion",
    inputFields: [{ id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] }],
    outputPreview: { kind: "markdown", pathFromOutput: "outputPath" },
    input: { kind: "file", extensions: [".docx"] },
    output: { kind: "markdown" },
  },
] as const satisfies readonly SynapseToolDefinition[]
