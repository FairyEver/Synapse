import type { ControlledProcessRunner } from "../runtime/process"
import { createCommandAction } from "../../action-packages/builtin/command/executor.main"
import { createScriptAction } from "../../action-packages/builtin/script/executor.main"
import { MainActionRegistry } from "./action-registry"

export function createBuiltinMainActionRegistry(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(createCommandAction(deps))
  registry.register(createScriptAction(deps))
  return registry
}
