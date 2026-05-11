import type { WorkflowDefinition, WorkflowRunResult, WorkflowEvent, NodeRunResult } from "../../../src/types/workflow"
import type { AgentSendDeps } from "../../../workflow-nodes/types"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { interpolatePrompt, resolveVariables } from "./variable-resolver"

type EventCallback = (event: WorkflowEvent) => void

function topoOrder(def: WorkflowDefinition): string[] {
  const inDeg = new Map(def.nodes.map((n) => [n.id, 0]))
  const adj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) { adj.get(e.from)?.push(e.to); inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1) }
  const queue = def.nodes.filter((n) => inDeg.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!; order.push(id)
    for (const next of adj.get(id) ?? []) { const d = (inDeg.get(next) ?? 0) - 1; inDeg.set(next, d); if (d === 0) queue.push(next) }
  }
  return order
}

export class WorkflowEngine {
  constructor(private readonly agentDeps: AgentSendDeps, private readonly abortSignal?: AbortSignal) {}

  async run(
    def: WorkflowDefinition,
    paramValues: Record<string, unknown>,
    runId: string,
    emit: EventCallback,
    abortSignal?: AbortSignal,
  ): Promise<WorkflowRunResult> {
    const effectiveAbortSignal = abortSignal ?? this.abortSignal ?? new AbortController().signal
    if (effectiveAbortSignal.aborted) {
      const result: WorkflowRunResult = { status: "cancelled", nodeResults: {}, durationMs: 0 }
      emit({ type: "workflow:cancelled", runId, result })
      return result
    }
    emit({ type: "workflow:started", runId, workflowId: def.id })
    const startMs = Date.now()
    const order = topoOrder(def)
    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}
    let overallFailed = false
    const reachableNodes = new Set<string>(
      def.nodes.filter((n) => !def.edges.some((e) => e.to === n.id)).map((n) => n.id)
    )

    for (const nodeId of order) {
      if (effectiveAbortSignal.aborted) {
        const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
        emit({ type: "workflow:cancelled", runId, result })
        return result
      }
      const node = def.nodes.find((n) => n.id === nodeId)!
      const incomingEdges = def.edges.filter((e) => e.to === nodeId)
      const ancestors = incomingEdges.map((e) => e.from)

      const shouldSkip =
        overallFailed ||
        (ancestors.length > 0 && !reachableNodes.has(nodeId))
      if (shouldSkip) {
        const res: NodeRunResult = { nodeId, status: "skipped", input: { variables: {} } }
        nodeResults[nodeId] = res
        emit({ type: "node:skipped", runId, nodeId, result: res })
        continue
      }
      emit({ type: "node:started", runId, nodeId })
      const nr: NodeRunResult = { nodeId, status: "running", input: { variables: {} }, startedAt: Date.now() }
      nodeResults[nodeId] = nr

      try {
        const manifest = nodeTypeRegistry.getManifest(node.type)
        const executor = nodeTypeRegistry.getExecutor(node.type)
        const cfg = manifest.configSchema.parse(node.config)
        const vars = (cfg as Record<string, unknown>)["variables"]
        const nodeNames = Object.fromEntries(def.nodes.map((n) => [n.id, n.name]))
        const resolved = resolveVariables(Array.isArray(vars) ? vars as never : [], paramValues, nodeOutputs, nodeNames)
        const prompt = (cfg as Record<string, unknown>)["prompt"]
        nr.input = {
          variables: resolved,
          ...(typeof prompt === "string" ? { prompt: interpolatePrompt(prompt, resolved) } : {}),
        }

        const execResult = await executor.execute({
          config: cfg, resolvedVariables: resolved,
          context: { projectId: def.id, runId, abortSignal: effectiveAbortSignal },
          agentDeps: this.agentDeps,
        })
        if (effectiveAbortSignal.aborted) {
          const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
          emit({ type: "workflow:cancelled", runId, result })
          return result
        }
        nr.status = execResult.status; nr.output = execResult.output; nr.outputs = execResult.outputs
        nr.activeBranch = execResult.activeBranch; nr.error = execResult.error
        nr.endedAt = Date.now(); nr.durationMs = execResult.durationMs

        if (execResult.status === "success") {
          nodeOutputs[nodeId] = execResult.output
          emit({ type: "node:completed", runId, nodeId, output: execResult.output, result: { ...nr } })
          for (const e of def.edges.filter((e) => e.from === nodeId)) {
            if (!execResult.activeBranch || e.branch === execResult.activeBranch) {
              reachableNodes.add(e.to)
              emit({ type: "edge:activated", runId, from: e.from, to: e.to })
            }
          }
        } else {
          overallFailed = true
          emit({ type: "node:failed", runId, nodeId, error: execResult.error ?? "Unknown error", result: { ...nr } })
        }
      } catch (err) {
        if (effectiveAbortSignal.aborted) {
          const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
          emit({ type: "workflow:cancelled", runId, result })
          return result
        }
        const msg = err instanceof Error ? err.message : String(err)
        nr.status = "failed"; nr.error = msg; nr.endedAt = Date.now()
        nr.durationMs = nr.startedAt ? nr.endedAt - nr.startedAt : undefined
        overallFailed = true
        emit({ type: "node:failed", runId, nodeId, error: msg, result: { ...nr } })
      }
    }

    const durationMs = Date.now() - startMs
    const result: WorkflowRunResult = {
      status: overallFailed ? "failed" : "completed",
      nodeResults, durationMs,
    }
    if (overallFailed) emit({ type: "workflow:failed", runId, error: "One or more nodes failed", result })
    else emit({ type: "workflow:completed", runId, result })
    return result
  }
}
