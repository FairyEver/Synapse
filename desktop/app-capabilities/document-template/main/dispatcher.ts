import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "../shared/capability"
import { generateDocxInputSchema } from "../shared/schema"
import type { DocumentTemplateService } from "./service"

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }

export type DocumentTemplateCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createDocumentTemplateCapabilityDispatcher(deps: {
  readonly service: DocumentTemplateService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}): DocumentTemplateCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action !== DOCUMENT_TEMPLATE_CAPABILITY_ID) {
        throw new Error(`Unknown document template action: ${action}`)
      }
      const parsed = generateDocxInputSchema.parse(params)
      await authorizeFileAccess(deps, context, "fs.read.outside-userdata", parsed.templatePath, "documentTemplate.mcp.template")
      if (parsed.dataPath) {
        await authorizeFileAccess(deps, context, "fs.read.outside-userdata", parsed.dataPath, "documentTemplate.mcp.data")
      }
      await authorizeFileAccess(deps, context, "fs.write.outside-userdata", parsed.outputPath, "documentTemplate.mcp.output")
      const result = await deps.service.generateDocx(parsed)
      return { ok: true, data: result, affected: 1 }
    },
  }
}

async function authorizeFileAccess(
  deps: {
    readonly permissionGuard?: PermissionGuard
    readonly auditSink?: AuditSink
    readonly actor?: ActorIdentity
  },
  context: DispatchContext,
  action: PermissionAction,
  resource: string,
  source: string,
): Promise<void> {
  if (!deps.permissionGuard) return
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = {
    source: context.source ?? "api",
    capabilityAction: DOCUMENT_TEMPLATE_CAPABILITY_ID,
    boundary: source,
  }
  const permission = await deps.permissionGuard.check({
    action,
    actor,
    resource,
    context: metadata,
  })
  deps.auditSink?.record({
    action,
    actor,
    resource,
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? metadata
      : { ...metadata, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
}
