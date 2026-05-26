import { randomUUID } from "node:crypto"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { WorkflowService, WorkflowSaveResult, WorkflowSaveError } from "../services/workflow/workflow-service"
import type { RunSnapshotService } from "../services/workflow/run-snapshot-service"
import type { NodeTypeRegistry } from "../../workflow-nodes/registry"
import type { EventBus } from "../runtime/event-bus/types"
import type { WorkflowDefinition, WorkflowRunStatus, ValidationError } from "../../src/types/workflow"
import { validateWorkflow } from "../services/workflow/workflow-validator"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import { createMainLogger } from "../services/log-store"
import { layoutWorkflowNodes } from "../../src/lib/workflow-auto-layout"
import type { AuditSink, PermissionGuard } from "../runtime/security"

const logger = createMainLogger("capability.workflow-dispatcher")
const workflowMutationChains = new WeakMap<WorkflowDispatchDeps, Map<string, Promise<void>>>()

export type WorkflowDispatchDeps = {
  workflowService: WorkflowService
  snapshotService: RunSnapshotService
  nodeTypeRegistry: NodeTypeRegistry
  eventBus: EventBus
  runWorkflow: (id: string, params: Record<string, unknown>) => Promise<{ runId: string } | { errors: ValidationError[] }>
  cancelRun: (runId: string) => void
  cancelRunsForWorkflow: (workflowId: string) => Promise<void>
  getRunStatus: (runId: string) => Promise<WorkflowRunStatus | null>
  listProviders?: () => Promise<readonly { id: string; name: string; model?: string; haikuModel?: string; sonnetModel?: string; opusModel?: string }[]>
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
}

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== "string" || !v) throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  return v
}

function requireObject(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key]
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`Missing or invalid '${key}': expected object`)
  return v as Record<string, unknown>
}

function requireNestedString(params: Record<string, unknown>, parentKey: string, key: string): string {
  const v = params[key]
  if (typeof v !== "string" || !v) throw new Error(`Missing or invalid '${parentKey}.${key}': expected non-empty string`)
  return v
}

function requireArray(params: Record<string, unknown>, key: string): unknown[] {
  const v = params[key]
  if (!Array.isArray(v)) throw new Error(`Missing or invalid '${key}': expected array`)
  return v
}

function optionalNonEmptyString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalModelTier(params: Record<string, unknown>): WorkflowDefinition["defaultModelTier"] | undefined {
  const value = params.defaultModelTier
  return value === "default" || value === "haiku" || value === "sonnet" || value === "opus" ? value : undefined
}

function optionalPositiveInteger(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key]
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function requirePosition(value: unknown, label: string): { x: number; y: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid position in ${label}: expected object with x and y numbers`)
  }
  const pos = value as Record<string, unknown>
  if (typeof pos.x !== "number" || !Number.isFinite(pos.x) || typeof pos.y !== "number" || !Number.isFinite(pos.y)) {
    throw new Error(`Invalid position in ${label}: x and y must be finite numbers`)
  }
  return { x: pos.x, y: pos.y }
}

function emitDefinitionUpdated(eventBus: EventBus, workflowId: string, source: string, versionHash: string): void {
  eventBus.emit({
    domain: "workflow",
    type: "workflow:definition-updated",
    payload: { workflowId, source, versionHash },
    timestamp: new Date().toISOString(),
  })
}

async function atomicMutate(
  deps: WorkflowDispatchDeps,
  workflowId: string,
  mutate: (def: WorkflowDefinition) => void,
): Promise<DispatchResult> {
  return withWorkflowMutationLock(deps, workflowId, async () => {
    const def = await deps.workflowService.get(workflowId)
    if (!def) throw new Error(`Workflow not found: ${workflowId}`)
    mutate(def)
    const validation = validateWorkflow(def)
    const saveResult = await deps.workflowService.save(def)
    if ("errors" in saveResult) throw new Error(`Save failed: ${(saveResult as WorkflowSaveError).errors.map((e) => e.message).join("; ")}`)
    emitDefinitionUpdated(deps.eventBus, workflowId, "mcp", (saveResult as WorkflowSaveResult).versionHash)
    return { ok: true, data: { versionHash: (saveResult as WorkflowSaveResult).versionHash, validation } }
  })
}

async function withWorkflowMutationLock<T>(
  deps: WorkflowDispatchDeps,
  workflowId: string,
  task: () => Promise<T>,
): Promise<T> {
  let chains = workflowMutationChains.get(deps)
  if (!chains) {
    chains = new Map()
    workflowMutationChains.set(deps, chains)
  }

  const previous = chains.get(workflowId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  const done = run.then(() => undefined, () => undefined)
  chains.set(workflowId, done)

  try {
    return await run
  } finally {
    if (chains.get(workflowId) === done) {
      chains.delete(workflowId)
    }
  }
}

function autoPosition(nodes: WorkflowDefinition["nodes"]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 200, y: 200 }
  const maxX = Math.max(...nodes.map((n) => n.position.x))
  const avgY = nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
  return { x: maxX + 250, y: avgY }
}

type ActionHandler = (params: Record<string, unknown>, deps: WorkflowDispatchDeps) => Promise<DispatchResult>

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  "workflow.node_type.list": async (_params, deps) => {
    const types = deps.nodeTypeRegistry.listTypes()
    const summaries = types.map((type) => {
      const manifest = deps.nodeTypeRegistry.getManifest(type)
      let title = manifest.title
      let subtitle = ""
      try {
        const summary = manifest.cardSummary({} as never)
        title = summary.title
        subtitle = summary.subtitle
      } catch (err) { logger.warn("cardSummary failed, falling back to manifest.title", { type, error: err instanceof Error ? err.message : String(err) }) }
      return { type, title, subtitle, color: manifest.color }
    })
    return { ok: true, data: summaries }
  },

  "workflow.node_type.describe": async (params, deps) => {
    const nodeType = requireString(params, "nodeType")
    const manifest = deps.nodeTypeRegistry.getManifest(nodeType)
    const configSchema = zodToJsonSchema(manifest.configSchema as unknown as Parameters<typeof zodToJsonSchema>[0])
    const data: Record<string, unknown> = {
      type: manifest.type,
      title: manifest.title,
      color: manifest.color,
      ports: manifest.ports,
      configFields: manifest.configFields,
      configSchema,
    }
    if ((nodeType === "prompt" || nodeType === "switch") && deps.listProviders) {
      const providers = await deps.listProviders()
      data.availableProviders = providers.map((p) => ({
        id: p.id,
        name: p.name,
        models: { default: p.model, haiku: p.haikuModel, sonnet: p.sonnetModel, opus: p.opusModel },
      }))
    }
    return { ok: true, data }
  },

  "workflow.definition.list": async (_params, deps) => {
    const list = await deps.workflowService.list()
    return { ok: true, data: list }
  },

  "workflow.definition.get": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const def = await deps.workflowService.get(workflowId)
    return { ok: true, data: def }
  },

  "workflow.definition.inspect": async (params) => {
    const definition = requireObject(params, "definition") as unknown as WorkflowDefinition
    const result = validateWorkflow(definition)
    return { ok: true, data: result }
  },

  "workflow.run.get": async (params, deps) => {
    const runId = requireString(params, "runId")
    const status = await deps.getRunStatus(runId)
    if (status) return { ok: true, data: status }
    const snapshot = await deps.snapshotService.findByRunId(runId)
    return { ok: true, data: snapshot }
  },

  "workflow.run.list": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const limit = typeof params.limit === "number" ? params.limit : 20
    const snapshots = await deps.snapshotService.list(workflowId)
    return { ok: true, data: snapshots.slice(0, limit) }
  },

  "workflow.definition.create": async (params, deps) => {
    const defaultProjectId = optionalNonEmptyString(params, "defaultProjectId")
    const defaultProviderId = optionalNonEmptyString(params, "defaultProviderId")
    const defaultModelTier = optionalModelTier(params)
    const defaultProviderModel = defaultProviderId && defaultModelTier
      ? { providerId: defaultProviderId, modelTier: defaultModelTier }
      : undefined
    const result = await deps.workflowService.create(defaultProjectId, defaultProviderModel)
    if ("errors" in result) throw new Error(`Create failed: ${result.errors.map((e) => e.message).join("; ")}`)
    let versionHash = result.versionHash
    const defaultNodeTimeoutMins = optionalPositiveInteger(params, "defaultNodeTimeoutMins")
    if (typeof params.name === "string" && params.name || defaultProviderId || defaultModelTier || defaultNodeTimeoutMins !== undefined) {
      const def = await deps.workflowService.get(result.id)
      if (def) {
        if (typeof params.name === "string" && params.name) def.name = params.name
        if (defaultProviderId) def.defaultProviderId = defaultProviderId
        if (defaultModelTier) def.defaultModelTier = defaultModelTier
        if (defaultNodeTimeoutMins !== undefined) def.defaultNodeTimeoutMins = defaultNodeTimeoutMins
        const saveResult = await deps.workflowService.save(def)
        if ("errors" in saveResult) throw new Error(`Save failed: ${(saveResult as WorkflowSaveError).errors.map((e) => e.message).join("; ")}`)
        versionHash = (saveResult as WorkflowSaveResult).versionHash
      }
    }
    emitDefinitionUpdated(deps.eventBus, result.id, "mcp", versionHash)
    return { ok: true, data: { id: result.id, versionHash } }
  },

  "workflow.definition.update": async (params, deps) => {
    const rawDefinition = requireObject(params, "definition")
    const workflowId = requireNestedString(rawDefinition, "definition", "id")
    return withWorkflowMutationLock(deps, workflowId, async () => {
      const existing = await deps.workflowService.get(workflowId)
      if (!existing) throw new Error(`Workflow not found: ${workflowId}`)
      const definition = rawDefinition as unknown as WorkflowDefinition
      // Normalize fields required by the IPC response schema but often missing from
      // external callers (MCP agents). Without this, the saved JSON passes DAG
      // validation but fails Zod response validation when the UI loads it via IPC get.
      const now = Date.now()
      if (typeof definition.createdAt !== "number") definition.createdAt = existing.createdAt ?? now
      if (typeof definition.updatedAt !== "number") definition.updatedAt = now
      if (!definition.version) definition.version = ""
      // Ensure every param has a `default` (required by IPC schema)
      if (Array.isArray(definition.params)) {
        for (const p of definition.params) {
          if ((p as { default?: unknown }).default === undefined) {
            (p as { default: unknown }).default = null
          }
        }
      }
      const saveResult = await deps.workflowService.save(definition)
      if ("errors" in saveResult) throw new Error(`Save failed: ${(saveResult as WorkflowSaveError).errors.map((e) => e.message).join("; ")}`)
      emitDefinitionUpdated(deps.eventBus, workflowId, "mcp", (saveResult as WorkflowSaveResult).versionHash)
      return { ok: true, data: saveResult }
    })
  },

  "workflow.definition.delete": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    await deps.cancelRunsForWorkflow(workflowId)
    await deps.workflowService.delete(workflowId)
    await deps.snapshotService.deleteWorkflow(workflowId)
    emitDefinitionUpdated(deps.eventBus, workflowId, "mcp", "")
    return { ok: true }
  },

  "workflow.run.execute": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const runParams = (params.params as Record<string, unknown>) ?? {}
    const result = await deps.runWorkflow(workflowId, runParams)
    if ("errors" in result) throw new Error(`Execute failed: ${result.errors.map((e) => e.message).join("; ")}`)
    return { ok: true, data: result }
  },

  "workflow.run.disable": async (params, deps) => {
    const runId = requireString(params, "runId")
    deps.cancelRun(runId)
    return { ok: true }
  },

  "workflow.node.create": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const node = requireObject(params, "node")
    let nodeId: string
    const result = await atomicMutate(deps, workflowId, (def) => {
      const position = "position" in node ? requirePosition(node.position, "workflow.node.create") : autoPosition(def.nodes)
      const id = randomUUID()
      nodeId = id
      def.nodes.push({
        id,
        name: (node.name as string) ?? "",
        type: requireString(node, "type"),
        position,
        config: (node.config as Record<string, unknown>) ?? {},
      })
    })
    return { ...result, data: { nodeId: nodeId!, ...result.data as Record<string, unknown> } }
  },

  "workflow.node.update": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const nodeId = requireString(params, "nodeId")
    const patch = requireObject(params, "patch")
    return atomicMutate(deps, workflowId, (def) => {
      const target = def.nodes.find((n) => n.id === nodeId)
      if (!target) throw new Error(`Node not found: ${nodeId}`)
      if (typeof patch.name === "string") target.name = patch.name
      if ("position" in patch) target.position = requirePosition(patch.position, "workflow.node.update")
      if (patch.config) target.config = patch.config as Record<string, unknown>
    })
  },

  "workflow.node.delete": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const nodeId = requireString(params, "nodeId")
    let removedEdgeCount: number
    const result = await atomicMutate(deps, workflowId, (d) => {
      const target = d.nodes.find((n) => n.id === nodeId)
      if (!target) throw new Error(`Node not found: ${nodeId}`)
      if (target.type === "end") throw new Error("Cannot delete the end node")
      const before = d.edges.length
      d.nodes = d.nodes.filter((n) => n.id !== nodeId)
      d.edges = d.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
      removedEdgeCount = before - d.edges.length
    })
    return { ...result, data: { removedEdgeCount: removedEdgeCount!, ...result.data as Record<string, unknown> } }
  },

  "workflow.edge.create": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const from = requireString(params, "from")
    const to = requireString(params, "to")
    const branch = typeof params.branch === "string" ? params.branch : undefined
    let edgeId: string
    const result = await atomicMutate(deps, workflowId, (def) => {
      const id = randomUUID()
      edgeId = id
      const edge: { id: string; from: string; to: string; branch?: string } = { id, from, to }
      if (branch) edge.branch = branch
      def.edges.push(edge)
    })
    return { ...result, data: { edgeId: edgeId!, ...result.data as Record<string, unknown> } }
  },

  "workflow.edge.delete": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const edgeId = requireString(params, "edgeId")
    return atomicMutate(deps, workflowId, (def) => {
      if (!def.edges.some((edge) => edge.id === edgeId)) {
        throw new Error(`Edge not found: ${edgeId}`)
      }
      def.edges = def.edges.filter((e) => e.id !== edgeId)
    })
  },

  "workflow.param.update": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const newParams = requireArray(params, "params")
    for (const p of newParams) {
      if (p && typeof p === "object" && (p as { default?: unknown }).default === undefined) {
        (p as { default: unknown }).default = null
      }
    }
    return atomicMutate(deps, workflowId, (def) => {
      def.params = newParams as WorkflowDefinition["params"]
    })
  },

  "workflow.layout.update": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const direction = typeof params.direction === "string" && (params.direction === "LR" || params.direction === "TB")
      ? params.direction
      : "LR"
    const nodeWidth = 220
    return atomicMutate(deps, workflowId, (def) => {
      if (def.nodes.length === 0) return
      def.nodes = layoutWorkflowNodes(def.nodes, def.edges, { direction, nodeWidth })
    })
  },
}

const MUTATING_WORKFLOW_ACTIONS = new Set([
  "workflow.definition.create",
  "workflow.definition.update",
  "workflow.definition.delete",
  "workflow.run.execute",
  "workflow.run.disable",
  "workflow.node.create",
  "workflow.node.update",
  "workflow.node.delete",
  "workflow.edge.create",
  "workflow.edge.delete",
  "workflow.param.update",
  "workflow.layout.update",
])

function dispatchCorrelation(params: Record<string, unknown>): Record<string, unknown> {
  const correlation: Record<string, unknown> = {}
  if (typeof params.workflowId === "string") correlation.workflowId = params.workflowId
  if (typeof params.runId === "string") correlation.runId = params.runId
  if (typeof params.nodeId === "string") correlation.nodeId = params.nodeId
  if (typeof params.nodeType === "string") correlation.nodeType = params.nodeType
  if (typeof params.edgeId === "string") correlation.edgeId = params.edgeId
  if (typeof params.from === "string") correlation.from = params.from
  if (typeof params.to === "string") correlation.to = params.to
  if (typeof params.branch === "string") correlation.branch = params.branch
  if ("definition" in params) correlation.hasDefinition = true
  if ("params" in params) correlation.hasRunParams = true
  if ("node" in params) correlation.hasNode = true
  if ("patch" in params) correlation.hasPatch = true
  if ("limit" in params) correlation.limit = params.limit
  return correlation
}

function dispatchErrorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorMessage: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const truncated = message.length <= 200 ? message : message.slice(0, 200) + "..."
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: truncated,
  }
}

export function createWorkflowDispatcher(deps: WorkflowDispatchDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const handler = ACTION_HANDLERS[action]
      if (!handler) throw new Error(`Unknown workflow action: ${action}`)
      logger.info("workflow mcp dispatch", { action, ...dispatchCorrelation(params) })
      const security = workflowMutationSecurity(action, params, context)
      if (security) await authorizeWorkflowMutation(deps, security)
      try {
        const result = await handler(params, deps)
        if (security) {
          deps.auditSink?.record({
            action: "workflow.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "allowed",
            metadata: security.metadata,
          })
        }
        logger.info("workflow mcp dispatch succeeded", { action, ...dispatchCorrelation(params) })
        return result
      } catch (error) {
        if (security) {
          deps.auditSink?.record({
            action: "workflow.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "failed",
            metadata: {
              ...security.metadata,
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
        }
        logger.warn("workflow mcp dispatch failed", {
          action,
          ...dispatchCorrelation(params),
          ...dispatchErrorDiagnostic(error),
        })
        throw error
      }
    },
  }
}

function workflowMutationSecurity(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): {
  readonly actor: { kind: "user"; id: string }
  readonly resource: string
  readonly metadata: Record<string, unknown>
} | null {
  if (!MUTATING_WORKFLOW_ACTIONS.has(action)) return null
  const source = context.source ?? "api"
  const correlation = dispatchCorrelation(params)
  const targetId = typeof correlation.workflowId === "string"
    ? correlation.workflowId
    : typeof correlation.runId === "string"
      ? correlation.runId
      : action
  return {
    actor: { kind: "user", id: `workflow-dispatch:${source}` },
    resource: `workflow:${targetId}`,
    metadata: {
      source,
      workflowAction: action,
      ...correlation,
    },
  }
}

async function authorizeWorkflowMutation(
  deps: WorkflowDispatchDeps,
  security: {
    readonly actor: { kind: "user"; id: string }
    readonly resource: string
    readonly metadata: Record<string, unknown>
  },
): Promise<void> {
  const permission = await deps.permissionGuard?.check({
    action: "workflow.mutate",
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "workflow.mutate",
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}
