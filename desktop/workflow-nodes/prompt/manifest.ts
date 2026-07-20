import { MessageSquare } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { PromptNodeConfig } from "./schema"
import { promptNodeConfigSchema } from "./schema"

export const promptNodeManifest: NodeManifest<PromptNodeConfig> = {
  type: "prompt", title: "Prompt", icon: MessageSquare, color: "bg-primary/10",
  defaultConfig: { providerId: "", modelTier: "default", prompt: "", variables: [] },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({ title: c.providerId ? `${c.providerId} · ${c.modelTier}` : "未选择供应商", subtitle: c.prompt.slice(0, 60) || "无 Prompt" }),
  configFields: [
    { name: "providerId", kind: "text", label: "供应商" },
    { name: "modelTier", kind: "select", label: "模型" },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "Prompt 模板" },
  ],
  configSchema: promptNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("prompt"),
    models: [{ providerPath: ["providerId"], tierPath: ["modelTier"], inheritProvider: true, inheritTier: true, environment: "synapse" }],
    projects: [{ path: ["projectId"], inheritFromWorkflow: true }],
  },
}
