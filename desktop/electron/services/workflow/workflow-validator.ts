import type { WorkflowDefinition, ValidationResult, ValidationError, ValidationWarning } from "../../../src/types/workflow"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.validator")

function buildReverseAdj(def: WorkflowDefinition): Map<string, string[]> {
  const r = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) r.get(e.to)?.push(e.from)
  return r
}

function topoSort(def: WorkflowDefinition): { order: string[]; hasCycle: boolean } {
  const inDeg = new Map(def.nodes.map((n) => [n.id, 0]))
  const adj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) { adj.get(e.from)?.push(e.to); inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1) }
  const queue = def.nodes.filter((n) => inDeg.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!; order.push(id)
    for (const next of adj.get(id) ?? []) { const d = (inDeg.get(next) ?? 0) - 1; inDeg.set(next, d); if (d === 0) queue.push(next) }
  }
  return { order, hasCycle: order.length !== def.nodes.length }
}

function ancestors(nodeId: string, def: WorkflowDefinition): Set<string> {
  const rev = buildReverseAdj(def)
  const visited = new Set<string>(); const stack = [nodeId]
  while (stack.length) { for (const p of rev.get(stack.pop()!) ?? []) { if (!visited.has(p)) { visited.add(p); stack.push(p) } } }
  return visited
}

export function validateWorkflow(def: WorkflowDefinition): ValidationResult {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = []

  const endNodes = def.nodes.filter((n) => n.type === "end")
  if (endNodes.length === 0)
    errors.push({ type: "missing_end_node", message: "工作流必须包含一个结束节点" })
  if (endNodes.length > 1)
    errors.push({ type: "multiple_end_nodes", message: "结束节点只能有一个" })

  const { hasCycle } = topoSort(def)
  if (hasCycle) errors.push({ type: "cycle", message: "工作流包含循环依赖" })

  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  if (def.nodes.filter((n) => n.type !== "end" && !def.edges.some((e) => e.to === n.id)).length > 1)
    warnings.push({ type: "multiple_start_nodes", message: "存在多个起始节点" })

  for (const node of def.nodes) {
    if (!def.edges.some((e) => e.to === node.id || e.from === node.id) && def.nodes.length > 1)
      warnings.push({ type: "disconnected_node", nodeId: node.id, message: `节点 "${node.name}" 未连接` })

    try {
      const manifest = nodeTypeRegistry.getManifest(node.type)
      const parsed = manifest.configSchema.safeParse(node.config)
      if (!parsed.success) errors.push({ type: "invalid_config", nodeId: node.id, message: parsed.error.message })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ type: "invalid_config", nodeId: node.id, message: `节点 "${node.name}" 类型无效：${message}` })
    }

    // Switch node: validate branch ID uniqueness
    if (node.type === "switch") {
      const branches = (node.config as Record<string, unknown>)["branches"]
      if (Array.isArray(branches)) {
        const branchIds = (branches as Array<{ id: string }>).map((b) => b.id)
        const seen = new Set<string>()
        for (const bid of branchIds) {
          if (seen.has(bid)) {
            errors.push({ type: "invalid_config", nodeId: node.id, message: `Switch 节点 "${node.name}" 存在重复的分支 ID "${bid}"` })
            logger.warn("duplicate branch id detected", { workflowId: def.id, nodeId: node.id, nodeName: node.name, duplicateId: bid })
            break
          }
          seen.add(bid)
        }
      }
    }

    if (!hasCycle) {
      const anc = ancestors(node.id, def)
      const vars = (node.config as Record<string, unknown>)["variables"]
      for (const v of (Array.isArray(vars) ? vars : []) as Array<Record<string, unknown>>) {
        const src = v["source"] as Record<string, unknown> | undefined
        if (src?.["type"] === "node_output" && !anc.has(src["node"] as string)) {
          errors.push({ type: "unreachable_reference", nodeId: node.id, message: `节点 "${node.name}" 引用了不可达上游节点 "${byId.get(src["node"] as string)?.name ?? src["node"]}"` })
        }
      }
    }
  }

  for (const edge of def.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) {
      errors.push({ type: "invalid_config", edgeId: edge.id, message: `连线 "${edge.id}" 引用了不存在的节点` })
      continue
    }
    const branches = ((from.config as Record<string, unknown>)["branches"] as Array<{ id: string }> | undefined) ?? []
    if (from.type === "switch") {
      if (edge.branch === undefined)
        errors.push({ type: "invalid_switch_edge", edgeId: edge.id, message: "Switch 节点出边必须设置 branch" })
      else if (!branches.some((b) => b.id === edge.branch))
        errors.push({ type: "invalid_switch_edge", edgeId: edge.id, message: `edge branch "${edge.branch}" 不在分支列表中` })
    } else if (edge.branch !== undefined) {
      errors.push({ type: "orphan_edge_branch", edgeId: edge.id, message: `非 Switch 节点出边不应设置 branch` })
    }
  }

  if (errors.length > 0) {
    logger.warn("workflow validation failed", { workflowId: def.id, errorCount: errors.length, errors: errors.map((e) => ({ type: e.type, nodeId: e.nodeId, edgeId: e.edgeId, message: e.message })) })
  }
  if (warnings.length > 0) {
    logger.info("workflow validation warnings", { workflowId: def.id, warnCount: warnings.length, warnings: warnings.map((w) => ({ type: w.type, nodeId: w.nodeId, message: w.message })) })
  }

  return { valid: errors.length === 0, errors, warnings }
}
