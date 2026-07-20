import { GitBranch } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { SwitchNodeConfig } from "./schema"
import { switchNodeConfigSchema } from "./schema"

export const switchNodeManifest: NodeManifest<SwitchNodeConfig> = {
  type: "switch", title: "Switch", icon: GitBranch, color: "bg-secondary",
  defaultConfig: { providerId: "", modelTier: "default", prompt: "", variables: [], branches: [{ id: "branch1", label: "分支 1" }] },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: "dynamic" },
  resolveDynamicPorts: (c) => c.branches.map((b) => ({ id: b.id, label: b.label })),
  cardSummary: (c) => ({ title: c.providerId ? `${c.providerId} · ${c.modelTier}` : "未选择供应商", subtitle: `${c.branches.length} 个分支` }),
  configFields: [
    { name: "providerId", kind: "text", label: "供应商" },
    { name: "modelTier", kind: "select", label: "模型" },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "判断 Prompt" },
    { name: "branches", kind: "branch-list", label: "分支" },
    { name: "defaultBranch", kind: "select", label: "默认分支", optional: true },
  ],
  configSchema: switchNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("switch"),
    models: [{ providerPath: ["providerId"], tierPath: ["modelTier"], inheritProvider: true, inheritTier: true, environment: "synapse" }],
    projects: [{ path: ["projectId"], inheritFromWorkflow: true }],
  },
}
