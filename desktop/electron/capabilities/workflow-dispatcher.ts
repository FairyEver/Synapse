import { randomUUID } from "node:crypto"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { WorkflowService, WorkflowSaveResult, WorkflowSaveError } from "../services/workflow/workflow-service"
import type { RunSnapshotService } from "../services/workflow/run-snapshot-service"
import type { NodeTypeRegistry } from "../../workflow-nodes/registry"
import type { EventBus } from "../runtime/event-bus/types"
import type { WorkflowDefinition, WorkflowRunStatus, ValidationError } from "../../src/types/workflow"
import { validateWorkflow } from "../services/workflow/workflow-validator"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

export type WorkflowDispatchDeps = {
  workflowService: WorkflowService
  snapshotService: RunSnapshotService
  nodeTypeRegistry: NodeTypeRegistry
  eventBus: EventBus
  runWorkflow: (id: string, params: Record<string, unknown>) => Promise<{ runId: string } | { errors: ValidationError[] }>
  cancelRun: (runId: string) => void
  getRunStatus: (runId: string) => Promise<WorkflowRunStatus | null>
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

function requireArray(params: Record<string, unknown>, key: string): unknown[] {
  const v = params[key]
  if (!Array.isArray(v)) throw new Error(`Missing or invalid '${key}': expected array`)
  return v
}

function emitDefinitionUpdated(eventBus: EventBus, workflowId: string): void {
  eventBus.emit({
    domain: "workflow",
    type: "workflow:definition-updated",
    payload: { workflowId },
    timestamp: new Date().toISOString(),
  })
}

async function atomicMutate(
  deps: WorkflowDispatchDeps,
  workflowId: string,
  mutate: (def: WorkflowDefinition) => void,
): Promise<DispatchResult> {
  const def = await deps.workflowService.get(workflowId)
  if (!def) throw new Error(`Workflow not found: ${workflowId}`)
  mutate(def)
  const validation = validateWorkflow(def)
  const saveResult = await deps.workflowService.save(def)
  if ("errors" in saveResult) throw new Error(`Save failed: ${(saveResult as WorkflowSaveError).errors.map((e) => e.message).join("; ")}`)
  emitDefinitionUpdated(deps.eventBus, workflowId)
  return { ok: true, data: { versionHash: (saveResult as WorkflowSaveResult).versionHash, validation } }
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
      } catch { /* fallback to manifest.title */ }
      return { type, title, subtitle, color: manifest.color }
    })
    return { ok: true, data: summaries }
  },

  "workflow.node_type.describe": async (params, deps) => {
    const nodeType = requireString(params, "nodeType")
    const manifest = deps.nodeTypeRegistry.getManifest(nodeType)
    const configSchema = zodToJsonSchema(manifest.configSchema as unknown as Parameters<typeof zodToJsonSchema>[0])
    return {
      ok: true,
      data: {
        type: manifest.type,
        title: manifest.title,
        color: manifest.color,
        ports: manifest.ports,
        configFields: manifest.configFields,
        configSchema,
      },
    }
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
    const result = await deps.workflowService.create()
    if ("errors" in result) throw new Error(`Create failed: ${result.errors.map((e) => e.message).join("; ")}`)
    if (typeof params.name === "string" && params.name) {
      const def = await deps.workflowService.get(result.id)
      if (def) {
        def.name = params.name
        await deps.workflowService.save(def)
      }
    }
    emitDefinitionUpdated(deps.eventBus, result.id)
    return { ok: true, data: result }
  },

  "workflow.definition.update": async (params, deps) => {
    const definition = requireObject(params, "definition") as unknown as WorkflowDefinition
    const saveResult = await deps.workflowService.save(definition)
    if ("errors" in saveResult) throw new Error(`Save failed: ${(saveResult as WorkflowSaveError).errors.map((e) => e.message).join("; ")}`)
    emitDefinitionUpdated(deps.eventBus, definition.id)
    return { ok: true, data: saveResult }
  },

  "workflow.definition.delete": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    deps.cancelRun(workflowId)
    await deps.workflowService.delete(workflowId)
    await deps.snapshotService.deleteWorkflow(workflowId)
    emitDefinitionUpdated(deps.eventBus, workflowId)
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
    return atomicMutate(deps, workflowId, (def) => {
      const position = node.position as { x: number; y: number } | undefined ?? autoPosition(def.nodes)
      def.nodes.push({
        id: randomUUID(),
        name: (node.name as string) ?? "",
        type: requireString(node, "type"),
        position,
        config: (node.config as Record<string, unknown>) ?? {},
      })
    })
  },

  "workflow.node.update": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const nodeId = requireString(params, "nodeId")
    const patch = requireObject(params, "patch")
    return atomicMutate(deps, workflowId, (def) => {
      const target = def.nodes.find((n) => n.id === nodeId)
      if (!target) throw new Error(`Node not found: ${nodeId}`)
      if (typeof patch.name === "string") target.name = patch.name
      if (patch.position) target.position = patch.position as { x: number; y: number }
      if (patch.config) target.config = patch.config as Record<string, unknown>
    })
  },

  "workflow.node.delete": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const nodeId = requireString(params, "nodeId")
    return atomicMutate(deps, workflowId, (def) => {
      def.nodes = def.nodes.filter((n) => n.id !== nodeId)
      def.edges = def.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
    })
  },

  "workflow.edge.create": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const from = requireString(params, "from")
    const to = requireString(params, "to")
    const branch = typeof params.branch === "string" ? params.branch : undefined
    return atomicMutate(deps, workflowId, (def) => {
      const edge: { id: string; from: string; to: string; branch?: string } = { id: randomUUID(), from, to }
      if (branch) edge.branch = branch
      def.edges.push(edge)
    })
  },

  "workflow.edge.delete": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const edgeId = requireString(params, "edgeId")
    return atomicMutate(deps, workflowId, (def) => {
      def.edges = def.edges.filter((e) => e.id !== edgeId)
    })
  },

  "workflow.param.update": async (params, deps) => {
    const workflowId = requireString(params, "workflowId")
    const newParams = requireArray(params, "params")
    return atomicMutate(deps, workflowId, (def) => {
      def.params = newParams as WorkflowDefinition["params"]
    })
  },
}

export function createWorkflowDispatcher(deps: WorkflowDispatchDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, _context: DispatchContext): Promise<DispatchResult> {
      const handler = ACTION_HANDLERS[action]
      if (!handler) throw new Error(`Unknown workflow action: ${action}`)
      return handler(params, deps)
    },
  }
}
