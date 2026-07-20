import { Bot } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import { claudeCodeNodeConfigSchema, defaultClaudeCodeNodeConfig, type ClaudeCodeNodeConfig } from "./schema"

export const claudeCodeNodeManifest: NodeManifest<ClaudeCodeNodeConfig> = {
  type: "claude_code",
  title: "Claude Code",
  icon: Bot,
  color: "bg-primary/10",
  defaultConfig: defaultClaudeCodeNodeConfig,
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "Claude Code",
    subtitle: config.prompt.slice(0, 60) || "未编写指令",
  }),
  configFields: [
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "workingDirectory", kind: "text", label: "工作目录", optional: true },
    { name: "prompt", kind: "text", label: "指令" },
    { name: "model", kind: "text", label: "模型", optional: true },
    { name: "maxTurns", kind: "number", label: "最大轮数", optional: true },
    { name: "settingSources", kind: "record", label: "设置来源" },
    { name: "settingsPath", kind: "text", label: "Settings 路径", optional: true },
    { name: "mcpConfigPath", kind: "text", label: "MCP 配置路径", optional: true },
    { name: "strictMcpConfig", kind: "select", label: "严格 MCP 配置" },
    { name: "permissionMode", kind: "select", label: "权限模式" },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "outputFormat", kind: "select", label: "输出格式" },
    { name: "verbose", kind: "select", label: "Verbose" },
    { name: "safeMode", kind: "select", label: "Safe mode" },
    { name: "bareMode", kind: "select", label: "Bare mode" },
    { name: "noSessionPersistence", kind: "select", label: "不保存会话" },
    { name: "additionalDirectories", kind: "record", label: "额外目录" },
    { name: "allowedTools", kind: "record", label: "允许工具" },
    { name: "disallowedTools", kind: "record", label: "禁用工具" },
    { name: "captureDebugArtifacts", kind: "select", label: "保存调试文件" },
  ],
  configSchema: claudeCodeNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("claude_code"),
    models: [{ modelPath: ["model"], environment: "claude-code" }],
    projects: [{ path: ["projectId"], inheritFromWorkflow: true }],
    resources: [
      { path: ["workingDirectory"], entryType: "directory", cardinality: "one", access: "read-write", optional: true },
      { path: ["settingsPath"], entryType: "file", cardinality: "one", access: "read", optional: true },
      { path: ["mcpConfigPath"], entryType: "file", cardinality: "one", access: "read", optional: true },
      { path: ["additionalDirectories"], entryType: "directory", cardinality: "many", access: "read-write", optional: true },
    ],
    risks: [{ path: ["permissionMode"], id: "claude-code.bypass-permissions", when: "present", equals: "bypassPermissions" }],
  },
}
