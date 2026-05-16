import type { WorkflowDefinition, ValidationResult, ValidationError, ValidationWarning } from "../../../src/types/workflow"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { createMainLogger } from "../log-store"
import { computeEndReachable } from "./workflow-utils"

const logger = createMainLogger("service.workflow.validator")

function buildReverseAdj(def: WorkflowDefinition): Map<string, string[]> {
  const r = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) r.get(e.to)?.push(e.from)
  return r
}

function topoSort(def: WorkflowDefinition): { order: string[]; hasCycle: boolean } {
  const inDeg = new Map(def.nodes.map((n) => [n.id, 0]))
  const adj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) {
    if (!adj.has(e.from) || !inDeg.has(e.to)) continue
    adj.get(e.from)?.push(e.to); inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
  }
  const queue = def.nodes.filter((n) => inDeg.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!; order.push(id)
    for (const next of adj.get(id) ?? []) { const d = (inDeg.get(next) ?? 0) - 1; inDeg.set(next, d); if (d === 0) queue.push(next) }
  }
  return { order, hasCycle: order.length !== def.nodes.length }
}

function ancestors(nodeId: string, rev: Map<string, string[]>): Set<string> {
  const visited = new Set<string>(); const stack = [nodeId]
  while (stack.length) { for (const p of rev.get(stack.pop()!) ?? []) { if (!visited.has(p)) { visited.add(p); stack.push(p) } } }
  return visited
}

export function validateWorkflow(def: WorkflowDefinition): ValidationResult {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = []

  // Validate param name uniqueness
  const paramNamesSeen = new Set<string>()
  for (const p of def.params) {
    const trimmed = p.name.trim()
    if (!trimmed) continue
    if (paramNamesSeen.has(trimmed)) {
      errors.push({ type: "invalid_config", message: `工作流参数名称「${trimmed}」重复，请确保每个参数名称唯一` })
      logger.warn("duplicate param name detected", { workflowId: def.id, duplicateName: trimmed })
      break
    }
    paramNamesSeen.add(trimmed)
  }

  const endNodes = def.nodes.filter((n) => n.type === "end")
  if (endNodes.length === 0)
    errors.push({ type: "missing_end_node", message: "工作流必须包含一个结束节点" })
  if (endNodes.length > 1)
    errors.push({ type: "multiple_end_nodes", message: "结束节点只能有一个" })
  const nodeIdsSeen = new Set<string>()
  for (const node of def.nodes) {
    if (nodeIdsSeen.has(node.id)) {
      errors.push({ type: "invalid_config", nodeId: node.id, message: `节点 ID「${node.id}」重复，请删除重复节点后重试` })
      logger.warn("duplicate node id detected", { workflowId: def.id, nodeId: node.id })
      break
    }
    nodeIdsSeen.add(node.id)
  }

  const { hasCycle } = topoSort(def)
  if (hasCycle) errors.push({ type: "cycle", message: "工作流包含循环依赖" })

  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const revAdj = buildReverseAdj(def)
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

    // Provider resolution: prompt/switch nodes must have provider either on node or workflow default
    if (node.type === "prompt" || node.type === "switch") {
      const cfg = node.config as Record<string, unknown>
      const hasProviderId = typeof cfg.providerId === "string" && cfg.providerId.length > 0
      const hasModelTier = typeof cfg.modelTier === "string" && cfg.modelTier.length > 0
      if (!hasProviderId && !def.defaultProviderId) {
        errors.push({ type: "invalid_config", nodeId: node.id, message: `节点「${node.name}」未配置供应商，且工作流未设置默认供应商` })
      }
      if (!hasModelTier && !def.defaultModelTier) {
        errors.push({ type: "invalid_config", nodeId: node.id, message: `节点「${node.name}」未配置模型层级，且工作流未设置默认模型` })
      }
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
      const anc = ancestors(node.id, revAdj)
      const vars = (node.config as Record<string, unknown>)["variables"]
      for (const v of (Array.isArray(vars) ? vars : []) as Array<Record<string, unknown>>) {
        const src = v["source"] as Record<string, unknown> | undefined
        if (src?.["type"] === "node_output" && !anc.has(src["node"] as string)) {
          errors.push({ type: "unreachable_reference", nodeId: node.id, message: `节点 "${node.name}" 引用了不可达上游节点 "${byId.get(src["node"] as string)?.name ?? src["node"]}"` })
        }
        if (src?.["type"] === "param" && !def.params.some((p) => p.name === src["param"])) {
          const missingParamName = (src["param"] as string) ?? "未知"
          errors.push({ type: "invalid_config", nodeId: node.id, message: `节点 "${node.name}" 引用了不存在的工作流参数 "${missingParamName}"` })
          logger.warn("variable references non-existent param", { workflowId: def.id, nodeId: node.id, nodeName: node.name, missingParam: missingParamName })
        }
      }
    }
  }

  const edgeIdsSeen = new Set<string>()
  for (const edge of def.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (edgeIdsSeen.has(edge.id)) {
      errors.push({ type: "invalid_config", edgeId: edge.id, message: `连线 ID「${edge.id}」重复，请重新连线后重试` })
      logger.warn("duplicate edge id detected", { workflowId: def.id, edgeId: edge.id })
      break
    }
    edgeIdsSeen.add(edge.id)
    if (!from || !to) {
      errors.push({ type: "invalid_config", edgeId: edge.id, message: `连线 "${edge.id}" 引用了不存在的节点` })
      continue
    }
    const branches = ((from.config as Record<string, unknown>)["branches"] as Array<{ id: string }> | undefined) ?? []
    if (from.type === "switch") {
      if (edge.branch === undefined)
        errors.push({ type: "invalid_switch_edge", edgeId: edge.id, message: "Switch 节点出边必须设置分支 ID" })
      else if (!branches.some((b) => b.id === edge.branch))
        errors.push({ type: "invalid_switch_edge", edgeId: edge.id, message: `连线分支 "${edge.branch}" 不在该 Switch 节点的分支列表中` })
    } else if (edge.branch !== undefined) {
      errors.push({ type: "orphan_edge_branch", edgeId: edge.id, message: "非 Switch 节点出边不应设置分支 ID" })
    }
  }

  // Validate that every Switch branch has at least one outgoing edge.
  // A branch with no outgoing edge will silently cause a runtime failure when
  // activated (the End node becomes unreachable), so catch it at validation time.
  //
  // Also validate that each Switch branch's outgoing edge(s) eventually reach
  // the End node. A branch that connects to a dead-end subgraph passes the
  // edge-existence check but will fail at runtime with "结束节点未被执行".
  const endReachable = computeEndReachable(def)
  for (const node of def.nodes) {
    if (node.type !== "switch") continue
    const branches = (node.config as Record<string, unknown>)["branches"]
    if (!Array.isArray(branches)) continue
    const outgoingBranches = new Set(
      def.edges.filter((e) => e.from === node.id && e.branch).map((e) => e.branch!),
    )
    for (const branch of branches as Array<{ id: string; label: string }>) {
      if (!outgoingBranches.has(branch.id)) {
        errors.push({
          type: "invalid_switch_edge",
          nodeId: node.id,
          message: `Switch 节点「${node.name}」的分支「${branch.label}」没有连接到下游节点`,
        })
        logger.warn("switch branch has no outgoing edge", {
          workflowId: def.id, nodeId: node.id, nodeName: node.name,
          branchId: branch.id, branchLabel: branch.label,
        })
      } else if (endReachable.size > 0) {
        // Check that at least one edge from this branch leads to End
        const branchEdges = def.edges.filter((e) => e.from === node.id && e.branch === branch.id)
        const anyReachEnd = branchEdges.some((e) => endReachable.has(e.to))
        if (!anyReachEnd) {
          errors.push({
            type: "invalid_switch_edge",
            nodeId: node.id,
            message: `Switch 节点「${node.name}」的分支「${branch.label}」的路径无法到达结束节点`,
          })
          logger.warn("switch branch cannot reach end node", {
            workflowId: def.id, nodeId: node.id, nodeName: node.name,
            branchId: branch.id, branchLabel: branch.label,
          })
        }
      }
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

export function validateRunParams(def: WorkflowDefinition, params: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const param of def.params) {
    const value = params[param.name]
    const hasValue = paramHasValue(params, param.name)
    const hasDefault = paramHasDefault(param)
    if (!hasValue) {
      if (!hasDefault) {
        errors.push({ type: "missing_param", message: `缺少必填参数「${param.name}」` })
      }
      continue
    }
    if (param.type === "text" && typeof value !== "string") {
      errors.push({ type: "invalid_config", message: `参数「${param.name}」必须是文本` })
    }
    if (param.type === "number") {
      const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
      if (!Number.isFinite(numberValue)) {
        errors.push({ type: "invalid_config", message: `参数「${param.name}」必须是数字` })
      }
    }
  }
  return errors
}

export function buildEffectiveRunParams(def: WorkflowDefinition, params: Record<string, unknown>): Record<string, unknown> {
  const effective = { ...params }
  for (const param of def.params) {
    const hasValue = paramHasValue(effective, param.name)
    const hasDefault = paramHasDefault(param)
    if (!hasValue && hasDefault) effective[param.name] = param.default
  }
  return effective
}

function paramHasValue(params: Record<string, unknown>, name: string): boolean {
  const value = params[name]
  return Object.prototype.hasOwnProperty.call(params, name) && value !== undefined && value !== null && value !== ""
}

function paramHasDefault(param: { default?: unknown }): boolean {
  return param.default !== undefined && param.default !== null && param.default !== ""
}
