import type { SynapseCategoryDefinition } from "../../types/category"

export const promptsCategories = [
  {
    id: "coding",
    label: "编程开发",
    description: "代码生成、调试、技术问答、架构设计。",
    order: 10,
  },
  {
    id: "writing",
    label: "写作创作",
    description: "文章、故事、文案、邮件、社媒内容。",
    order: 20,
  },
  {
    id: "analysis",
    label: "分析研究",
    description: "数据分析、调研报告、信息整理。",
    order: 30,
  },
  {
    id: "translation",
    label: "翻译润色",
    description: "多语言翻译、文本润色、本地化。",
    order: 40,
  },
  {
    id: "productivity",
    label: "工作效率",
    description: "任务规划、会议纪要、流程优化。",
    order: 50,
  },
  {
    id: "education",
    label: "学习教育",
    description: "知识讲解、辅导答疑、学习计划。",
    order: 60,
  },
  {
    id: "design",
    label: "设计创意",
    description: "UI 设计、头脑风暴、创意构思。",
    order: 70,
  },
  {
    id: "business",
    label: "商业营销",
    description: "营销策划、商业分析、运营方案。",
    order: 80,
  },
  {
    id: "lifestyle",
    label: "生活日常",
    description: "旅行规划、健康建议、日常问答。",
    order: 90,
  },
] as const satisfies readonly SynapseCategoryDefinition[]
