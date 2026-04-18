import type { SynapseCategoryDefinition } from "@/types/category"

export const skillsCategories = [
  {
    id: "development",
    label: "开发能力",
    description: "编码、调试、重构和测试相关能力。",
    order: 10,
  },
  {
    id: "automation",
    label: "自动化",
    description: "批处理、生成和流程编排能力。",
    order: 20,
  },
  {
    id: "content",
    label: "内容处理",
    description: "写作、改写、翻译和摘要能力。",
    order: 30,
  },
  {
    id: "data",
    label: "数据与文档",
    description: "表格、文档、PDF 和结构化数据能力。",
    order: 40,
  },
  {
    id: "integration",
    label: "集成与连接",
    description: "外部服务、插件和仓库协作能力。",
    order: 50,
  },
] as const satisfies readonly SynapseCategoryDefinition[]
