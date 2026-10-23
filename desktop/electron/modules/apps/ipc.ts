import { mailOpenRequestSchema } from "../../../app-capabilities/mail/shared/private-schema"
import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import { CHEAT_CODE_STATE_SERVICE_ID, type CheatCodeStateService } from "../../services/cheat-code-state-service"
import {
  SYSTEM_APP_WINDOW_SERVICE_ID,
  type createDefaultSystemAppWindowService,
} from "../../services/system-app-window-service"
import { WORKFLOW_ENTRY_VISIBLE_BY_DEFAULT } from "../../../config"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "../../../src/lib/cheat-codes/names"
import { getSystemAppDefinition } from "../../../src/modules/apps/definitions"
import { SYSTEM_APP_IDS } from "../../../src/modules/apps/types"
import { isSystemAppEntryVisible } from "../../../src/modules/apps/visibility"

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

const gitOpenRequestSchema = z.object({
  requestId: z.string().min(1),
  repositoryId: z.string().min(1),
}).strict()

const terminalOpenRequestSchema = z.object({
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
}).strict()

const todoOpenRequestSchema = z.object({ requestId: z.string().min(1).max(200), id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u) }).strict()

const mailInternalOpenRequestSchema = z.object({ requestId: z.string().min(1), messageId: z.string().min(1) }).strict()

const openSystemAppRequestSchema = z.object({
  appId: systemAppIdSchema,
  options: z.object({
    contentOpenRequest: contentOpenRequestSchema.optional(),
    gitOpenRequest: gitOpenRequestSchema.optional(),
    terminalOpenRequest: terminalOpenRequestSchema.optional(),
    mailOpenRequest: mailOpenRequestSchema.nullable().optional(),
    mailInternalOpenRequest: mailInternalOpenRequestSchema.optional(),
    todoOpenRequest: todoOpenRequestSchema.nullable().optional(),
  }).strict().optional(),
}).strict().superRefine((request, context) => {
  if (request.options?.gitOpenRequest && request.appId !== "git") {
    context.addIssue({
      code: "custom",
      message: "Git open requests require the Git app.",
      path: ["options", "gitOpenRequest"],
    })
  }
  if (request.options?.terminalOpenRequest && request.appId !== "terminal") {
    context.addIssue({
      code: "custom",
      message: "Terminal open requests require the Terminal app.",
      path: ["options", "terminalOpenRequest"],
    })
  }
  if (request.options?.todoOpenRequest && request.appId !== "todos") {
    context.addIssue({ code: "custom", message: "Todo open requests require the Todos app.", path: ["options", "todoOpenRequest"] })
  }
  if (request.options?.mailOpenRequest && request.appId !== "mail") context.addIssue({ code: "custom", message: "Mailbox targets require the Mail app.", path: ["options", "mailOpenRequest"] })
  if (request.options?.mailInternalOpenRequest && request.appId !== "mail-internal") {
    context.addIssue({ code: "custom", message: "Mail open requests require the Mail app.", path: ["options", "mailInternalOpenRequest"] })
  }
})

type OpenSystemAppRequest = z.infer<typeof openSystemAppRequestSchema>
type SystemAppWindowService = ReturnType<typeof createDefaultSystemAppWindowService>

async function assertSystemAppVisible(ctx: IpcHandlerContext, appId: OpenSystemAppRequest["appId"]): Promise<void> {
  const definition = getSystemAppDefinition(appId)
  if (!definition) {
    throw new Error("Unknown system app.")
  }
  if (isSystemAppEntryVisible(definition, {
    workflowEntryVisible: WORKFLOW_ENTRY_VISIBLE_BY_DEFAULT,
  })) {
    return
  }

  const cheatCodeStateService = ctx.resolve<Pick<CheatCodeStateService, "getStates">>(CHEAT_CODE_STATE_SERVICE_ID)
  const states = await cheatCodeStateService.getStates([WORKFLOW_ENTRY_CHEAT_CODE_NAME])
  if (!isSystemAppEntryVisible(definition, {
    workflowEntryVisible: states[WORKFLOW_ENTRY_CHEAT_CODE_NAME] === true,
  })) {
    throw new Error("工作流入口未启用。")
  }
}

export const appsIpcModule: IpcModule = {
  id: "apps",
  methods: {
    openSystemApp: {
      operationId: "app.apps.system_app.open",
      kind: "invoke",
      request: openSystemAppRequestSchema,
      response: z.void(),
      handler: async (ctx, request: OpenSystemAppRequest) => {
        await assertSystemAppVisible(ctx, request.appId)
        const service = ctx.resolve<SystemAppWindowService>(SYSTEM_APP_WINDOW_SERVICE_ID)
        await service.open(request.appId, request.options)
      },
    },
  },
  events: {
    mailOpenRequest: { operationId: "app.apps.operation.mail_open_request", kind: "event", payload: mailOpenRequestSchema },
    todoOpenRequest: { operationId: "app.apps.operation.todo_open_request", kind: "event", payload: todoOpenRequestSchema },
  },
}
