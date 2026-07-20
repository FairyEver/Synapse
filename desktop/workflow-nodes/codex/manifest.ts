import { Bot } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import { codexNodeConfigSchema, defaultCodexNodeConfig, type CodexNodeConfig } from "./schema"

export const codexNodeManifest: NodeManifest<CodexNodeConfig> = {
  type: "codex",
  title: "Codex",
  icon: Bot,
  color: "bg-primary/10",
  defaultConfig: defaultCodexNodeConfig,
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "Codex",
    subtitle: config.prompt.slice(0, 60) || "未编写指令",
  }),
  configFields: [
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "workingDirectory", kind: "text", label: "工作目录", optional: true },
    { name: "prompt", kind: "text", label: "指令" },
    { name: "model", kind: "text", label: "模型", optional: true },
    { name: "profile", kind: "text", label: "Profile", optional: true },
    { name: "features", kind: "record", label: "Goals", optional: true },
    { name: "strictConfig", kind: "select", label: "严格配置", optional: true },
    { name: "configOverrides", kind: "record", label: "配置覆盖", optional: true },
    { name: "approvalPolicy", kind: "select", label: "审批策略" },
    { name: "sandbox", kind: "select", label: "沙箱" },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "enableSearch", kind: "select", label: "启用搜索", optional: true },
    { name: "skipGitRepoCheck", kind: "select", label: "跳过 Git 仓库检查", optional: true },
    { name: "bypassApprovalsAndSandbox", kind: "select", label: "绕过审批和沙箱", optional: true },
    { name: "bypassHookTrust", kind: "select", label: "绕过 Hook 信任检查", optional: true },
    { name: "additionalWritableDirs", kind: "record", label: "可写目录", optional: true },
    { name: "images", kind: "record", label: "图片路径", optional: true },
    { name: "captureDebugArtifacts", kind: "select", label: "保存调试文件", optional: true },
  ],
  configSchema: codexNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("codex"),
    models: [{ modelPath: ["model"], environment: "codex" }],
    projects: [{ path: ["projectId"], inheritFromWorkflow: true }],
    resources: [
      { path: ["workingDirectory"], entryType: "directory", cardinality: "one", access: "read-write", optional: true },
      { path: ["additionalWritableDirs"], entryType: "directory", cardinality: "many", access: "write", optional: true },
      { path: ["images"], entryType: "file", cardinality: "many", access: "read", optional: true },
    ],
    environments: [{ path: ["profile"], kind: "codex.profile", optional: true }],
    sensitive: [{ path: ["configOverrides", "*", "value"] }],
    risks: [
      { path: ["bypassApprovalsAndSandbox"], id: "codex.bypass-approvals-and-sandbox", when: "truthy" },
      { path: ["bypassHookTrust"], id: "codex.bypass-hook-trust", when: "truthy" },
    ],
  },
}
