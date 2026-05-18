import type { IpcHandlerContext } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

interface GuardedShellOperation {
  ctx: IpcHandlerContext
  resource: string
  source: string
  run(): Promise<void> | void
}

export async function runGuardedShellOperation(operation: GuardedShellOperation): Promise<void> {
  const actor = { kind: "user" } as const
  const permissionGuard = operation.ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = operation.ctx.resolve<AuditSink>("core.audit-sink")
  const permission = await permissionGuard.check({
    action: "shell.exec",
    actor,
    resource: operation.resource,
    context: { source: operation.source },
  })

  if (!permission.allowed) {
    auditSink.record({
      action: "shell.exec",
      actor,
      resource: operation.resource,
      outcome: "denied",
      metadata: {
        source: operation.source,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }

  try {
    await operation.run()
    auditSink.record({
      action: "shell.exec",
      actor,
      resource: operation.resource,
      outcome: "allowed",
      metadata: { source: operation.source },
    })
  } catch (error) {
    auditSink.record({
      action: "shell.exec",
      actor,
      resource: operation.resource,
      outcome: "failed",
      metadata: {
        source: operation.source,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
}
