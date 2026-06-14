import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"

type CapabilityPermissionAuditInput = {
  readonly permissionGuard?: Pick<PermissionGuard, "check">
  readonly auditSink?: Pick<AuditSink, "record">
  readonly action: PermissionAction
  readonly actor: ActorIdentity
  readonly resource: string
  readonly context: Record<string, unknown>
}

type CapabilityPermissionResult = Awaited<ReturnType<PermissionGuard["check"]>> | undefined

export async function checkCapabilityPermission(
  input: CapabilityPermissionAuditInput,
): Promise<CapabilityPermissionResult> {
  try {
    return await input.permissionGuard?.check({
      action: input.action,
      actor: input.actor,
      resource: input.resource,
      context: input.context,
    })
  } catch (error) {
    input.auditSink?.record({
      action: input.action,
      actor: input.actor,
      resource: input.resource,
      outcome: "failed",
      metadata: {
        ...input.context,
        reason: "permission-check-error",
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
}
