import { randomUUID } from "node:crypto"
import { z } from "zod"
import {
  SKILL_HUB_LIMITS,
  skillHubDetailSchema,
  skillHubListInputSchema,
  skillHubMainResultSchema,
  skillHubPageSchema,
  skillHubTeamPageSchema,
  skillHubTeamQuerySchema,
  type SkillHubListInput,
  type SkillHubTeamQuery,
} from "@synapse/shared/skill-hub-contracts"
import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import { SYSTEM_APP_WINDOW_SERVICE_ID, type createSystemAppWindowService } from "../../../electron/services/system-app-window-service"
import { HUB_INSTALL_SOURCE_PREFIX, hubInstallSkillIdSchema } from "../shared/install-source"
import type { HubCatalogResult, HubInstallPrepareResult } from "../shared/ipc-result"
import type { SkillHubCaller } from "./access"
import { SkillHubDesktopError } from "./error"
import { HUB_INSTALL_PROVIDER_ID, type HubPreparedSourceProvider } from "./prepared-source-provider"
import { SKILL_HUB_SERVICE_ID, type DesktopSkillHubService } from "./service"

type WindowService = ReturnType<typeof createSystemAppWindowService>
const skillInput = z.object({ skillId: hubInstallSkillIdSchema }).strict()
const catalogLifetimes = new Map<number, { controller: AbortController; detach: () => void; requests: number }>()

function catalogResponse<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), code: z.string(), message: z.string() }),
  ])
}

// The IPC registry and the shared contracts use different Zod minor versions.
// Keep validation in the package that owns each schema.
function sharedSchema<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }) {
  return z.custom<T>((value) => schema.safeParse(value).success)
}

async function catalogRequest<T>(
  ctx: IpcHandlerContext,
  work: (service: DesktopSkillHubService, caller: SkillHubCaller, windows: WindowService) => Promise<T>,
): Promise<HubCatalogResult<T>> {
  const sender = ctx.sender
  const windows = ctx.resolve<WindowService>(SYSTEM_APP_WINDOW_SERVICE_ID)
  if (!sender || sender.isDestroyed() || !windows.isSkillHubCatalogSender(sender.id)) {
    return { ok: false, code: "HUB_FORBIDDEN", message: "仅 Synapse 主窗口和 SkillHub 可使用此操作。" }
  }

  let lifetime = catalogLifetimes.get(sender.id)
  if (!lifetime) {
    const controller = new AbortController()
    lifetime = { controller, detach: sender.onDestroyed(() => controller.abort()), requests: 0 }
    catalogLifetimes.set(sender.id, lifetime)
  }
  lifetime.requests++
  try {
    const service = ctx.resolve<DesktopSkillHubService>(SKILL_HUB_SERVICE_ID)
    const value = await work(service, {
      actor: { kind: "user", id: "skill-hub-catalog" },
      clientId: String(sender.id),
      signal: lifetime.controller.signal,
    }, windows)
    return { ok: true, value }
  } catch (error) {
    if (error instanceof SkillHubDesktopError) return { ok: false, code: error.code, message: error.message }
    ctx.logger?.child("skill-hub").warn?.("SkillHub desktop request failed.", { errorName: error instanceof Error ? error.name : typeof error })
    return { ok: false, code: "HUB_CATALOG_UNAVAILABLE", message: "SkillHub 暂时无法使用，请重试。" }
  } finally {
    if (--lifetime.requests === 0) {
      lifetime.detach()
      catalogLifetimes.delete(sender.id)
    }
  }
}

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
    catalogTeams: {
      operationId: "app.skill_hub.operation.catalog_teams",
      kind: "invoke",
      request: sharedSchema(skillHubTeamQuerySchema),
      response: catalogResponse(sharedSchema(skillHubTeamPageSchema)),
      handler: (ctx, request: SkillHubTeamQuery) => catalogRequest(ctx, (hub, caller) => hub.teams(request, caller)),
    },
    catalogList: {
      operationId: "app.skill_hub.operation.catalog_list",
      kind: "invoke",
      request: sharedSchema(skillHubListInputSchema.omit({ createdByMe: true })),
      response: catalogResponse(sharedSchema(skillHubPageSchema)),
      handler: (ctx, request: Omit<SkillHubListInput, "createdByMe">) => catalogRequest(ctx, (hub, caller) => hub.list(request, caller)),
    },
    catalogDetail: {
      operationId: "app.skill_hub.operation.catalog_detail",
      kind: "invoke",
      request: skillInput,
      response: catalogResponse(z.strictObject({
        content: sharedSchema(skillHubMainResultSchema.shape.content),
        skill: sharedSchema(skillHubDetailSchema),
      })),
      handler: (ctx, { skillId }: { skillId: string }) => catalogRequest(ctx, (hub, caller) => hub.catalogDetail(skillId, caller)),
    },
    catalogIcon: {
      operationId: "app.skill_hub.operation.catalog_icon",
      kind: "invoke",
      request: skillInput,
      response: catalogResponse(z.base64().max(Math.ceil(SKILL_HUB_LIMITS.iconBytes / 3) * 4)),
      handler: (ctx, { skillId }: { skillId: string }) => catalogRequest(ctx, (hub, caller) => hub.catalogIcon(skillId, caller)),
    },
    catalogOpenInstaller: {
      operationId: "app.skill_hub.operation.catalog_open_installer",
      kind: "invoke",
      request: skillInput,
      response: catalogResponse(z.null()),
      handler: (ctx, { skillId }: { skillId: string }) => catalogRequest(ctx, async (hub, caller, windows) => {
        await hub.get(skillId, caller)
        caller.signal?.throwIfAborted()
        await windows.openSkillInstaller({ requestId: randomUUID(), skillId })
        return null
      }),
    },
    prepareInstall: {
      operationId: "app.skill_hub.operation.prepare_install",
      kind: "invoke",
      request: skillInput,
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
