import type { DocumentTemplateNodeConfig } from "./schema"

export function documentTemplateNodeCardSummary(config: DocumentTemplateNodeConfig) {
  return {
    title: "生成 Word 文档",
    subtitle: config.outputPath || "未设置输出文件",
  }
}
