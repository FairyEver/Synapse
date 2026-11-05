import { permissionModeLabels } from "@/modules/agent/permission-mode-options"
import { sanitizeUrl } from "@/lib/url-sanitize"
import type { SynapseProjectConfig } from "@/types/config"

export type AutomationConfigurationField = { key: string; label: string; value: string }

const labels: Record<string, string> = {
  accountId: "邮箱账号", singleRun: "终端模式",
  expr: "Cron 表达式", timezone: "时区", activeDays: "活跃日", timeRange: "触发时段", start: "开始", end: "结束",
  everyMinutes: "间隔分钟", anchor: "起算方式", webhookName: "Webhook", webhookPublicId: "Webhook ID",
  command: "命令", script: "脚本", source: "代码", shell: "Shell", env: "环境变量", pathStrategy: "PATH 模式", posixLogin: "登录 Shell",
  timeoutMins: "超时分钟", timeoutSeconds: "超时秒数", method: "请求方法", url: "URL", headers: "Headers", query: "Query 参数",
  auth: "认证", type: "类型", bearerToken: "Token", basicUsername: "用户名", basicPassword: "密码", bodyType: "请求体格式", body: "请求体",
  projectId: "项目", agentType: "Agent", providerId: "供应商", providerName: "供应商", modelName: "模型", modelTier: "模型档位", mode: "权限模式",
  prompt: "提示词", sessionPolicy: "会话策略", workflowId: "工作流", paramTemplates: "工作流参数", inputs: "输入绑定", moduleMode: "模块模式", saveRunContent: "保存运行内容",
}
const values: Record<string, Record<string, string>> = {
  anchor: { created_at: "从创建时间", last_completed_at: "上次完成后" },
  sessionPolicy: { fresh: "每次新建", resume: "复用上次" },
  mode: permissionModeLabels,
  pathStrategy: { merge: "合并", replace: "替换" },
  agentType: { "claude-code": "CC/Synapse" },
  shell: { posix: "POSIX", cmd: "cmd", powershell: "PowerShell" },
  bodyType: { none: "无", json: "JSON", text: "文本" },
  type: { none: "无", bearer: "Bearer Token", basic: "Basic Auth" },
  moduleMode: { commonjs: "CommonJS", esm: "ESM" },
}

function formatValue(key: string, value: unknown, projects: readonly SynapseProjectConfig[], accounts: readonly { id: string; name: string }[]): string {
  if (value == null) return "不限制"
  if (/token|password|secret|authorization|cookie|api.?key/i.test(key)) return "••••••••"
  if (key === "url" && typeof value === "string") return sanitizeUrl(value)
  if (key === "accountId" && typeof value === "string") return value === "__all__" ? "全部邮箱账号" : accounts.find(account => account.id === value)?.name ?? "邮箱账号不可用"
  if (key === "projectId" && typeof value === "string") return projects.find(project => project.id === value)?.name ?? value
  if (key === "activeDays" && Array.isArray(value)) return value.length === 7 ? "每天" : value.map(day => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][Number(day)] ?? String(day)).join("、")
  if (key === "singleRun" && typeof value === "boolean") return value ? "完成后退出" : "保持交互"
  if (typeof value === "boolean") return value ? "是" : "否"
  if (typeof value === "string") return values[key]?.[value] ?? value
  if (Array.isArray(value)) return value.map(entry => formatValue("", entry, projects, accounts)).join("\n")
  if (typeof value === "object") return Object.entries(value).map(([name, entry]) => `${labels[name] ?? name}: ${key === "env" ? "••••••••" : formatValue(name, entry, projects, accounts)}`).join("\n")
  return String(value)
}

/** Read-only projection of registry-owned config; no form rendering or runtime type dispatch. */
export function buildAutomationConfigurationFields(config: Record<string, unknown>, projects: readonly SynapseProjectConfig[], accounts: readonly { id: string; name: string }[] = []): AutomationConfigurationField[] {
  return Object.entries(config)
    .filter(([key, value]) => value !== undefined && value !== "" && !(key === "providerId" && config.providerName))
    .map(([key, value]) => ({ key, label: labels[key] ?? key, value: formatValue(key, value, projects, accounts) }))
}
