import { z } from "zod"

import type { EventBus } from "../../../electron/runtime/event-bus"
import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { notifyInstallStatusChanged } from "../../../electron/modules/install-status-events"
import { createMainLogger } from "../../../electron/services/log-store"
import {
  skillUninstallBatchResultSchema,
  skillUninstallCancelRequestSchema,
  skillUninstallExecutionCancelRequestSchema,
  skillUninstallNameScanRequestSchema,
  skillUninstallNameScanResultSchema,
  skillUninstallRequestSchema,
  skillUninstallScanRequestSchema,
  skillUninstallScanResultSchema,
  type SkillUninstallCancelRequest,
  type SkillUninstallExecutionCancelRequest,
  type SkillUninstallNameScanRequest,
  type SkillUninstallRequest,
  type SkillUninstallScanRequest,
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
  service: Pick<SkillUninstallerService, "scan" | "scanNames" | "uninstall"> = skillUninstallerService,
): IpcModule {
  const activeScans = new Map<string, AbortController>()
  const activeUninstalls = new Map<string, AbortController>()

  async function runScan<T>(scanId: string, scan: (signal: AbortSignal) => Promise<T>): Promise<T> {
    activeScans.get(scanId)?.abort()
    const controller = new AbortController()
    activeScans.set(scanId, controller)
    try {
      return await scan(controller.signal)
    } finally {
      if (activeScans.get(scanId) === controller) activeScans.delete(scanId)
    }
  }

  const module: IpcModule = {
    id: "skill-uninstaller",
    methods: {
      scan: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:scan",
        request: skillUninstallScanRequestSchema,
        response: skillUninstallScanResultSchema,
        handler: async (ctx, request: SkillUninstallScanRequest) => runScan(
          request.scanId,
          (signal) => service.scan(request.query, securityFrom(ctx), signal),
        ),
      },
      scanNames: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:names:scan",
        request: skillUninstallNameScanRequestSchema,
        response: skillUninstallNameScanResultSchema,
        handler: async (ctx, request: SkillUninstallNameScanRequest) => runScan(
          request.scanId,
          (signal) => service.scanNames(request.searchRootPath, securityFrom(ctx), signal),
        ),
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
      cancelUninstall: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:uninstall:cancel",
        request: skillUninstallExecutionCancelRequestSchema,
        response: z.object({ cancelled: z.boolean() }).strict(),
        handler: async (_ctx, request: SkillUninstallExecutionCancelRequest) => {
          const controller = activeUninstalls.get(request.operationId)
          if (controller && activeUninstalls.get(request.operationId) === controller) {
            activeUninstalls.delete(request.operationId)
            controller.abort("user-cancel")
          }
          return { cancelled: Boolean(controller) }
        },
      },
      uninstall: {
        kind: "invoke",
        channel: "synapse:skill-uninstaller:uninstall",
        request: skillUninstallRequestSchema,
        response: skillUninstallBatchResultSchema,
        handler: async (ctx, request: SkillUninstallRequest) => {
          activeUninstalls.get(request.operationId)?.abort("superseded")
          const controller = new AbortController()
          activeUninstalls.set(request.operationId, controller)
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          try {
            return await service.uninstall(request.targets, securityFrom(ctx), {
              onTrashedContentId: async (contentId) => {
                const refreshed = await notifyInstallStatusChanged(eventBus, contentId, {
                  logger,
                  warningMessage: "Failed to refresh install status after Skill uninstall.",
                })
                if (refreshed === false) throw new Error("Install status refresh failed.")
              },
            }, controller.signal)
          } finally {
            if (activeUninstalls.get(request.operationId) === controller) {
              activeUninstalls.delete(request.operationId)
            }
          }
        },
      },
    },
    events: {},
  }

  return module
}

export const skillUninstallerIpcModule = createSkillUninstallerIpcModule()
