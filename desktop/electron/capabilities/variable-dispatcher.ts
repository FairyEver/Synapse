import type { EventBus } from "../runtime/event-bus"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"
import type { SynapseConfig, SynapseConfigPatch, SynapseVariable } from "../../src/types/config"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type VariableCapabilityDispatcherDeps = {
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly eventBus?: Pick<EventBus, "emit">
  readonly actor?: ActorIdentity
}

type VariableSafeView = {
  readonly name: string
  readonly description?: string
  readonly hasValue: boolean
}

type SecretAuditContext = {
  readonly action: PermissionAction
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const VARIABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/
const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const variableMutationChains = new WeakMap<VariableCapabilityDispatcherDeps, Promise<void>>()

export function createVariableCapabilityDispatcher(deps: VariableCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      switch (action) {
        case "variable.item.list":
          return listVariables(deps, params)
        case "variable.item.get":
          return getVariable(deps, action, params, context)
        case "variable.item.create":
          return createVariable(deps, action, params, context)
        case "variable.item.update":
          return updateVariable(deps, action, params, context)
        case "variable.item.upsert":
          return upsertVariable(deps, action, params, context)
        case "variable.item.delete":
          return deleteVariable(deps, action, params, context)
        default:
          throw new Error(`Unknown variable action: ${action}`)
      }
    },
  }
}

function rejectRepositoryScope(params: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(params, "repositoryUuid")) {
    throw new Error("repositoryUuid is no longer supported for user variables.")
  }
}

async function withVariableMutationLock<T>(
  deps: VariableCapabilityDispatcherDeps,
  task: () => Promise<T>,
): Promise<T> {
  const previous = variableMutationChains.get(deps) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  const done = run.then(() => undefined, () => undefined)
  variableMutationChains.set(deps, done)

  try {
    return await run
  } finally {
    if (variableMutationChains.get(deps) === done) {
      variableMutationChains.delete(deps)
    }
  }
}

async function mutateUserVariables<T>(
  deps: VariableCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  task: (config: SynapseConfig) => Promise<T>,
): Promise<T> {
  rejectRepositoryScope(params)
  return withVariableMutationLock(deps, async () => {
    const config = await deps.loadConfig()
    return task(config)
  })
}

function requireVariableName(params: Record<string, unknown>, key: string): string {
  const value = optionalString(params[key])
  if (!value) throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  if (!VARIABLE_NAME_REGEX.test(value)) {
    throw new Error("Variable name must contain only letters, digits, and underscores.")
  }
  return value
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string") throw new Error(`Missing or invalid '${key}': expected string`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalDescription(params: Record<string, unknown>): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, "description")) return undefined
  const value = params.description
  if (typeof value !== "string") throw new Error("Invalid 'description': expected string")
  return value.trim()
}

function findVariableIndex(variables: readonly SynapseVariable[], name: string): number {
  const normalized = name.toLowerCase()
  return variables.findIndex((variable) => variable.name.toLowerCase() === normalized)
}

function requireExistingVariable(
  variables: readonly SynapseVariable[],
  name: string,
): { index: number; variable: SynapseVariable } {
  const index = findVariableIndex(variables, name)
  if (index < 0) throw new Error(`Variable not found: ${name}`)
  const variable = variables[index]
  if (!variable) throw new Error(`Variable not found: ${name}`)
  return { index, variable }
}

function assertNoDuplicate(
  variables: readonly SynapseVariable[],
  name: string,
  allowedExistingName?: string,
): void {
  const normalized = name.toLowerCase()
  const allowed = allowedExistingName?.toLowerCase()
  const duplicate = variables.some((variable) =>
    variable.name.toLowerCase() === normalized && variable.name.toLowerCase() !== allowed,
  )
  if (duplicate) throw new Error(`Variable already exists: ${name}`)
}

function toSafeVariable(variable: SynapseVariable): VariableSafeView {
  return {
    name: variable.name,
    ...(variable.description ? { description: variable.description } : undefined),
    hasValue: variable.value.length > 0,
  }
}

async function authorizeSecret(
  deps: VariableCapabilityDispatcherDeps,
  action: PermissionAction,
  capabilityAction: string,
  context: DispatchContext,
  variableName: string,
  includeValue: boolean,
): Promise<SecretAuditContext> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const resource = `variable:user:${variableName}`
  const metadata = {
    source: context.source ?? "api",
    variableAction: capabilityAction,
    variableName,
    includeValue,
  }

  const permission = await deps.permissionGuard.check({
    action,
    actor,
    resource,
    context: metadata,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action,
      actor,
      resource,
      outcome: "denied",
      metadata: {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }

  return {
    action,
    actor,
    resource,
    metadata,
  }
}

function recordSecretAudit(
  deps: VariableCapabilityDispatcherDeps,
  audit: SecretAuditContext,
  outcome: "allowed" | "failed",
  metadata?: Record<string, unknown>,
): void {
  deps.auditSink.record({
    action: audit.action,
    actor: audit.actor,
    resource: audit.resource,
    outcome,
    metadata: metadata ? { ...audit.metadata, ...metadata } : audit.metadata,
  })
}

async function persistVariables(
  deps: VariableCapabilityDispatcherDeps,
  variables: SynapseVariable[],
): Promise<void> {
  await deps.updateConfig({ global: { variables } })
  const timestamp = new Date().toISOString()
  deps.eventBus?.emit({
    domain: "repository",
    type: "repository.updated",
    payload: {
      operation: "variables",
      completedAt: timestamp,
      message: "变量已更新",
    },
    timestamp,
  })
}

async function persistVariablesWithAudit(
  deps: VariableCapabilityDispatcherDeps,
  variables: SynapseVariable[],
  audit: SecretAuditContext,
): Promise<void> {
  try {
    await persistVariables(deps, variables)
    recordSecretAudit(deps, audit, "allowed")
  } catch (error) {
    recordSecretAudit(deps, audit, "failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: String(error).length,
    })
    throw error
  }
}

function variableResponse(variable: SynapseVariable) {
  return {
    variable: toSafeVariable(variable),
  }
}

async function listVariables(
  deps: VariableCapabilityDispatcherDeps,
  params: Record<string, unknown>,
): Promise<DispatchResult> {
  rejectRepositoryScope(params)
  const config = await deps.loadConfig()
  const variables = config.global.variables.map(toSafeVariable)
  return {
    ok: true,
    data: {
      variables,
      total: variables.length,
    },
    total: variables.length,
  }
}

async function getVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  rejectRepositoryScope(params)
  const name = requireVariableName(params, "name")
  const includeValue = params.includeValue === true
  const config = await deps.loadConfig()
  const { variable } = requireExistingVariable(config.global.variables, name)
  if (includeValue) {
    const audit = await authorizeSecret(deps, "secret.read", action, context, variable.name, true)
    recordSecretAudit(deps, audit, "allowed")
  }
  return {
    ok: true,
    data: {
      ...variableResponse(variable),
      variable: includeValue ? { ...toSafeVariable(variable), value: variable.value } : toSafeVariable(variable),
    },
  }
}

async function createVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  rejectRepositoryScope(params)
  const name = requireVariableName(params, "name")
  const value = requireString(params, "value")
  const description = optionalDescription(params)
  return mutateUserVariables(deps, params, async (config) => {
    const variables = [...config.global.variables]
    assertNoDuplicate(variables, name)
    const variable: SynapseVariable = {
      name,
      value,
      ...(description ? { description } : undefined),
    }
    const audit = await authorizeSecret(deps, "secret.write", action, context, variable.name, false)
    await persistVariablesWithAudit(deps, [...variables, variable], audit)
    return { ok: true, data: { ...variableResponse(variable), created: true } }
  })
}

async function updateVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  rejectRepositoryScope(params)
  const name = requireVariableName(params, "name")
  const hasNewName = Object.prototype.hasOwnProperty.call(params, "newName")
  const hasValue = Object.prototype.hasOwnProperty.call(params, "value")
  const hasDescription = Object.prototype.hasOwnProperty.call(params, "description")
  if (!hasNewName && !hasValue && !hasDescription) throw new Error("No variable fields provided for update")
  return mutateUserVariables(deps, params, async (config) => {
    const variables = [...config.global.variables]
    const { index, variable } = requireExistingVariable(variables, name)
    const newName = hasNewName ? requireVariableName(params, "newName") : variable.name
    assertNoDuplicate(variables, newName, variable.name)
    const description = hasDescription ? optionalDescription(params) : variable.description
    const updated: SynapseVariable = {
      name: newName,
      value: hasValue ? requireString(params, "value") : variable.value,
      ...(description ? { description } : undefined),
    }
    variables[index] = updated
    const audit = await authorizeSecret(deps, "secret.write", action, context, updated.name, false)
    await persistVariablesWithAudit(deps, variables, audit)
    return { ok: true, data: { ...variableResponse(updated), updated: true } }
  })
}

async function upsertVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  rejectRepositoryScope(params)
  const name = requireVariableName(params, "name")
  return mutateUserVariables(deps, params, async (config) => {
    const variables = [...config.global.variables]
    const index = findVariableIndex(variables, name)
    if (index < 0) {
      if (!Object.prototype.hasOwnProperty.call(params, "value")) {
        throw new Error("Creating a variable through upsert requires 'value'.")
      }
      const description = optionalDescription(params)
      const created: SynapseVariable = {
        name,
        value: requireString(params, "value"),
        ...(description ? { description } : undefined),
      }
      const audit = await authorizeSecret(deps, "secret.write", action, context, created.name, false)
      await persistVariablesWithAudit(deps, [...variables, created], audit)
      return { ok: true, data: { ...variableResponse(created), created: true, updated: false } }
    }

    const current = variables[index]
    if (!current) throw new Error(`Variable not found: ${name}`)
    const hasValue = Object.prototype.hasOwnProperty.call(params, "value")
    const hasDescription = Object.prototype.hasOwnProperty.call(params, "description")
    const description = hasDescription ? optionalDescription(params) : current.description
    const updated: SynapseVariable = {
      name: current.name,
      value: hasValue ? requireString(params, "value") : current.value,
      ...(description ? { description } : undefined),
    }
    variables[index] = updated
    const audit = await authorizeSecret(deps, "secret.write", action, context, current.name, false)
    await persistVariablesWithAudit(deps, variables, audit)
    return { ok: true, data: { ...variableResponse(updated), created: false, updated: true } }
  })
}

async function deleteVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  rejectRepositoryScope(params)
  const name = requireVariableName(params, "name")
  return mutateUserVariables(deps, params, async (config) => {
    const variables = [...config.global.variables]
    const { index, variable } = requireExistingVariable(variables, name)
    const audit = await authorizeSecret(deps, "secret.write", action, context, variable.name, false)
    variables.splice(index, 1)
    await persistVariablesWithAudit(deps, variables, audit)
    return { ok: true, data: { ...variableResponse(variable), deleted: true } }
  })
}
