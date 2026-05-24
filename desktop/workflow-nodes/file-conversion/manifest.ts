import { FileText } from "lucide-react"
import type { NodeManifest } from "../types"
import type { FileConversionNodeConfig } from "./schema"
import { fileConversionNodeConfigSchema } from "./schema"

export const fileConversionNodeManifest: NodeManifest<FileConversionNodeConfig> = {
  type: "file_conversion",
  title: "文件转换",
  icon: FileText,
  color: "bg-primary/10",
  defaultConfig: { inputPath: "", outputMode: "result" },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({
    title: "文件转换",
    subtitle: c.inputPath ? c.inputPath.slice(0, 60) : "未选择文件",
  }),
  configFields: [
    { name: "inputPath", kind: "text", label: "输入路径" },
    { name: "outputMode", kind: "select", label: "输出模式", optional: true },
    { name: "outputPath", kind: "text", label: "输出路径", optional: true },
  ],
  configSchema: fileConversionNodeConfigSchema,
}
