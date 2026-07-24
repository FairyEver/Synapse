import type { WorkflowLayoutDirection } from "../types/workflow"

export const WORKFLOW_NODE_WIDTH = 220
export const SWITCH_BRANCH_LABEL_RIGHT_GAP = 80
export const SWITCH_VERTICAL_HANDLE_MIN_SPACING = 24

export function toDagreRankDirection(direction: WorkflowLayoutDirection): "LR" | "TB" {
  return direction === "vertical" ? "TB" : "LR"
}

export function resolveSwitchNodeWidth(
  direction: WorkflowLayoutDirection,
  branchCount: number,
  baseNodeWidth = WORKFLOW_NODE_WIDTH,
): number {
  if (direction === "horizontal") return baseNodeWidth + SWITCH_BRANCH_LABEL_RIGHT_GAP
  return Math.max(baseNodeWidth, (branchCount + 1) * SWITCH_VERTICAL_HANDLE_MIN_SPACING)
}

export function resolveSwitchBranchHandlePercent(index: number, branchCount: number): number {
  return ((index + 1) / (branchCount + 1)) * 100
}
