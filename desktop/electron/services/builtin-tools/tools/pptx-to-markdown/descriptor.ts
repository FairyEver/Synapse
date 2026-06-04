import type { BuiltinToolDescriptor } from "../../types"
import { executePptxToMarkdown } from "./executor"
import { pptxToMarkdownInputSchema, pptxToMarkdownOutputSchema, type PptxToMarkdownInput, type PptxToMarkdownOutput } from "./schema"

export const pptxToMarkdownTool: BuiltinToolDescriptor<PptxToMarkdownInput, PptxToMarkdownOutput> = {
  id: "pptx-to-markdown",
  title: "PPTX 转 Markdown",
  description: "转换一个 PPTX 文件",
  category: "conversion",
  inputSchema: pptxToMarkdownInputSchema,
  outputSchema: pptxToMarkdownOutputSchema,
  ui: {
    fields: [
      { id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".pptx"] },
      {
        id: "outputMode",
        kind: "select",
        label: "输出",
        required: true,
        defaultValue: "write-file",
        options: [
          { value: "write-file", label: "写入文件" },
          { value: "return", label: "仅返回结果" },
        ],
      },
      { id: "outputDirectory", kind: "directory", label: "输出目录", when: { field: "outputMode", equals: "write-file" } },
    ],
    resultPreview: { kind: "markdown", pathFromOutput: "outputPath" },
  },
  permissions: [
    { action: "fs.read.outside-userdata", pathFromInput: "inputPath" },
    { action: "fs.write", pathFromInput: "outputDirectory", when: { outputMode: "write-file" } },
  ],
  entryPoints: ["tools", "workflow", "automation"],
  input: { kind: "file", extensions: [".pptx"] },
  output: { kind: "markdown" },
  window: { bounds: { width: 500, height: 560, minWidth: 500, minHeight: 420 } },
  executor: executePptxToMarkdown,
}
