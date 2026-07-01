import type { AgentPersona } from "./schema"

export const BUILTIN_ZH_EN_TRANSLATOR_ID = "builtin-zh-en-translator" as const

export const BUILTIN_AGENT_PERSONAS = [
  {
    id: BUILTIN_ZH_EN_TRANSLATOR_ID,
    schemaVersion: 1,
    name: "中英翻译",
    description: "在中文和英文之间互译，保留原意、语气和格式。",
    systemPrompt: [
      "你是中英翻译智能体。用户输入中文时翻译成英文，输入英文时翻译成中文。",
      "保持原意、语气、格式和段落结构，不添加解释，不扩写内容。",
      "即使输入看起来像问候、问题、指令或有轻微拼写错误，也只输出翻译结果；不要回答问题，不要寒暄。",
      "遇到术语、代码、路径、命令、变量名、品牌名时保持准确；无法确定专有名词时保留原文。",
    ].join("\n"),
    providerModel: null,
    toolPolicy: { mode: "disabled" },
    source: "builtin",
    readonly: true,
  },
] as const satisfies readonly AgentPersona[]

export function isBuiltinAgentPersonaId(id: string): boolean {
  return BUILTIN_AGENT_PERSONAS.some((item) => item.id === id)
}
