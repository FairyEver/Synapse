import type { SynapseConfig, SynapseRepositoryConfig } from "../../src/types/config"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { checkCapabilityPermission } from "./permission-audit"

type RepositoryCapabilityDispatcherDeps = {
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}

type RepositorySummary = {
  readonly uuid: string
  readonly name: string
  readonly localPath: string
  readonly isActive: boolean
}

type RepositoryAccessSecurity = {
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }

export function createRepositoryCapabilityDispatcher(deps: RepositoryCapabilityDispatcherDeps) {
  return {
    async dispatch(
      action: string,
      _params: Record<string, unknown>,
      context: DispatchContext,
    ): Promise<DispatchResult> {
      switch (action) {
        case "app.settings.repository.item.list": {
          const security = repositoryAccessSecurity(deps, action, context)
          await authorizeRepositoryAccess(deps, security)
          try {
            const config = await deps.loadConfig()
            const repositories = config.repositories.map((repository) =>
              toRepositorySummary(repository, config.activeRepoUuid),
            )
            deps.auditSink?.record({
              action: "fs.read.outside-userdata",
              actor: security.actor,
              resource: security.resource,
              outcome: "allowed",
              metadata: security.metadata,
            })
            return {
              ok: true,
              data: {
                activeRepositoryUuid: config.activeRepoUuid,
                repositories,
              },
              total: repositories.length,
            }
          } catch (error) {
            deps.auditSink?.record({
              action: "fs.read.outside-userdata",
              actor: security.actor,
              resource: security.resource,
              outcome: "failed",
              metadata: {
                ...security.metadata,
                errorName: error instanceof Error ? error.name : typeof error,
                errorLength: String(error).length,
              },
            })
            throw error
          }
        }
        default:
          throw new Error(`Unknown repository action: ${action}`)
      }
    },
  }
}

function repositoryAccessSecurity(
  deps: RepositoryCapabilityDispatcherDeps,
  action: string,
  context: DispatchContext,
): RepositoryAccessSecurity {
  return {
    actor: context.actor ?? deps.actor ?? DEFAULT_ACTOR,
    resource: "repository:list",
    metadata: {
      source: context.source ?? "api",
      repositoryAction: action,
    },
  }
}

async function authorizeRepositoryAccess(
  deps: RepositoryCapabilityDispatcherDeps,
  security: RepositoryAccessSecurity,
): Promise<void> {
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: "fs.read.outside-userdata",
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "fs.read.outside-userdata",
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}

function toRepositorySummary(
  repository: SynapseRepositoryConfig,
  activeRepositoryUuid: string | null,
): RepositorySummary {
  return {
    uuid: repository.uuid,
    name: repository.name,
    localPath: repository.localPath,
    isActive: repository.uuid === activeRepositoryUuid,
  }
}
