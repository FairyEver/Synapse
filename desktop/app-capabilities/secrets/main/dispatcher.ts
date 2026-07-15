import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
import {
  SECRETS_ITEM_CREATE_CAPABILITY_ID,
  SECRETS_ITEM_DELETE_CAPABILITY_ID,
  SECRETS_ITEM_GET_CAPABILITY_ID,
  SECRETS_ITEM_LIST_CAPABILITY_ID,
  SECRETS_ITEM_UPDATE_CAPABILITY_ID,
  SECRETS_ITEM_UPSERT_CAPABILITY_ID,
} from "../shared/capability"
import {
  secretCreateInputSchema,
  secretDeleteInputSchema,
  secretGetInputSchema,
  secretUpdateInputSchema,
  secretUpsertInputSchema,
} from "../shared/schema"
import type { SecretsService } from "./service"

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }

type SecretAuditContext = {
  readonly action: PermissionAction
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

export type SecretsCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createSecretsCapabilityDispatcher(deps: {
  readonly service: SecretsService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}): SecretsCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      switch (action) {
        case SECRETS_ITEM_LIST_CAPABILITY_ID: {
          const audit = await authorizeSecret(deps, "secret.read", action, context, undefined, false)
          return runWithAudit(deps, audit, async () => {
            const result = await deps.service.list()
            recordSecretAudit(deps, audit, "allowed", { secretCount: result.total })
            return { ok: true, data: result, total: result.total }
          })
        }
        case SECRETS_ITEM_GET_CAPABILITY_ID: {
          const input = secretGetInputSchema.parse(params)
          const audit = await authorizeSecret(deps, "secret.read", action, context, input.name, input.includeValue === true)
          return runWithAudit(deps, audit, async () => {
            const secret = await deps.service.get(input)
            recordSecretAudit(deps, audit, "allowed")
            return { ok: true, data: { secret } }
          })
        }
        case SECRETS_ITEM_CREATE_CAPABILITY_ID: {
          const input = secretCreateInputSchema.parse(params)
          const audit = await authorizeSecret(deps, "secret.write", action, context, input.name, false)
          return runWithAudit(deps, audit, async () => {
            const secret = await deps.service.create(input)
            recordSecretAudit(deps, audit, "allowed")
            return { ok: true, data: { secret, created: true }, affected: 1 }
          })
        }
        case SECRETS_ITEM_UPDATE_CAPABILITY_ID: {
          const input = secretUpdateInputSchema.parse(params)
          const audit = await authorizeSecret(deps, "secret.write", action, context, input.name, false)
          return runWithAudit(deps, audit, async () => {
            const secret = await deps.service.update(input)
            recordSecretAudit(deps, audit, "allowed")
            return { ok: true, data: { secret, updated: true }, affected: 1 }
          })
        }
        case SECRETS_ITEM_UPSERT_CAPABILITY_ID: {
          const input = secretUpsertInputSchema.parse(params)
          const audit = await authorizeSecret(deps, "secret.write", action, context, input.name, false)
          return runWithAudit(deps, audit, async () => {
            const result = await deps.service.upsert(input)
            recordSecretAudit(deps, audit, "allowed", { created: result.created })
            return { ok: true, data: result, affected: 1 }
          })
        }
        case SECRETS_ITEM_DELETE_CAPABILITY_ID: {
          const input = secretDeleteInputSchema.parse(params)
          const audit = await authorizeSecret(deps, "secret.write", action, context, input.name, false)
          return runWithAudit(deps, audit, async () => {
            const secret = await deps.service.delete(input)
            recordSecretAudit(deps, audit, "allowed")
            return { ok: true, data: { secret, deleted: true }, affected: 1 }
          })
        }
        default:
          throw new Error(`Unknown secrets action: ${action}`)
      }
    },
  }
}

async function authorizeSecret(
  deps: {
    readonly permissionGuard?: PermissionGuard
    readonly auditSink?: AuditSink
    readonly actor?: ActorIdentity
  },
  action: PermissionAction,
  capabilityAction: string,
  context: DispatchContext,
  secretName: string | undefined,
  includeValue: boolean,
): Promise<SecretAuditContext> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const resource = secretName ? `secret:user:${secretName.toLowerCase()}` : "secret:user:*"
  const metadata = {
    source: context.source ?? "api",
    secretAction: capabilityAction,
    includeValue,
  }

  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action,
    actor,
    resource,
    context: metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
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

  return { action, actor, resource, metadata }
}

async function runWithAudit<T>(
  deps: { readonly auditSink?: AuditSink },
  audit: SecretAuditContext,
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task()
  } catch (error) {
    recordSecretAudit(deps, audit, "failed", secretFailureMetadata(error))
    throw error
  }
}

function recordSecretAudit(
  deps: { readonly auditSink?: AuditSink },
  audit: SecretAuditContext,
  outcome: "allowed" | "failed",
  metadata?: Record<string, unknown>,
): void {
  deps.auditSink?.record({
    action: audit.action,
    actor: audit.actor,
    resource: audit.resource,
    outcome,
    metadata: metadata ? { ...audit.metadata, ...metadata } : audit.metadata,
  })
}

function secretFailureMetadata(error: unknown): Record<string, unknown> {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: String(error).length,
  }
}
