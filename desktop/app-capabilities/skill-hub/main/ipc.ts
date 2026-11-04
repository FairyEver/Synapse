import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import { SYSTEM_APP_WINDOW_SERVICE_ID, type createSystemAppWindowService } from "../../../electron/services/system-app-window-service"
import { HUB_INSTALL_SOURCE_PREFIX, hubInstallSkillIdSchema } from "../shared/install-source"
import type { HubInstallPrepareResult } from "../shared/ipc-result"
import { SkillHubDesktopError } from "./error"
import { HUB_INSTALL_PROVIDER_ID, type HubPreparedSourceProvider } from "./prepared-source-provider"

function installerSender(ctx: IpcHandlerContext) {
  if (!ctx.sender || ctx.sender.isDestroyed()
    || !ctx.resolve<ReturnType<typeof createSystemAppWindowService>>(SYSTEM_APP_WINDOW_SERVICE_ID).isSkillInstallerSender(ctx.sender.id)) {
    throw new Error("仅 Skill 安装器可使用此操作。")
  }
  return ctx.sender
}

export const skillHubIpcModule: IpcModule = {
  id: "skillHub",
  methods: {
    prepareInstall: {
      operationId: "app.skill_hub.operation.prepare_install",
      kind: "invoke",
      request: z.object({ skillId: hubInstallSkillIdSchema }).strict(),
      async handler(ctx, request: { skillId: string }): Promise<HubInstallPrepareResult> {
        const sender = installerSender(ctx)
        const controller = new AbortController()
        const detach = sender.onDestroyed(() => controller.abort())
        controller.signal.addEventListener("abort", detach, { once: true })
        try {
          const provider = ctx.resolve<HubPreparedSourceProvider>(HUB_INSTALL_PROVIDER_ID)
          const source = await provider.prepare(request.skillId, {
            actor: { kind: "user", id: "skill-installer" }, clientId: String(sender.id), signal: controller.signal,
          })
          provider.onRelease(source.preparedSourceId!, detach)
          return { ok: true, source }
        } catch (error) {
          detach()
          if (error instanceof SkillHubDesktopError) return { ok: false, code: error.code, message: error.message }
          ctx.logger?.child("skill-hub").warn?.("Skill Hub installer preparation failed.", { errorName: error instanceof Error ? error.name : typeof error })
          return { ok: false, code: "HUB_PREPARE_UNAVAILABLE", message: "暂时无法读取 Skill，请重试。" }
        }
      },
    },
    releaseInstall: {
      operationId: "app.skill_hub.operation.release_install",
      kind: "invoke",
      request: z.object({ preparedSourceId: z.string().startsWith(HUB_INSTALL_SOURCE_PREFIX).max(128) }).strict(),
      handler(ctx, request: { preparedSourceId: string }) {
        const sender = installerSender(ctx)
        ctx.resolve<HubPreparedSourceProvider>(HUB_INSTALL_PROVIDER_ID).release(request.preparedSourceId, String(sender.id))
      },
    },
  },
  events: {},
}
