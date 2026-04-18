import type { SynapseCategoryDefinition } from "@/types/category"

export const rulesCategories = [
  {
    id: "coding",
    label: "代码与工程",
    description: "编码约束、实现规范和工程实践。",
    order: 10,
  },
  {
    id: "writing",
    label: "写作与表达",
    description: "文案、说明、整理和内容润色。",
    order: 20,
  },
  {
    id: "analysis",
    label: "分析与研究",
    description: "调研、拆解、总结和判断支持。",
    order: 30,
  },
  {
    id: "review",
    label: "审查与质量",
    description: "代码审查、测试约束和质量检查。",
    order: 40,
  },
  {
    id: "workflow",
    label: "流程与协作",
    description: "团队约定、执行步骤和协作流程。",
    order: 50,
  },
] as const satisfies readonly SynapseCategoryDefinition[]
