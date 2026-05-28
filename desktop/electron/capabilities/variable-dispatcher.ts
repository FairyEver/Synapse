import type { EventBus } from "../runtime/event-bus"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"
import type { SynapseConfig, SynapseConfigPatch, SynapseRepositoryConfig, SynapseVariable } from "../../src/types/config"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type VariableCapabilityDispatcherDeps = {
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly eventBus?: Pick<EventBus, "emit">
  readonly actor?: ActorIdentity
}

type RepositoryRef = {
  readonly uuid: string
  readonly name: string
  readonly isActive: boolean
}

type VariableSafeView = {
  readonly name: string
  readonly description?: string
  readonly hasValue: boolean
}

type ResolvedRepository = {
  readonly config: SynapseConfig
  readonly repository: SynapseRepositoryConfig
}

const VARIABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/
const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const variableMutationChains = new WeakMap<VariableCapabilityDispatcherDeps, Map<string, Promise<void>>>()

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

async function resolveRepository(
  deps: VariableCapabilityDispatcherDeps,
  params: Record<string, unknown>,
): Promise<ResolvedRepository> {
  const config = await deps.loadConfig()
  const repositoryUuid = optionalString(params.repositoryUuid) ?? config.activeRepoUuid
  if (!repositoryUuid) throw new Error("No active repository. Pass repositoryUuid explicitly.")
  const repository = config.repositories.find((item) => item.uuid === repositoryUuid)
  if (!repository) throw new Error(`Repository not found: ${repositoryUuid}`)
  return { config, repository }
}

async function resolveRepositoryByUuid(
  deps: VariableCapabilityDispatcherDeps,
  repositoryUuid: string,
): Promise<ResolvedRepository> {
  const config = await deps.loadConfig()
  const repository = config.repositories.find((item) => item.uuid === repositoryUuid)
  if (!repository) throw new Error(`Repository not found: ${repositoryUuid}`)
  return { config, repository }
}

async function withVariableMutationLock<T>(
  deps: VariableCapabilityDispatcherDeps,
  repositoryUuid: string,
  task: () => Promise<T>,
): Promise<T> {
  let chains = variableMutationChains.get(deps)
  if (!chains) {
    chains = new Map()
    variableMutationChains.set(deps, chains)
  }

  const previous = chains.get(repositoryUuid) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  const done = run.then(() => undefined, () => undefined)
  chains.set(repositoryUuid, done)

  try {
    return await run
  } finally {
    if (chains.get(repositoryUuid) === done) {
      chains.delete(repositoryUuid)
    }
  }
}

async function mutateRepositoryVariables<T>(
  deps: VariableCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  task: (config: SynapseConfig, repository: SynapseRepositoryConfig) => Promise<T>,
): Promise<T> {
  const { repository } = await resolveRepository(deps, params)
  return withVariableMutationLock(deps, repository.uuid, async () => {
    const latest = await resolveRepositoryByUuid(deps, repository.uuid)
    return task(latest.config, latest.repository)
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

function toRepositoryRef(repository: SynapseRepositoryConfig, activeRepoUuid: string | null): RepositoryRef {
  return {
    uuid: repository.uuid,
    name: repository.name,
    isActive: repository.uuid === activeRepoUuid,
  }
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
  repositoryUuid: string,
  variableName: string,
  includeValue: boolean,
): Promise<void> {
  const actor = deps.actor ?? DEFAULT_ACTOR
  const resource = `variable:${repositoryUuid}:${variableName}`
  const metadata = {
    source: context.source ?? "api",
    variableAction: capabilityAction,
    repositoryUuid,
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

  deps.auditSink.record({
    action,
    actor,
    resource,
    outcome: "allowed",
    metadata,
  })
}

async function persistVariables(
  deps: VariableCapabilityDispatcherDeps,
  config: SynapseConfig,
  repository: SynapseRepositoryConfig,
  variables: SynapseVariable[],
): Promise<void> {
  const repositories = config.repositories.map((item) =>
    item.uuid === repository.uuid
      ? { ...item, variables: variables.length > 0 ? variables : undefined }
      : item,
  )
  await deps.updateConfig({ repositories })
  const timestamp = new Date().toISOString()
  deps.eventBus?.emit({
    domain: "repository",
    type: "repository.updated",
    payload: {
      repositoryUuid: repository.uuid,
      operation: "variables",
      completedAt: timestamp,
      message: "变量已更新",
    },
    timestamp,
  })
}

function variableResponse(config: SynapseConfig, repository: SynapseRepositoryConfig, variable: SynapseVariable) {
  return {
    repository: toRepositoryRef(repository, config.activeRepoUuid),
    variable: toSafeVariable(variable),
  }
}

async function listVariables(
  deps: VariableCapabilityDispatcherDeps,
  params: Record<string, unknown>,
): Promise<DispatchResult> {
  const { config, repository } = await resolveRepository(deps, params)
  const variables = (repository.variables ?? []).map(toSafeVariable)
  return {
    ok: true,
    data: {
      repository: toRepositoryRef(repository, config.activeRepoUuid),
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
  const name = requireVariableName(params, "name")
  const includeValue = params.includeValue === true
  const { config, repository } = await resolveRepository(deps, params)
  const { variable } = requireExistingVariable(repository.variables ?? [], name)
  if (includeValue) {
    await authorizeSecret(deps, "secret.read", action, context, repository.uuid, variable.name, true)
  }
  return {
    ok: true,
    data: {
      ...variableResponse(config, repository, variable),
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
  const name = requireVariableName(params, "name")
  const value = requireString(params, "value")
  const description = optionalDescription(params)
  return mutateRepositoryVariables(deps, params, async (config, repository) => {
    const variables = [...(repository.variables ?? [])]
    assertNoDuplicate(variables, name)
    const variable: SynapseVariable = {
      name,
      value,
      ...(description ? { description } : undefined),
    }
    await authorizeSecret(deps, "secret.write", action, context, repository.uuid, variable.name, false)
    await persistVariables(deps, config, repository, [...variables, variable])
    return { ok: true, data: { ...variableResponse(config, repository, variable), created: true } }
  })
}

async function updateVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  const hasNewName = Object.prototype.hasOwnProperty.call(params, "newName")
  const hasValue = Object.prototype.hasOwnProperty.call(params, "value")
  const hasDescription = Object.prototype.hasOwnProperty.call(params, "description")
  if (!hasNewName && !hasValue && !hasDescription) throw new Error("No variable fields provided for update")
  return mutateRepositoryVariables(deps, params, async (config, repository) => {
    const variables = [...(repository.variables ?? [])]
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
    await authorizeSecret(deps, "secret.write", action, context, repository.uuid, variable.name, false)
    await persistVariables(deps, config, repository, variables)
    return { ok: true, data: { ...variableResponse(config, repository, updated), updated: true } }
  })
}

async function upsertVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  return mutateRepositoryVariables(deps, params, async (config, repository) => {
    const variables = [...(repository.variables ?? [])]
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
      await authorizeSecret(deps, "secret.write", action, context, repository.uuid, created.name, false)
      await persistVariables(deps, config, repository, [...variables, created])
      return { ok: true, data: { ...variableResponse(config, repository, created), created: true, updated: false } }
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
    await authorizeSecret(deps, "secret.write", action, context, repository.uuid, current.name, false)
    await persistVariables(deps, config, repository, variables)
    return { ok: true, data: { ...variableResponse(config, repository, updated), created: false, updated: true } }
  })
}

async function deleteVariable(
  deps: VariableCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const name = requireVariableName(params, "name")
  return mutateRepositoryVariables(deps, params, async (config, repository) => {
    const variables = [...(repository.variables ?? [])]
    const { index, variable } = requireExistingVariable(variables, name)
    await authorizeSecret(deps, "secret.write", action, context, repository.uuid, variable.name, false)
    variables.splice(index, 1)
    await persistVariables(deps, config, repository, variables)
    return { ok: true, data: { ...variableResponse(config, repository, variable), deleted: true } }
  })
}
