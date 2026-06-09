import type { WorkflowDefinition } from "../../../src/types/workflow"
import { sanitizeError } from "../../../src/lib/error-sanitize"
import { agentDiagnosticPresentation } from "../agent-runtime/agent-error-messages"
export { errorCode } from "../error-utils"

export function truncateWithEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength))
  return `${value.slice(0, maxLength - 3)}...`
}

export function agentErrorDiagnostic(error: string | undefined): { readonly errorName: string; readonly errorLength: number; readonly errorMessage: string } {
  return {
    errorName: "agent",
    errorLength: error?.length ?? 0,
    errorMessage: error ? truncateWithEllipsis(sanitizeAgentError(error), 200) : "",
  }
}

export function sanitizeAgentError(error: string | undefined): string {
  if (!error) return ""
  return sanitizeError(error)
}

export function agentFailureMessage(error: string | undefined): string {
  const presentation = agentDiagnosticPresentation(error)
  if (presentation.recoverable) return presentation.message
  const sanitized = sanitizeAgentError(error)
  if (!sanitized) return "Agent 调用失败"
  return `Agent 调用失败：${truncateWithEllipsis(sanitized, 120)}`
}

export function agentProviderFailureFromResponse(response: string): string | undefined {
  const firstLine = response.split(/\r?\n/, 1)[0]?.trim() ?? ""
  return /^API Error:\s*\d{3}\b/i.test(firstLine) ? firstLine : undefined
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
  let qi = 0
  while (qi < queue.length) {
    const cur = queue[qi++]
    for (const prev of revAdj.get(cur) ?? []) {
      if (!reachable.has(prev)) { reachable.add(prev); queue.push(prev) }
    }
  }
  return reachable
}

/**
 * Compute the full set of nodes to execute, including side-effect branches.
 * Side-effect branches are nodes reachable from the main path (nodes that can
 * reach End) but that don't themselves have a path to End.
 *
 * Returns implicit edges from side-effect leaf nodes to End so that End acts
 * as a barrier waiting for all branches to complete.
 */
export function computeFullExecutionSet(def: WorkflowDefinition): {
  executableNodeIds: Set<string>
  implicitEdges: Array<{ from: string; to: string }>
} {
  const mainPathSet = computeEndReachable(def)
  if (mainPathSet.size === 0) {
    return { executableNodeIds: new Set(), implicitEdges: [] }
  }

  const endNode = def.nodes.find((n) => n.type === "end")!
  const allNodeIds = new Set(def.nodes.map((n) => n.id))

  const forwardAdj = new Map<string, string[]>()
  for (const e of def.edges) {
    if (!forwardAdj.has(e.from)) forwardAdj.set(e.from, [])
    forwardAdj.get(e.from)!.push(e.to)
  }

  const sideEffectSet = new Set<string>()
  const queue: string[] = []
  for (const nodeId of mainPathSet) {
    for (const target of forwardAdj.get(nodeId) ?? []) {
      if (!mainPathSet.has(target) && allNodeIds.has(target)) {
        sideEffectSet.add(target)
        queue.push(target)
      }
    }
  }
  let qi = 0
  while (qi < queue.length) {
    const cur = queue[qi++]
    for (const target of forwardAdj.get(cur) ?? []) {
      if (!mainPathSet.has(target) && !sideEffectSet.has(target) && allNodeIds.has(target)) {
        sideEffectSet.add(target)
        queue.push(target)
      }
    }
  }

  const fullSet = new Set([...mainPathSet, ...sideEffectSet])

  const implicitEdges: Array<{ from: string; to: string }> = []
  for (const nodeId of sideEffectSet) {
    const outTargets = forwardAdj.get(nodeId) ?? []
    const hasOutInFullSet = outTargets.some((t) => fullSet.has(t))
    if (!hasOutInFullSet) {
      implicitEdges.push({ from: nodeId, to: endNode.id })
    }
  }

  return { executableNodeIds: fullSet, implicitEdges }
}
