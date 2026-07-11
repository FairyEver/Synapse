import { z } from "zod"

import type { EventBus } from "../../../electron/runtime/event-bus"
import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { notifyInstallStatusChanged } from "../../../electron/modules/install-status-events"
import { createMainLogger } from "../../../electron/services/log-store"
import {
  skillUninstallBatchResultSchema,
  skillUninstallCancelRequestSchema,
  skillUninstallScanRequestSchema,
  skillUninstallScanResultSchema,
  skillUninstallTargetSchema,
  type SkillUninstallCancelRequest,
  type SkillUninstallScanRequest,
  type SkillUninstallTarget,
} from "../shared/schema"
import {
  skillUninstallerService,
  type SkillUninstallerSecurity,
  type SkillUninstallerService,
} from "./service"

const logger = createMainLogger("ipc.skill-uninstaller")

function securityFrom(ctx: IpcHandlerContext): SkillUninstallerSecurity {
  return {
    actor: { kind: "user" },
    auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
    permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
  }
}

export function createSkillUninstallerIpcModule(
  service: Pick<SkillUninstallerService, "scan" | "uninstall"> = skillUninstallerService,
): IpcModule {
  const activeScans = new Map<string, AbortController>()
  const module: IpcModule = {
    id: "skill-uninstaller",
    methods: {
      scan: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:scan",
        request: skillUninstallScanRequestSchema,
        response: skillUninstallScanResultSchema,
        handler: async (ctx, request: SkillUninstallScanRequest) => {
          activeScans.get(request.scanId)?.abort()
          const controller = new AbortController()
          activeScans.set(request.scanId, controller)
          try {
            return await service.scan(request.query, securityFrom(ctx), controller.signal)
          } finally {
            if (activeScans.get(request.scanId) === controller) {
              activeScans.delete(request.scanId)
            }
          }
        },
      },
      cancelScan: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:scan:cancel",
        request: skillUninstallCancelRequestSchema,
        response: z.object({ cancelled: z.boolean() }).strict(),
        handler: async (_ctx, request: SkillUninstallCancelRequest) => {
          const controller = activeScans.get(request.scanId)
          if (controller && activeScans.get(request.scanId) === controller) {
            activeScans.delete(request.scanId)
            controller.abort()
          }
          return { cancelled: Boolean(controller) }
        },
      },
      uninstall: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:uninstall",
        request: z.object({ targets: z.array(skillUninstallTargetSchema) }).strict(),
        response: skillUninstallBatchResultSchema,
        handler: async (ctx, request: { targets: SkillUninstallTarget[] }) => {
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          return service.uninstall(request.targets, securityFrom(ctx), {
            onTrashedContentId: (contentId) => notifyInstallStatusChanged(eventBus, contentId, {
              logger,
              warningMessage: "Failed to refresh install status after Skill uninstall.",
            }),
          })
        },
      },
    },
    events: {},
  }

  return module
}

export const skillUninstallerIpcModule = createSkillUninstallerIpcModule()
