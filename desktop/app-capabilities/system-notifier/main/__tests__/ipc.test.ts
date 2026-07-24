import { describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import { systemNotifierIpcModule } from "../ipc"

describe("systemNotifierIpcModule", () => {
  it("declares exactly three stable methods and zero events", () => {
    expect(systemNotifierIpcModule.id).toBe("systemNotifier")
    expect(Object.keys(systemNotifierIpcModule.methods)).toEqual([
      "getSettings",
      "updateSettings",
      "testNotification",
    ])
    expect(systemNotifierIpcModule.methods.getSettings.operationId)
      .toBe("app.system_notifier.settings.get")
    expect(systemNotifierIpcModule.methods.updateSettings.operationId)
      .toBe("app.system_notifier.settings.update")
    expect(systemNotifierIpcModule.methods.testNotification.operationId)
      .toBe("app.system_notifier.notification.test")
    expect(systemNotifierIpcModule.events).toEqual({})
  })

  it("uses strict empty and strict patch request schemas", () => {
    expect(systemNotifierIpcModule.methods.getSettings.request.safeParse({}).success).toBe(true)
    expect(systemNotifierIpcModule.methods.getSettings.request.safeParse({ extra: true }).success)
      .toBe(false)
    expect(systemNotifierIpcModule.methods.updateSettings.request.safeParse({ enabled: false }).success)
      .toBe(true)
    expect(systemNotifierIpcModule.methods.updateSettings.request.safeParse({}).success).toBe(false)
    expect(systemNotifierIpcModule.methods.updateSettings.request.safeParse({ silent: true, extra: 1 }).success)
      .toBe(false)
  })

  it("delegates settings and fixed test content to the shared service", async () => {
    const service = {
      getSettings: vi.fn(async () => ({ schemaVersion: 1, enabled: true, silent: false })),
      updateSettings: vi.fn(async () => ({ schemaVersion: 1, enabled: false, silent: true })),
      trigger: vi.fn(() => ({ success: true })),
    }
    const context = {
      moduleId: "systemNotifier",
      resolve: <T>(id: string) => {
        if (id !== "core.system-notifier") throw new Error(id)
        return service as T
      },
    } satisfies IpcHandlerContext

    await expect(systemNotifierIpcModule.methods.getSettings.handler(context, {}))
      .resolves.toEqual({ schemaVersion: 1, enabled: true, silent: false })
    await expect(systemNotifierIpcModule.methods.updateSettings.handler(context, {
      enabled: false,
      silent: true,
    })).resolves.toEqual({ schemaVersion: 1, enabled: false, silent: true })
    expect(systemNotifierIpcModule.methods.testNotification.handler(context, {}))
      .toEqual({ success: true })
    expect(service.trigger).toHaveBeenCalledWith(
      { title: "System Notifier", body: "这是一条测试通知" },
      expect.objectContaining({
        source: "system-app-test",
        bypassEnabled: true,
      }),
    )
  })
})
