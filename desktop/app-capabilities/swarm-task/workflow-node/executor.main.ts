import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult, NodeRuntimeDeps } from "../../../workflow-nodes/types"
import { SWARM_TASK_SERVICE_ID } from "../shared/capability"
import type { SwarmRun, SwarmTaskConfig } from "../shared/schema"
import type { SwarmTaskService } from "../main/service"
import type { SwarmTaskNodeConfig } from "./schema"

type SwarmTaskWorkflowService = Pick<SwarmTaskService, "startRun" | "getRun" | "cancelRun">

const TERMINAL_STATUSES = new Set<SwarmRun["status"]>(["success", "partial", "failed", "cancelled"])
const POLL_INTERVAL_MS = 100

export const swarmTaskNodeExecutor: NodeExecutor<SwarmTaskNodeConfig> = {
  async execute(input: NodeExecutionInput<SwarmTaskNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    try {
      const service = resolveSwarmTaskService(input.runtimeDeps)
      if (!service) {
        return { status: "failed", output: "", error: "蜂群任务服务不可用", durationMs: Date.now() - start }
      }

      const taskId = interpolatePrompt(input.config.taskId, input.resolvedVariables)
      input.onProgress?.("starting", "启动蜂群任务…")
      if (input.context.abortSignal.aborted) {
        throw new Error("工作流已取消")
      }
      const run = await service.startRun({
        taskId,
        configOverride: buildConfigOverride(input.config, input.resolvedVariables),
      })
      if (input.context.abortSignal.aborted) {
        await service.cancelRun(run.id)
        throw new Error("工作流已取消")
      }

      if (!input.config.waitForCompletion) {
        return buildResult(run, Date.now() - start)
      }

      input.onProgress?.("waiting", "等待蜂群任务…")
      const terminalRun = await waitForTerminalRun(service, run, input.context.abortSignal)
      return buildResult(terminalRun, Date.now() - start)
    } catch (error) {
      if (input.context.abortSignal.aborted) {
        return {
          status: "cancelled",
          output: "",
          error: "工作流已取消",
          durationMs: Date.now() - start,
        }
      }
      return {
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      }
    }
  },
}

function resolveSwarmTaskService(runtimeDeps: NodeRuntimeDeps | undefined): SwarmTaskWorkflowService | undefined {
  return runtimeDeps?.resolveService?.<SwarmTaskWorkflowService>(SWARM_TASK_SERVICE_ID)
}

function buildConfigOverride(
  config: SwarmTaskNodeConfig,
  resolvedVariables: Record<string, string>,
): Partial<SwarmTaskConfig> | undefined {
  const override: Partial<SwarmTaskConfig> = {}
  if (config.promptOverride) {
    override.prompt = interpolatePrompt(config.promptOverride, resolvedVariables)
  }
  if (config.runModeOverride) {
    override.runMode = config.runModeOverride
  }
  if (config.maxRoundsOverride !== undefined) {
    override.maxRounds = config.maxRoundsOverride
  }
  if (config.concurrencyOverride !== undefined) {
    override.concurrency = config.concurrencyOverride
  }
  return Object.keys(override).length > 0 ? override : undefined
}

async function waitForTerminalRun(
  service: SwarmTaskWorkflowService,
  initialRun: SwarmRun,
  abortSignal: AbortSignal,
): Promise<SwarmRun> {
  let latest = initialRun
  let abortCancelPromise: Promise<unknown> | undefined
  const requestCancelRun = () => {
    abortCancelPromise ??= service.cancelRun(initialRun.id).catch(() => undefined)
    return abortCancelPromise
  }
  const cancelOnAbort = () => {
    void requestCancelRun()
  }
  abortSignal.addEventListener("abort", cancelOnAbort, { once: true })
  try {
    while (!TERMINAL_STATUSES.has(latest.status)) {
      if (abortSignal.aborted) {
        throw new Error("工作流已取消")
      }
      const polled = await service.getRun(initialRun.id)
      if (!polled) {
        throw new Error("蜂群任务运行不存在")
      }
      latest = polled
      if (!TERMINAL_STATUSES.has(latest.status)) {
        await sleep(POLL_INTERVAL_MS, abortSignal)
      }
    }
  } catch (error) {
    if (abortSignal.aborted) {
      await requestCancelRun()
    }
    throw error
  } finally {
    abortSignal.removeEventListener("abort", cancelOnAbort)
  }
  return latest
}

function buildResult(run: SwarmRun, durationMs: number): NodeExecutionResult {
  const outputs = {
    runId: run.id,
    status: run.status,
    totals: run.totals,
    outputDirectory: run.outputDirectory,
  }

  if (run.status === "failed") {
    return {
      status: "failed",
      output: run.id,
      outputs,
      error: "蜂群任务执行失败",
      durationMs,
    }
  }
  if (run.status === "partial") {
    return {
      status: "failed",
      output: run.id,
      outputs,
      error: `蜂群任务部分完成：${run.totals.success} 个成功，${run.totals.failed} 个失败，${run.totals.cancelled} 个取消，${run.totals.timeout} 个超时`,
      durationMs,
    }
  }
  if (run.status === "cancelled") {
    return {
      status: "cancelled",
      output: run.id,
      outputs,
      error: "蜂群任务已取消",
      durationMs,
    }
  }
  return {
    status: "success",
    output: run.id,
    outputs,
    durationMs,
  }
}

function sleep(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abortSignal.aborted) {
      reject(new Error("工作流已取消"))
      return
    }
    const timer = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("工作流已取消"))
    }
    abortSignal.addEventListener("abort", onAbort, { once: true })
  })
}
