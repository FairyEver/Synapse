import type { WorkflowDefinition, ValidationResult, ValidationError, ValidationWarning } from "../../../src/types/workflow"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"

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
  const { hasCycle } = topoSort(def)
  if (hasCycle) errors.push({ type: "cycle", message: "工作流包含循环依赖" })

  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  if (def.nodes.filter((n) => !def.edges.some((e) => e.to === n.id)).length > 1)
    warnings.push({ type: "multiple_start_nodes", message: "存在多个起始节点" })

  for (const node of def.nodes) {
    if (!def.edges.some((e) => e.to === node.id || e.from === node.id) && def.nodes.length > 1)
      warnings.push({ type: "disconnected_node", nodeId: node.id, message: `节点 "${node.name}" 未连接` })

    try {
      const manifest = nodeTypeRegistry.getManifest(node.type)
      const parsed = manifest.configSchema.safeParse(node.config)
      if (!parsed.success) errors.push({ type: "invalid_config", nodeId: node.id, message: parsed.error.message })
    } catch { /* unknown type — skip */ }

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
    if (!from) continue
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

  return { valid: errors.length === 0, errors, warnings }
}
