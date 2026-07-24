import type { IpcModule } from "../../../electron/runtime/ipc/types"
import {
  strictEmptyObjectSchema,
  systemNotificationResultSchema,
  systemNotifierSettingsPatchSchema,
  systemNotifierSettingsSchema,
  systemNotifierTestNotification,
  validateSystemNotificationInput,
} from "../shared/schema"
import { SYSTEM_NOTIFIER_SERVICE_ID } from "../shared/capability"
import type { SystemNotifierService } from "./service"

function resolveSystemNotifierService(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
): SystemNotifierService {
  return ctx.resolve<SystemNotifierService>(SYSTEM_NOTIFIER_SERVICE_ID)
}

export const systemNotifierIpcModule: IpcModule = {
  id: "systemNotifier",
  methods: {
    getSettings: {
      operationId: "app.system_notifier.settings.get",
      kind: "invoke",
      request: strictEmptyObjectSchema,
      response: systemNotifierSettingsSchema,
      handler: (ctx) => resolveSystemNotifierService(ctx).getSettings(),
    },
    updateSettings: {
      operationId: "app.system_notifier.settings.update",
      kind: "invoke",
      request: systemNotifierSettingsPatchSchema,
      response: systemNotifierSettingsSchema,
      handler: (ctx, request) =>
        resolveSystemNotifierService(ctx).updateSettings(
          systemNotifierSettingsPatchSchema.parse(request),
        ),
    },
    testNotification: {
      operationId: "app.system_notifier.notification.test",
      kind: "invoke",
      request: strictEmptyObjectSchema,
      response: systemNotificationResultSchema,
      handler: (ctx) => {
        const validation = validateSystemNotificationInput(systemNotifierTestNotification)
        if (!validation.ok) throw new Error("System notifier test input invariant failed.")
        return resolveSystemNotifierService(ctx).trigger(validation.data, {
          source: "system-app-test",
          actor: { kind: "user", id: "system-app:system-notifier" },
          identityKey: "system-app-test\u0000system-notifier",
          bypassEnabled: true,
        })
      },
    },
  },
  events: {},
}
