import type { WorkflowDefinition, WorkflowRunResult, WorkflowEvent, NodeRunResult, WorkflowNodeUsageCostSnapshot } from "../../../src/types/workflow"
import type { SynapseAgentConversationReference } from "../../../src/types/agent-navigation"
import type { AgentSendDeps, NodeExecutionResult, NodeRuntimeDeps, WorkflowCallStackEntry } from "../../../workflow-nodes/types"
import type { ActorIdentity } from "../../runtime/security"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { DEFAULT_AGENT_TIMEOUT_MINS } from "../../../workflow-nodes/agent-timeout"
import { interpolatePrompt, resolveVariables } from "./variable-resolver"
import { ReactiveScheduler } from "./workflow-scheduler"
import type { NodeExecOutcome, NodeTask, SchedulerCallbacks } from "./workflow-scheduler"
import { createMainLogger } from "../log-store"
import { sanitizeError } from "../error-sanitize"
import { computeFullExecutionSet } from "./workflow-utils"

const logger = createMainLogger("service.workflow.engine")
const DEFAULT_WORKFLOW_MAX_CONCURRENCY = 5

type WorkflowRunAttribution = {
  readonly automationId?: string
  readonly automationRunId?: string
}

function stringDiagnostic(text: string | undefined, errorName: string): { readonly errorName: string; readonly errorMessage?: string; readonly errorLength: number } {
  return {
    errorName,
    errorMessage: text ? sanitizeError(text) : undefined,
    errorLength: text?.length ?? 0,
  }
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorMessage: string; readonly errorLength: number; readonly stackLength?: number } {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: sanitizeError(error.message),
      errorLength: error.message.length,
      stackLength: error.stack?.length,
    }
  }

  const str = String(error)
  return {
    errorName: "Error",
    errorMessage: sanitizeError(str),
    errorLength: str.length,
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function mergeAgentConversationOutput(
  outputs: Record<string, unknown> | undefined,
  agentConversation: SynapseAgentConversationReference | undefined,
): NodeRunResult["outputs"] {
  if (!agentConversation) return outputs as NodeRunResult["outputs"]
  return {
    ...(outputs ?? {}),
    agentConversation,
  }
}

function buildWorkflowUsageCostSnapshot(result: NodeExecutionResult): WorkflowNodeUsageCostSnapshot | undefined {
  if (!result.usage || !result.modelName) return undefined
  if (
    result.costCurrency === "CNY"
    && typeof result.costCny === "number"
    && result.costBreakdownCny
  ) {
    return {
      modelName: result.modelName,
      costCny: result.costCny,
      costBreakdownCny: result.costBreakdownCny,
      costCurrency: "CNY",
      priceKnown: true,
      estimatedCost: true,
    }
  }
  return {
    modelName: result.modelName,
    priceKnown: false,
    estimatedCost: false,
  }
}

function summarizeWorkflowUsageAndCost(
  nodeResults: Record<string, NodeRunResult>,
): { readonly usage?: Record<string, number>; readonly totalCostUsd?: number } {
  const usage: Record<string, number> = {}
  let hasUsage = false
  let totalCostUsd = 0
  let hasCostUsd = false

  for (const result of Object.values(nodeResults)) {
    if (result.usage) {
      for (const [key, value] of Object.entries(result.usage)) {
        if (typeof value !== "number" || !Number.isFinite(value)) continue
        usage[key] = (usage[key] ?? 0) + value
        hasUsage = true
      }
    }
    if (typeof result.costUsd === "number" && Number.isFinite(result.costUsd)) {
      totalCostUsd += result.costUsd
      hasCostUsd = true
    }
  }

  return {
    ...(hasUsage ? { usage } : {}),
    ...(hasCostUsd ? { totalCostUsd: Number(totalCostUsd.toFixed(12)) } : {}),
  }
}

type EventCallback = (event: WorkflowEvent) => void

export class WorkflowEngine {
  constructor(private readonly agentDeps: AgentSendDeps, private readonly abortSignal?: AbortSignal, private readonly runtimeDeps?: NodeRuntimeDeps) {}

  async run(
    def: WorkflowDefinition,
    paramValues: Record<string, unknown>,
    runId: string,
    emit: EventCallback,
    abortSignal?: AbortSignal,
    projectId?: string,
    triggerSource?: string,
    actor?: ActorIdentity,
    callStack?: readonly WorkflowCallStackEntry[],
    attribution?: WorkflowRunAttribution,
  ): Promise<WorkflowRunResult> {
    const effectiveAbortSignal = abortSignal ?? this.abortSignal ?? new AbortController().signal
    if (effectiveAbortSignal.aborted) {
      logger.warn("workflow cancelled before start", { runId, workflowId: def.id })
      const result: WorkflowRunResult = { status: "cancelled", nodeResults: {}, durationMs: 0 }
      emit({ type: "workflow:cancelled", runId, workflowId: def.id, result })
      return result
    }
    emit({ type: "workflow:started", runId, workflowId: def.id })
    const startMs = Date.now()
    const paramKeys = Object.keys(paramValues)
    logger.info("workflow run started", {
      runId,
      workflowId: def.id,
      projectId: projectId ?? "(none)",
      nodeCount: def.nodes.length,
      paramKeys,
      paramCount: paramKeys.length,
      triggerSource: triggerSource ?? "unknown",
    })

    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}
    const workflowCallStack: readonly WorkflowCallStackEntry[] = callStack && callStack.length > 0
      ? callStack
      : [{ workflowId: def.id, workflowName: def.name }]

    // --- Reachability pruning (includes side-effect branches) ---
    let executionSet: ReturnType<typeof computeFullExecutionSet>
    try {
      executionSet = computeFullExecutionSet(def)
    } catch (err) {
      const diagnostic = errorDiagnostic(err)
      const rawMessage = err instanceof Error ? err.message : String(err)
      const visibleError = `工作流执行准备失败：${sanitizeError(rawMessage)}`
      logger.warn("workflow preparation failed", {
        runId,
        workflowId: def.id,
        triggerSource: triggerSource ?? "unknown",
        ...diagnostic,
      })
      const result: WorkflowRunResult = { status: "failed", nodeResults, durationMs: Date.now() - startMs }
      emit({ type: "workflow:failed", runId, workflowId: def.id, error: visibleError, result })
      return result
    }
    const { executableNodeIds, implicitEdges } = executionSet

    if (executableNodeIds.size === 0) {
      const hasEndNode = def.nodes.some((n) => n.type === "end")
      const visibleError = hasEndNode ? "没有节点连接到结束节点，无法执行" : "工作流缺少结束节点，无法执行"
      logger.warn("workflow has no executable nodes — aborting", { runId, workflowId: def.id, hasEndNode })
      const result: WorkflowRunResult = { status: "failed", nodeResults, durationMs: Date.now() - startMs }
      emit({ type: "workflow:failed", runId, workflowId: def.id, error: visibleError, result })
      return result
    }
    const executableNodes = def.nodes
      .filter((n) => executableNodeIds.has(n.id))
      .map((n) => n.id)
    const executableSet = new Set(executableNodes)
    const executableEdgesRaw = [
      ...def.edges
        .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
        .map((e) => ({ from: e.from, to: e.to })),
      ...implicitEdges,
    ]
    // Deduplicate by from+to to prevent inflated pending counts when
    // multiple switch branch edges target the same node.
    const edgeKeySeen = new Set<string>()
    const executableEdges = executableEdgesRaw.filter((e) => {
      const key = `${e.from}->${e.to}`
      if (edgeKeySeen.has(key)) return false
      edgeKeySeen.add(key)
      return true
    })

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
        const node = def.nodes.find((n) => n.id === nodeId)
        if (!node) {
          logger.warn("taskFactory: node ID not found in definition", { runId, nodeId })
          return { nodeId, status: "failed", error: `节点 ID「${nodeId}」在工作流定义中不存在` }
        }
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
                timeoutMins: (rawCfg as Record<string, unknown>).timeoutMins ?? def.defaultNodeTimeoutMins ?? DEFAULT_AGENT_TIMEOUT_MINS,
              }
            : (node.type === "codex" || node.type === "claude_code")
              ? {
                  ...(rawCfg as Record<string, unknown>),
                  timeoutMins: (rawCfg as Record<string, unknown>).timeoutMins ?? def.defaultNodeTimeoutMins ?? DEFAULT_AGENT_TIMEOUT_MINS,
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
          const recordedPrompt = typeof prompt === "string" ? resolvedPrompt : undefined

          // Update NodeRunResult input for this node
          const nr = nodeResults[nodeId]
          if (nr) {
            nr.input = { variables: resolved, ...(recordedPrompt !== undefined ? { prompt: recordedPrompt } : {}) }
          }
          emit({ type: "node:started", runId, nodeId, startedAt: nr?.startedAt, result: nr ? { ...nr } : undefined })

          const inputVariableKeys = Object.keys(resolved)
          logger.info("node started", {
            runId, nodeId, nodeType: node.type, nodeName: node.name,
            triggerSource: triggerSource ?? "unknown",
            inputVariableKeys,
            inputVariableCount: inputVariableKeys.length,
            ...(resolvedPrompt !== undefined ? { promptLength: resolvedPrompt.length } : {}),
          })

          const nodeProjectId = normalizeOptionalString((cfg as Record<string, unknown>)["projectId"])
          const effectiveProjectId = nodeProjectId ?? projectId

          const execResult = await executor.execute({
            config: cfg,
            resolvedVariables: resolved,
            ...(node.type === "workflow_call" ? { nodeOutputs: { ...nodeOutputs } } : {}),
            paramValues,
            paramDefinitions: def.params,
            context: {
              projectId: effectiveProjectId,
              workflowId: def.id,
              workflowName: def.name,
              runId,
              nodeId,
              nodeName: node.name,
              abortSignal: effectiveAbortSignal,
              actor,
              automationId: attribution?.automationId,
              automationRunId: attribution?.automationRunId,
              workflowCallStack,
            },
            agentDeps: this.agentDeps,
            runtimeDeps: this.runtimeDeps,
            onProgress: (phase, label) => {
              emit({ type: "node:progress", runId, nodeId, phase, label })
            },
            onAgentConversation: (target) => {
              const existing = nodeResults[nodeId]
                ?? { nodeId, status: "running" as const, input: { variables: {} } }
              nodeResults[nodeId] = {
                ...existing,
                outputs: mergeAgentConversationOutput(existing.outputs, target),
              }
              emit({ type: "node:agent-conversation", runId, nodeId, target })
            },
          })

          if (effectiveAbortSignal.aborted) {
            return {
              nodeId,
              status: "cancelled",
              output: execResult.output,
              outputs: mergeAgentConversationOutput(execResult.outputs, execResult.agentConversation),
              agentConversation: execResult.agentConversation,
              error: execResult.status === "cancelled" && execResult.error
                ? execResult.error
                : "运行被取消",
              durationMs: execResult.durationMs,
            }
          }
          const usageCost = buildWorkflowUsageCostSnapshot(execResult)

          return {
            nodeId, status: execResult.status, output: execResult.output,
            outputs: mergeAgentConversationOutput(execResult.outputs, execResult.agentConversation),
            activeBranch: execResult.activeBranch,
            error: execResult.error, durationMs: execResult.durationMs,
            usage: execResult.usage,
            modelName: execResult.modelName,
            costUsd: execResult.costUsd,
            costCny: execResult.costCny,
            costBreakdownCny: execResult.costBreakdownCny,
            costCurrency: execResult.costCurrency,
            usageCost,
            agentConversation: execResult.agentConversation,
          }
        } catch (err) {
          if (effectiveAbortSignal.aborted) {
            return { nodeId, status: "cancelled", error: "运行被取消" }
          }
          const diagnostic = errorDiagnostic(err)
          const rawMessage = err instanceof Error ? err.message : String(err)
          const visibleError = `节点执行异常：${sanitizeError(rawMessage)}`
          logger.warn("node threw exception", {
            runId, nodeId, nodeName: node.name, nodeType: node.type,
            triggerSource: triggerSource ?? "unknown",
            ...diagnostic,
          })
          const throwDurationMs = nodeResults[nodeId]?.startedAt != null ? Date.now() - nodeResults[nodeId].startedAt! : undefined
          return { nodeId, status: "failed", error: visibleError, durationMs: throwDurationMs }
        }
      },
    })

    // --- Build callbacks ---
    const callbacks: SchedulerCallbacks = {
      onNodeReady: (nodeId) => {
        const nodeStartedAt = Date.now()
        const nr: NodeRunResult = { nodeId, status: "running", input: { variables: {} }, startedAt: nodeStartedAt }
        nodeResults[nodeId] = nr
      },
      onNodeDone: (outcome) => {
        let nr = nodeResults[outcome.nodeId]
        if (!nr) {
          // taskFactory threw before onNodeReady — no entry exists yet.
          // Initialize from the outcome so the failure is recorded correctly
          // instead of being silently dropped and later marked as "skipped".
          if (outcome.status === "failed") {
            nr = { nodeId: outcome.nodeId, status: "failed", input: { variables: {} }, error: outcome.error, endedAt: Date.now() }
            nodeResults[outcome.nodeId] = nr
          } else {
            return
          }
        }
        nr.status = outcome.status
        nr.output = outcome.output
        nr.outputs = mergeAgentConversationOutput(
          outcome.outputs,
          outcome.agentConversation ?? nr.outputs?.agentConversation,
        )
        nr.activeBranch = outcome.activeBranch
        nr.error = outcome.error
        nr.usage = outcome.usage
        nr.costUsd = outcome.costUsd
        nr.costCny = outcome.costCny
        nr.costCurrency = outcome.costCurrency
        nr.usageCost = outcome.usageCost
        nr.endedAt = Date.now()
        nr.durationMs = outcome.durationMs

        if (outcome.status === "success") {
          logger.info("node succeeded", {
            runId, nodeId: outcome.nodeId, nodeName: nodeNames[outcome.nodeId], durationMs: nr.durationMs,
            triggerSource: triggerSource ?? "unknown",
            ...(nr.output !== undefined ? { outputLength: nr.output.length } : {}),
            ...(nr.activeBranch !== undefined ? { activeBranch: nr.activeBranch } : {}),
            ...(nr.usage !== undefined ? { usage: nr.usage } : {}),
            ...(nr.costUsd !== undefined ? { costUsd: nr.costUsd } : {}),
            ...(nr.costCny !== undefined ? { costCny: nr.costCny, costCurrency: nr.costCurrency } : {}),
            ...(nr.usageCost !== undefined ? { usageCost: nr.usageCost } : {}),
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
            ...(nr.usage !== undefined ? { usage: nr.usage } : {}),
            ...(nr.costUsd !== undefined ? { costUsd: nr.costUsd } : {}),
            ...(nr.costCny !== undefined ? { costCny: nr.costCny, costCurrency: nr.costCurrency } : {}),
            ...(nr.usageCost !== undefined ? { usageCost: nr.usageCost } : {}),
          })
          emit({ type: "node:failed", runId, nodeId: outcome.nodeId, error: outcome.error ?? "Unknown error", result: { ...nr } })
        }
      },
      resolveActivatedDownstream: (nodeId, outcome) => {
        const activated: string[] = []
        // Iterate def.edges directly to preserve branch info and avoid
        // find()-by-from+to ambiguity when multiple branch edges share a target.
        for (const defEdge of def.edges.filter((e) => e.from === nodeId && executableSet.has(e.to))) {
          if (!outcome.activeBranch || !defEdge.branch || defEdge.branch === outcome.activeBranch) {
            if (!activated.includes(defEdge.to)) {
              activated.push(defEdge.to)
              logger.info("edge activated", { runId, from: nodeId, to: defEdge.to, branch: defEdge.branch ?? null })
              emit({ type: "edge:activated", runId, from: defEdge.from, to: defEdge.to })
            }
          }
        }
        // Implicit edges (side-effect leaf → End) only activate on success
        if (outcome.status === "success") {
          for (const ie of implicitEdges.filter((e) => e.from === nodeId)) {
            if (!activated.includes(ie.to)) {
              activated.push(ie.to)
              logger.info("edge activated", { runId, from: nodeId, to: ie.to, branch: null })
              emit({ type: "edge:activated", runId, from: ie.from, to: ie.to })
            }
          }
        }
        return activated
      },
    }

    // --- Execute via scheduler ---
    const scheduler = new ReactiveScheduler({ runId, maxConcurrency: DEFAULT_WORKFLOW_MAX_CONCURRENCY })
    const schedulerResults = await scheduler.execute(
      executableNodes, executableEdges, taskFactory, callbacks, effectiveAbortSignal,
    )

    // Mark scheduler outcomes that never reached onNodeReady/onNodeDone.
    for (const [nodeId, outcome] of schedulerResults) {
      if (!(nodeId in nodeResults)) {
        const node = def.nodes.find((n) => n.id === nodeId)
        const res: NodeRunResult = {
          nodeId,
          status: outcome.status,
          input: { variables: {} },
          ...(outcome.output !== undefined ? { output: outcome.output } : {}),
          ...(outcome.outputs !== undefined ? { outputs: outcome.outputs } : {}),
          ...(outcome.activeBranch !== undefined ? { activeBranch: outcome.activeBranch } : {}),
          ...(outcome.error ? { error: outcome.error } : {}),
          ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
        }
        nodeResults[nodeId] = res
        if (outcome.status === "skipped") {
          logger.info("node skipped", { runId, nodeId, nodeName: node?.name, nodeType: node?.type, reason: "scheduler-skipped", error: outcome.error })
          emit({ type: "node:skipped", runId, nodeId, result: res })
        } else if (outcome.status === "cancelled") {
          logger.info("node cancelled", { runId, nodeId, nodeName: node?.name, nodeType: node?.type, reason: "scheduler-cancelled" })
        } else if (outcome.status === "failed") {
          logger.warn("node failed", { runId, nodeId, nodeName: node?.name, nodeType: node?.type, reason: "scheduler-failed", ...stringDiagnostic(outcome.error, "scheduler") })
          emit({ type: "node:failed", runId, nodeId, error: outcome.error ?? "Unknown error", result: { ...res } })
        } else {
          logger.info("node succeeded", { runId, nodeId, nodeName: node?.name, nodeType: node?.type, reason: "scheduler-success" })
          if (outcome.output !== undefined) nodeOutputs[nodeId] = outcome.output
          emit({ type: "node:completed", runId, nodeId, output: outcome.output, result: { ...res } })
        }
      }
    }

    // --- Post-processing (unchanged) ---
    const durationMs = Date.now() - startMs
    let overallFailed = Object.values(nodeResults).some((nr) => nr.status === "failed")
    const endNode = def.nodes.find((n) => n.type === "end")
    const endNodeId = endNode?.id

    if (effectiveAbortSignal.aborted) {
      // Mark any still-running nodes as cancelled (skipped nodes stay skipped)
      const runningNodes: string[] = []
      for (const nr of Object.values(nodeResults)) {
        if (nr.status === "running") {
          nr.status = "cancelled"; nr.error = "运行被取消"
          nr.endedAt = nr.endedAt ?? Date.now()
          nr.durationMs = nr.startedAt ? (nr.endedAt ?? Date.now()) - nr.startedAt : undefined
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
      emit({ type: "workflow:cancelled", runId, workflowId: def.id, result })
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
    const usageAndCost = summarizeWorkflowUsageAndCost(nodeResults)
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
        ...usageAndCost,
        ...stringDiagnostic(detailedError, "workflow"),
      })
      emit({ type: "workflow:failed", runId, workflowId: def.id, error: detailedError, result })
    } else {
      logger.info("workflow run completed", {
        runId, workflowId: def.id, durationMs,
        triggerSource: triggerSource ?? "unknown",
        ...usageAndCost,
        ...(result.output !== undefined ? { outputLength: result.output.length } : {}),
      })
      emit({ type: "workflow:completed", runId, workflowId: def.id, result })
    }
    return result
  }
}
