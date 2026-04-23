import type { SynapseCategoryDefinition } from "../../types/category"

export const rulesCategories = [
  {
    id: "coding",
    label: "编程与工程",
    description: "编码约束、架构规范、实现模式、命名规则。",
    order: 10,
  },
  {
    id: "writing",
    label: "写作与格式",
    description: "输出格式、文风、排版、内容标准。",
    order: 20,
  },
  {
    id: "reasoning",
    label: "推理与决策",
    description: "思考方式、分析框架、判断准则。",
    order: 30,
  },
  {
    id: "quality",
    label: "质量与规范",
    description: "审查标准、测试要求、验收条件。",
    order: 40,
  },
  {
    id: "workflow",
    label: "流程与步骤",
    description: "执行顺序、协作流程、分支策略。",
    order: 50,
  },
  {
    id: "security",
    label: "安全与隐私",
    description: "敏感数据处理、权限约束、合规要求。",
    order: 60,
  },
  {
    id: "interaction",
    label: "角色与风格",
    description: "人设、语气、交互风格、回复长度。",
    order: 70,
  },
  {
    id: "domain",
    label: "领域知识",
    description: "行业术语、专业约束、业务规则。",
    order: 80,
  },
  {
    id: "tooling",
    label: "工具与环境",
    description: "工具使用偏好、环境配置、CLI 约束。",
    order: 90,
  },
] as const satisfies readonly SynapseCategoryDefinition[]
