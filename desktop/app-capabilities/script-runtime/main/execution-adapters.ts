import type {
  ActionManifest,
  ActionRunResult,
} from "../../../action-packages/types"
import type {
  ActionExecutionInput,
  NoAuthorizationMainActionDefinition,
} from "../../../electron/action-runtime/action-registry"
import type {
  NodeExecutionInput,
  NodeExecutionResult,
} from "../../../workflow-nodes/types"
import type { SecretsService } from "../../secrets/main/service"
import { resolveAutomationScriptInputs } from "./automation-input-resolver"
import {
  SCRIPT_RUNTIME_SERVICE_ID,
  type ScriptRuntimeService,
} from "./service"
import type { ScriptRunOutcome } from "./types"
import type { AutomationScriptInputBinding } from "../shared/input"

type ScriptAutomationConfig = {
  readonly inputs: readonly AutomationScriptInputBinding[]
}

export function createScriptAutomationAction<TConfig extends ScriptAutomationConfig>(options: {
  readonly manifest: ActionManifest<TConfig> & { readonly authorization: "none" }
  readonly runtime: ScriptRuntimeService
  readonly secrets: Pick<SecretsService, "get">
  readonly run: (
    runtime: ScriptRuntimeService,
    input: Readonly<Record<string, import("../shared/json").JsonValue>>,
    execution: ActionExecutionInput<TConfig>,
  ) => Promise<ScriptRunOutcome>
}): NoAuthorizationMainActionDefinition<TConfig> {
  return {
    manifest: options.manifest,
    async execute(execution) {
      let input
      try {
        input = await resolveAutomationScriptInputs({
          bindings: execution.config.inputs,
          triggerInput: execution.context.triggerInput,
          secrets: options.secrets,
        })
      } catch {
        return {
          status: "failed",
          summary: "执行失败",
          error: "INVALID_INPUT: Script input could not be resolved.",
        }
      }
      return automationOutcome(
        await options.run(options.runtime, input, execution),
      )
    },
  }
}

export async function executeScriptWorkflowNode<TConfig>(options: {
  readonly input: NodeExecutionInput<TConfig>
  readonly unavailableMessage: string
  readonly run: (
    runtime: ScriptRuntimeService,
    input: NodeExecutionInput<TConfig>,
  ) => Promise<ScriptRunOutcome>
}): Promise<NodeExecutionResult> {
  const runtime = options.input.runtimeDeps?.resolveService?.<ScriptRuntimeService>(
    SCRIPT_RUNTIME_SERVICE_ID,
  )
  if (!runtime) {
    return {
      status: "failed",
      error: `CAPABILITY_UNAVAILABLE: ${options.unavailableMessage}`,
      durationMs: 0,
    }
  }
  return workflowOutcome(await options.run(runtime, options.input))
}

function workflowOutcome(outcome: ScriptRunOutcome): NodeExecutionResult {
  return outcome.status === "success"
    ? {
        status: "success",
        outputs: { result: outcome.result },
        logs: outcome.logs,
        durationMs: outcome.durationMs,
      }
    : {
      status: outcome.status === "cancelled" ? "cancelled" : "failed",
      error: `${outcome.code}: ${outcome.error}`,
      errorCode: outcome.code,
      ...(outcome.reason ? { errorReason: outcome.reason } : {}),
      logs: outcome.logs,
        durationMs: outcome.durationMs,
      }
}

function automationOutcome(outcome: ScriptRunOutcome): ActionRunResult {
  const metrics = outcome.exitCode === undefined
    ? { durationMs: outcome.durationMs }
    : { durationMs: outcome.durationMs, exitCode: outcome.exitCode }
  return outcome.status === "success"
    ? {
        status: "success",
        summary: "执行成功",
        outputs: { result: outcome.result },
        logs: outcome.logs,
        metrics,
      }
    : {
        status: outcome.status,
      summary: outcome.status === "cancelled" ? "已停止" : "执行失败",
      error: `${outcome.code}: ${outcome.error}`,
      errorCode: outcome.code,
      ...(outcome.reason ? { errorReason: outcome.reason } : {}),
      logs: outcome.logs,
        metrics,
      }
}
