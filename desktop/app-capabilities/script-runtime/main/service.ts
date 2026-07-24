import { runChromiumWorkerScript, type ChromiumWorkerRunnerDeps } from "./chromium-worker-runner"
import { runNodeCliScript, type NodeCliRunnerDeps } from "./node-cli-runner"
import { ScriptRunScheduler } from "./scheduler"
import type { NodeScriptRunRequest, ScriptRunOutcome, ScriptRunRequest } from "./types"
import { ScriptRuntimeError } from "../shared/json"
import { createMainLogger } from "../../../electron/services/log-store"

export const SCRIPT_RUNTIME_SERVICE_ID = "core.script-runtime"

export type ScriptRuntimeServiceDeps = {
  readonly node: NodeCliRunnerDeps
  readonly chromium?: ChromiumWorkerRunnerDeps
  readonly defaultWorkingDirectory: string
}

export class ScriptRuntimeService {
  private readonly scheduler = new ScriptRunScheduler(2, 8)
  private readonly logger = createMainLogger("core.script-runtime")

  constructor(private readonly deps: ScriptRuntimeServiceDeps) {}

  get defaultWorkingDirectory(): string {
    return this.deps.defaultWorkingDirectory
  }

  runJavascript(request: ScriptRunRequest): Promise<ScriptRunOutcome> {
    return this.schedule(request.abortSignal, () =>
      runChromiumWorkerScript(request, { ...this.deps.chromium, logger: this.logger }))
  }

  runNodejs(request: NodeScriptRunRequest): Promise<ScriptRunOutcome> {
    return this.schedule(request.abortSignal, () =>
      runNodeCliScript(request, { ...this.deps.node, logger: this.logger }))
  }

  private async schedule(
    signal: AbortSignal,
    execute: () => Promise<ScriptRunOutcome>,
  ): Promise<ScriptRunOutcome> {
    const startedAt = Date.now()
    try {
      return await this.scheduler.run(signal, execute)
    } catch (error) {
      const runtimeError = error instanceof ScriptRuntimeError
        ? error
        : new ScriptRuntimeError("RUNNER_START_FAILED", "Unable to schedule script execution.")
      return {
        status: runtimeError.code === "CANCELLED" ? "cancelled" : "failed",
        code: runtimeError.code,
        error: runtimeError.message,
        logs: [],
        durationMs: Date.now() - startedAt,
      }
    }
  }
}
