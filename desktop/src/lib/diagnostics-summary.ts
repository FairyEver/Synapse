import type {
  SynapseDiagnosticsCheck,
  SynapseDiagnosticsReport,
  SynapseDiagnosticsStatus,
} from "../types/diagnostics"

type DiagnosticsSummary = Pick<SynapseDiagnosticsReport, "overallStatus" | "summary">

type RendererMainRoundtripInput = {
  durationMs: number
  requestedAt: string
  completedAt: string
  mainReceivedAt?: string
  error?: string
}

function summarizeDiagnosticsChecks(checks: SynapseDiagnosticsCheck[]): DiagnosticsSummary {
  const summary = {
    ok: 0,
    degraded: 0,
    failed: 0,
    skipped: 0,
  }

  for (const check of checks) {
    summary[check.status] += 1
  }

  return {
    overallStatus: summary.failed > 0 ? "failed" : summary.degraded > 0 ? "degraded" : "ok",
    summary,
  }
}

function appendDiagnosticsCheck(
  report: SynapseDiagnosticsReport,
  check: SynapseDiagnosticsCheck,
): SynapseDiagnosticsReport {
  const checks = [
    ...report.checks.filter((item) => item.id !== check.id),
    check,
  ]
  const summary = summarizeDiagnosticsChecks(checks)

  return {
    ...report,
    ...summary,
    checks,
  }
}

function createRendererMainRoundtripCheck(
  input: RendererMainRoundtripInput,
): SynapseDiagnosticsCheck {
  const details = {
    durationMs: input.durationMs,
    requestedAt: input.requestedAt,
    completedAt: input.completedAt,
    mainReceivedAt: input.mainReceivedAt,
    error: input.error,
  }

  if (input.error) {
    return {
      id: "ipc.renderer-main.roundtrip",
      group: "IPC",
      name: "Renderer-Main 往返",
      status: "failed",
      severity: "error",
      message: input.error,
      details,
      durationMs: input.durationMs,
    }
  }

  if (input.durationMs > 1000) {
    return {
      id: "ipc.renderer-main.roundtrip",
      group: "IPC",
      name: "Renderer-Main 往返",
      status: "degraded",
      severity: "warning",
      message: "IPC 往返偏慢",
      details,
      durationMs: input.durationMs,
    }
  }

  return {
    id: "ipc.renderer-main.roundtrip",
    group: "IPC",
    name: "Renderer-Main 往返",
    status: "ok",
    severity: "info",
    message: "IPC 往返正常",
    details,
    durationMs: input.durationMs,
  }
}

function buildDiagnosticsSummary(report: SynapseDiagnosticsReport): string {
  const lines = [
    "# Synapse Diagnostics Summary",
    "",
    `- 版本：Synapse ${formatDiagnosticsValue(report.app.version ?? "unknown")}`,
    `- 诊断时间：${formatDiagnosticsDate(report.generatedAt)}`,
    `- 状态：${getDiagnosticsStatusLabel(report.overallStatus)}`,
    `- 结果：通过 ${report.summary.ok}，异常 ${report.summary.degraded}，失败 ${report.summary.failed}`,
  ]
  const context = [
    report.activeContext.repositoryName,
    report.activeContext.projectName,
  ].filter(Boolean).join(" / ")

  if (context) {
    lines.push(`- 上下文：${context}`)
  }

  const keyChecks = [
    "system.node-visibility",
    "logs.lifecycle",
    "ipc.renderer-main.roundtrip",
    "logs.recent-signals",
    "logs.agent-runtime",
    "logs.windows-compatibility",
    "windows.environment",
    "windows.writable-data",
    "windows.configured-paths",
    "database.status",
    "database.integrity",
    "database.cli",
    "database.mcp",
  ]
    .map((id) => report.checks.find((check) => check.id === id))
    .filter((check): check is SynapseDiagnosticsCheck => Boolean(check))

  if (keyChecks.length > 0) {
    lines.push("", "## 关键检查")
    for (const check of keyChecks) {
      lines.push(`- ${getDiagnosticsStatusLabel(check.status)} ${check.group}/${check.name}：${check.message}`)
    }
  }

  const nonOkChecks = report.checks.filter((check) => check.status !== "ok")
  lines.push("", "## 异常项")
  if (nonOkChecks.length > 0) {
    for (const check of nonOkChecks) {
      lines.push(`- ${getDiagnosticsStatusLabel(check.status)} ${check.group}/${check.name}：${check.message}`)
    }
  } else {
    lines.push("无")
  }

  return lines.join("\n")
}

function getDiagnosticsStatusLabel(status: SynapseDiagnosticsStatus): string {
  if (status === "ok") return "通过"
  if (status === "degraded") return "异常"
  if (status === "failed") return "失败"
  return "跳过"
}

function formatDiagnosticsDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatDiagnosticsValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export {
  appendDiagnosticsCheck,
  buildDiagnosticsSummary,
  createRendererMainRoundtripCheck,
  formatDiagnosticsDate,
  formatDiagnosticsValue,
  getDiagnosticsStatusLabel,
  summarizeDiagnosticsChecks,
}
