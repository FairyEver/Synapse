import type { SynapseCategoryDefinition } from "../../types/category"

export const promptsCategories = [
  {
    id: "coding",
    label: "编程开发",
    description: "代码生成、调试和技术问答。",
    order: 10,
  },
  {
    id: "writing",
    label: "写作创作",
    description: "文案、故事、邮件和内容创作。",
    order: 20,
  },
  {
    id: "analysis",
    label: "分析研究",
    description: "数据分析、调研和信息整理。",
    order: 30,
  },
  {
    id: "translation",
    label: "翻译润色",
    description: "多语言翻译和文本润色。",
    order: 40,
  },
  {
    id: "productivity",
    label: "工作效率",
    description: "任务规划、会议纪要和流程优化。",
    order: 50,
  },
] as const satisfies readonly SynapseCategoryDefinition[]
