import type { WorkflowDefinition } from "../../../src/types/workflow"

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

export function agentErrorDiagnostic(error: string | undefined): { readonly errorName: string; readonly errorLength: number; readonly errorMessage: string } {
  return {
    errorName: "agent",
    errorLength: error?.length ?? 0,
    errorMessage: error ? (error.length > 200 ? sanitizeAgentError(error).slice(0, 200) + "..." : sanitizeAgentError(error)) : "",
  }
}

export function sanitizeAgentError(error: string | undefined): string {
  if (!error) return ""
  return error
    .replace(/\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g, "[path]")
    .replace(/(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g, "$1[path]")
    .replace(/\b(api[_-]?key|apikey|token|secret|authorization|bearer|cookie|password|credential)[\s=:]+[^\s,;"')]+/gi, "$1=[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[key]")
}

export function agentFailureMessage(error: string | undefined): string {
  const sanitized = sanitizeAgentError(error)
  if (!sanitized) return "Agent 调用失败"
  const truncated = sanitized.length <= 120 ? sanitized : sanitized.slice(0, 120) + "..."
  return `Agent 调用失败：${truncated}`
}

/**
 * Compute which nodes can reach the End node via forward edge traversal.
 * Uses a reverse BFS from the End node (following edges backwards).
 * Used to prune unreachable nodes from execution and to validate
 * that every Switch branch path eventually reaches End.
 * Returns an empty Set when no End node exists (all nodes pass through).
 */
export function computeEndReachable(def: WorkflowDefinition): Set<string> {
  const endNode = def.nodes.find((n) => n.type === "end")
  if (!endNode) return new Set()
  const revAdj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) revAdj.get(e.to)?.push(e.from)
  const reachable = new Set<string>([endNode.id])
  const queue = [endNode.id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const prev of revAdj.get(cur) ?? []) {
      if (!reachable.has(prev)) { reachable.add(prev); queue.push(prev) }
    }
  }
  return reachable
}
