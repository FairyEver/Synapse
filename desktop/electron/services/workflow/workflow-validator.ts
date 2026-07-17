import type { WorkflowDefinition, WorkflowParam, WorkflowParamBinding, ValidationResult, ValidationError, ValidationWarning } from "../../../src/types/workflow"
import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../config"
import type { SynapseConfig } from "../../../src/types/config"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { createMainLogger } from "../log-store"
import { computeEndReachable } from "./workflow-utils"
import { agentTimeoutMinsToMs, resolveAgentTimeoutMins } from "../../../workflow-nodes/agent-timeout"
import {
  extractWorkflowCallTemplateVariables,
  validateWorkflowCallValueBinding,
  workflowParamHasDefault,
} from "../../../workflow-nodes/workflow-call/params"
import { isSafeWorkflowNodeId } from "./workflow-id"
import {
  isMultiResourceParam,
  isResourceParamType,
  validateWorkflowParamConfiguration,
} from "./workflow-param-validator"
import { validateWorkflowResourceDefaults } from "./workflow-param-normalizer"

const logger = createMainLogger("service.workflow.validator")

export interface WorkflowValidationOptions {
  readonly configuredProjectIds?: Iterable<string>
  readonly availableWorkflowIds?: Iterable<string>
  readonly workflowParamsById?: ReadonlyMap<string, readonly WorkflowParam[]>
}

export function workflowCallTargetIds(def: Pick<WorkflowDefinition, "nodes">): string[] {
  const ids = new Set<string>()
  for (const node of def.nodes) {
    if (node.type !== "workflow_call") continue
    const workflowId = typeof node.config.workflowId === "string" ? node.config.workflowId.trim() : ""
    if (workflowId) ids.add(workflowId)
  }
  return [...ids]
}

const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu

export function configuredWorkflowProjectIdsFromConfig(config: Pick<SynapseConfig, "repositories" | "global">): string[] {
  const ids = new Set<string>()
  for (const repository of config.repositories) {
    if (repository.uuid) ids.add(repository.uuid)
  }
  for (const project of config.global.projects) {
    if (project.id) ids.add(project.id)
  }
  return [...ids]
}

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

function switchBranchTargetKey(targetIds: string[]): string {
  return [...new Set(targetIds)].sort().join("\u0000")
}

function missingWorkflowDefaultError(input: {
  node: WorkflowDefinition["nodes"][number]
  field: "defaultProviderId" | "defaultModelTier" | "defaultProjectId"
  nodeField: "providerId" | "modelTier" | "projectId"
  label: string
  cfg: Record<string, unknown>
  defaultNodeTimeoutMins?: number
}): ValidationError {
  const timeoutMins = typeof input.cfg.timeoutMins === "number"
    ? input.cfg.timeoutMins
    : input.defaultNodeTimeoutMins
  return {
    type: "invalid_config",
    nodeId: input.node.id,
    nodeName: input.node.name,
    field: input.field,
    message: `节点「${input.node.name}」缺少 ${input.nodeField}，且工作流缺少 ${input.field}（${input.label}未配置）`,
    retryable: false,
    details: {
      missingField: input.field,
      nodeField: input.nodeField,
      providerId: typeof input.cfg.providerId === "string" && input.cfg.providerId ? input.cfg.providerId : undefined,
      modelTier: typeof input.cfg.modelTier === "string" && input.cfg.modelTier ? input.cfg.modelTier : undefined,
      projectId: typeof input.cfg.projectId === "string" && input.cfg.projectId.trim() ? input.cfg.projectId : undefined,
      timeoutMs: agentTimeoutMinsToMs(resolveAgentTimeoutMins(timeoutMins)),
    },
  }
}

function collectTemplateTexts(node: WorkflowDefinition["nodes"][number]): string[] {
  const cfg = node.config as Record<string, unknown>
  const texts: string[] = []
  const pushString = (value: unknown) => {
    if (typeof value === "string") texts.push(value)
  }
  const pushStringArray = (value: unknown) => {
    if (!Array.isArray(value)) return
    for (const item of value) pushString(item)
  }
  const pushRecordValues = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const recordValue of Object.values(value as Record<string, unknown>)) {
        pushString(recordValue)
      }
    }
  }

  if (node.type === "prompt" || node.type === "switch" || node.type === "codex" || node.type === "claude_code") {
    pushString(cfg.prompt)
    if (node.type === "codex") {
      pushString(cfg.workingDirectory)
      pushStringArray(cfg.additionalWritableDirs)
      pushStringArray(cfg.images)
    } else if (node.type === "claude_code") {
      pushString(cfg.workingDirectory)
      pushString(cfg.settingsPath)
      pushString(cfg.mcpConfigPath)
      pushStringArray(cfg.additionalDirectories)
    }
  } else if (node.type === "end") {
    pushString(cfg.template)
  } else if (node.type === "http_request") {
    pushString(cfg.url)
    pushString(cfg.body)
    pushRecordValues(cfg.headers)
    pushRecordValues(cfg.query)
    const auth = cfg.auth
    if (auth && typeof auth === "object" && !Array.isArray(auth)) {
      const authConfig = auth as Record<string, unknown>
      pushString(authConfig.bearerToken)
      pushString(authConfig.basicUsername)
      pushString(authConfig.basicPassword)
    }
  }

  return texts
}

function normalizeProjectId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeConfiguredProjectIds(ids: Iterable<string> | undefined): Set<string> | undefined {
  if (!ids) return undefined
  const normalized = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed) normalized.add(trimmed)
  }
  return normalized
}

function missingConfiguredProjectError(input: {
  readonly node: WorkflowDefinition["nodes"][number]
  readonly field: "projectId" | "defaultProjectId"
  readonly projectId: string
}): ValidationError {
  return {
    type: "invalid_config",
    nodeId: input.node.id,
    nodeName: input.node.name,
    field: input.field,
    message: `节点「${input.node.name}」引用的项目「${input.projectId}」不存在，请重新选择项目`,
    retryable: false,
    details: {
      projectId: input.projectId,
      source: input.field,
    },
  }
}

export function validateWorkflow(def: WorkflowDefinition, options: WorkflowValidationOptions = {}): ValidationResult {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = []
  const defaultProjectId = normalizeProjectId(def.defaultProjectId)
  const hasDefaultProjectId = Boolean(defaultProjectId)
  const configuredProjectIds = normalizeConfiguredProjectIds(options.configuredProjectIds)
  const availableWorkflowIds = options.availableWorkflowIds ? new Set([...options.availableWorkflowIds].map((id) => id.trim()).filter(Boolean)) : undefined
  const workflowParamsById = options.workflowParamsById

  if (!def.name?.trim()) {
    errors.push({ type: "invalid_config", message: "工作流名称不能为空" })
  }

  // Validate param name uniqueness
  const paramNamesSeen = new Set<string>()
  for (const p of def.params) {
    const trimmed = p.name.trim()
    if (!trimmed) {
      errors.push({ type: "invalid_config", message: "工作流参数名称不能为空" })
      continue
    }
    if (paramNamesSeen.has(trimmed)) {
      errors.push({ type: "invalid_config", message: `工作流参数名称「${trimmed}」重复，请确保每个参数名称唯一` })
      logger.warn("duplicate param name detected", { workflowId: def.id, duplicateName: trimmed })
      continue
    }
    paramNamesSeen.add(trimmed)

    errors.push(...validateWorkflowParamConfiguration(p))
  }

  const endNodes = def.nodes.filter((n) => n.type === "end")
  if (endNodes.length === 0)
    errors.push({ type: "missing_end_node", message: "工作流必须包含一个结束节点" })
  if (endNodes.length > 1)
    errors.push({ type: "multiple_end_nodes", message: "结束节点只能有一个" })
  for (const endNode of endNodes) {
    if (def.edges.some((edge) => edge.from === endNode.id)) {
      errors.push({ type: "invalid_config", nodeId: endNode.id, message: `结束节点「${endNode.name}」不能连接到下游节点` })
    }
  }
  const nodeIdsSeen = new Set<string>()
  for (const node of def.nodes) {
    if (!isSafeWorkflowNodeId(node.id)) {
      errors.push({ type: "invalid_config", nodeId: node.id, nodeName: node.name, message: `节点 ID「${node.id}」无效，请使用字母、数字、下划线或短横线` })
      logger.warn("unsafe node id detected", { workflowId: def.id, nodeId: node.id })
      continue
    }
    if (nodeIdsSeen.has(node.id)) {
      errors.push({ type: "invalid_config", nodeId: node.id, message: `节点 ID「${node.id}」重复，请删除重复节点后重试` })
      logger.warn("duplicate node id detected", { workflowId: def.id, nodeId: node.id })
      continue
    }
    nodeIdsSeen.add(node.id)
  }

  const { hasCycle } = topoSort(def)
  if (hasCycle) errors.push({ type: "cycle", message: "工作流包含循环依赖" })

  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const revAdj = buildReverseAdj(def)
  if (def.nodes.filter((n) => n.type === "start").length > 1)
    warnings.push({ type: "multiple_start_nodes", message: "存在多个起始节点" })

  for (const node of def.nodes) {
    if (!def.edges.some((e) => e.to === node.id || e.from === node.id) && def.nodes.length > 1)
      errors.push({ type: "disconnected_node", nodeId: node.id, nodeName: node.name, message: `节点 "${node.name}" 未连接` })

    try {
      const manifest = nodeTypeRegistry.getManifest(node.type)
      const parsed = manifest.configSchema.safeParse(node.config)
      if (!parsed.success) errors.push({ type: "invalid_config", nodeId: node.id, message: parsed.error.message })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ type: "invalid_config", nodeId: node.id, message: `节点 "${node.name}" 类型无效：${message}` })
    }

    // Provider resolution: prompt/switch nodes must have provider/model/project;
    // local CLI and script nodes only require project resolution.
    if (node.type === "prompt" || node.type === "switch" || node.type === "codex" || node.type === "claude_code" || node.type === "script") {
      const cfg = node.config as Record<string, unknown>
      const hasProviderId = typeof cfg.providerId === "string" && cfg.providerId.length > 0
      const hasModelTier = typeof cfg.modelTier === "string" && cfg.modelTier.length > 0
      const nodeProjectId = normalizeProjectId(cfg.projectId)
      const hasProjectId = Boolean(nodeProjectId)
      const requiresProviderAndModel = node.type === "prompt" || node.type === "switch"
      if (requiresProviderAndModel && !hasProviderId && !def.defaultProviderId) {
        errors.push(missingWorkflowDefaultError({
          node, field: "defaultProviderId", nodeField: "providerId", label: "供应商", cfg,
          defaultNodeTimeoutMins: def.defaultNodeTimeoutMins,
        }))
      }
      if (requiresProviderAndModel && !hasModelTier && !def.defaultModelTier) {
        errors.push(missingWorkflowDefaultError({
          node, field: "defaultModelTier", nodeField: "modelTier", label: "模型层级", cfg,
          defaultNodeTimeoutMins: def.defaultNodeTimeoutMins,
        }))
      }
      if (!hasProjectId && !hasDefaultProjectId) {
        errors.push(missingWorkflowDefaultError({
          node, field: "defaultProjectId", nodeField: "projectId", label: "项目", cfg,
          defaultNodeTimeoutMins: def.defaultNodeTimeoutMins,
        }))
      }
      if (configuredProjectIds) {
        const effectiveProjectId = nodeProjectId ?? defaultProjectId
        if (effectiveProjectId && !configuredProjectIds.has(effectiveProjectId)) {
          errors.push(missingConfiguredProjectError({
            node,
            field: nodeProjectId ? "projectId" : "defaultProjectId",
            projectId: effectiveProjectId,
          }))
        }
      }
    }

    // HTTP request node: validate URL is not empty
    if (node.type === "http_request") {
      const cfg = node.config as Record<string, unknown>
      const url = typeof cfg.url === "string" ? cfg.url.trim() : ""
      if (!url) {
        errors.push({ type: "invalid_config", nodeId: node.id, message: `节点「${node.name}」的 URL 不能为空` })
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
            continue
          }
          seen.add(bid)
        }
      }
    }

    // Variable name uniqueness check
    const vars = (node.config as Record<string, unknown>)["variables"]
    if (Array.isArray(vars)) {
      const varNames = (vars as Array<{ name: string }>).map((v) => v.name).filter(Boolean)
      const seenVar = new Set<string>()
      for (const vname of varNames) {
        if (seenVar.has(vname)) {
          errors.push({ type: "invalid_config", nodeId: node.id, message: `节点「${node.name}」存在重复的变量名「${vname}」` })
          logger.warn("duplicate variable name detected", { workflowId: def.id, nodeId: node.id, nodeName: node.name, duplicateName: vname })
          continue
        }
        seenVar.add(vname)
      }
    }

    if (node.type === "workflow_call") {
      const cfg = node.config as Record<string, unknown>
      const childWorkflowId = typeof cfg.workflowId === "string" ? cfg.workflowId.trim() : ""
      if (!childWorkflowId) {
        errors.push({ type: "invalid_config", nodeId: node.id, nodeName: node.name, field: "workflowId", message: `节点「${node.name}」请选择要调用的工作流` })
      } else if (childWorkflowId === def.id) {
        errors.push({ type: "invalid_config", nodeId: node.id, nodeName: node.name, field: "workflowId", message: `节点「${node.name}」不能调用当前工作流` })
      } else if (availableWorkflowIds && !availableWorkflowIds.has(childWorkflowId)) {
        errors.push({ type: "invalid_config", nodeId: node.id, nodeName: node.name, field: "workflowId", message: `节点「${node.name}」调用的子工作流不存在，请重新选择工作流` })
      }

      const templates = cfg.paramTemplates
      const templateValues = templates && typeof templates === "object" && !Array.isArray(templates)
        ? Object.values(templates as Record<string, unknown>)
        : []
      const boundNames = new Set(
        (Array.isArray(vars) ? vars : [])
          .map((variable) => (variable as Record<string, unknown>).name as string)
          .filter(Boolean),
      )
      for (const value of templateValues) {
        if (typeof value !== "string") continue
        for (const placeholder of extractWorkflowCallTemplateVariables(value)) {
          if (!boundNames.has(placeholder)) {
            errors.push({
              type: "invalid_config",
              nodeId: node.id,
              nodeName: node.name,
              field: "paramTemplates",
              message: `节点「${node.name}」的模板变量「${placeholder}」未绑定，请在节点变量中添加绑定`,
            })
          }
        }
      }

      const childParams = childWorkflowId ? workflowParamsById?.get(childWorkflowId) : undefined
      const templateRecord = templates && typeof templates === "object" && !Array.isArray(templates)
        ? templates as Record<string, unknown>
        : undefined
      if (childParams && templateRecord) {
        for (const childParam of childParams) {
          const template = templateRecord[childParam.name]
          if (!isMultiResourceParam(childParam) || typeof template !== "string" || template.length === 0) continue
          errors.push({
            type: "invalid_config",
            nodeId: node.id,
            nodeName: node.name,
            field: "paramTemplates",
            message: `节点「${node.name}」的多选资源参数「${childParam.name}」不能使用 paramTemplates，必须直接绑定类型和多选设置一致的父工作流参数`,
          })
        }
      }

      const rawBindings = cfg.paramBindings
      const bindingRecord = rawBindings && typeof rawBindings === "object" && !Array.isArray(rawBindings)
        ? rawBindings as Record<string, unknown>
        : undefined
      if (childParams && templateRecord && bindingRecord) {
        for (const childParam of childParams) {
          const template = templateRecord[childParam.name]
          const binding = bindingRecord[childParam.name]
          if (typeof template !== "string" || template.length === 0 || !binding) continue
          errors.push({
            type: "invalid_config",
            nodeId: node.id,
            nodeName: node.name,
            field: "paramBindings",
            message: `节点「${node.name}」的子工作流参数「${childParam.name}」不能同时使用 paramTemplates 和 paramBindings`,
          })
        }
      }
      const bindingTemplateValues = Object.values(bindingRecord ?? {}).flatMap((rawBinding) => {
        if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) return []
        const binding = rawBinding as Partial<WorkflowParamBinding>
        return binding.mode === "template" && typeof binding.template === "string"
          ? [binding.template]
          : []
      })
      for (const value of bindingTemplateValues) {
        for (const placeholder of extractWorkflowCallTemplateVariables(value)) {
          if (!boundNames.has(placeholder)) {
            errors.push({
              type: "invalid_config",
              nodeId: node.id,
              nodeName: node.name,
              field: "paramBindings",
              message: `节点「${node.name}」的模板变量「${placeholder}」未绑定，请在节点变量中添加绑定`,
            })
          }
        }
      }
      if (childParams) {
        for (const childParam of childParams) {
          if (workflowParamHasDefault(childParam)) continue
          const template = templateRecord?.[childParam.name]
          const rawBinding = bindingRecord?.[childParam.name]
          const binding = rawBinding && typeof rawBinding === "object" && !Array.isArray(rawBinding)
            ? rawBinding as Partial<WorkflowParamBinding>
            : undefined
          const hasTemplate = typeof template === "string" && template.trim().length > 0
          const hasBinding = binding?.mode === "value" && Boolean(binding.source)
            || binding?.mode === "template" && typeof binding.template === "string" && binding.template.trim().length > 0
          if (hasTemplate || hasBinding) continue
          errors.push({
            type: "invalid_config",
            nodeId: node.id,
            nodeName: node.name,
            field: "paramBindings",
            message: `节点「${node.name}」的子工作流必填参数「${childParam.name}」未配置，请添加参数模板或绑定`,
          })
        }
      }
      if (childParams && rawBindings && typeof rawBindings === "object" && !Array.isArray(rawBindings)) {
        for (const [childParamName, rawBinding] of Object.entries(rawBindings as Record<string, unknown>)) {
          if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) continue
          const binding = rawBinding as WorkflowParamBinding
          const childParam = childParams.find((param) => param.name === childParamName)
          if (!childParam) continue
          if (binding.mode === "template" && isMultiResourceParam(childParam)) {
            errors.push({
              type: "invalid_config",
              nodeId: node.id,
              nodeName: node.name,
              field: "paramBindings",
              message: `节点「${node.name}」的多选资源参数「${childParam.name}」不能使用模板绑定，必须直接绑定类型和多选设置一致的父工作流参数`,
            })
            continue
          }
          if (binding.mode !== "value" || !binding.source) continue
          const bindingError = validateWorkflowCallValueBinding(childParam, binding.source, def.params)
          if (bindingError) {
            errors.push({
              type: "invalid_config",
              nodeId: node.id,
              nodeName: node.name,
              field: "paramBindings",
              message: bindingError,
            })
          }
        }
      }
    }

    if (node.type === "script") {
      const script = (node.config as Record<string, unknown>).script
      if (typeof script === "string") {
        for (const match of script.matchAll(TEMPLATE_VARIABLE_RE)) {
          errors.push({
            type: "invalid_config",
            nodeId: node.id,
            nodeName: node.name,
            field: "script",
            message: `脚本节点「${node.name}」不支持模板变量「{{${match[1]}}}」，请按 Shell 使用环境变量语法`,
          })
        }
      }
    }

    if (!hasCycle) {
      const anc = ancestors(node.id, revAdj)
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

      // Template variable validation: check that {{...}} placeholders in text
      // fields are covered by the node's bound variable names.
      for (const text of collectTemplateTexts(node)) {
        const placeholders = new Set(
          [...text.matchAll(TEMPLATE_VARIABLE_RE)].map((m) => m[1]),
        )
        if (placeholders.size > 0) {
          const boundNames = new Set(
            (Array.isArray(vars) ? vars : []).map((v) => (v as Record<string, unknown>).name as string).filter(Boolean),
          )
          for (const placeholder of placeholders) {
            if (!boundNames.has(placeholder)) {
              errors.push({
                type: "invalid_config",
                nodeId: node.id,
                message: `节点「${node.name}」的模板变量「${placeholder}」未绑定，请在节点变量中添加绑定`,
              })
            }
          }
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
      continue
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

    const duplicateBranchTargets = new Map<string, { targetIds: string[]; branchLabels: string[] }>()
    for (const branch of branches as Array<{ id: string; label: string }>) {
      const targetIds = [...new Set(def.edges.filter((e) => e.from === node.id && e.branch === branch.id).map((e) => e.to))].sort()
      if (targetIds.length <= 1) continue
      const key = switchBranchTargetKey(targetIds)
      const group = duplicateBranchTargets.get(key) ?? { targetIds, branchLabels: [] }
      group.branchLabels.push(branch.label)
      duplicateBranchTargets.set(key, group)
    }
    for (const group of duplicateBranchTargets.values()) {
      if (group.branchLabels.length < 2) continue
      warnings.push({
        type: "duplicate_switch_branch_targets",
        nodeId: node.id,
        message: `Switch 节点「${node.name}」的分支「${group.branchLabels.join(" / ")}」连接到了同一批下游节点，疑似把互斥分支误连到所有节点；如需汇合，请先连接各分支专属节点再汇合`,
      })
      logger.warn("switch branches share identical multi-target downstream nodes", {
        workflowId: def.id,
        nodeId: node.id,
        nodeName: node.name,
        branchLabels: group.branchLabels,
        targetIds: group.targetIds,
      })
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

export async function validateWorkflowWithResourceDefaults(
  def: WorkflowDefinition,
  options: WorkflowValidationOptions = {},
): Promise<ValidationResult> {
  const result = validateWorkflow(def, options)
  if (!result.valid) return result
  const resourceDefaultErrors = await validateWorkflowResourceDefaults(def)
  if (resourceDefaultErrors.length === 0) return result
  return {
    valid: false,
    errors: [...result.errors, ...resourceDefaultErrors],
    warnings: result.warnings,
  }
}

export function validateRunParams(def: WorkflowDefinition, params: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const param of def.params) {
    const value = params[param.name]
    const hasValue = paramHasValue(params, param.name)
    const hasDefault = workflowParamHasDefault(param)
    if (!hasValue) {
      if (!hasDefault) {
        errors.push({ type: "missing_param", message: `缺少必填参数「${param.name}」` })
      } else if (param.type === "number") {
        const dv = param.default
        if (typeof dv !== "number" || !Number.isFinite(dv)) {
          errors.push({ type: "invalid_config", message: `参数「${param.name}」的数字默认值无效` })
        }
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
    if (isResourceParamType(param.type)) {
      validateRunResourceParam(param, value, errors)
    }
  }
  return errors
}

export function buildEffectiveRunParams(def: WorkflowDefinition, params: Record<string, unknown>): Record<string, unknown> {
  const effective = { ...params }
  for (const param of def.params) {
    const hasValue = paramHasValue(effective, param.name)
    const hasDefault = workflowParamHasDefault(param)
    if (!hasValue && hasDefault) effective[param.name] = param.default
  }
  return effective
}

function paramHasValue(params: Record<string, unknown>, name: string): boolean {
  const value = params[name]
  return Object.prototype.hasOwnProperty.call(params, name)
    && value !== undefined
    && value !== null
    && (!Array.isArray(value) || value.length > 0)
}

function validateRunResourceParam(param: WorkflowParam, value: unknown, errors: ValidationError[]): void {
  const kind = param.type === "file" ? "文件" : "文件夹"
  if (param.allowMultiple !== true) {
    if (Array.isArray(value)) {
      errors.push({ type: "invalid_config", message: `参数「${param.name}」必须是单个${kind}引用` })
    } else if (!isRunResourceInput(value)) {
      errors.push({ type: "invalid_config", message: `参数「${param.name}」必须是${kind}引用` })
    }
    return
  }
  if (!Array.isArray(value)) {
    errors.push({ type: "invalid_config", message: `参数「${param.name}」必须是${kind}引用数组` })
    return
  }
  if (value.length === 0) {
    errors.push({ type: "missing_param", message: `缺少必填参数「${param.name}」` })
    return
  }
  if (value.length > WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS) {
    errors.push({ type: "invalid_config", message: `参数「${param.name}」最多包含 ${WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS} 项` })
    return
  }
  if (value.some((item) => !isRunResourceInput(item))) {
    errors.push({ type: "invalid_config", message: `参数「${param.name}」必须全部是${kind}引用` })
  }
}

function isRunResourceInput(value: unknown): boolean {
  return (typeof value === "string" && value.trim().length > 0)
    || (Boolean(value) && typeof value === "object" && !Array.isArray(value))
}
