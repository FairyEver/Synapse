import type { WorkflowDefinition, WorkflowRunResult, WorkflowEvent, NodeRunResult } from "../../../src/types/workflow"
import type { AgentSendDeps } from "../../../workflow-nodes/types"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { interpolatePrompt, resolveVariables } from "./variable-resolver"
import { ReactiveScheduler } from "./workflow-scheduler"
import type { NodeExecOutcome, NodeTask, SchedulerCallbacks } from "./workflow-scheduler"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.engine")

function summarizeRecord(record: Record<string, unknown>): { readonly keys: string[]; readonly count: number } {
  const keys = Object.keys(record)
  return { keys, count: keys.length }
}

function stringDiagnostic(text: string | undefined, errorName: string): { readonly errorName: string; readonly errorLength: number } {
  return {
    errorName,
    errorLength: text?.length ?? 0,
  }
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number; readonly stackLength?: number } {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorLength: error.message.length,
      stackLength: error.stack?.length,
    }
  }

  return {
    errorName: "Error",
    errorLength: String(error).length,
  }
}

type EventCallback = (event: WorkflowEvent) => void

export class WorkflowEngine {
  constructor(private readonly agentDeps: AgentSendDeps, private readonly abortSignal?: AbortSignal) {}

  async run(
    def: WorkflowDefinition,
    paramValues: Record<string, unknown>,
    runId: string,
    emit: EventCallback,
    abortSignal?: AbortSignal,
    projectId?: string,
    triggerSource?: string,
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
    const paramSummary = summarizeRecord(paramValues)
    logger.info("workflow run started", {
      runId,
      workflowId: def.id,
      projectId: projectId ?? "(fallback to def.id)",
      nodeCount: def.nodes.length,
      paramKeys: paramSummary.keys,
      paramCount: paramSummary.count,
      triggerSource: triggerSource ?? "unknown",
    })

    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}

    // --- Reachability pruning (unchanged) ---
    const endNodeForReach = def.nodes.find((n) => n.type === "end")
    const canReachEnd = new Set<string>()
    if (endNodeForReach) {
      canReachEnd.add(endNodeForReach.id)
      const revAdj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
      for (const e of def.edges) { revAdj.get(e.to)?.push(e.from) }
      const bfsQueue = [endNodeForReach.id]
      while (bfsQueue.length) {
        const cur = bfsQueue.shift()!
        for (const prev of revAdj.get(cur) ?? []) {
          if (!canReachEnd.has(prev)) { canReachEnd.add(prev); bfsQueue.push(prev) }
        }
      }
    }

    // Filter to only nodes that can reach end
    const executableNodes = def.nodes
      .filter((n) => canReachEnd.size === 0 || canReachEnd.has(n.id))
      .map((n) => n.id)
    const executableSet = new Set(executableNodes)
    const executableEdges = def.edges
      .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
      .map((e) => ({ from: e.from, to: e.to }))

    // Mark pruned nodes as skipped immediately
    for (const node of def.nodes) {
      if (!executableSet.has(node.id)) {
        logger.info("node skipped", { runId, nodeId: node.id, nodeName: node.name, nodeType: node.type, reason: "not-reachable" })
        const res: NodeRunResult = { nodeId: node.id, status: "skipped", input: { variables: {} } }
        nodeResults[node.id] = res
        emit({ type: "node:skipped", runId, nodeId: node.id, result: res })
      }
    }

    // --- Build taskFactory ---
    const nodeNames = Object.fromEntries(def.nodes.map((n) => [n.id, n.name]))
    const allNodeIds = new Set(def.nodes.map((n) => n.id))

    const taskFactory = (nodeId: string): NodeTask => ({
      nodeId,
      execute: async (): Promise<NodeExecOutcome> => {
        const node = def.nodes.find((n) => n.id === nodeId)!
        try {
          const manifest = nodeTypeRegistry.getManifest(node.type)
          const executor = nodeTypeRegistry.getExecutor(node.type)
          const rawCfg = manifest.configSchema.parse(node.config)
          // Resolve provider/model from workflow defaults when node omits them
          const cfg = (node.type === "prompt" || node.type === "switch")
            ? {
                ...(rawCfg as Record<string, unknown>),
                providerId: (rawCfg as Record<string, unknown>).providerId || def.defaultProviderId,
                modelTier: (rawCfg as Record<string, unknown>).modelTier || def.defaultModelTier,
              }
            : rawCfg
          const vars = (cfg as Record<string, unknown>)["variables"]
          const { resolved, skippedReferences } = resolveVariables(
            Array.isArray(vars) ? vars as never : [], paramValues, nodeOutputs, nodeNames, allNodeIds,
          )
          if (skippedReferences.length > 0) {
            logger.warn("node has variables referencing skipped upstream nodes (resolved to empty)", {
              runId, nodeId, nodeName: node.name,
              skippedReferences: skippedReferences.map((r) => `$${r.variableName} → ${r.sourceNodeName}`),
            })
          }
          const prompt = (cfg as Record<string, unknown>)["prompt"]
          const template = (cfg as Record<string, unknown>)["template"]
          const interpolatable = typeof prompt === "string" ? prompt : (typeof template === "string" ? template : undefined)
          const resolvedPrompt = interpolatable !== undefined ? interpolatePrompt(interpolatable, resolved) : undefined

          // Update NodeRunResult input for this node
          const nr = nodeResults[nodeId]
          if (nr) {
            nr.input = { variables: resolved, ...(resolvedPrompt !== undefined ? { prompt: resolvedPrompt } : {}) }
          }

          const inputVariableSummary = summarizeRecord(resolved)
          logger.info("node started", {
            runId, nodeId, nodeType: node.type, nodeName: node.name,
            triggerSource: triggerSource ?? "unknown",
            inputVariableKeys: inputVariableSummary.keys,
            inputVariableCount: inputVariableSummary.count,
            ...(resolvedPrompt !== undefined ? { promptLength: resolvedPrompt.length } : {}),
          })

          const nodeProjectId = (cfg as Record<string, unknown>)["projectId"] as string | undefined
          const effectiveProjectId = nodeProjectId ?? projectId ?? def.id

          const execResult = await executor.execute({
            config: cfg, resolvedVariables: resolved,
            context: { projectId: effectiveProjectId, runId, abortSignal: effectiveAbortSignal },
            agentDeps: this.agentDeps,
            onProgress: (phase, label) => {
              emit({ type: "node:progress", runId, nodeId, phase, label })
            },
          })

          if (effectiveAbortSignal.aborted) {
            return { nodeId, status: "cancelled", error: "运行被取消", durationMs: execResult.durationMs }
          }

          return {
            nodeId, status: execResult.status, output: execResult.output,
            outputs: execResult.outputs, activeBranch: execResult.activeBranch,
            error: execResult.error, durationMs: execResult.durationMs,
          }
        } catch (err) {
          if (effectiveAbortSignal.aborted) {
            return { nodeId, status: "cancelled", error: "运行被取消" }
          }
          const diagnostic = errorDiagnostic(err)
          const visibleError = visibleNodeExceptionError(diagnostic.errorName, diagnostic.errorLength)
          logger.warn("node threw exception", {
            runId, nodeId, nodeName: node.name, nodeType: node.type,
            ...diagnostic,
          })
          return { nodeId, status: "failed", error: visibleError }
        }
      },
    })

    // --- Build callbacks ---
    const callbacks: SchedulerCallbacks = {
      onNodeReady: (nodeId) => {
        const nodeStartedAt = Date.now()
        emit({ type: "node:started", runId, nodeId, startedAt: nodeStartedAt })
        const nr: NodeRunResult = { nodeId, status: "running", input: { variables: {} }, startedAt: nodeStartedAt }
        nodeResults[nodeId] = nr
      },
      onNodeDone: (outcome) => {
        const nr = nodeResults[outcome.nodeId]
        if (!nr) return
        nr.status = outcome.status
        nr.output = outcome.output
        nr.outputs = outcome.outputs
        nr.activeBranch = outcome.activeBranch
        nr.error = outcome.error
        nr.endedAt = Date.now()
        nr.durationMs = outcome.durationMs

        if (outcome.status === "success") {
          logger.info("node succeeded", {
            runId, nodeId: outcome.nodeId, nodeName: nodeNames[outcome.nodeId], durationMs: nr.durationMs,
            triggerSource: triggerSource ?? "unknown",
            ...(nr.output !== undefined ? { outputLength: nr.output.length } : {}),
            ...(nr.activeBranch !== undefined ? { activeBranch: nr.activeBranch } : {}),
          })
          if (outcome.output !== undefined) nodeOutputs[outcome.nodeId] = outcome.output
          emit({ type: "node:completed", runId, nodeId: outcome.nodeId, output: outcome.output, result: { ...nr } })
        } else if (outcome.status === "cancelled") {
          logger.info("node cancelled", {
            runId, nodeId: outcome.nodeId, nodeName: nodeNames[outcome.nodeId],
            triggerSource: triggerSource ?? "unknown",
          })
        } else {
          const node = def.nodes.find((n) => n.id === outcome.nodeId)
          logger.warn("node failed", {
            runId, nodeId: outcome.nodeId, nodeName: node?.name, nodeType: node?.type,
            triggerSource: triggerSource ?? "unknown",
            ...stringDiagnostic(outcome.error, "agent"),
            durationMs: nr.durationMs,
          })
          emit({ type: "node:failed", runId, nodeId: outcome.nodeId, error: outcome.error ?? "Unknown error", result: { ...nr } })
        }
      },
      resolveActivatedDownstream: (nodeId, outcome) => {
        const activated: string[] = []
        for (const edge of def.edges.filter((e) => e.from === nodeId)) {
          if (!outcome.activeBranch || edge.branch === outcome.activeBranch) {
            activated.push(edge.to)
            logger.info("edge activated", { runId, from: nodeId, to: edge.to, branch: edge.branch ?? null })
            emit({ type: "edge:activated", runId, from: edge.from, to: edge.to })
          }
        }
        return activated
      },
    }

    // --- Execute via scheduler ---
    const scheduler = new ReactiveScheduler({ runId })
    const schedulerResults = await scheduler.execute(
      executableNodes, executableEdges, taskFactory, callbacks, effectiveAbortSignal,
    )

    // Mark scheduler-skipped nodes
    for (const [nodeId, outcome] of schedulerResults) {
      if (!(nodeId in nodeResults)) {
        const node = def.nodes.find((n) => n.id === nodeId)
        logger.info("node skipped", { runId, nodeId, nodeName: node?.name, nodeType: node?.type, reason: "scheduler-skipped", error: outcome.error })
        const res: NodeRunResult = { nodeId, status: "skipped", input: { variables: {} }, ...(outcome.error ? { error: outcome.error } : {}) }
        nodeResults[nodeId] = res
        emit({ type: "node:skipped", runId, nodeId, result: res })
      }
    }

    // --- Post-processing (unchanged) ---
    const durationMs = Date.now() - startMs
    let overallFailed = Object.values(nodeResults).some((nr) => nr.status === "failed")
    const endNode = def.nodes.find((n) => n.type === "end")
    const endNodeId = endNode?.id

    if (effectiveAbortSignal.aborted) {
      // Mark any still-running nodes
      const runningNodes: string[] = []
      for (const nr of Object.values(nodeResults)) {
        if (nr.status === "running") {
          nr.status = "cancelled"; nr.error = "运行被取消"
          nr.endedAt = Date.now()
          nr.durationMs = nr.startedAt ? nr.endedAt - nr.startedAt : undefined
          runningNodes.push(nr.nodeId)
        }
      }
      logger.info("workflow cancelled mid-run", {
        runId,
        workflowId: def.id,
        durationMs,
        triggerSource: triggerSource ?? "unknown",
        runningNodeCount: runningNodes.length,
        runningNodeIds: runningNodes,
      })
      const result: WorkflowRunResult = { status: "cancelled", nodeResults, durationMs }
      emit({ type: "workflow:cancelled", runId, result })
      return result
    }

    if (!overallFailed && endNodeId && !(endNodeId in nodeOutputs)) {
      const endResult = nodeResults[endNodeId]
      if (!endResult || endResult.status === "skipped") {
        overallFailed = true
        const errorMsg = `工作流结束节点「${endNode!.name}」未被执行（当前分支路径未连接到结束节点）`
        logger.warn("end node skipped — treating as failure", { runId, workflowId: def.id, endNodeId, durationMs })
        if (endResult) { endResult.status = "failed"; endResult.error = errorMsg }
        else { nodeResults[endNodeId] = { nodeId: endNodeId, status: "failed", input: { variables: {} }, error: errorMsg } }
        emit({ type: "node:failed", runId, nodeId: endNodeId, error: errorMsg, result: { ...nodeResults[endNodeId] } })
      }
    }

    const result: WorkflowRunResult = {
      status: overallFailed ? "failed" : "completed",
      nodeResults, durationMs,
      output: endNodeId ? nodeOutputs[endNodeId] : undefined,
    }
    if (overallFailed) {
      const failedNode = Object.values(nodeResults).find((nr) => nr.status === "failed" && nr.error)
      const failedNodeName = failedNode ? def.nodes.find((n) => n.id === failedNode.nodeId)?.name : undefined
      const detailedError = failedNode?.error
        ? (failedNodeName ? `节点「${failedNodeName}」失败：${failedNode.error}` : failedNode.error)
        : "One or more nodes failed"
      logger.error("workflow run failed", {
        runId,
        workflowId: def.id,
        durationMs,
        triggerSource: triggerSource ?? "unknown",
        firstFailedNode: failedNode?.nodeId,
        ...stringDiagnostic(detailedError, "workflow"),
      })
      emit({ type: "workflow:failed", runId, error: detailedError, result })
    } else {
      logger.info("workflow run completed", {
        runId, workflowId: def.id, durationMs,
        triggerSource: triggerSource ?? "unknown",
        ...(result.output !== undefined ? { outputLength: result.output.length } : {}),
      })
      emit({ type: "workflow:completed", runId, result })
    }
    return result
  }
}
function visibleNodeExceptionError(errorName: string, errorLength: number): string {
  return `节点执行异常（${errorName}，错误 ${errorLength} 字）`
}
