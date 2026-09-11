import { describe, expect, it, vi } from "vitest"
import type {
  ClientTelemetryEnvironmentEntryV1,
  ClientTelemetryOutboxEntryV1,
} from "../../runtime/data-repo/schemas/client-telemetry"
import type { DataNamespace } from "../../runtime/data-repo"
import { ClientTelemetryService, detectDesktopOperatingSystem } from "../client-telemetry-service"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/synapse-app",
    getPath: () => "/tmp/synapse-telemetry-test",
  },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value),
    isEncryptionAvailable: () => true,
  },
}))

function createOutbox(initial: ClientTelemetryOutboxEntryV1[] = []) {
  const entries = new Map(initial.map((entry) => [entry.id, entry]))
  const namespace = {
    list: vi.fn(async () => [...entries.values()]),
    get: vi.fn(async (id: string) => entries.get(id) ?? null),
    count: vi.fn(async () => entries.size),
    upsert: vi.fn(async (entry: ClientTelemetryOutboxEntryV1) => {
      entries.set(entry.id, entry)
    }),
    remove: vi.fn(async (id: string) => {
      entries.delete(id)
    }),
  }
  return { entries, namespace: namespace as unknown as DataNamespace<ClientTelemetryOutboxEntryV1> }
}

function createEnvironmentStore(initial: ClientTelemetryEnvironmentEntryV1[] = []) {
  const entries = new Map(initial.map((entry) => [entry.id, entry]))
  const namespace = {
    list: vi.fn(async () => [...entries.values()]),
    get: vi.fn(async (id: string) => entries.get(id) ?? null),
    upsert: vi.fn(async (entry: ClientTelemetryEnvironmentEntryV1) => {
      entries.set(entry.id, entry)
    }),
    remove: vi.fn(async (id: string) => {
      entries.delete(id)
    }),
  }
  return {
    entries,
    namespace: namespace as unknown as DataNamespace<ClientTelemetryEnvironmentEntryV1>,
  }
}

function createAccount(userId: string | null) {
  return {
    getState: vi.fn(() => userId
      ? {
          status: "authenticated" as const,
          connectivity: "online" as const,
          profile: {
            user: { id: userId, email: "user@example.com", handle: "user", status: "active" as const },
            syncedAt: "2026-09-01T00:00:00.000Z",
          },
        }
      : { status: "unauthenticated" as const }),
    fetchPublic: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    fetchAuthenticated: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    onBeforeIdentityChange: vi.fn(() => () => undefined),
    onStateChanged: vi.fn(() => () => undefined),
  }
}

function trackingPayload() {
  return {
    level: "info" as const,
    category: "ui.tracking",
    message: "保存:click",
    details: {
      value: "private input",
      metadata: { path: "/private/file", resourceId: "resource-1" },
      telemetry: {
        category: "interaction",
        eventKey: "database.row.save",
        component: "button",
        action: "click",
        moduleId: "database",
        windowType: "main",
      },
    },
  }
}

describe("ClientTelemetryService", () => {
  it("maps desktop system versions to stable operating-system dimensions", () => {
    expect(detectDesktopOperatingSystem("win32", "6.1.7601")).toEqual({
      osName: "windows-7",
      osVersion: "6.1.7601",
    })
    expect(detectDesktopOperatingSystem("win32", "10.0.19045").osName).toBe("windows-10")
    expect(detectDesktopOperatingSystem("win32", "10.0.26100").osName).toBe("windows-11")
    expect(detectDesktopOperatingSystem("darwin", "15.6.1")).toEqual({
      osName: "macos",
      osVersion: "15.6.1",
    })
  })

  it("starts and stops when queue reads fail", async () => {
    const outbox = createOutbox()
    outbox.namespace.list = vi.fn().mockRejectedValue(new Error("queue read failed"))
    const account = createAccount(null)
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: createEnvironmentStore().namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
    })

    await expect(service.start()).resolves.toBeUndefined()
    await expect(service.stop()).resolves.toBeUndefined()
    expect(account.fetchPublic).not.toHaveBeenCalled()
  })

  it("isolates queue write failures from renderer logging", async () => {
    const outbox = createOutbox()
    outbox.namespace.upsert = vi.fn().mockRejectedValue(new Error("queue write failed"))
    const environments = createEnvironmentStore()
    const account = createAccount(null)
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: environments.namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
    })
    await service.start()

    expect(() => service.recordRendererLog(trackingPayload())).not.toThrow()
    await vi.waitFor(() => expect(outbox.namespace.upsert).toHaveBeenCalledOnce())
    await expect(service.stop()).resolves.toBeUndefined()
    expect(account.fetchPublic).not.toHaveBeenCalled()
    expect(environments.entries.size).toBe(0)
  })

  it("does not enqueue an event when its capture-time environment cannot be persisted", async () => {
    const outbox = createOutbox()
    const environments = createEnvironmentStore()
    environments.namespace.upsert = vi.fn().mockRejectedValue(new Error("environment write failed"))
    const account = createAccount(null)
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: environments.namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      osName: "macos",
      osVersion: "15.6.1",
    })
    await service.start()

    service.recordRendererLog(trackingPayload())
    await vi.waitFor(() => expect(environments.namespace.upsert).toHaveBeenCalledOnce())
    await expect(service.stop()).resolves.toBeUndefined()

    expect(outbox.namespace.upsert).not.toHaveBeenCalled()
    expect(account.fetchPublic).not.toHaveBeenCalled()
  })

  it("keeps events queued after a network failure without recursive delivery", async () => {
    const event: ClientTelemetryOutboxEntryV1 = {
      id: "event-1",
      schemaVersion: 1,
      accountUserId: null,
      category: "interaction",
      eventKey: "button.click",
      component: "button",
      action: "click",
      windowType: "main",
      clientInstanceId: "client-1",
      sessionId: "session-1",
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      occurredAt: new Date().toISOString(),
    }
    const outbox = createOutbox([event])
    const account = createAccount(null)
    account.fetchPublic.mockRejectedValue(new Error("network unavailable"))
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: createEnvironmentStore().namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
    })

    await service.start()
    await vi.waitFor(() => expect(account.fetchPublic).toHaveBeenCalledTimes(1))
    expect(outbox.entries.has(event.id)).toBe(true)
    expect(account.fetchPublic).toHaveBeenCalledTimes(1)
    await expect(service.stop()).resolves.toBeUndefined()
    expect(account.fetchPublic.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("keeps delivered events queued when queue removal fails", async () => {
    const event: ClientTelemetryOutboxEntryV1 = {
      id: "event-1",
      schemaVersion: 1,
      accountUserId: null,
      category: "interaction",
      eventKey: "button.click",
      component: "button",
      action: "click",
      windowType: "main",
      clientInstanceId: "client-1",
      sessionId: "session-1",
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      occurredAt: new Date().toISOString(),
    }
    const outbox = createOutbox([event])
    outbox.namespace.remove = vi.fn().mockRejectedValue(new Error("queue remove failed"))
    const account = createAccount(null)
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: createEnvironmentStore().namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
    })

    await service.start()
    await vi.waitFor(() => expect(outbox.namespace.remove).toHaveBeenCalled())
    await expect(service.stop()).resolves.toBeUndefined()
    expect(outbox.entries.has(event.id)).toBe(true)
  })

  it("uploads anonymous events without user content or userId", async () => {
    const outbox = createOutbox()
    const account = createAccount(null)
    let nextId = 0
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: createEnvironmentStore().namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      osName: "macos",
      osVersion: "15.6.1",
      createId: () => `id-${nextId += 1}`,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    })
    await service.start()
    service.recordRendererLog(trackingPayload())
    await vi.waitFor(() => expect(outbox.namespace.upsert).toHaveBeenCalled())
    await service.stop()

    const request = account.fetchPublic.mock.calls.at(-1)?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as { events: Array<Record<string, unknown>> }
    expect(body.events[0]).toMatchObject({
      eventKey: "database.row.save",
      clientInstanceId: "client-1",
      sessionId: "id-1",
    })
    expect(request.headers).toMatchObject({
      "X-Synapse-Telemetry-OS-Name": "macos",
      "X-Synapse-Telemetry-OS-Version": "15.6.1",
    })
    expect(body.events[0]).not.toHaveProperty("osName")
    expect(body.events[0]).not.toHaveProperty("osVersion")
    expect(body.events[0]).not.toHaveProperty("userId")
    expect(body.events[0]).not.toHaveProperty("value")
    expect(body.events[0]).not.toHaveProperty("metadata")
  })

  it("uses the capture-time operating system for events queued across a system upgrade", async () => {
    const event: ClientTelemetryOutboxEntryV1 = {
      id: "event-before-upgrade",
      schemaVersion: 1,
      accountUserId: null,
      category: "interaction",
      eventKey: "button.click",
      component: "button",
      action: "click",
      windowType: "main",
      clientInstanceId: "client-1",
      sessionId: "session-1",
      appVersion: "0.2.419",
      platform: "win32-x64",
      occurredAt: "2026-09-01T00:00:00.000Z",
    }
    const eventAfterUpgrade: ClientTelemetryOutboxEntryV1 = {
      ...event,
      id: "event-after-upgrade",
      sessionId: "session-2",
      appVersion: "0.2.420",
      occurredAt: "2026-09-01T01:00:00.000Z",
    }
    const outbox = createOutbox([event, eventAfterUpgrade])
    const environments = createEnvironmentStore([{
      id: event.id,
      schemaVersion: 1,
      osName: "windows-10",
      osVersion: "10.0.19045",
      occurredAt: event.occurredAt,
    }, {
      id: eventAfterUpgrade.id,
      schemaVersion: 1,
      osName: "windows-11",
      osVersion: "10.0.26100",
      occurredAt: eventAfterUpgrade.occurredAt,
    }])
    const account = createAccount(null)
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: environments.namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.420",
      platform: "win32-x64",
      osName: "windows-11",
      osVersion: "10.0.26100",
      now: () => new Date("2026-09-02T00:00:00.000Z"),
    })

    await service.start()
    await vi.waitFor(() => expect(account.fetchPublic).toHaveBeenCalledTimes(2))
    await service.stop()

    const firstRequest = account.fetchPublic.mock.calls[0]?.[1] as RequestInit
    const secondRequest = account.fetchPublic.mock.calls[1]?.[1] as RequestInit
    expect(firstRequest.headers).toMatchObject({
      "X-Synapse-Telemetry-OS-Name": "windows-10",
      "X-Synapse-Telemetry-OS-Version": "10.0.19045",
    })
    expect(secondRequest.headers).toMatchObject({
      "X-Synapse-Telemetry-OS-Name": "windows-11",
      "X-Synapse-Telemetry-OS-Version": "10.0.26100",
    })
    expect(String(firstRequest.body)).not.toContain("windows-10")
    expect(environments.entries.has(event.id)).toBe(false)
    expect(environments.entries.has(eventAfterUpgrade.id)).toBe(false)
  })

  it("uses authenticated delivery for capture-time account events", async () => {
    const outbox = createOutbox()
    const account = createAccount("user-1")
    let nextId = 0
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: createEnvironmentStore().namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      createId: () => `id-${nextId += 1}`,
    })
    await service.start()
    service.recordRendererLog(trackingPayload())
    await vi.waitFor(() => expect(outbox.namespace.upsert).toHaveBeenCalled())
    await service.stop()

    expect(account.fetchAuthenticated).toHaveBeenCalled()
    expect(account.fetchPublic).not.toHaveBeenCalled()
    const request = account.fetchAuthenticated.mock.calls.at(-1)?.[1] as RequestInit
    expect(String(request.body)).not.toContain("user-1")
    expect(String(request.body)).not.toContain("userId")
  })

  it("does not downgrade another account's queued event to anonymous", async () => {
    const outbox = createOutbox([{
      id: "event-1",
      schemaVersion: 1,
      accountUserId: "user-1",
      category: "interaction",
      eventKey: "button.click",
      component: "button",
      action: "click",
      windowType: "main",
      clientInstanceId: "client-1",
      sessionId: "session-1",
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      occurredAt: new Date().toISOString(),
    }])
    const account = createAccount(null)
    const service = new ClientTelemetryService({
      outbox: outbox.namespace,
      environments: createEnvironmentStore().namespace,
      account,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-1") },
      appVersion: "0.2.419",
      platform: "darwin-arm64",
    })
    await service.start()
    await service.stop()

    expect(account.fetchAuthenticated).not.toHaveBeenCalled()
    expect(account.fetchPublic).not.toHaveBeenCalled()
    expect(outbox.entries.has("event-1")).toBe(true)
  })
})
