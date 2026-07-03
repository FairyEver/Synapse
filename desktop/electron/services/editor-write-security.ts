import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"

export type EditorWriteSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

async function checkEditorWritePermission(
  deps: EditorWriteSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.write",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.write",
      actor: deps.actor,
      metadata,
      outcome: "denied",
      resource,
    })
    throw new Error("没有写入该位置的权限。")
  }
}

function recordEditorWriteAudit(
  deps: EditorWriteSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.write",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
}

export {
  checkEditorWritePermission,
  recordEditorWriteAudit,
}
