import type { WorkflowRunStatus } from "@/types/workflow"

export type NodeStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "skipped"

export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  pending: "等待",
  running: "执行中",
  success: "完成",
  failed: "失败",
  cancelled: "已取消",
  skipped: "跳过",
}

export const NODE_STATUS_VARIANT: Record<NodeStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "default",
  success: "secondary",
  failed: "destructive",
  cancelled: "secondary",
  skipped: "outline",
}

interface RunStateBadge {
  readonly label: string
  readonly variant: "default" | "secondary" | "destructive" | "outline"
}

export const RUN_STATE_BADGE: Record<WorkflowRunStatus["status"], RunStateBadge> = {
  running: { label: "执行中", variant: "default" },
  completed: { label: "已完成", variant: "secondary" },
  failed: { label: "失败", variant: "destructive" },
  cancelled: { label: "已取消", variant: "outline" },
}
