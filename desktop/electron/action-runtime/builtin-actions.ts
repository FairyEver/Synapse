import type { AgentRuntimeService } from "../services/agent-runtime/agent-runtime-service"
import { createAgentAction } from "../../action-packages/builtin/agent/executor.main"
import { createClaudeCodeAction, type LaunchAutomationClaudeCode } from "../../action-packages/builtin/claude-code/executor.main"
import { listBuiltinCapabilityPackages, validateBuiltinCapabilityPackages } from "../../app-capabilities/manifest-registry"
import { MainActionRegistry } from "./action-registry"

export function createBuiltinMainActionRegistry(deps: {
  readonly getAgentRuntime: (projectId: string) => Promise<AgentRuntimeService | undefined>
  readonly launchClaudeCode: LaunchAutomationClaudeCode
  readonly builtinCapabilityRegistrations?: {
    readonly workflowNodeTypes: readonly string[]
    readonly capabilityIds: readonly string[]
  }
}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(createAgentAction({ getAgentRuntime: deps.getAgentRuntime }))
  registry.register(createClaudeCodeAction({ launch: deps.launchClaudeCode }))
  if (deps.builtinCapabilityRegistrations) {
    const packages = listBuiltinCapabilityPackages()
    const declaredWorkflowNodeTypes = new Set(packages.flatMap(manifest => manifest.workflowNodes.map(surface => surface.type)))
    validateBuiltinCapabilityPackages({
      workflowNodeTypes: deps.builtinCapabilityRegistrations.workflowNodeTypes.filter(type => declaredWorkflowNodeTypes.has(type)),
      automationActionTypes: [],
      capabilityIds: deps.builtinCapabilityRegistrations.capabilityIds,
    })
  }
  return registry
}
