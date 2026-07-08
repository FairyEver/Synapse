import type {
  SwarmRun,
  SwarmRunMode,
  SwarmRunStatus,
  SwarmWorkerPhase,
  SwarmWorkerRunStatus,
} from "../shared/schema"

export function formatRunStatus(status: SwarmRunStatus | undefined): string {
  if (!status) return "-"
  if (status === "running") return "运行中"
  if (status === "draining") return "收尾中"
  if (status === "success") return "完成"
  if (status === "partial") return "部分完成"
  if (status === "failed") return "失败"
  return "已取消"
}

export function formatWorkerStatus(status: SwarmWorkerRunStatus): string {
  if (status === "queued") return "排队中"
  if (status === "running") return "运行中"
  if (status === "success") return "完成"
  if (status === "failed") return "失败"
  if (status === "timeout") return "超时"
  return "已取消"
}

export function formatWorkerPhase(phase: SwarmWorkerPhase | undefined): string {
  if (!phase) return "-"
  if (phase === "queued") return "排队"
  if (phase === "thinking") return "思考"
  if (phase === "reading") return "读取"
  if (phase === "writing") return "写入"
  if (phase === "command") return "命令"
  if (phase === "permission") return "权限"
  if (phase === "completed") return "完成"
  return "失败"
}

export function formatRunMode(mode: SwarmRunMode): string {
  if (mode === "continuous") return "补位运行"
  return "分批运行"
}

export function formatTimestamp(value: string | undefined): string {
  if (!value) return "-"
  return value.replace("T", " ").slice(0, 16)
}

export function formatRunTotals(run: SwarmRun | null | undefined): string {
  if (!run) return "已启动 0 · 成功 0 · 失败 0 · 取消 0 · 超时 0"
  const { totals } = run
  return `已启动 ${totals.started} · 成功 ${totals.success} · 失败 ${totals.failed} · 取消 ${totals.cancelled} · 超时 ${totals.timeout}`
}
