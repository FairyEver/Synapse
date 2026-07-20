import path from "node:path"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  SynapseCopyToEditorPayload,
  SynapseResolveEditorCopyTargetPayload,
} from "../../../src/types/editor-copy"
import { editorCopyService } from "../../services/editor-copy-service"
import { createMainLogger } from "../../services/log-store"

const logger = createMainLogger("ipc.editor-copy")
const anySchema = z.any()

export const editorCopyIpcModule: IpcModule = {
  id: "editor-copy",
  methods: {
    resolveTarget: {
      kind: "invoke",
      operationId: "app.editor_copy.operation.resolve_target",
      request: anySchema,
      response: anySchema,
      handler: async (_ctx, payload: SynapseResolveEditorCopyTargetPayload) => {
        return editorCopyService.resolveTarget(payload)
      },
    },
    copy: {
      kind: "invoke",
      operationId: "app.editor_copy.operation.copy",
      request: anySchema,
      response: anySchema,
      handler: async (ctx, payload: SynapseCopyToEditorPayload) => {
        logger.info("Handling editor copy request.", {
          contentType: payload.source.itemType,
          sourceEditorId: payload.source.editorId,
          sourceName: path.basename(payload.source.itemPath),
          targetEditorId: payload.targetEditorId,
          targetScope: payload.targetScope,
        })
        return editorCopyService.copy(payload, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
  },
  events: {},
}
