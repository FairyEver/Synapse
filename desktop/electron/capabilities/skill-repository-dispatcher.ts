import type {
  SkillRepositoryDetailDto,
  SkillRepositoryForkInput,
  SkillRepositoryForkResultDto,
  SkillRepositoryInstallSessionDto,
  SkillRepositoryItemDto,
  SkillRepositoryUpdateInput,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import type { ContentSkillSourceSecurityDeps } from "../services/content-skill-source-service"
import type {
  SkillRepositoryLocalImportInput,
  SkillRepositoryLocalImportResult,
} from "../services/skill-repository-upload-service"
import type { SkillRepositoryIdentityWriteSecurity } from "../services/skill-repository-local-identity"
import { openSkillRepositoryExternalLink } from "../services/skill-repository-external-open"
import { checkCapabilityPermission } from "./permission-audit"

type SkillRepositoryAccountServicePort = {
  readonly listSkillRepositories: () => Promise<SkillRepositoryItemDto[]>
  readonly getSkillRepository: (repositoryId: string) => Promise<SkillRepositoryDetailDto>
  readonly updateSkillRepository: (
    repositoryId: string,
    input: SkillRepositoryUpdateInput,
  ) => Promise<SkillRepositoryDetailDto>
  readonly forkSkillRepository: (
    repositoryId: string,
    input: SkillRepositoryForkInput,
  ) => Promise<SkillRepositoryForkResultDto>
  readonly createSkillRepositoryInstallSession: (repositoryId: string) => Promise<SkillRepositoryInstallSessionDto>
}

type SkillRepositoryUploadSecurity = ContentSkillSourceSecurityDeps & SkillRepositoryIdentityWriteSecurity

type SkillRepositoryUploadServicePort = {
  readonly importLocal: (
    input: SkillRepositoryLocalImportInput,
    security?: SkillRepositoryUploadSecurity,
  ) => Promise<SkillRepositoryLocalImportResult>
}

type SkillRepositoryCapabilityDispatcherDeps = {
  readonly accountService: SkillRepositoryAccountServicePort
  readonly uploadService: SkillRepositoryUploadServicePort
  readonly publicAppUrl: string
  readonly openExternal?: (url: string) => Promise<void> | void
  readonly auditSink?: AuditSink
  readonly permissionGuard?: PermissionGuard
  readonly actor?: ActorIdentity
}

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const sharedSkillRepositoryPromise = import("@synapse/shared")

export function createSkillRepositoryCapabilityDispatcher(deps: SkillRepositoryCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      switch (action) {
        case "app.skill_repository.item.list":
          return listSkillRepositories(deps, context)
        case "app.skill_repository.item.get":
          return getSkillRepository(deps, params, context)
        case "app.skill_repository.item.import_local":
          return importLocalSkillRepository(deps, params, context)
        case "app.skill_repository.item.update_local":
          return updateLocalSkillRepository(deps, params, context)
        case "app.skill_repository.visibility.update":
          return setSkillRepositoryVisibility(deps, params, context)
        case "app.skill_repository.item.open":
          return openSkillRepository(deps, params, context)
        case "app.skill_repository.public.open":
          return openPublicSkillRepository(deps, params, context)
        case "app.skill_repository.fork.create":
          return forkSkillRepository(deps, params, context)
        case "app.skill_repository.install_session.create":
          return createInstallSession(deps, params, context)
        default:
          throw new Error(`Unknown skill repository action: ${action}`)
      }
    },
  }
}

async function listSkillRepositories(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  context: DispatchContext,
): Promise<DispatchResult> {
  const repositories = await runSkillRepositoryRead(
    deps,
    context,
    "app.skill_repository.item.list",
    undefined,
    () => deps.accountService.listSkillRepositories(),
  )
  return { ok: true, data: repositories, total: repositories.length }
}

async function getSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  const repository = await runSkillRepositoryRead(
    deps,
    context,
    "app.skill_repository.item.get",
    repositoryId,
    () => deps.accountService.getSkillRepository(repositoryId),
  )
  return { ok: true, data: repository }
}

async function importLocalSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  return runSkillRepositoryMutation(
    deps,
    context,
    "app.skill_repository.item.import_local",
    "new",
    async () => {
      const result = await deps.uploadService.importLocal(
        buildUploadInput(params),
        securityFromDeps(deps, context),
      )
      return { ok: true, data: result }
    },
  )
}

async function updateLocalSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  return runSkillRepositoryMutation(
    deps,
    context,
    "app.skill_repository.item.update_local",
    repositoryId,
    async () => {
      const result = await deps.uploadService.importLocal(
        buildUploadInput(params, repositoryId),
        securityFromDeps(deps, context),
      )
      return { ok: true, data: result }
    },
  )
}

async function setSkillRepositoryVisibility(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  const visibility = requireVisibility(params)
  const openInBrowser = optionalBoolean(params, "openInBrowser")
  return runSkillRepositoryMutation(
    deps,
    context,
    "app.skill_repository.visibility.update",
    repositoryId,
    async () => {
      const repository = await deps.accountService.updateSkillRepository(repositoryId, { visibility })
      const { buildSkillRepositoryManagementUrl } = await sharedSkillRepositoryPromise
      const managementUrl = buildSkillRepositoryManagementUrl(deps.publicAppUrl, repository.id)

      const openWarning = await openSkillRepositoryExternalLink({
        requested: openInBrowser === true,
        targetKind: "management",
        url: managementUrl,
        openExternal: deps.openExternal,
      })

      return {
        ok: true,
        data: {
          repository,
          managementUrl,
          ...(openWarning ? { openWarning } : {}),
        },
      }
    },
  )
}

async function forkSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  const input = optionalForkStrings(params)
  return runSkillRepositoryMutation(
    deps,
    context,
    "app.skill_repository.fork.create",
    repositoryId,
    async () => {
      const result = await deps.accountService.forkSkillRepository(repositoryId, input)
      return { ok: true, data: result }
    },
  )
}

async function createInstallSession(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  const openInBrowser = optionalBoolean(params, "openInBrowser")
  return runSkillRepositoryMutation(
    deps,
    context,
    "app.skill_repository.install_session.create",
    repositoryId,
    async () => {
      const session = await deps.accountService.createSkillRepositoryInstallSession(repositoryId)

      const openWarning = await openSkillRepositoryExternalLink({
        requested: openInBrowser === true,
        targetKind: "install",
        url: session.deepLinkUrl,
        openExternal: deps.openExternal,
      })

      return { ok: true, data: { ...session, ...(openWarning ? { openWarning } : {}) } }
    },
  )
}

async function openSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  const openInBrowser = optionalBoolean(params, "openInBrowser")
  return runSkillRepositoryRead(
    deps,
    context,
    "app.skill_repository.item.open",
    repositoryId,
    async () => {
      const { buildSkillRepositoryManagementUrl } = await sharedSkillRepositoryPromise
      const managementUrl = buildSkillRepositoryManagementUrl(deps.publicAppUrl, repositoryId)

      const openWarning = await openSkillRepositoryExternalLink({
        requested: openInBrowser === true,
        targetKind: "management",
        url: managementUrl,
        openExternal: deps.openExternal,
      })

      return {
        ok: true,
        data: {
          repositoryId,
          managementUrl,
          ...(openWarning ? { openWarning } : {}),
        },
      }
    },
  )
}

async function openPublicSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const openInBrowser = optionalBoolean(params, "openInBrowser")
  const path = await resolvePublicPath(deps, params, context)
  const { buildSkillRepositoryPublicUrl } = await sharedSkillRepositoryPromise
  const publicUrl = buildSkillRepositoryPublicUrl(deps.publicAppUrl, path.ownerHandle, path.repositoryName)

  const openWarning = await openSkillRepositoryExternalLink({
    requested: openInBrowser === true,
    targetKind: "public",
    url: publicUrl,
    openExternal: deps.openExternal,
  })

  return {
    ok: true,
    data: {
      publicUrl,
      ownerHandle: path.ownerHandle,
      repositoryName: path.repositoryName,
      repositoryId: path.repositoryId,
      ...(openWarning ? { openWarning } : {}),
    },
  }
}

async function resolvePublicPath(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<{ ownerHandle: string; repositoryName: string; repositoryId?: string }> {
  const ownerHandle = optionalTrimmedString(params, "ownerHandle")
  const repositoryName = optionalTrimmedString(params, "repositoryName")
  if (ownerHandle && repositoryName) {
    return { ownerHandle, repositoryName }
  }

  const repositoryId = requireTrimmedString(params, "repositoryId")
  return runSkillRepositoryRead(
    deps,
    context,
    "app.skill_repository.public.open",
    repositoryId,
    async () => {
      const repository = await deps.accountService.getSkillRepository(repositoryId)
      if (!repository.owner.handle) {
        throw new Error("This Skill repository cannot build a public URL because the owner has no username.")
      }
      return {
        ownerHandle: repository.owner.handle,
        repositoryName: repository.name,
        repositoryId,
      }
    },
  )
}

function buildUploadInput(
  params: Record<string, unknown>,
  repositoryId?: string,
): SkillRepositoryLocalImportInput {
  const openInBrowser = optionalBoolean(params, "openInBrowser")
  return {
    sourceDirectoryPath: requireTrimmedString(params, "sourceDirectoryPath"),
    ...(repositoryId ? { repositoryId } : {}),
    ...optionalUploadStrings(params),
    ...(openInBrowser === undefined ? {} : { openInBrowser }),
  }
}

function optionalForkStrings(params: Record<string, unknown>): SkillRepositoryForkInput {
  const name = optionalTrimmedString(params, "name")
  const title = optionalTrimmedString(params, "title")
  return {
    ...(name === undefined ? {} : { name }),
    ...(title === undefined ? {} : { title }),
  }
}

function optionalUploadStrings(params: Record<string, unknown>): Partial<SkillRepositoryLocalImportInput> {
  const name = optionalTrimmedString(params, "name")
  const title = optionalTrimmedString(params, "title")
  const description = optionalTrimmedString(params, "description")
  return {
    ...(name === undefined ? {} : { name }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  }
}

function securityFromDeps(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  context: DispatchContext,
): SkillRepositoryUploadSecurity | undefined {
  if (!deps.auditSink || !deps.permissionGuard) return undefined
  return {
    actor: context.actor ?? deps.actor ?? DEFAULT_ACTOR,
    auditSink: deps.auditSink,
    permissionGuard: deps.permissionGuard,
  }
}

async function runSkillRepositoryMutation(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  context: DispatchContext,
  capabilityAction: string,
  repositoryId: string,
  task: () => Promise<DispatchResult>,
): Promise<DispatchResult> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const resource = `skill-repository:${repositoryId}`
  const metadata = {
    source: context.source ?? "api",
    capabilityAction,
    boundary: "skill-repository.mcp",
    repositoryId,
  }
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: "content.mutate",
    actor,
    resource,
    context: metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "content.mutate",
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

  try {
    const result = await task()
    deps.auditSink?.record({
      action: "content.mutate",
      actor,
      resource,
      outcome: "allowed",
      metadata,
    })
    return result
  } catch (error) {
    deps.auditSink?.record({
      action: "content.mutate",
      actor,
      resource,
      outcome: "failed",
      metadata: {
        ...metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: error instanceof Error ? error.message.length : String(error).length,
      },
    })
    throw error
  }
}

async function runSkillRepositoryRead<T>(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  context: DispatchContext,
  capabilityAction: string,
  repositoryId: string | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const resource = `skill-repository:${repositoryId ?? "list"}`
  const metadata = {
    source: context.source ?? "api",
    capabilityAction,
    boundary: "skill-repository.mcp",
    ...(repositoryId ? { repositoryId } : {}),
  }
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: "content.read",
    actor,
    resource,
    context: metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "content.read",
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

  try {
    const result = await task()
    deps.auditSink?.record({
      action: "content.read",
      actor,
      resource,
      outcome: "allowed",
      metadata,
    })
    return result
  } catch (error) {
    deps.auditSink?.record({
      action: "content.read",
      actor,
      resource,
      outcome: "failed",
      metadata: {
        ...metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: error instanceof Error ? error.message.length : String(error).length,
      },
    })
    throw error
  }
}

function requireTrimmedString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string") {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  return trimmed
}

function optionalTrimmedString(params: Record<string, unknown>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, key)) return undefined
  const value = params[key]
  if (typeof value !== "string") {
    throw new Error(`Invalid '${key}': expected string`)
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.prototype.hasOwnProperty.call(params, key)) return undefined
  const value = params[key]
  if (typeof value !== "boolean") {
    throw new Error(`Invalid '${key}': expected boolean`)
  }
  return value
}

function requireVisibility(params: Record<string, unknown>): "private" | "public" {
  const value = requireTrimmedString(params, "visibility")
  if (value === "private" || value === "public") return value
  throw new Error("Invalid 'visibility': expected private or public")
}
