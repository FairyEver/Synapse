import type { SynapseCategoryDefinition } from "../../types/category"

export const skillsCategories = [
  {
    id: "development",
    label: "编程开发",
    description: "编码、调试、重构、测试、代码生成。",
    order: 10,
  },
  {
    id: "automation",
    label: "自动化",
    description: "批处理、脚本编排、定时任务、流水线。",
    order: 20,
  },
  {
    id: "content",
    label: "内容创作",
    description: "写作、改写、翻译、摘要、文案。",
    order: 30,
  },
  {
    id: "data",
    label: "数据与文件",
    description: "数据分析、文件转换、媒体处理、结构化数据。",
    order: 40,
  },
  {
    id: "integration",
    label: "集成连接",
    description: "外部 API、插件、第三方服务对接。",
    order: 50,
  },
  {
    id: "devops",
    label: "运维部署",
    description: "CI/CD、部署、监控、基础设施管理。",
    order: 60,
  },
  {
    id: "design",
    label: "设计原型",
    description: "UI/UX 设计、原型图、视觉稿。",
    order: 70,
  },
  {
    id: "research",
    label: "调研分析",
    description: "信息检索、竞品分析、技术调研。",
    order: 80,
  },
  {
    id: "productivity",
    label: "效率工具",
    description: "任务管理、日程安排、文档整理。",
    order: 90,
  },
] as const satisfies readonly SynapseCategoryDefinition[]
