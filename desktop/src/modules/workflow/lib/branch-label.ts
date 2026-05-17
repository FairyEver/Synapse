import type { WorkflowDefinition } from "@/types/workflow"

export function resolveBranchLabel(def: WorkflowDefinition, fromId: string, branchId: string): string {
  const node = def.nodes.find((n) => n.id === fromId)
  if (!node || node.type !== "switch") return branchId
  const branches = (node.config as { branches?: Array<{ id: string; label: string }> }).branches
  return branches?.find((branch) => branch.id === branchId)?.label ?? branchId
}
