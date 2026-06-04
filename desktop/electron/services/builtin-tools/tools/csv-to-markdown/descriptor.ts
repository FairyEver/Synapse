import type { BuiltinToolDescriptor } from "../../types"
import { executeCsvToMarkdown } from "./executor"
import { csvToMarkdownInputSchema, csvToMarkdownOutputSchema, type CsvToMarkdownInput, type CsvToMarkdownOutput } from "./schema"

export const csvToMarkdownTool: BuiltinToolDescriptor<CsvToMarkdownInput, CsvToMarkdownOutput> = {
  id: "csv-to-markdown",
  title: "CSV 转 Markdown",
  description: "转换一个 CSV 文件",
  category: "conversion",
  inputSchema: csvToMarkdownInputSchema,
  outputSchema: csvToMarkdownOutputSchema,
  ui: {
    fields: [
      { id: "inputPath", kind: "file", label: "文件", required: true, extensions: [".csv"] },
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
      { id: "delimiter", kind: "text", label: "分隔符", defaultValue: "," },
      { id: "maxRows", kind: "number", label: "最大行数", defaultValue: 1000, min: 1, max: 10000 },
    ],
    resultPreview: { kind: "markdown", pathFromOutput: "outputPath" },
  },
  permissions: [
    { action: "fs.read.outside-userdata", pathFromInput: "inputPath" },
    { action: "fs.write", pathFromInput: "outputDirectory", when: { outputMode: "write-file" } },
  ],
  entryPoints: ["tools", "workflow", "automation"],
  input: { kind: "file", extensions: [".csv"] },
  output: { kind: "markdown" },
  executor: executeCsvToMarkdown,
}
