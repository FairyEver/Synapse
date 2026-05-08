import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink } from "../../runtime/audit/types"
import type { PermissionGuard } from "../../runtime/permission/types"
import { installStatusCacheService } from "../../services/install-status-cache-service"
import { trashScanItem } from "../../services/editor-scan-service"
import { scanAll } from "../../services/editor-scan-service"
import { createMainLogger } from "../../services/log-store"

const logger = createMainLogger("install-status-ipc")

const uninstallSchema = z.object({
  contentId: z.string(),
  editorId: z.string(),
})

export const installStatusIpcModule: IpcModule = {
  id: "install-status",
  methods: {
    getAll: {
      kind: "invoke",
      channel: "synapse:install-status:get-all",
      request: z.any(),
      response: z.any(),
      handler: async () => {
        return installStatusCacheService.getAll()
      },
    },
    uninstall: {
      kind: "invoke",
      channel: "synapse:install-status:uninstall",
      request: uninstallSchema,
      response: z.any(),
      handler: async (ctx, payload: { contentId: string; editorId: string }) => {
        const scan = await scanAll()
        const globalEntry = scan.global.find((e) => e.editorId === payload.editorId)
        if (!globalEntry) {
          throw new Error(`Editor ${payload.editorId} not found in scan`)
        }

        const skill = globalEntry.skills.find((s) => s.synapseContentId === payload.contentId)
        const rule = globalEntry.rules.find((r) => r.synapseContentId === payload.contentId)
        const item = skill ?? rule

        if (!item) {
          throw new Error(`Content ${payload.contentId} not found in editor ${payload.editorId}`)
        }

        await trashScanItem(
          {
            itemType: skill ? "skill" : "rule",
            itemName: item.name,
            itemPath: item.path,
            editorId: payload.editorId,
            scope: "global",
            source: item.synapseContentId ? "synapse" : "external",
            trash: item.trash,
            synapseContentId: item.synapseContentId,
          },
          {
            actor: { kind: "user" },
            auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
            permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
          },
        )

        const editors = await installStatusCacheService.refresh(payload.contentId)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        eventBus.emit({
          domain: "install-status",
          type: "install-status.changed",
          payload: { contentId: payload.contentId, editors },
          timestamp: new Date().toISOString(),
        })
      },
    },
  },
  events: {},
}
