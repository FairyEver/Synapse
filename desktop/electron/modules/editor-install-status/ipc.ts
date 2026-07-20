import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { editorInstallStatusService } from "../../services/editor-install-status-service"
import type { SynapseResolveEditorInstallStatusPayload } from "../../../src/types/editor-install-status"

const requestSchema = z.object({
  contentType: z.enum(["rule", "skill"]),
  contentId: z.string(),
  contentName: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  repositoryVersion: z.string().optional(),
  sourceFingerprint: z.string().optional(),
  projects: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
})
const anySchema = z.any()

export const editorInstallStatusIpcModule: IpcModule = {
  id: "editor-install-status",
  methods: {
    resolveForContent: {
      kind: "invoke",
      operationId: "app.editor_install_status.operation.resolve_for_content",
      request: requestSchema,
      response: anySchema,
      handler: async (_ctx, payload: SynapseResolveEditorInstallStatusPayload) => {
        return editorInstallStatusService.resolveForContent(payload)
      },
    },
  },
  events: {},
}
