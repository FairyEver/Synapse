import type { NodeManifest } from "../types"
import type { SwitchNodeConfig } from "./schema"
import { switchNodeConfigSchema } from "./schema"

export const switchNodeManifest: NodeManifest<SwitchNodeConfig> = {
  type: "switch", title: "Switch", icon: "GitBranch", color: "bg-amber-500/10",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: "dynamic" },
  resolveDynamicPorts: (c) => c.branches.map((b) => ({ id: b.id, label: b.label })),
  cardSummary: (c) => ({ title: c.agent || "未选择 Agent", subtitle: `${c.branches.length} 个分支` }),
  configFields: [
    { name: "agent", kind: "select", label: "Agent" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "判断 Prompt" },
    { name: "branches", kind: "branch-list", label: "分支" },
    { name: "defaultBranch", kind: "select", label: "默认分支", optional: true },
  ],
  configSchema: switchNodeConfigSchema,
}
