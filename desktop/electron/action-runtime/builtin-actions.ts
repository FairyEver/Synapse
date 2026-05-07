import type { ControlledProcessRunner } from "../runtime/process"
import type { AgentRuntimeService } from "../services/agent-runtime/agent-runtime-service"
import { createCommandAction } from "../../action-packages/builtin/command/executor.main"
import { createHttpRequestAction } from "../../action-packages/builtin/http-request/executor.main"
import { createScriptAction } from "../../action-packages/builtin/script/executor.main"
import { createAgentAction } from "../../action-packages/builtin/agent/executor.main"
import { MainActionRegistry } from "./action-registry"

export function createBuiltinMainActionRegistry(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly getAgentRuntime?: (projectId: string) => Promise<AgentRuntimeService | undefined>
}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(createCommandAction(deps))
  registry.register(createScriptAction(deps))
  registry.register(createHttpRequestAction())
  if (deps.getAgentRuntime) {
    registry.register(createAgentAction({ getAgentRuntime: deps.getAgentRuntime }))
  }
  return registry
}
