import type { ControlledProcessRunner } from "../runtime/process"
import type { AgentRuntimeService } from "../services/agent-runtime/agent-runtime-service"
import { createCommandAction } from "../../action-packages/builtin/command/executor.main"
import { createHttpRequestAction } from "../../action-packages/builtin/http-request/executor.main"
import { createScriptAction } from "../../action-packages/builtin/script/executor.main"
import { createAgentAction } from "../../action-packages/builtin/agent/executor.main"
import { createWorkflowAction, type WorkflowActionRuntimeDeps } from "../../action-packages/builtin/workflow/executor.main"
import { createJavascriptRunAction } from "../../app-capabilities/javascript-run/automation-action/executor.main"
import { createNodejsRunAction } from "../../app-capabilities/nodejs-run/automation-action/executor.main"
import type { ScriptRuntimeService } from "../../app-capabilities/script-runtime/main/service"
import type { SecretsService } from "../../app-capabilities/secrets/main/service"
import {
  listBuiltinCapabilityPackages,
  validateBuiltinCapabilityPackages,
} from "../../app-capabilities/manifest-registry"
import { MainActionRegistry } from "./action-registry"

export function createBuiltinMainActionRegistry(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly getAgentRuntime?: (projectId: string) => Promise<AgentRuntimeService | undefined>
  readonly workflowRuntime?: WorkflowActionRuntimeDeps
  readonly scriptRuntime?: ScriptRuntimeService
  readonly secrets?: Pick<SecretsService, "get">
  readonly builtinCapabilityRegistrations?: {
    readonly workflowNodeTypes: readonly string[]
    readonly capabilityIds: readonly string[]
  }
}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(createCommandAction(deps))
  registry.register(createScriptAction(deps))
  registry.register(createHttpRequestAction())
  if (deps.getAgentRuntime) {
    registry.register(createAgentAction({ getAgentRuntime: deps.getAgentRuntime }))
  }
  if (deps.workflowRuntime) {
    registry.register(createWorkflowAction(deps.workflowRuntime))
  }
  if (deps.scriptRuntime && deps.secrets) {
    if (!deps.builtinCapabilityRegistrations) {
      throw new Error("Builtin capability registrations are required when script runtimes are enabled.")
    }
    registry.register(createJavascriptRunAction({
      runtime: deps.scriptRuntime,
      secrets: deps.secrets,
    }))
    registry.register(createNodejsRunAction({
      runtime: deps.scriptRuntime,
      secrets: deps.secrets,
    }))
    const packages = listBuiltinCapabilityPackages()
    const declaredWorkflowNodeTypes = new Set(
      packages.flatMap((manifest) => manifest.workflowNodes.map((surface) => surface.type)),
    )
    const declaredAutomationActionTypes = new Set(
      packages.flatMap((manifest) => manifest.automationActions.map((surface) => surface.type)),
    )
    validateBuiltinCapabilityPackages({
      workflowNodeTypes: deps.builtinCapabilityRegistrations.workflowNodeTypes
        .filter((type) => declaredWorkflowNodeTypes.has(type)),
      automationActionTypes: registry.list()
        .map((action) => action.manifest.id)
        .filter((id) => declaredAutomationActionTypes.has(id)),
      capabilityIds: deps.builtinCapabilityRegistrations.capabilityIds,
    })
  }
  return registry
}
