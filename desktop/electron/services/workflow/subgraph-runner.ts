import type { SubgraphDefinition, AgentSendDeps, NodeRuntimeDeps } from "../../../workflow-nodes/types"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { ReactiveScheduler } from "./workflow-scheduler"
import { resolveVariables, interpolatePrompt } from "./variable-resolver"
import type { NodeExecOutcome, NodeTask, SchedulerCallbacks } from "./workflow-scheduler"
import type { WorkflowEvent, NodeRunResult } from "../../../src/types/workflow"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.subgraph-runner")

export interface SubgraphRunnerInput {
  subgraph: SubgraphDefinition
  contextVariables: Record<string, unknown>
  inheritedParams?: Record<string, unknown>
  nodeRegistry: typeof nodeTypeRegistry
  agentDeps: AgentSendDeps
  runtimeDeps?: NodeRuntimeDeps
  abortSignal: AbortSignal
  onNodeEvent?: (event: WorkflowEvent & { iterationIndex?: number }) => void
}

export interface SubgraphRunnerOutput {
  status: "success" | "failed" | "cancelled"
  exitPort: "continue" | "break"
  nodeResults: Record<string, NodeRunResult>
  outputData: Record<string, unknown>
  durationMs: number
}

export class SubgraphRunner {
  async run(input: SubgraphRunnerInput): Promise<SubgraphRunnerOutput> {
    const startMs = Date.now()
    const { subgraph, contextVariables, agentDeps, runtimeDeps, abortSignal, onNodeEvent, inheritedParams, nodeRegistry } = input
    const { nodes, edges } = subgraph

    // Early return if already aborted
    if (abortSignal.aborted) {
      const durationMs = Date.now() - startMs
      return { status: "cancelled", exitPort: "continue", nodeResults: {}, outputData: {}, durationMs }
    }

    // Build executable node list (skip loop-input special node — not an actual execution node)
    const executableNodes = nodes
      .filter((n) => n.type !== "loop-input")
      .map((n) => n.id)
    const executableSet = new Set(executableNodes)
    const executableEdges = edges
      .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
      .map((e) => ({ from: e.from, to: e.to }))

    const nodeNames = Object.fromEntries(nodes.map((n) => [n.id, n.name]))
    const allNodeIds = new Set(nodes.map((n) => n.id))
    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}
    let terminalNodeOutput: NodeExecOutcome | undefined

    // Merge contextVariables with inheritedParams so resolveVariables sees both
    const paramValues = { ...inheritedParams, ...contextVariables }

    const taskFactory = (nodeId: string): NodeTask => ({
      nodeId,
      execute: async () => {
        const node = nodes.find((n) => n.id === nodeId)!
        try {
          const manifest = nodeRegistry.getManifest(node.type)
          const executor = nodeRegistry.getExecutor(node.type)
          const rawCfg = manifest.configSchema.parse(node.config)
          const cfg = (node.type === "prompt" || node.type === "switch")
            ? { ...rawCfg, providerId: rawCfg.providerId || "", modelTier: rawCfg.modelTier || "default" }
            : rawCfg
          const vars = (cfg as Record<string, unknown>)["variables"]
          const { resolved } = resolveVariables(
            Array.isArray(vars) ? vars as never : [], paramValues, nodeOutputs, nodeNames, allNodeIds,
          )
          const prompt = (cfg as Record<string, unknown>)["prompt"]
          const template = (cfg as Record<string, unknown>)["template"]
          const interpolatable = typeof prompt === "string" ? prompt : (typeof template === "string" ? template : undefined)
          const resolvedPrompt = interpolatable !== undefined ? interpolatePrompt(interpolatable, resolved) : undefined

          const execResult = await executor.execute({
            config: cfg, resolvedVariables: resolved,
            context: { projectId: "", runId: "", abortSignal },
            agentDeps, runtimeDeps,
            onProgress: (phase, label) => {
              const event: Record<string, unknown> = { type: "node:progress", runId: "", nodeId, phase, label, iterationIndex: undefined }
              onNodeEvent?.(event as WorkflowEvent & { iterationIndex?: number })
            },
          })

          if (abortSignal.aborted) {
            return { nodeId, status: "cancelled", error: "运行被取消", durationMs: execResult.durationMs }
          }
          return {
            nodeId, status: execResult.status, output: execResult.output,
            outputs: execResult.outputs, activeBranch: execResult.activeBranch,
            error: execResult.error, durationMs: execResult.durationMs,
          }
        } catch (err) {
          if (abortSignal.aborted) return { nodeId, status: "cancelled", error: "运行被取消" }
          return { nodeId, status: "failed", error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    const callbacks: SchedulerCallbacks = {
      onNodeReady: (nodeId) => {
        const nr: NodeRunResult = { nodeId, status: "running", input: { variables: {} }, startedAt: Date.now() }
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

        if (outcome.status === "success" && outcome.output !== undefined) {
          nodeOutputs[outcome.nodeId] = outcome.output
        }

        terminalNodeOutput = outcome
      },
      resolveActivatedDownstream: (nodeId, outcome) => {
        const activated: string[] = []
        for (const edge of edges.filter((e) => e.from === nodeId)) {
          if (!outcome.activeBranch || edge.branch === outcome.activeBranch) {
            activated.push(edge.to)
          }
        }
        return activated
      },
    }

    const scheduler = new ReactiveScheduler({ runId: "subgraph" })
    const schedulerResults = await scheduler.execute(
      executableNodes, executableEdges, taskFactory, callbacks, abortSignal,
    )

    // Fill in skipped nodes
    for (const [nid, outcome] of schedulerResults) {
      if (!(nid in nodeResults)) {
        nodeResults[nid] = { nodeId: nid, status: "skipped", input: { variables: {} }, ...(outcome.error ? { error: outcome.error } : {}) }
      }
    }

    const durationMs = Date.now() - startMs

    // Determine exitPort from terminal node
    let exitPort: "continue" | "break" = "continue"
    let outputData: Record<string, unknown> = {}
    if (terminalNodeOutput) {
      outputData = {
        output: terminalNodeOutput.output,
        outputs: terminalNodeOutput.outputs,
        activeBranch: terminalNodeOutput.activeBranch,
      }
      if (terminalNodeOutput.activeBranch === "break") exitPort = "break"
    }

    // Overall status
    const hasFailed = Object.values(nodeResults).some((nr) => nr.status === "failed")
    const hasCancelled = Object.values(nodeResults).some((nr) => nr.status === "cancelled")
    const status = hasCancelled ? "cancelled" : hasFailed ? "failed" : "success"

    return { status, exitPort, nodeResults, outputData, durationMs }
  }
}
