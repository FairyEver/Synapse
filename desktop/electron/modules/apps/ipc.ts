import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { systemAppWindowService } from "../../services/system-app-window-service"
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

export const appsIpcModule: IpcModule = {
  id: "apps",
  methods: {
    openSystemApp: {
      channel: "synapse:apps:open-system-app",
      kind: "invoke",
      request: openSystemAppRequestSchema,
      response: z.void(),
      handler: async (_ctx, request: OpenSystemAppRequest) => {
        await systemAppWindowService.open(request.appId, request.options)
      },
    },
  },
  events: {},
}
