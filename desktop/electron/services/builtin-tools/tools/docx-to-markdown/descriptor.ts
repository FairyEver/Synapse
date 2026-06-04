import type { BuiltinToolDescriptor } from "../../types"
import { executeDocxToMarkdown } from "./executor"
import { docxToMarkdownInputSchema, docxToMarkdownOutputSchema, type DocxToMarkdownInput, type DocxToMarkdownOutput } from "./schema"

export const docxToMarkdownTool: BuiltinToolDescriptor<DocxToMarkdownInput, DocxToMarkdownOutput> = {
  id: "docx-to-markdown",
  title: "DOCX 转 Markdown",
  description: "转换一个 DOCX 文件",
  category: "conversion",
  inputSchema: docxToMarkdownInputSchema,
  outputSchema: docxToMarkdownOutputSchema,
  ui: {
    fields: [
      { id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".docx"] },
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
  input: { kind: "file", extensions: [".docx"] },
  output: { kind: "markdown" },
  executor: executeDocxToMarkdown,
}

