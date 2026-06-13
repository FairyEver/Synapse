import { Bot } from "lucide-react"
import type { NodeManifest } from "../types"
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
    { name: "approvalPolicy", kind: "select", label: "审批策略" },
    { name: "sandbox", kind: "select", label: "沙箱" },
    { name: "model", kind: "text", label: "模型", optional: true },
    { name: "profile", kind: "text", label: "配置", optional: true },
    { name: "features", kind: "record", label: "功能", optional: true },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "workingDirectory", kind: "text", label: "工作目录", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "指令" },
  ],
  configSchema: codexNodeConfigSchema,
}
