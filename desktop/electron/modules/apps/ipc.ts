import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WindowManager } from "../../runtime/window"
import { createDefaultSystemAppWindowService } from "../../services/system-app-window-service"
import { SYSTEM_APP_IDS } from "../../../src/modules/apps/types"

const systemAppIdSchema = z.enum(SYSTEM_APP_IDS)

const contentOpenRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    requestId: z.string().min(1),
    contentType: z.enum(["rule", "skill"]),
  }).passthrough(),
  z.object({
    kind: z.literal("detail"),
    requestId: z.string().min(1),
    contentType: z.enum(["rule", "skill"]),
    contentId: z.string().min(1),
  }).passthrough(),
  z.object({
    kind: z.literal("edit-overwrite"),
    requestId: z.string().min(1),
    contentType: z.enum(["rule", "skill"]),
    contentId: z.string().min(1),
  }).passthrough(),
])

const openSystemAppRequestSchema = z.object({
  appId: systemAppIdSchema,
  options: z.object({
    contentOpenRequest: contentOpenRequestSchema.optional(),
  }).optional(),
})

type OpenSystemAppRequest = z.infer<typeof openSystemAppRequestSchema>
type SystemAppWindowService = ReturnType<typeof createDefaultSystemAppWindowService>

let cachedWindowManager: WindowManager | null = null
let cachedSystemAppWindowService: SystemAppWindowService | null = null

function getSystemAppWindowService(windowManager: WindowManager): SystemAppWindowService {
  if (!cachedSystemAppWindowService || cachedWindowManager !== windowManager) {
    cachedWindowManager = windowManager
    cachedSystemAppWindowService = createDefaultSystemAppWindowService(windowManager)
  }
  return cachedSystemAppWindowService
}

export const appsIpcModule: IpcModule = {
  id: "apps",
  methods: {
    openSystemApp: {
      channel: "synapse:apps:open-system-app",
      kind: "invoke",
      request: openSystemAppRequestSchema,
      response: z.void(),
      handler: async (ctx, request: OpenSystemAppRequest) => {
        const service = getSystemAppWindowService(ctx.resolve<WindowManager>("core.window-manager"))
        await service.open(request.appId, request.options)
      },
    },
  },
  events: {},
}
