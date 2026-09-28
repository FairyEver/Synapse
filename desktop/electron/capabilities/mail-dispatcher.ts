import path from "node:path"
import { z } from "zod"
import type { MailOperation } from "../../src/types/mail"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { checkCapabilityPermission } from "./permission-audit"

type MailAccount = { executeMailOperation: (operation: MailOperation) => Promise<unknown> }
type MailDeps = { accountService: MailAccount; permissionGuard?: PermissionGuard; auditSink?: AuditSink }
const actor: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const id = z.string().min(1)
const content = z.object({ recipientIds: z.array(id).max(50), subject: z.string().max(120), body: z.string().max(100_000), attachmentIds: z.array(id).max(10), replyToId: id.optional() }).strict()

function parseOperation(action: string, params: Record<string, unknown>): MailOperation {
  switch (action) {
    case "app.mail.recipient.list": return { kind: "recipientSearch", ...z.object({ query: z.string().max(100), cursor: id.optional() }).strict().parse(params) }
    case "app.mail.message.list": return { kind: "messageList", ...z.object({ box: z.enum(["inbox", "sent"]), query: z.string().optional(), cursor: id.optional() }).strict().parse(params) }
    case "app.mail.message.get": return { kind: "messageGet", ...z.object({ messageId: id }).strict().parse(params) }
    case "app.mail.message.update": return { kind: "messageSetRead", ...z.object({ messageId: id, read: z.boolean() }).strict().parse(params) }
    case "app.mail.message.delete": return { kind: "messageDelete", ...z.object({ messageId: id }).strict().parse(params) }
    case "app.mail.attachment.create": return { kind: "attachmentLocal", ...z.object({ filePath: z.string().min(1) }).strict().parse(params) }
    case "app.mail.attachment.download_file": return { kind: "attachmentDownload", ...z.object({ messageId: id, attachmentId: id, outputPath: z.string().min(1) }).strict().parse(params) }
    case "app.mail.send.preview": return { kind: "sendPreview", content: content.parse(params) }
    case "app.mail.message.send": {
      const parsed = z.object({ previewId: id, clientRequestId: id, confirmed: z.literal(true) }).strict().parse(params)
      return { kind: "send", previewId: parsed.previewId, clientRequestId: parsed.clientRequestId }
    }
    default: throw new Error(`Unknown mail action: ${action}`)
  }
}

export function createMailCapabilityDispatcher(deps: MailDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const operation = parseOperation(action, params)
      const currentActor = context.actor ?? actor
      const metadata = { source: context.source ?? "api", action, operation: operation.kind, controllerInstanceId: context.controllerInstanceId }
      const permission = await checkCapabilityPermission({ permissionGuard: deps.permissionGuard, auditSink: deps.auditSink, action: "network.connect", actor: currentActor, resource: "synapse-mail", context: metadata })
      if (permission && !permission.allowed) throw new Error(permission.reason)
      if (operation.kind === "attachmentLocal") {
        if (!path.isAbsolute(operation.filePath)) throw new Error("Attachment filePath must be absolute.")
        const readPermission = await checkCapabilityPermission({ permissionGuard: deps.permissionGuard, auditSink: deps.auditSink, action: "fs.read.outside-userdata", actor: currentActor, resource: operation.filePath, context: metadata })
        if (readPermission && !readPermission.allowed) throw new Error(readPermission.reason)
      }
      if (operation.kind === "attachmentDownload") {
        if (!operation.outputPath || !path.isAbsolute(operation.outputPath)) throw new Error("Attachment outputPath must be absolute.")
        const writePermission = await checkCapabilityPermission({ permissionGuard: deps.permissionGuard, auditSink: deps.auditSink, action: "fs.write.outside-userdata", actor: currentActor, resource: operation.outputPath, context: metadata })
        if (writePermission && !writePermission.allowed) throw new Error(writePermission.reason)
      }
      try {
        const data = await deps.accountService.executeMailOperation(operation)
        deps.auditSink?.record({ action: "network.connect", actor: currentActor, resource: "synapse-mail", outcome: "allowed", metadata })
        return { ok: true, data }
      } catch (error) {
        deps.auditSink?.record({ action: "network.connect", actor: currentActor, resource: "synapse-mail", outcome: "failed", metadata: { ...metadata, errorName: error instanceof Error ? error.name : typeof error } })
        throw error
      }
    },
  }
}
