import { randomUUID } from "node:crypto"

import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import {
  TERMINAL_CLIENT_LEASE_LIMIT,
  TERMINAL_CLIENT_OBSERVE_LIMIT,
  TERMINAL_CONTROLLER_LEASE_LIMIT,
  TERMINAL_GLOBAL_OBSERVE_LIMIT,
  TERMINAL_GLOBAL_RUNNING_SESSION_LIMIT,
  TERMINAL_MCP_READ_RATE_LIMIT_PER_MINUTE,
  TERMINAL_MCP_WRITE_RATE_LIMIT_PER_MINUTE,
  TERMINAL_SESSION_OBSERVE_LIMIT,
} from "../../../config"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import {
  TERMINAL_CAPABILITY_BY_ID,
  TERMINAL_CAPABILITY_CATALOG,
  type TerminalCapabilityMetadata,
  type TerminalPermissionFamily,
} from "../shared/capability"
import {
  terminalAcquireControlInputSchema,
  terminalCommandInputSchema,
  terminalCreateSessionOverrideInputSchema,
  terminalCreateSessionInputSchema,
  terminalDeleteSessionInputSchema,
  terminalGroupCommandCreateInputSchema,
  terminalGroupCommandDeleteInputSchema,
  terminalGroupCommandLaunchInputSchema,
  terminalGroupCommandListInputSchema,
  terminalGroupCommandTargetSchema,
  terminalGroupCommandUpdateInputSchema,
  terminalGroupCreateInputSchema,
  terminalGroupDeleteCommitInputSchema,
  terminalGroupDeletePreviewInputSchema,
  terminalGroupDeleteInputSchema,
  terminalGroupLaunchUpdateInputSchema,
  terminalGroupListInputSchema,
  terminalGroupRenameInputSchema,
  terminalGroupTargetSchema,
  terminalGlobalLaunchGetInputSchema,
  terminalGlobalLaunchUpdateInputSchema,
  terminalLeaseOperationInputSchema,
  terminalObserveInputSchema,
  terminalOperationGetInputSchema,
  terminalPagedRequestSchema,
  terminalPasteInputSchema,
  terminalRawInputSchema,
  terminalReadOutputInputSchema,
  terminalRenewControlInputSchema,
  terminalRequestBaseSchema,
  terminalResizeInputSchema,
  terminalSemanticInputSchema,
  terminalSessionListInputSchema,
  terminalSessionRenameInputSchema,
  terminalSessionStateListInputSchema,
  terminalSessionTargetSchema,
  terminalStopInputSchema,
  terminalViewInputSchema,
} from "../shared/contract-schema"
import {
  TerminalContractError,
  terminalContractError,
  terminalErrorEnvelope,
  terminalResult,
} from "../shared/errors"
import { terminalInputSchemaForCapability } from "../shared/mcp-tools"
import type { TerminalLaunchLayer } from "../shared/schema"
import { TerminalLaunchValidationError } from "./environment"
import type { TerminalControllerContext, TerminalService } from "./service"

const TERMINAL_PERMISSION_ACTIONS: Readonly<Record<TerminalPermissionFamily, PermissionAction>> = {
  discover: "terminal.discover",
  "state.read": "terminal.state.read",
  "metadata.read": "terminal.metadata.read",
  "output.read": "terminal.output.read",
  "command.read": "terminal.command.read",
  "command.launch": "terminal.command.launch",
  "session.create": "terminal.session.create",
  "session.override.create": "terminal.session.override.create",
  "session.control": "terminal.session.control",
  "session.rawInput": "terminal.session.rawInput",
  "session.resize": "terminal.session.resize",
  "session.stop": "terminal.session.stop",
  "session.forceStop": "terminal.session.forceStop",
  "metadata.manage": "terminal.metadata.manage",
  "settings.manage": "terminal.settings.manage",
  "group.manage": "terminal.group.manage",
  "command.manage": "terminal.command.manage",
  "session.delete": "terminal.session.delete",
  "group.delete": "terminal.group.delete",
}

const TERMINAL_LAUNCH_SETTING_MUTATION_ACTIONS = new Set([
  "app.terminal.global_launch.update",
  "app.terminal.group_launch.update",
  "app.terminal.group_command.create",
  "app.terminal.group_command.update",
])

export type TerminalCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createTerminalCapabilityDispatcher(deps: {
  readonly service: TerminalService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
  readonly platform?: NodeJS.Platform
}): TerminalCapabilityDispatcher {
  const rateWindows = new Map<string, number[]>()
  const clientsByActor = new Map<string, Set<string>>()
  deps.permissionGuard?.onRevoked?.((event) => {
    const affected = event.actorId
      ? clientsByActor.get(event.actorId) ?? new Set<string>()
      : new Set([...clientsByActor.values()].flatMap((clients) => [...clients]))
    for (const clientId of affected) deps.service.revokeClientAccess(clientId, event.resource)
  })
  return {
    async dispatch(action, params, context) {
      let authorizedAudit: {
        metadata: TerminalCapabilityMetadata
        resource: string
        details: Record<string, unknown>
      } | undefined
      try {
        const metadata = TERMINAL_CAPABILITY_BY_ID.get(action as never)
        if (!metadata) throw terminalContractError("unsupported", "capability")
        requireStableCaller(context)
        const actorClients = clientsByActor.get(context.actor!.id ?? context.clientId!) ?? new Set<string>()
        actorClients.add(context.clientId!)
        clientsByActor.set(context.actor!.id ?? context.clientId!, actorClients)
        enforceRateLimit(rateWindows, context.clientId!, metadata.mutates)
        const schema = terminalInputSchemaForCapability(action)
        if (!schema) throw terminalContractError("unsupported", "capability")
        const parsed = schema.parse(params) as Record<string, unknown>
        const resource = resourceFor(parsed)
        const details = auditMetadata(action, parsed)
        const initialPermissions = action === "app.terminal.session_state.list" ? ["discover" as const] : metadata.permissions
        await authorize(deps, context, initialPermissions, action, resource, details)
        authorizedAudit = { metadata, resource, details }
        const result = await dispatchAuthorized(deps, action, parsed, context)
        const envelope = terminalResult(result, outcomeFor(result))
        recordDispatchOutcome(deps, context, authorizedAudit, "allowed", envelope.correlationId, envelope.outcome)
        return envelope as DispatchResult
      } catch (error) {
        const isLaunchSettingValidationError = error instanceof TerminalLaunchValidationError
          && TERMINAL_LAUNCH_SETTING_MUTATION_ACTIONS.has(action)
        const envelope = !(error instanceof TerminalContractError) && (isZodError(error) || isLaunchSettingValidationError)
          ? terminalErrorEnvelope(terminalContractError("validation_error", "validation"))
          : terminalErrorEnvelope(error)
        if (authorizedAudit) {
          recordDispatchOutcome(deps, context, authorizedAudit, "failed", envelope.error.correlationId, envelope.error.code)
        }
        return envelope as unknown as DispatchResult
      }
    },
  }
}

function outcomeFor(result: unknown): "accepted" | "partial" | "delivery_uncertain" | "no_op" | "failed_after_identity_created" {
  if (!isRecord(result) || typeof result.outcome !== "string") return "accepted"
  if (result.outcome === "partial" || result.outcome === "delivery_uncertain" || result.outcome === "failed_after_identity_created") {
    return result.outcome
  }
  if (result.outcome === "no_op" || result.outcome === "terminal_noop") return "no_op"
  return "accepted"
}

function recordDispatchOutcome(
  deps: { readonly auditSink?: AuditSink },
  context: DispatchContext,
  audit: { metadata: TerminalCapabilityMetadata; resource: string; details: Record<string, unknown> },
  outcome: "allowed" | "failed",
  correlationId: string,
  result: string,
): void {
  const family = audit.metadata.permissions[0]
  if (!family || !context.actor) return
  deps.auditSink?.record({
    action: TERMINAL_PERMISSION_ACTIONS[family],
    actor: context.actor,
    resource: audit.resource,
    outcome,
    metadata: { ...audit.details, stage: "result", result, correlationId },
  })
}

async function dispatchAuthorized(
  deps: {
    readonly service: TerminalService
    readonly platform?: NodeJS.Platform
    readonly permissionGuard?: PermissionGuard
    readonly auditSink?: AuditSink
    readonly actor?: ActorIdentity
  },
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<unknown> {
  const service = deps.service
  let result: unknown
  if (typeof params.idempotencyKey === "string" && !SERVICE_IDEMPOTENT_ACTIONS.has(action)) {
    result = service.runIdempotentOperation(
      context.clientId ?? "unknown-client",
      action,
      params.idempotencyKey,
      params,
      () => dispatchAuthorizedCore(deps, action, params, context),
    )
  } else {
    result = await dispatchAuthorizedCore(deps, action, params, context)
  }
  const resolved = await result
  if (!PERSISTED_MUTATION_ACTIONS.has(action) || !service.lastPersistError) return resolved
  return isRecord(resolved)
    ? { ...resolved, outcome: "delivery_uncertain", persistence: "degraded" }
    : { outcome: "delivery_uncertain", persistence: "degraded" }
}

const SERVICE_IDEMPOTENT_ACTIONS = new Set([
  "app.terminal.session_input.send",
  "app.terminal.session_input.command",
  "app.terminal.session_input.paste",
  "app.terminal.session_input.raw",
  "app.terminal.session.resize",
])

const PERSISTED_MUTATION_ACTIONS = new Set([
  "app.terminal.global_launch.update",
  "app.terminal.group.create",
  "app.terminal.group.rename",
  "app.terminal.group.delete",
  "app.terminal.group_launch.update",
  "app.terminal.group_delete.commit",
  "app.terminal.group_command.create",
  "app.terminal.group_command.update",
  "app.terminal.group_command.delete",
  "app.terminal.group_command.launch",
  "app.terminal.session.create",
  "app.terminal.session_override.create",
  "app.terminal.session_metadata.rename",
  "app.terminal.session.delete",
])

async function dispatchAuthorizedCore(
  deps: {
    readonly service: TerminalService
    readonly platform?: NodeJS.Platform
    readonly permissionGuard?: PermissionGuard
    readonly auditSink?: AuditSink
    readonly actor?: ActorIdentity
  },
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<unknown> {
  const service = deps.service
  if (action === "app.terminal.capabilities.get") {
    terminalRequestBaseSchema.parse(params)
    return buildCapabilities(deps.platform ?? process.platform, service.persistenceProtection)
  }
  if (action === "app.terminal.diagnostics.get") {
    terminalPagedRequestSchema.parse(params)
    return {
      terminalDomainRevision: service.terminalDomainRevision,
      scope: "authorized_objects_only",
      objectCountsUnavailable: true,
      persistenceDegraded: Boolean(service.lastPersistError),
      generatedAt: new Date().toISOString(),
    }
  }
  if (action === "app.terminal.global_launch.get") {
    terminalGlobalLaunchGetInputSchema.parse(params)
    const settings = service.getGlobalLaunchSettings()
    return {
      revision: settings.revision,
      updatedAt: settings.updatedAt,
      defaultCwd: settings.settings?.defaultCwd ?? null,
      shell: settings.settings?.shell ?? null,
      environment: environmentMetadata(settings.settings?.environment, "global"),
    }
  }
  if (action === "app.terminal.global_launch.update") {
    const input = terminalGlobalLaunchUpdateInputSchema.parse(params)
    const current = service.getGlobalLaunchSettings()
    requireRevision(current.revision, input.expectedRevision, "revision")
    const updated = await service.updateGlobalLaunchSettings({
      expectedRevision: input.expectedRevision,
      settings: mergeLaunchLayer(current.settings, input.settings),
    })
    return mutationResult({
      revision: updated.revision,
      updatedAt: updated.updatedAt,
      defaultCwd: updated.settings?.defaultCwd ?? null,
      shell: updated.settings?.shell ?? null,
      environment: environmentMetadata(updated.settings?.environment, "global"),
    }, current.revision, updated.revision, updated !== current)
  }
  if (action === "app.terminal.group.list") {
    const input = terminalGroupListInputSchema.parse(params)
    const visible = await filterAuthorizedResources(
      deps, context, service.listGroups(), (group) => `terminal:group:${group.id}`, ["discover"], action,
    )
    return paginate(visible
      .filter((group) => !input.name || group.name.includes(input.name))
      .map((group) => groupSummary(group, service.listSessions())), input.limit, input.cursor, input, service.terminalDomainRevision)
  }
  if (action === "app.terminal.group.get") {
    const input = terminalGroupTargetSchema.parse(params)
    return groupSummary(requireGroup(service, input.groupId), service.listSessions())
  }
  if (action === "app.terminal.group.create") {
    const input = terminalGroupCreateInputSchema.parse(params)
    const group = await service.createGroup({ name: input.name })
    return mutationResult(groupSummary(group, service.listSessions()), group.groupRevision, group.groupRevision, true)
  }
  if (action === "app.terminal.group.rename") {
    const input = terminalGroupRenameInputSchema.parse(params)
    const group = requireGroup(service, input.groupId)
    requireRevision(group.groupRevision, input.expectedGroupRevision, "groupRevision")
    const updated = await service.renameGroup({ groupId: input.groupId, name: input.name })
    return mutationResult(groupSummary(updated, service.listSessions()), group.groupRevision, updated.groupRevision, updated !== group)
  }
  if (action === "app.terminal.group.delete") {
    const input = terminalGroupDeleteInputSchema.parse(params)
    const group = requireGroup(service, input.groupId)
    requireRevision(group.groupRevision, input.expectedGroupRevision, "groupRevision")
    await service.deleteGroup({ groupId: input.groupId })
    return { deleteOperationId: randomUUID(), groupId: input.groupId }
  }
  if (action === "app.terminal.group_launch.get") {
    const input = terminalGroupTargetSchema.parse(params)
    const group = requireGroup(service, input.groupId)
    return {
      groupId: group.id,
      launchRevision: group.launchRevision,
      defaultCwd: group.settings?.defaultCwd ?? null,
      shell: group.settings?.shell ?? null,
      environment: environmentMetadata(group.settings?.environment, "group"),
    }
  }
  if (action === "app.terminal.group_launch.update") {
    const input = terminalGroupLaunchUpdateInputSchema.parse(params)
    const group = requireGroup(service, input.groupId)
    requireRevision(group.launchRevision, input.expectedLaunchRevision, "launchRevision")
    const launch = mergeLaunchLayer(group.settings, input.settings)
    const updated = await service.updateGroupSettings({
      groupId: group.id,
      name: group.name,
      settings: {
        ...launch,
        ...(group.settings?.commands ? { commands: group.settings.commands } : {}),
        ...(group.settings?.startupCommand ? { startupCommand: group.settings.startupCommand } : {}),
      },
    })
    return mutationResult({ groupId: group.id, launchRevision: updated.launchRevision }, group.launchRevision, updated.launchRevision, true)
  }
  if (action === "app.terminal.group_delete.preview") {
    const input = terminalGroupDeletePreviewInputSchema.parse(params)
    return service.previewGroupDelete(input.groupId)
  }
  if (action === "app.terminal.group_delete.commit") {
    const input = terminalGroupDeleteCommitInputSchema.parse(params)
    return service.commitGroupDelete(input.deletePlanId)
  }
  if (action === "app.terminal.group_command.list") {
    const input = terminalGroupCommandListInputSchema.parse(params)
    const group = requireGroup(service, input.groupId)
    return paginate((group.settings?.commands ?? []).map((command) => commandSummary(group.id, command)), input.limit, input.cursor, input, service.terminalDomainRevision)
  }
  if (action === "app.terminal.group_command.get") {
    const input = terminalGroupCommandTargetSchema.parse(params)
    const command = requireCommand(requireGroup(service, input.groupId), input.commandId)
    return {
      groupId: input.groupId,
      commandId: command.id,
      name: command.name,
      commandRevision: command.commandRevision,
      command: command.command,
      launch: launchMetadata(command.launch, "command"),
    }
  }
  if (action === "app.terminal.group_command.create") {
    const input = terminalGroupCommandCreateInputSchema.parse(params)
    const group = requireGroup(service, input.groupId)
    requireRevision(group.commandCollectionRevision, input.expectedCommandCollectionRevision, "commandCollectionRevision")
    const command = await service.createGroupCommand({
      groupId: input.groupId,
      name: input.name,
      command: input.command,
      ...(input.launch ? { launch: launchLayerFromMcpInput(input.launch) } : {}),
    })
    return commandSummary(input.groupId, command)
  }
  if (action === "app.terminal.group_command.update") {
    const input = terminalGroupCommandUpdateInputSchema.parse(params)
    const command = requireCommand(requireGroup(service, input.groupId), input.commandId)
    requireRevision(command.commandRevision, input.expectedCommandRevision, "commandRevision")
    return commandSummary(input.groupId, await service.updateGroupCommand({
      groupId: input.groupId,
      commandId: input.commandId,
      name: input.name,
      command: input.command,
      launch: input.launch ? launchLayerFromMcpInput(input.launch) : command.launch,
    }))
  }
  if (action === "app.terminal.group_command.delete") {
    const input = terminalGroupCommandDeleteInputSchema.parse(params)
    const command = requireCommand(requireGroup(service, input.groupId), input.commandId)
    requireRevision(command.commandRevision, input.expectedCommandRevision, "commandRevision")
    await service.deleteGroupCommand(input)
    return { commandId: input.commandId, deleted: true }
  }
  if (action === "app.terminal.group_command.launch") {
    const input = terminalGroupCommandLaunchInputSchema.parse(params)
    const group = requireGroup(service, input.groupId)
    requireRevision(group.launchRevision, input.expectedLaunchRevision, "launchRevision")
    const command = requireCommand(group, input.commandId)
    requireRevision(command.commandRevision, input.expectedCommandRevision, "commandRevision")
    const session = await service.launchGroupCommand(
      { groupId: input.groupId, commandId: input.commandId },
      { source: "mcp", clientId: context.clientId },
    )
    const delivery = session.commandDeliveryOperationId
      ? service.getOperation(session.commandDeliveryOperationId)
      : undefined
    return {
      outcome: session.status !== "running" || delivery?.status === "failed"
        ? "failed_after_identity_created"
        : delivery?.status === "delivery_uncertain" ? "delivery_uncertain" : "accepted",
      sessionId: session.id,
      launchRevisionApplied: group.launchRevision,
      commandRevisionApplied: command.commandRevision,
      commandDeliveryOperationId: session.commandDeliveryOperationId,
      commandDeliveryStatus: delivery?.status,
      acceptedAt: delivery?.updatedAt,
      acceptedActionCount: delivery?.acceptedActionCount ?? 0,
      acceptedBytes: delivery?.acceptedBytes ?? 0,
      failedActionIndex: delivery?.failedActionIndex,
      inputRevision: session.inputRevision,
      lifecycle: session.status,
    }
  }
  if (action === "app.terminal.session.list") {
    const input = terminalSessionListInputSchema.parse(params)
    const visible = await filterAuthorizedResources(
      deps, context, service.listSessions(), (session) => `terminal:session:${session.id}`, ["discover"], action,
    )
    return paginate(filterSessions(visible, input).map(sessionSummary), input.limit, input.cursor, input, service.terminalDomainRevision)
  }
  if (action === "app.terminal.session_summary.get") {
    const input = terminalSessionTargetSchema.parse(params)
    return sessionSummary(service.getSession(input))
  }
  if (action === "app.terminal.session_state.list") {
    const input = terminalSessionStateListInputSchema.parse(params)
    const controller = controllerFor(context)
    const visible = await filterAuthorizedResources(
      deps, context, service.listSessions(), (session) => `terminal:session:${session.id}`, ["discover", "state.read"], action,
    )
    const items = filterSessions(visible, input)
      .filter((session) => !input.lifecycle || session.status === input.lifecycle)
      .map((session) => service.getSessionState(session.id, controller))
    return paginate(items, input.limit, input.cursor, input, service.terminalDomainRevision)
  }
  if (action === "app.terminal.session_state.get") {
    const input = terminalSessionTargetSchema.parse(params)
    return service.getSessionState(input.sessionId, controllerFor(context))
  }
  if (action === "app.terminal.session_metadata.get") {
    const input = terminalSessionTargetSchema.parse(params)
    const session = service.getSession(input)
    return {
      sessionId: session.id, cwd: session.cwd, shell: session.shell,
      cols: session.cols, rows: session.rows, metadataRevision: session.metadataRevision,
      launchRevisionApplied: session.launchRevisionApplied,
      commandId: session.commandId ?? null,
      commandRevisionApplied: session.commandRevisionApplied ?? null,
      launchFacts: session.launchFacts ?? {
        shellKind: session.creationSource === "legacy_unknown" ? "legacy_unversioned" : "default",
        cwdKind: session.creationSource === "legacy_unknown" ? "legacy_unversioned" : "default",
        environmentKeys: [], overriddenFields: [], cols: session.cols, rows: session.rows,
        legacyUnversioned: session.creationSource === "legacy_unknown",
      },
    }
  }
  if (action === "app.terminal.session.create") {
    const input = terminalCreateSessionInputSchema.parse(params)
    const session = await service.createMcpSession(input, context.clientId)
    return createdSession(session, input.groupId ? requireGroup(service, input.groupId).launchRevision : null)
  }
  if (action === "app.terminal.session_override.create") {
    const input = terminalCreateSessionOverrideInputSchema.parse(params)
    const session = await service.createSessionOverride(input, context.clientId)
    return createdSession(session, input.groupId ? requireGroup(service, input.groupId).launchRevision : null)
  }
  if (action === "app.terminal.session_metadata.rename") {
    const input = terminalSessionRenameInputSchema.parse(params)
    const session = service.getSession(input)
    requireRevision(session.metadataRevision, input.expectedMetadataRevision, "metadataRevision")
    const updated = await service.renameSession(input)
    return mutationResult(sessionSummary(updated), session.metadataRevision, updated.metadataRevision, updated !== session)
  }
  if (action === "app.terminal.session.observe") {
    return service.observe(terminalObserveInputSchema.parse(params), false, context.clientId)
  }
  if (action === "app.terminal.session_output.read") {
    const input = terminalReadOutputInputSchema.parse(params)
    const output = service.readSession({ sessionId: input.sessionId, afterSeq: input.afterOutputSeq, limitBytes: input.limitBytes })
    return outputOnly(output)
  }
  if (action === "app.terminal.session_output.observe") {
    return service.observe(terminalObserveInputSchema.parse(params), true, context.clientId)
  }
  if (action === "app.terminal.session_view.get") {
    const input = terminalViewInputSchema.parse(params)
    return service.getView(input)
  }
  if (action === "app.terminal.session_control.acquire") {
    return service.acquireControl(terminalAcquireControlInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session_control.renew") {
    return service.renewControl(terminalRenewControlInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session_control.release") {
    return service.releaseControl(terminalLeaseOperationInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session_input.send") {
    return service.sendSemanticInput(terminalSemanticInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session_input.command") {
    return service.sendCommand(terminalCommandInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session_input.paste") {
    return service.paste(terminalPasteInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session_input.raw") {
    return service.sendRaw(terminalRawInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session.resize") {
    return service.resizeControlledSession(terminalResizeInputSchema.parse(params), controllerFor(context, true))
  }
  if (action === "app.terminal.session.stop") {
    return redactOperation(await service.stopControlledSession(terminalStopInputSchema.parse(params), controllerFor(context)), context)
  }
  if (action === "app.terminal.session.force_stop") {
    return redactOperation(await service.forceStopControlledSession(terminalStopInputSchema.parse(params), controllerFor(context)), context)
  }
  if (action === "app.terminal.operation.get") {
    const input = terminalOperationGetInputSchema.parse(params)
    const operation = service.getOperation(input.operationId)
    if (operation.sessionId !== input.sessionId) throw terminalContractError("not_found", "not_found")
    return redactOperation(operation, context)
  }
  if (action === "app.terminal.session.delete") {
    const input = terminalDeleteSessionInputSchema.parse(params)
    return service.deleteTerminalSession(input.sessionId, context.clientId ?? "unknown-client")
  }
  throw terminalContractError("unsupported", "capability")
}

function buildCapabilities(platform: NodeJS.Platform, persistenceProtection: "available" | "unavailable" | "degraded") {
  return {
    generatedAt: new Date().toISOString(),
    capabilities: TERMINAL_CAPABILITY_CATALOG.map((item) => ({
      capabilityId: item.id,
      toolName: item.toolName,
      permissions: item.permissions,
      risk: item.risk,
      support: item.id === "app.terminal.session.force_stop" && platform === "win32" ? "unsupported" : item.support,
    })),
    termination: {
      platform,
      normalStopSupported: true,
      forceStopSupported: platform !== "win32",
      scope: platform === "win32" ? "conpty_session" : "pty_process",
      limitations: ["detached_processes_not_guaranteed", ...(platform === "win32" ? ["distinct_force_path_unproven"] : [])],
    },
    raw: {
      supportedEncoding: "node-pty-buffer-current-platform",
      transport: "base64",
      arbitraryBinaryTransparent: false,
      limitations: ["accepted_bytes_depend_on_packaged_node_pty_platform_tests", "no_string_reencoding_fallback"],
      maxBytes: 256 * 1024,
    },
    paste: { support: "supported", mode: "bracketed-paste-only", fallback: "none" },
    view: { support: "supported", emulator: "xterm-headless", emulatorVersion: "6.0.0" },
    attention: { support: "degraded", defaultState: "unknown", detector: "passive-terminal-v1" },
    persistenceProtection,
    executionIsolation: "none",
    executionIdentity: "current_os_user",
    processResourceIsolation: "none",
    hardBounds: {
      maxWaitMs: 30_000,
      maxReadBytes: 1024 * 1024,
      maxActions: 128,
      maxInputBytes: 256 * 1024,
      maxCols: 500,
      maxRows: 200,
      globalRunningSessions: TERMINAL_GLOBAL_RUNNING_SESSION_LIMIT,
      clientLeases: TERMINAL_CLIENT_LEASE_LIMIT,
      controllerLeases: TERMINAL_CONTROLLER_LEASE_LIMIT,
      sessionObserve: TERMINAL_SESSION_OBSERVE_LIMIT,
      clientObserve: TERMINAL_CLIENT_OBSERVE_LIMIT,
      globalObserve: TERMINAL_GLOBAL_OBSERVE_LIMIT,
      clientReadRequestsPerMinute: TERMINAL_MCP_READ_RATE_LIMIT_PER_MINUTE,
      clientWriteRequestsPerMinute: TERMINAL_MCP_WRITE_RATE_LIMIT_PER_MINUTE,
    },
  }
}

async function authorize(
  deps: { readonly permissionGuard?: PermissionGuard; readonly auditSink?: AuditSink; readonly actor?: ActorIdentity },
  context: DispatchContext,
  permissions: readonly TerminalPermissionFamily[],
  capabilityAction: string,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (permissions.length === 0) return
  const actor = context.actor ?? deps.actor
  if (!actor) throw terminalContractError("caller_identity_required", "caller_context")
  if (!deps.permissionGuard) throw terminalContractError("permission_denied", "authorization")
  for (const family of permissions) {
    const action = TERMINAL_PERMISSION_ACTIONS[family]
    const result = await deps.permissionGuard.check({
      action,
      actor,
      resource,
      context: { source: context.source, capabilityAction, ...metadata },
    })
    deps.auditSink?.record({
      action,
      actor,
      resource,
      outcome: result.allowed ? "allowed" : "denied",
      metadata: { capabilityAction, source: context.source, ...metadata, ...(!result.allowed ? { policyId: result.policyId } : {}) },
    })
    if (!result.allowed) throw terminalContractError("permission_denied", "authorization")
  }
}

async function filterAuthorizedResources<T>(
  deps: { readonly permissionGuard?: PermissionGuard; readonly auditSink?: AuditSink; readonly actor?: ActorIdentity },
  context: DispatchContext,
  items: readonly T[],
  resourceForItem: (item: T) => string,
  permissions: readonly TerminalPermissionFamily[],
  capabilityAction: string,
): Promise<T[]> {
  const actor = context.actor ?? deps.actor
  if (!actor || !deps.permissionGuard) return []
  const visible: T[] = []
  for (const item of items) {
    const resource = resourceForItem(item)
    let allowed = true
    for (const family of permissions) {
      const action = TERMINAL_PERMISSION_ACTIONS[family]
      const decision = await deps.permissionGuard.check({
        action,
        actor,
        resource,
        context: { source: context.source, capabilityAction, scopedListCheck: true },
      })
      deps.auditSink?.record({
        action,
        actor,
        resource,
        outcome: decision.allowed ? "allowed" : "denied",
        metadata: { capabilityAction, source: context.source, scopedListCheck: true },
      })
      if (!decision.allowed) {
        allowed = false
        break
      }
    }
    if (allowed) visible.push(item)
  }
  return visible
}

function requireStableCaller(context: DispatchContext): void {
  if (!context.actor || !context.clientId) {
    throw terminalContractError("caller_identity_required", "caller_context")
  }
}

function controllerFor(context: DispatchContext, required = false): TerminalControllerContext {
  if (!context.clientId || !context.actor || (required && !context.controllerInstanceId)) {
    throw terminalContractError("caller_identity_required", "caller_context")
  }
  return {
    clientId: context.clientId,
    controllerInstanceId: context.controllerInstanceId ?? `${context.clientId}:observer`,
    actorKind: context.actor.kind,
  }
}

function resourceFor(params: Record<string, unknown>): string {
  if (typeof params.sessionId === "string") return `terminal:session:${params.sessionId}`
  if (typeof params.commandId === "string") return `terminal:command:${params.commandId}`
  if (typeof params.groupId === "string") return `terminal:group:${params.groupId}`
  if (typeof params.operationId === "string") return "terminal:operation"
  if (typeof params.deletePlanId === "string") return "terminal:group-delete-plan"
  return "terminal:domain"
}

function auditMetadata(action: string, params: Record<string, unknown>): Record<string, unknown> {
  const actions = Array.isArray(params.actions) ? params.actions : []
  return {
    capabilityAction: action,
    actionCount: actions.length,
    actionTypes: actions.map((item) => isRecord(item) ? item.type : "invalid"),
    keyNames: actions.flatMap((item) => isRecord(item) && item.type === "key" && typeof item.key === "string" ? [item.key] : []),
    byteCount: typeof params.dataBase64 === "string"
      ? Buffer.from(params.dataBase64, "base64").byteLength
      : typeof params.text === "string"
        ? Buffer.byteLength(params.text)
        : undefined,
    hasIdempotencyKey: typeof params.idempotencyKey === "string",
    expectedLaunchRevision: typeof params.expectedLaunchRevision === "number" ? params.expectedLaunchRevision : undefined,
    expectedCommandRevision: typeof params.expectedCommandRevision === "number" ? params.expectedCommandRevision : undefined,
    expectedInputRevision: typeof params.expectedInputRevision === "number" ? params.expectedInputRevision : undefined,
    expectedSizeRevision: typeof params.expectedSizeRevision === "number" ? params.expectedSizeRevision : undefined,
  }
}

function groupSummary(
  group: ReturnType<TerminalService["listGroups"]>[number],
  sessions: ReturnType<TerminalService["listSessions"]>,
) {
  return {
    groupId: group.id, name: group.name, createdAt: group.createdAt,
    groupRevision: group.groupRevision, launchRevision: group.launchRevision,
    membershipRevision: group.membershipRevision,
    commandCollectionRevision: group.commandCollectionRevision,
    memberCount: sessions.filter((session) => session.groupId === group.id).length,
    commandCount: group.settings?.commands?.length ?? 0,
  }
}

function sessionSummary(session: ReturnType<TerminalService["listSessions"]>[number]) {
  return { sessionId: session.id, title: session.title, groupId: session.groupId, createdAt: session.createdAt, source: session.creationSource }
}

function commandSummary(groupId: string, command: ReturnType<typeof requireCommand>) {
  return {
    groupId,
    commandId: command.id,
    name: command.name,
    commandRevision: command.commandRevision,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
    launch: launchMetadata(command.launch, "command"),
  }
}

function environmentMetadata(
  environment: Record<string, string | null> | undefined,
  source: "global" | "group" | "command",
) {
  return Object.entries(environment ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, action: value === null ? "unset" as const : "set" as const, source }))
}

function launchMetadata(
  launch: TerminalLaunchLayer | undefined,
  source: "global" | "group" | "command",
) {
  return {
    defaultCwd: launch?.defaultCwd ?? null,
    shell: launch?.shell ?? null,
    environment: environmentMetadata(launch?.environment, source),
  }
}

function mergeLaunchLayer(
  current: TerminalLaunchLayer | undefined,
  patch: {
    defaultCwd?: string | null
    shell?: string | null
    environment?: Record<string, string | null>
    inheritEnvironmentKeys?: readonly string[]
  },
): TerminalLaunchLayer | undefined {
  const environment = patch.environment === undefined
    ? current?.environment
    : { ...current?.environment, ...patch.environment }
  const nextEnvironment = environment ? { ...environment } : undefined
  for (const key of patch.inheritEnvironmentKeys ?? []) delete nextEnvironment?.[key]
  const next: TerminalLaunchLayer = {
    ...((patch.defaultCwd === undefined ? current?.defaultCwd : patch.defaultCwd) ? {
      defaultCwd: (patch.defaultCwd === undefined ? current?.defaultCwd : patch.defaultCwd)!,
    } : {}),
    ...((patch.shell === undefined ? current?.shell : patch.shell) ? {
      shell: (patch.shell === undefined ? current?.shell : patch.shell)!,
    } : {}),
    ...(nextEnvironment && Object.keys(nextEnvironment).length ? { environment: nextEnvironment } : {}),
  }
  return Object.keys(next).length ? next : undefined
}

function launchLayerFromMcpInput(input: {
  defaultCwd?: string | null
  shell?: string | null
  environment?: Record<string, string | null>
}): TerminalLaunchLayer {
  return {
    ...(input.defaultCwd ? { defaultCwd: input.defaultCwd } : {}),
    ...(input.shell ? { shell: input.shell } : {}),
    ...(input.environment && Object.keys(input.environment).length ? { environment: input.environment } : {}),
  }
}

function createdSession(session: ReturnType<TerminalService["getSession"]>, launchRevisionApplied: number | null) {
  return {
    outcome: session.status === "running" ? "accepted" : "failed_after_identity_created",
    sessionId: session.id, source: "mcp", launchRevisionApplied,
    lifecycle: session.status, stateRevision: session.stateRevision,
    throughOutputSeq: session.lastOutputSeq,
    inputRevision: session.inputRevision,
    launchFacts: session.launchFacts,
  }
}

function outputOnly(output: ReturnType<TerminalService["readSession"]>) {
  return {
    sessionId: output.session.id,
    firstSeq: output.firstSeq,
    nextSeq: output.nextSeq,
    throughOutputSeq: output.session.lastOutputSeq,
    chunks: output.chunks,
    gap: output.gap,
    truncated: output.truncated,
    hasMore: output.hasMore,
    discardedBytes: output.discardedBytes,
    discardedChunks: output.discardedChunks,
  }
}

function redactOperation(operation: unknown, context: DispatchContext): unknown {
  if (!isRecord(operation) || typeof operation.requestedBy !== "string") return operation
  return {
    ...operation,
    requestedBy: operation.requestedBy === context.clientId ? "self" : "other_actor",
  }
}

function filterSessions<T extends { groupId?: string; createdAfter?: string; createdBefore?: string; creationSource?: string; title?: string }>(
  sessions: ReturnType<TerminalService["listSessions"]>,
  input: T,
) {
  return sessions.filter((session) =>
    (!input.groupId || session.groupId === input.groupId)
    && (!input.createdAfter || session.createdAt >= input.createdAfter)
    && (!input.createdBefore || session.createdAt <= input.createdBefore)
    && (!input.creationSource || session.creationSource === input.creationSource)
    && (!input.title || session.title.includes(input.title)))
}

function paginate<T>(
  items: readonly T[],
  limit = 50,
  cursor: string | undefined,
  query: unknown,
  domainRevision?: number,
) {
  const queryDigest = digest(query, ["cursor"])
  let offset = 0
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { anchor?: unknown; queryDigest?: unknown }
      if (decoded.queryDigest !== queryDigest || typeof decoded.anchor !== "string") throw new Error()
      const anchorIndex = items.findIndex((item) => pageIdentity(item) === decoded.anchor)
      if (anchorIndex < 0) {
        throw terminalContractError("cursor_invalid", "cursor", { details: { reason: "anchor_missing" } })
      }
      offset = anchorIndex + 1
    } catch (error) {
      if (error instanceof TerminalContractError) throw error
      throw terminalContractError("cursor_invalid", "cursor")
    }
  }
  const boundedLimit = Math.min(200, Math.max(1, limit))
  const page = items.slice(offset, offset + boundedLimit)
  return {
    items: page,
    nextCursor: offset + page.length < items.length && page.length > 0
      ? Buffer.from(JSON.stringify({ anchor: pageIdentity(page.at(-1)), queryDigest })).toString("base64url")
      : null,
    domainRevision,
    generatedAt: new Date().toISOString(),
  }
}

function pageIdentity(value: unknown): string {
  if (!isRecord(value)) return digest(value)
  const stableId = value.sessionId ?? value.commandId ?? value.groupId ?? value.operationId ?? value.id
  return typeof stableId === "string" ? stableId : digest(value)
}

function enforceRateLimit(
  windows: Map<string, number[]>,
  clientId: string,
  mutates: boolean,
): void {
  const current = Date.now()
  const windowStart = current - 60_000
  const kind = mutates ? "write" : "read"
  const key = `${clientId}:${kind}`
  const recent = (windows.get(key) ?? []).filter((timestamp) => timestamp > windowStart)
  const limit = mutates ? TERMINAL_MCP_WRITE_RATE_LIMIT_PER_MINUTE : TERMINAL_MCP_READ_RATE_LIMIT_PER_MINUTE
  if (recent.length >= limit) {
    const retryAt = new Date(recent[0]! + 60_000).toISOString()
    windows.set(key, recent)
    throw terminalContractError("rate_limited", "quota", {
      retryable: true,
      retryAfter: retryAt,
      details: { dimension: `client_${kind}_requests` },
    })
  }
  recent.push(current)
  windows.set(key, recent)
}

function digest(value: unknown, omit: readonly string[] = []): string {
  const filtered = isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)))
    : value
  return JSON.stringify(filtered, Object.keys(filtered as Record<string, unknown>).sort())
}

function requireGroup(service: TerminalService, groupId: string) {
  const group = service.listGroups().find((item) => item.id === groupId)
  if (!group) throw terminalContractError("not_found", "not_found")
  return group
}

function requireCommand(group: ReturnType<typeof requireGroup>, commandId: string) {
  const command = group.settings?.commands?.find((item) => item.id === commandId)
  if (!command) throw terminalContractError("not_found", "not_found")
  return command
}

function requireRevision(current: number, expected: number, field: string): void {
  if (current !== expected) throw terminalContractError("revision_conflict", "revision", { details: { field, current } })
}

function mutationResult<T>(value: T, before: number, after: number, changed: boolean) {
  return { operationId: randomOperationId(), value, beforeRevision: before, afterRevision: after, changed, noOp: !changed }
}

function randomOperationId(): string {
  return globalThis.crypto.randomUUID()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isZodError(value: unknown): value is { issues: unknown[] } {
  return isRecord(value) && Array.isArray(value.issues)
}
