import type { NodeRunResult, WorkflowDefinition, WorkflowNode, WorkflowRunStatus } from "@/types/workflow"
import { formatTokenUsageValue, tokenUsageFields } from "@/lib/token-usage"
import { resolveBranchLabel } from "../lib/branch-label"
import { sanitizeWorkflowResultText, sanitizeWorkflowResultValue } from "./result-sanitize"

interface WorkflowRunReportInput {
  readonly definition: WorkflowDefinition
  readonly runId: string
  readonly runState: WorkflowRunStatus["status"]
  readonly runParams: Record<string, unknown>
  readonly nodeResults: Record<string, NodeRunResult>
  readonly runError?: string | null
}

interface NodeRunReportInput {
  readonly definition: WorkflowDefinition
  readonly node: WorkflowNode
  readonly result: NodeRunResult
  readonly orderIndex: number
}

interface OrderedNodeRun {
  readonly node: WorkflowNode
  readonly result: NodeRunResult
  readonly definitionIndex: number
}

export function formatWorkflowRunReport(input: WorkflowRunReportInput): string {
  const orderedNodes = orderNodes(input.definition, input.nodeResults)
  const startedTimes = Object.values(input.nodeResults)
    .map((result) => result.startedAt)
    .filter((value): value is number => typeof value === "number")
  const endedTimes = Object.values(input.nodeResults)
    .map((result) => result.endedAt)
    .filter((value): value is number => typeof value === "number")

  const sections = [
    `# 工作流运行报告：${input.definition.name}`,
    [
      "## 运行概览",
      `- 工作流 ID：${input.definition.id}`,
      `- 运行 ID：${input.runId || "未记录"}`,
      `- 状态：${input.runState}`,
      `- 快照：${input.runState !== "running" ? "是" : "否"}`,
      `- 开始时间：${formatTimestamp(startedTimes.length > 0 ? Math.min(...startedTimes) : undefined)}`,
      `- 结束时间：${formatTimestamp(endedTimes.length > 0 ? Math.max(...endedTimes) : undefined)}`,
      `- 总耗时：${formatDuration(resolveTotalDuration(input.nodeResults))}`,
      ...(input.runError ? [`- 错误：${sanitizeWorkflowResultText(input.runError)}`] : []),
      "",
      "### 运行参数",
      codeBlock("json", formatJson(sanitizeWorkflowResultValue(input.runParams))),
    ].join("\n"),
    [
      "## 工作流结构",
      `- 节点数：${input.definition.nodes.length}`,
      `- 边数：${input.definition.edges.length}`,
      `- 默认项目：${formatScalar(input.definition.defaultProjectId)}`,
      `- 默认供应商：${formatScalar(input.definition.defaultProviderId)}`,
      `- 默认模型：${formatScalar(input.definition.defaultModelTier)}`,
      `- 默认超时：${formatScalar(input.definition.defaultNodeTimeoutMins)}`,
    ].join("\n"),
    [
      "## 执行顺序",
      ...orderedNodes.map((entry, index) => `${index + 1}. ${entry.node.name}（${entry.node.type}）：${entry.result.status}，${formatDuration(entry.result.durationMs)}`),
    ].join("\n"),
    [
      "## 节点详情",
      ...orderedNodes.map((entry, index) => formatNodeRunReport({
        definition: input.definition,
        node: entry.node,
        result: entry.result,
        orderIndex: entry.definitionIndex + 1,
      }).replace(/^# 节点运行报告：.*\n\n/, `### ${index + 1}. ${entry.node.name}\n\n`)),
    ].join("\n\n"),
  ]

  return `${sections.join("\n\n").trimEnd()}\n`
}

export function formatNodeRunReport(input: NodeRunReportInput): string {
  const { definition, node, result } = input
  const sections = [
    `# 节点运行报告：${node.name}`,
    formatNodeBasicInfo(definition, node, result, input.orderIndex),
    ["## 设置", codeBlock("json", formatJson(sanitizeNodeConfigForReport(node)))].join("\n"),
  ]

  const variables = node.config.variables
  if (variables !== undefined) {
    sections.push(["## 变量绑定", codeBlock("json", formatJson(sanitizeWorkflowResultValue(variables)))].join("\n"))
  }

  if (result.input.variables && Object.keys(result.input.variables).length > 0) {
    sections.push(["## 运行输入变量", codeBlock("json", formatJson(sanitizeWorkflowResultValue(result.input.variables)))].join("\n"))
  }

  const mainContent = resolveNodeMainContent(node, result)
  if (mainContent) {
    sections.push([`## ${mainContent.title}`, codeBlock(mainContent.language, mainContent.content)].join("\n"))
  }

  if (result.output !== undefined) {
    sections.push(["## 输出", codeBlock("text", formatTextValue(result.output))].join("\n"))
  }

  const structuredOutputs = resolveReportStructuredOutputs(result)
  if (structuredOutputs && Object.keys(structuredOutputs).length > 0) {
    sections.push(["## 结构化输出", codeBlock("json", formatJson(sanitizeWorkflowResultValue(structuredOutputs)))].join("\n"))
  }

  const usageFields = tokenUsageFields(result.usage)
  if (usageFields) {
    sections.push([
      "## Token 消耗",
      ...(usageFields?.map((field) => (
        field.value !== undefined ? `- ${field.label}：${formatTokenUsageValue(field.value)}` : `- ${field.label}`
      )) ?? []),
    ].join("\n"))
  }

  if (result.error) {
    sections.push(["## 错误", codeBlock("text", sanitizeWorkflowResultText(result.error))].join("\n"))
  }

  return `${sections.join("\n\n").trimEnd()}\n`
}

function sanitizeNodeConfigForReport(node: WorkflowNode): unknown {
  const sanitized = sanitizeWorkflowResultValue(node.config)
  if (node.type !== "codex" || !isRecord(sanitized)) return sanitized
  const overrides = sanitized.configOverrides
  if (!Array.isArray(overrides)) return sanitized

  return {
    ...sanitized,
    configOverrides: overrides.map((override) => (
      isRecord(override) && "value" in override
        ? { ...override, value: "[redacted]" }
        : override
    )),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function orderNodes(definition: WorkflowDefinition, nodeResults: Record<string, NodeRunResult>): OrderedNodeRun[] {
  return definition.nodes
    .map((node, index) => ({
      node,
      definitionIndex: index,
      result: nodeResults[node.id] ?? { nodeId: node.id, status: "pending" as const, input: { variables: {} } },
    }))
    .sort((a, b) => {
      const aStarted = a.result.startedAt
      const bStarted = b.result.startedAt
      if (typeof aStarted === "number" && typeof bStarted === "number") return aStarted - bStarted
      if (typeof aStarted === "number") return -1
      if (typeof bStarted === "number") return 1
      return a.definitionIndex - b.definitionIndex
    })
}

function formatNodeBasicInfo(definition: WorkflowDefinition, node: WorkflowNode, result: NodeRunResult, orderIndex: number): string {
  const lines = [
    "## 基本信息",
    `- 节点 ID：${node.id}`,
    `- 类型：${node.type}`,
    `- 状态：${result.status}`,
    `- 定义顺序：${orderIndex}`,
    `- 开始时间：${formatTimestamp(result.startedAt)}`,
    `- 结束时间：${formatTimestamp(result.endedAt)}`,
    `- 耗时：${formatDuration(result.durationMs)}`,
  ]

  if (result.activeBranch) {
    const label = resolveBranchLabel(definition, node.id, result.activeBranch)
    lines.push(`- 命中分支：${label} (${result.activeBranch})`)
  }

  return lines.join("\n")
}

function resolveNodeMainContent(node: WorkflowNode, result: NodeRunResult): { title: string; language: string; content: string } | null {
  if ((node.type === "prompt" || node.type === "switch" || node.type === "claude_code") && result.input.prompt) {
    return { title: node.type === "switch" ? "判断 Prompt" : "完整 Prompt", language: "text", content: sanitizeWorkflowResultText(result.input.prompt) }
  }
  if (node.type === "script" && typeof node.config.script === "string") {
    return { title: "脚本", language: "text", content: sanitizeWorkflowResultText(node.config.script) }
  }
  if (node.type === "http_request") {
    return { title: "请求配置", language: "json", content: formatJson(sanitizeWorkflowResultValue(node.config)) }
  }
  if (node.type === "end" && typeof node.config.template === "string") {
    return { title: "返回模板", language: "text", content: sanitizeWorkflowResultText(node.config.template) }
  }
  return null
}

function resolveTotalDuration(nodeResults: Record<string, NodeRunResult>): number | undefined {
  const durations = Object.values(nodeResults)
    .map((result) => result.durationMs)
    .filter((value): value is number => typeof value === "number")
  if (durations.length === 0) return undefined
  return durations.reduce((total, duration) => total + duration, 0)
}

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== "number") return "未记录"
  return `${new Date(value).toLocaleString()} (${value})`
}

function formatDuration(value: number | undefined): string {
  if (typeof value !== "number") return "未记录"
  if (value >= 1000) return `${value}ms (${(value / 1000).toFixed(2)}s)`
  return `${value}ms`
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "未记录"
  if (value === "") return "（空）"
  return String(value)
}

function formatTextValue(value: unknown): string {
  if (value === null || value === undefined) return "未记录"
  if (value === "") return "空字符串"
  return sanitizeWorkflowResultText(String(value))
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, createJsonReplacer(), 2)
}

function createJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>()
  return (_key, value) => {
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    return value
  }
}

function resolveReportStructuredOutputs(result: NodeRunResult): Record<string, unknown> | undefined {
  if (!result.outputs || Object.keys(result.outputs).length === 0) return undefined
  const entries = Object.entries(result.outputs).filter(([key]) => key !== "agentConversation")
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function codeBlock(language: string, content: string): string {
  const fence = content.includes("```") ? "````" : "```"
  return `${fence}${language}\n${content}\n${fence}`
}
