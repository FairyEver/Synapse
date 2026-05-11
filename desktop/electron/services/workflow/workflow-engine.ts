import type { WorkflowDefinition, WorkflowRunResult, WorkflowEvent, NodeRunResult } from "../../../src/types/workflow"
import type { AgentSendDeps } from "../../../workflow-nodes/types"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { interpolatePrompt, resolveVariables } from "./variable-resolver"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.engine")

function truncate(text: string | undefined, maxLen: number): string | undefined {
  if (!text) return text
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}...(truncated)`
}

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
    projectId?: string,
  ): Promise<WorkflowRunResult> {
    const effectiveAbortSignal = abortSignal ?? this.abortSignal ?? new AbortController().signal
    if (effectiveAbortSignal.aborted) {
      logger.warn("workflow cancelled before start", { runId, workflowId: def.id })
      const result: WorkflowRunResult = { status: "cancelled", nodeResults: {}, durationMs: 0 }
      emit({ type: "workflow:cancelled", runId, result })
      return result
    }
    emit({ type: "workflow:started", runId, workflowId: def.id })
    const startMs = Date.now()
    const order = topoOrder(def)
    logger.info("workflow run started", { runId, workflowId: def.id, projectId: projectId ?? "(fallback to def.id)", nodeCount: def.nodes.length, executionOrder: order.length, params: paramValues })
    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}
    let overallFailed = false
    const reachableNodes = new Set<string>(
      def.nodes.filter((n) => !def.edges.some((e) => e.to === n.id)).map((n) => n.id)
    )

    for (const nodeId of order) {
      if (effectiveAbortSignal.aborted) {
        logger.warn("workflow cancelled mid-run", { runId, workflowId: def.id, durationMs: Date.now() - startMs })
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
        const reason = overallFailed ? "overall-failed" : "not-reachable"
        logger.info("node skipped", { runId, nodeId, nodeName: node.name, nodeType: node.type, reason })
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
        const template = (cfg as Record<string, unknown>)["template"]
        const interpolatable = typeof prompt === "string" ? prompt : (typeof template === "string" ? template : undefined)
        nr.input = {
          variables: resolved,
          ...(interpolatable !== undefined ? { prompt: interpolatePrompt(interpolatable, resolved) } : {}),
        }

        logger.info("node started", {
          runId, nodeId, nodeType: node.type, nodeName: node.name,
          inputVariables: resolved,
          ...(nr.input.prompt !== undefined ? { prompt: truncate(nr.input.prompt, 200) } : {}),
        })

        const execResult = await executor.execute({
          config: cfg, resolvedVariables: resolved,
          context: { projectId: projectId ?? def.id, runId, abortSignal: effectiveAbortSignal },
          agentDeps: this.agentDeps,
        })
        if (effectiveAbortSignal.aborted) {
          logger.warn("node aborted mid-execution", { runId, nodeId, nodeName: node.name })
          const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
          emit({ type: "workflow:cancelled", runId, result })
          return result
        }
        nr.status = execResult.status; nr.output = execResult.output; nr.outputs = execResult.outputs
        nr.activeBranch = execResult.activeBranch; nr.error = execResult.error
        nr.endedAt = Date.now(); nr.durationMs = execResult.durationMs

        if (execResult.status === "success") {
          logger.info("node succeeded", {
            runId, nodeId, nodeName: node.name, durationMs: nr.durationMs,
            ...(nr.output !== undefined ? { outputPreview: truncate(nr.output, 500) } : {}),
            ...(nr.activeBranch !== undefined ? { activeBranch: nr.activeBranch } : {}),
          })
          nodeOutputs[nodeId] = execResult.output
          emit({ type: "node:completed", runId, nodeId, output: execResult.output, result: { ...nr } })
          for (const e of def.edges.filter((e) => e.from === nodeId)) {
            if (!execResult.activeBranch || e.branch === execResult.activeBranch) {
              reachableNodes.add(e.to)
              logger.info("edge activated", { runId, from: nodeId, to: e.to, branch: e.branch ?? null })
              emit({ type: "edge:activated", runId, from: e.from, to: e.to })
            }
          }
        } else {
          logger.warn("node failed", {
            runId, nodeId, nodeName: node.name, nodeType: node.type, error: execResult.error, durationMs: nr.durationMs,
            inputVariables: nr.input.variables,
            ...(nr.input.prompt !== undefined ? { prompt: truncate(nr.input.prompt, 200) } : {}),
          })
          overallFailed = true
          emit({ type: "node:failed", runId, nodeId, error: execResult.error ?? "Unknown error", result: { ...nr } })
        }
      } catch (err) {
        if (effectiveAbortSignal.aborted) {
          logger.warn("node aborted mid-execution (exception path)", { runId, nodeId, nodeName: node.name })
          const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs: Date.now() - startMs }
          emit({ type: "workflow:cancelled", runId, result })
          return result
        }
        const msg = err instanceof Error ? err.message : String(err)
        logger.warn("node threw exception", {
          runId, nodeId, nodeName: node.name, nodeType: node.type, error: msg,
          ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
        })
        nr.status = "failed"; nr.error = msg; nr.endedAt = Date.now()
        nr.durationMs = nr.startedAt ? nr.endedAt - nr.startedAt : undefined
        overallFailed = true
        emit({ type: "node:failed", runId, nodeId, error: msg, result: { ...nr } })
      }
    }

    const durationMs = Date.now() - startMs
    const endNode = def.nodes.find((n) => n.type === "end")
    const endNodeId = endNode?.id

    // Detect skipped End node: workflow structurally completed but the End node
    // was never reached (e.g. active Switch branch has no path to End).
    if (!overallFailed && endNodeId && !(endNodeId in nodeOutputs)) {
      const endResult = nodeResults[endNodeId]
      if (!endResult || endResult.status === "skipped") {
        overallFailed = true
        const errorMsg = `工作流结束节点「${endNode!.name}」未被执行（当前分支路径未连接到结束节点）`
        logger.warn("end node skipped — treating as failure", { runId, workflowId: def.id, endNodeId, durationMs })
        if (endResult) {
          endResult.status = "failed"
          endResult.error = errorMsg
        } else {
          nodeResults[endNodeId] = { nodeId: endNodeId, status: "failed", input: { variables: {} }, error: errorMsg }
        }
        emit({ type: "node:failed", runId, nodeId: endNodeId, error: errorMsg, result: { ...nodeResults[endNodeId] } })
      }
    }

    const result: WorkflowRunResult = {
      status: overallFailed ? "failed" : "completed",
      nodeResults, durationMs,
      output: endNodeId ? nodeOutputs[endNodeId] : undefined,
    }
    if (overallFailed) {
      logger.error("workflow run failed", { runId, workflowId: def.id, durationMs })
      emit({ type: "workflow:failed", runId, error: "One or more nodes failed", result })
    } else {
      logger.info("workflow run completed", {
        runId, workflowId: def.id, durationMs,
        ...(result.output !== undefined ? { outputPreview: truncate(result.output, 500) } : {}),
      })
      emit({ type: "workflow:completed", runId, result })
    }
    return result
  }
}
