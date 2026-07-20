import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink, PermissionGuard } from "../../runtime/security/permission-guard"
import { skillUninstallerService } from "../../../app-capabilities/skill-uninstaller/main/service"
import { installStatusCacheService } from "../../services/install-status-cache-service"
import { scanGlobalEditorById, trashScanItem } from "../../services/editor-scan-service"
import { createMainLogger } from "../../services/log-store"
import type { InstallStatusEntry } from "../../../src/types/install-status"

const logger = createMainLogger("ipc.install-status")

const uninstallSchema = z.object({
  contentId: z.string(),
  editorId: z.string(),
})

const uninstallResultSchema = z.object({
  warning: z.string().optional(),
})

export const installStatusIpcModule: IpcModule = {
  id: "install-status",
  methods: {
    getAll: {
      kind: "invoke",
      operationId: "app.install_status.operation.get_all",
      request: z.any(),
      response: z.any(),
      handler: async () => {
        return installStatusCacheService.getAll()
      },
    },
    uninstall: {
      kind: "invoke",
      operationId: "app.install_status.operation.uninstall",
      request: uninstallSchema,
      response: uninstallResultSchema,
      handler: async (ctx, payload: { contentId: string; editorId: string }) => {
        const globalEntry = await scanGlobalEditorById(payload.editorId)
        if (!globalEntry) {
          throw new Error(`Editor ${payload.editorId} not found in scan`)
        }

        const skill = globalEntry.skills.find((s) => s.synapseContentId === payload.contentId)
        const rule = globalEntry.rules.find((r) => r.synapseContentId === payload.contentId)
        if (!skill && !rule) {
          throw new Error(`Content ${payload.contentId} not found in editor ${payload.editorId}`)
        }

        const security = {
          actor: { kind: "user" } as const,
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        }

        const emitInstallStatusChanged = (contentId: string, entries: InstallStatusEntry[]): void => {
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          eventBus.emit({
            domain: "install-status",
            type: "install-status.changed",
            payload: { contentId, entries },
            timestamp: new Date().toISOString(),
          })
        }

        const refreshInstallStatus = async (contentId: string): Promise<void> => {
          const entries = await installStatusCacheService.refreshGlobal(contentId, payload.editorId)
          emitInstallStatusChanged(contentId, entries)
        }

        if (skill) {
          const result = await skillUninstallerService.uninstall(
            [{ path: skill.path, query: { name: skill.name } }],
            security,
            {
              onTrashedContentId: async (contentId) => {
                try {
                  await refreshInstallStatus(contentId)
                } catch (error) {
                  const entries = installStatusCacheService.removeGlobalEntry(contentId, payload.editorId)
                  emitInstallStatusChanged(contentId, entries)
                  logger.warn("Failed to refresh install status after uninstall.", {
                    contentId,
                    editorId: payload.editorId,
                    error,
                  })
                  throw error
                }
              },
            },
          )
          const uninstallResult = result.results[0]
          if (uninstallResult?.status !== "trashed") {
            throw new Error(uninstallResult?.error ?? "Skill 卸载失败。")
          }
          return uninstallResult.warning ? { warning: uninstallResult.warning } : {}
        }

        if (!rule) {
          throw new Error(`Content ${payload.contentId} not found in editor ${payload.editorId}`)
        }

        await trashScanItem({
          itemType: "rule",
          itemName: rule.name,
          itemPath: rule.path,
          editorId: payload.editorId,
          scope: "global",
          source: rule.synapseContentId ? "synapse" : "external",
          trash: rule.trash,
          synapseContentId: rule.synapseContentId,
        }, security)

        try {
          await refreshInstallStatus(payload.contentId)
        } catch (error) {
          logger.warn("Failed to refresh install status after uninstall.", {
            contentId: payload.contentId,
            editorId: payload.editorId,
            error,
          })
        }
        return {}
      },
    },
  },
  events: {},
}
