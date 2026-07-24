import { describe, expect, expectTypeOf, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { SystemNotifierSettingsEntryV1 } from "../../../../electron/runtime/data-repo/schemas/system-notifier"
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

function settingsNamespace(initial: SystemNotifierSettingsEntryV1 | null) {
  let current = initial
  return {
    port: {
      name: "app.system-notifier.settings",
      schemaVersion: 1,
      backend: "json",
      getSingleton: vi.fn(async () => current),
      setSingleton: vi.fn(async (value: SystemNotifierSettingsEntryV1) => { current = value }),
    } as unknown as DataNamespace<SystemNotifierSettingsEntryV1>,
    current: () => current,
  }
}

function logger() {
  return { warn: vi.fn() }
}

describe("SystemNotifierService", () => {
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
    expect(show).toHaveBeenCalledWith({ ...input, silent: false })
  })

  it("audits accepted calls without content and preserves fixed success", async () => {
    const settings = settingsNamespace({ schemaVersion: 1, enabled: true, silent: true })
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

  it("does not touch the limiter when disabled and test bypass remains available", async () => {
    const settings = settingsNamespace({ schemaVersion: 1, enabled: false, silent: true })
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record: vi.fn() } as never,
      adapter: { kind: "electron", show },
    })
    for (let index = 0; index < 20; index++) service.trigger(input, context)
    expect(show).not.toHaveBeenCalled()
    expect(service.trigger(input, { ...context, bypassEnabled: true })).toEqual({ success: true })
    expect(show).toHaveBeenCalledWith({ ...input, silent: true })
  })

  it("fails closed on invalid settings while a test uses default silent", async () => {
    const settings = settingsNamespace({ schemaVersion: 1, enabled: true } as never)
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record: vi.fn() } as never,
      adapter: { kind: "electron", show },
    })
    expect(service.health()).toMatchObject({ status: "degraded" })
    expect(service.trigger(input, context)).toEqual({ success: true })
    expect(show).not.toHaveBeenCalled()
    service.trigger(input, { ...context, bypassEnabled: true })
    expect(show).toHaveBeenCalledWith({ ...input, silent: false })
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
    const settings = settingsNamespace({ schemaVersion: 1, enabled: true, silent: false })
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
    const serialized = JSON.stringify(logs.warn.mock.calls)
    expect(serialized).not.toContain("raw audit secret")
    expect(serialized).not.toContain("raw adapter secret")
    expect(serialized).not.toContain("Title")
    expect(serialized).not.toContain("Body")
  })

  it("keeps rate-limit suppression caller-invisible while auditing every accepted call", async () => {
    const settings = settingsNamespace({ schemaVersion: 1, enabled: true, silent: false })
    const show = vi.fn()
    const record = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      auditSink: { record } as never,
      adapter: { kind: "electron", show },
    })
    const results = Array.from({ length: 6 }, () => service.trigger(input, context))
    expect(results).toEqual(Array.from({ length: 6 }, () => ({ success: true })))
    expect(show).toHaveBeenCalledTimes(5)
    expect(record).toHaveBeenCalledTimes(6)
  })

  it("keeps a no-op degraded adapter on the fixed success surface", async () => {
    const settings = settingsNamespace({ schemaVersion: 1, enabled: true, silent: false })
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
  })

  it("serializes get and update, writes a full singleton, and replaces the snapshot after persistence", async () => {
    const settings = settingsNamespace(null)
    const service = new SystemNotifierService(logger())
    await service.initialize({ settings: settings.port })
    await expect(service.updateSettings({ silent: true })).resolves.toEqual({
      schemaVersion: 1,
      enabled: true,
      silent: true,
    })
    expect(settings.current()).toEqual({ schemaVersion: 1, enabled: true, silent: true })
    await expect(service.getSettings()).resolves.toEqual(settings.current())
  })

  it("preserves the previous snapshot when persistence fails", async () => {
    const settings = settingsNamespace({ schemaVersion: 1, enabled: true, silent: false })
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      adapter: { kind: "electron", show },
    })
    vi.mocked(settings.port.setSingleton).mockRejectedValueOnce(new Error("raw persistence detail"))
    await expect(service.updateSettings({ silent: true })).rejects.toThrow()
    service.trigger(input, context)
    expect(show).toHaveBeenCalledWith({ ...input, silent: false })
  })

  it("preserves the last valid snapshot when a later settings read fails", async () => {
    const settings = settingsNamespace({ schemaVersion: 1, enabled: true, silent: true })
    const show = vi.fn()
    const service = new SystemNotifierService(logger())
    await service.initialize({
      settings: settings.port,
      adapter: { kind: "electron", show },
    })
    vi.mocked(settings.port.getSingleton).mockRejectedValueOnce(new Error("raw read detail"))

    await expect(service.getSettings()).rejects.toThrow()
    expect(service.trigger(input, context)).toEqual({ success: true })
    expect(show).toHaveBeenCalledWith({ ...input, silent: true })
  })
})
