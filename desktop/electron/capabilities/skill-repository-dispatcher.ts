import type {
  SkillRepositoryDetailDto,
  SkillRepositoryItemDto,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import type { ContentSkillSourceSecurityDeps } from "../services/content-skill-source-service"
import type {
  SkillRepositoryLocalImportInput,
  SkillRepositoryLocalImportResult,
} from "../services/skill-repository-upload-service"
import type { SkillRepositoryIdentityWriteSecurity } from "../services/skill-repository-local-identity"

type SkillRepositoryAccountServicePort = {
  readonly listSkillRepositories: () => Promise<SkillRepositoryItemDto[]>
  readonly getSkillRepository: (repositoryId: string) => Promise<SkillRepositoryDetailDto>
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
          return listSkillRepositories(deps)
        case "app.skill_repository.item.get":
          return getSkillRepository(deps, params)
        case "app.skill_repository.item.import_local":
          return importLocalSkillRepository(deps, params, context)
        case "app.skill_repository.item.update_local":
          return updateLocalSkillRepository(deps, params, context)
        case "app.skill_repository.item.open":
          return openSkillRepository(deps, params)
        default:
          throw new Error(`Unknown skill repository action: ${action}`)
      }
    },
  }
}

async function listSkillRepositories(deps: SkillRepositoryCapabilityDispatcherDeps): Promise<DispatchResult> {
  const repositories = await deps.accountService.listSkillRepositories()
  return { ok: true, data: repositories, total: repositories.length }
}

async function getSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  return { ok: true, data: await deps.accountService.getSkillRepository(repositoryId) }
}

async function importLocalSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const result = await deps.uploadService.importLocal(
    buildUploadInput(params),
    securityFromDeps(deps, context),
  )
  return { ok: true, data: result }
}

async function updateLocalSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const result = await deps.uploadService.importLocal(
    buildUploadInput(params, requireTrimmedString(params, "repositoryId")),
    securityFromDeps(deps, context),
  )
  return { ok: true, data: result }
}

async function openSkillRepository(
  deps: SkillRepositoryCapabilityDispatcherDeps,
  params: Record<string, unknown>,
): Promise<DispatchResult> {
  const repositoryId = requireTrimmedString(params, "repositoryId")
  const openInBrowser = optionalBoolean(params, "openInBrowser")
  const { buildSkillRepositoryManagementUrl } = await sharedSkillRepositoryPromise
  const managementUrl = buildSkillRepositoryManagementUrl(deps.publicAppUrl, repositoryId)

  if (openInBrowser === true && deps.openExternal) {
    await deps.openExternal(managementUrl)
  }

  return {
    ok: true,
    data: {
      repositoryId,
      managementUrl,
    },
  }
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
