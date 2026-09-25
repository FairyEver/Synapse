import { describe, expect, expectTypeOf, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { SystemNotifierSettingsEntryV2 } from "../../../../electron/runtime/data-repo/schemas/system-notifier"
import {
  SystemNotifierService,
  type SystemNotifierDegradedReason,
} from "../service"

const input = { title: "Title", body: "Body" }
const context = {
  source: "workflow",
  actor: { kind: "system", id: "workflow-engine" } as const,
  identityKey: "workflow\u0000wf\u0000node",
  workflowId: "wf",
  runId: "run",
  nodeId: "node",
}
const enabledSettings = {
  schemaVersion: 2,
  enabled: true,
  silent: false,
  syncToAccount: true,
} as const

function settingsNamespace(initial: SystemNotifierSettingsEntryV2 | null) {
  let current = initial
  return {
    port: {
      name: "app.system-notifier.settings",
      schemaVersion: 2,
      backend: "json",
      getSingleton: vi.fn(async () => current),
      setSingleton: vi.fn(async (value: SystemNotifierSettingsEntryV2) => { current = value }),
    } as unknown as DataNamespace<SystemNotifierSettingsEntryV2>,
    current: () => current,
  }
}

function logger() {
  return { warn: vi.fn() }
}

/** `trigger` 的发送链路是异步的，断言本机呈现前先把微任务放完。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("SystemNotifierService", () => {
  it("sends one account message per accepted call and never sends a test", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const sync = vi.fn(async () => true)
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({ settings: settings.port, adapter: { kind: "electron", show }, sync })

    service.trigger(input, context)
    await flush()
    expect(sync).toHaveBeenCalledWith(input)
    expect(show).not.toHaveBeenCalled()

    await service.updateSettings({ syncToAccount: false })
    service.trigger(input, { ...context, identityKey: "send-off" })
    await flush()
    expect(sync).toHaveBeenCalledTimes(1)

    service.presentTestNotification()
    await flush()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it("keeps sending to the account while local notifications are off", async () => {
    const settings = settingsNamespace({ ...enabledSettings, enabled: false })
    const show = vi.fn()
    const sync = vi.fn(async () => true)
    const service = new SystemNotifierService(logger())
    await service.initialize({ settings: settings.port, adapter: { kind: "electron", show }, sync })

    expect(service.trigger(input, context)).toEqual({ success: true })
    await flush()
    expect(sync).toHaveBeenCalledWith(input)
    expect(show).not.toHaveBeenCalled()
  })

  it("falls back to a local notification only when the message was not sent", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({ settings: settings.port, adapter: { kind: "electron", show } })

    // 没有 sync 端口 = 这条消息根本没建出来（未登录 / 离线 / 装配缺失）。
    expect(service.trigger(input, context)).toEqual({ success: true })
    await flush()
    expect(show).toHaveBeenCalledWith({ ...input, silent: false })
  })

  it("keeps a failed account send on the fixed success surface and falls back locally", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const show = vi.fn()
    const logs = logger()
    const service = new SystemNotifierService(logs)
    await service.initialize({
      settings: settings.port,
      auditSink: { record: vi.fn() } as never,
      adapter: { kind: "electron", show },
      sync: async () => { throw new Error("raw send secret") },
    })

    expect(service.trigger(input, context)).toEqual({ success: true })
    await flush()
    expect(show).toHaveBeenCalledWith({ ...input, silent: false })
    expect(logs.warn).toHaveBeenCalledWith("System notifier diagnostic summary.", {
      stage: "notification_sync",
      reason: "sync_failed",
      count: 1,
    })
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain("raw send secret")
  })

  it("does not fall back locally when the message was sent", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      adapter: { kind: "electron", show },
      sync: async () => true,
    })

    service.trigger(input, context)
    await flush()
    expect(show).not.toHaveBeenCalled()
  })

  it("presents an incoming account message only while local notifications are on", async () => {
    const settings = settingsNamespace({ ...enabledSettings, silent: true })
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({ settings: settings.port, adapter: { kind: "electron", show } })

    service.presentAccountNotification(input)
    expect(show).toHaveBeenCalledWith({ ...input, silent: true })

    await service.updateSettings({ enabled: false })
    service.presentAccountNotification(input)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it("uses in-memory defaults without seeding an absent singleton", async () => {
    const settings = settingsNamespace(null)
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record: vi.fn() } as never,
      adapter: { kind: "electron", show },
    })
    expect(settings.port.setSingleton).not.toHaveBeenCalled()
    expect(service.trigger(input, context)).toEqual({ success: true })
    await flush()
    expect(show).toHaveBeenCalledWith({ ...input, silent: false })
  })

  it("audits accepted calls without content and preserves fixed success", async () => {
    const settings = settingsNamespace({ ...enabledSettings, silent: true })
    const record = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record } as never,
      adapter: { kind: "electron", show: vi.fn() },
    })
    expect(service.trigger(input, {
      ...context,
      clientId: "client",
      controllerInstanceId: "controller",
    })).toEqual({ success: true })
    expect(record).toHaveBeenCalledWith({
      action: "notification.trigger",
      actor: context.actor,
      resource: "app.system_notifier.notification.trigger",
      outcome: "allowed",
      metadata: {
        source: "workflow",
        titleCodePointLength: 5,
        bodyCodePointLength: 4,
        clientId: "client",
        controllerInstanceId: "controller",
        workflowId: "wf",
        runId: "run",
        nodeId: "node",
      },
    })
    expect(JSON.stringify(record.mock.calls)).not.toContain("Title")
    expect(JSON.stringify(record.mock.calls)).not.toContain("Body")
  })

  it("does not touch the limiter when sending is off while the test stays available", async () => {
    const settings = settingsNamespace({ ...enabledSettings, silent: true, syncToAccount: false })
    const show = vi.fn()
    const sync = vi.fn(async () => true)
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record: vi.fn() } as never,
      adapter: { kind: "electron", show },
      sync,
    })
    for (let index = 0; index < 20; index++) service.trigger(input, context)
    await flush()
    expect(sync).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
    expect(service.presentTestNotification()).toEqual({ success: true })
    expect(show).toHaveBeenCalledWith({
      title: "System Notifier",
      body: "这是一条测试通知",
      silent: true,
    })
  })

  it("fails closed on invalid settings while a test uses default silent", async () => {
    const settings = settingsNamespace({ schemaVersion: 2, enabled: true } as never)
    const show = vi.fn()
    const sync = vi.fn(async () => true)
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record: vi.fn() } as never,
      adapter: { kind: "electron", show },
      sync,
    })
    expect(service.health()).toMatchObject({ status: "degraded" })
    expect(service.trigger(input, context)).toEqual({ success: true })
    await flush()
    expect(show).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    service.presentAccountNotification(input)
    expect(show).not.toHaveBeenCalled()
    service.presentTestNotification()
    expect(show).toHaveBeenCalledWith({
      title: "System Notifier",
      body: "这是一条测试通知",
      silent: false,
    })
  })

  it("records one fail-closed diagnostic when the initial settings read fails", async () => {
    const settings = settingsNamespace(null)
    const logs = logger()
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValue(60_000)
    vi.mocked(settings.port.getSingleton).mockRejectedValue(new Error("raw read detail"))
    const service = new SystemNotifierService(logs, undefined, now)

    await expect(service.initialize({ settings: settings.port })).resolves.toBeUndefined()

    expect(service.health()).toEqual({
      status: "degraded",
      reasons: ["adapter_unavailable", "settings_unavailable"],
    })
    expect(logs.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logs.warn.mock.calls)).not.toContain("raw read detail")
  })

  it("narrows health reasons to the fixed degraded reason union", () => {
    const service = new SystemNotifierService(logger())

    expectTypeOf(service.health().reasons)
      .toEqualTypeOf<readonly SystemNotifierDegradedReason[]>()
  })

  it("keeps fixed success across audit and adapter synchronous exceptions", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const logs = logger()
    const service = new SystemNotifierService(logs)
    await service.initialize({
      settings: settings.port,
      auditSink: { record: () => { throw new Error("raw audit secret") } } as never,
      adapter: {
        kind: "electron",
        show: () => { throw new Error("raw adapter secret") },
      },
    })
    expect(service.trigger(input, context)).toEqual({ success: true })
    await flush()
    const serialized = JSON.stringify(logs.warn.mock.calls)
    expect(serialized).not.toContain("raw audit secret")
    expect(serialized).not.toContain("raw adapter secret")
    expect(serialized).not.toContain("Title")
    expect(serialized).not.toContain("Body")
  })

  it("keeps rate-limit suppression caller-invisible while auditing every accepted call", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const sync = vi.fn(async () => true)
    const record = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record } as never,
      adapter: { kind: "electron", show: vi.fn() },
      sync,
    })
    const results = Array.from({ length: 6 }, () => service.trigger(input, context))
    await flush()
    expect(results).toEqual(Array.from({ length: 6 }, () => ({ success: true })))
    expect(sync).toHaveBeenCalledTimes(5)
    expect(record).toHaveBeenCalledTimes(6)
  })

  it("keeps a no-op degraded adapter on the fixed success surface", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      adapter: { kind: "noop", show: vi.fn() },
    })
    expect(service.health()).toMatchObject({
      status: "degraded",
      reasons: expect.arrayContaining(["adapter_unavailable"]),
    })
    expect(service.trigger(input, context)).toEqual({ success: true })
    await flush()
  })

  it("serializes get and update, writes a full singleton, and replaces the snapshot after persistence", async () => {
    const settings = settingsNamespace(null)
    const service = new SystemNotifierService(logger())
    await service.initialize({ settings: settings.port })
    await expect(service.updateSettings({ silent: true })).resolves.toEqual({
      schemaVersion: 2,
      enabled: true,
      silent: true,
      syncToAccount: true,
    })
    expect(settings.current()).toEqual({ schemaVersion: 2, enabled: true, silent: true, syncToAccount: true })
    await expect(service.getSettings()).resolves.toEqual(settings.current())
  })

  it("preserves the previous snapshot when persistence fails", async () => {
    const settings = settingsNamespace({ ...enabledSettings })
    const service = new SystemNotifierService(logger())
    await service.initialize({ settings: settings.port })
    vi.mocked(settings.port.setSingleton).mockRejectedValueOnce(new Error("raw persistence detail"))
    await expect(service.updateSettings({ syncToAccount: false })).rejects.toThrow()
    await expect(service.getSettings()).resolves.toEqual({ ...enabledSettings })
  })

  it("preserves the last valid snapshot when a later settings read fails", async () => {
    const settings = settingsNamespace({ ...enabledSettings, silent: true })
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      adapter: { kind: "electron", show },
    })
    vi.mocked(settings.port.getSingleton).mockRejectedValueOnce(new Error("raw read detail"))

    await expect(service.getSettings()).rejects.toThrow()
    service.presentAccountNotification(input)
    expect(show).toHaveBeenCalledWith({ ...input, silent: true })
  })
})
