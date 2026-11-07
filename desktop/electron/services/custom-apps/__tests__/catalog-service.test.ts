import { describe, expect, it, vi } from "vitest"
import type { CustomAppSnapshotDto } from "@synapse/shared"

import {
  CustomAppsCatalogService,
  type CustomAppsAccountPort,
  type CustomAppsApiPort,
} from "../catalog-service"

const appId = "cwa_123e4567-e89b-42d3-a456-426614174000"

describe("CustomAppsCatalogService", () => {
  it("serves the last valid cache read-only while the cloud is offline", async () => {
    const harness = createHarness()
    await harness.catalog.seedCache("user-1", snapshot(4))
    harness.account.setAuthenticatedOffline("user-1")

    await harness.catalog.initialize()

    expect(harness.api.fetchSnapshot).not.toHaveBeenCalled()
    expect(harness.catalog.getState()).toMatchObject({
      accountId: "user-1",
      syncState: "offline",
      snapshot: expect.objectContaining({ revision: 4 }),
    })
  })

  it("normalizes legacy cached apps without an open mode", async () => {
    const harness = createHarness()
    const legacy = snapshot(4)
    harness.cache.set("user-1", {
      id: "user-1",
      schemaVersion: 1,
      accountId: "user-1",
      cachedAt: "2026-11-07T00:00:00.000Z",
      snapshot: {
        ...legacy,
        apps: legacy.apps.map(({ openMode: _openMode, ...app }) => app),
      },
    })
    harness.account.setAuthenticatedOffline("user-1")

    await harness.catalog.initialize()

    expect(harness.catalog.getState().snapshot?.apps[0]?.openMode).toBe("window")
  })

  it("discards a snapshot request after account switch", async () => {
    const harness = createHarness()
    const deferred = deferredValue<CustomAppSnapshotDto>()
    harness.account.setAuthenticatedOnline("user-1")
    await harness.catalog.seedCache("user-1", snapshot(4))
    vi.mocked(harness.api.fetchSnapshot).mockResolvedValueOnce(snapshot(1))
    await harness.catalog.initialize()
    vi.mocked(harness.api.fetchSnapshot)
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(snapshot(2))

    const pending = harness.catalog.refresh("focus")
    harness.account.switchTo("user-2")
    expect(harness.catalog.getState()).toMatchObject({
      accountId: "user-2",
      snapshot: null,
      syncState: "loading",
    })
    deferred.resolve(snapshot(4))
    await pending
    await vi.waitFor(() => expect(harness.catalog.getState().accountId).toBe("user-2"))

    expect(harness.catalog.getState().accountId).toBe("user-2")
    expect(harness.catalog.getState().snapshot?.revision).not.toBe(4)
  })

  it("does not replace the last good cache with an invalid snapshot", async () => {
    const harness = createHarness()
    await harness.catalog.seedCache("user-1", snapshot(4))
    harness.account.setAuthenticatedOnline("user-1")
    vi.mocked(harness.api.fetchSnapshot).mockResolvedValueOnce({
      schemaVersion: 1,
      revision: 5,
      apps: "invalid",
    } as never)

    await harness.catalog.initialize()

    expect(harness.catalog.getState().snapshot?.revision).toBe(4)
    expect(harness.catalog.getState().syncState).toBe("error")
  })

  it("does not replace a newer local revision with an older refresh response", async () => {
    const harness = createHarness()
    harness.account.setAuthenticatedOnline("user-1")
    vi.mocked(harness.api.fetchSnapshot)
      .mockResolvedValueOnce(snapshot(5))
      .mockResolvedValueOnce(snapshot(4))
    await harness.catalog.initialize()

    await harness.catalog.refresh("stale-response")

    expect(harness.catalog.getState().snapshot?.revision).toBe(5)
    expect(harness.cache.get("user-1")).toMatchObject({
      snapshot: { revision: 5 },
    })
  })

  it("does not leave the catalog loading when concurrent refreshes share one request", async () => {
    const harness = createHarness()
    const deferred = deferredValue<CustomAppSnapshotDto>()
    harness.account.setAuthenticatedOnline("user-1")
    vi.mocked(harness.api.fetchSnapshot)
      .mockResolvedValueOnce(snapshot(4))
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValueOnce(snapshot(5))
    await harness.catalog.initialize()

    const first = harness.catalog.refresh("focus")
    const second = harness.catalog.refresh("live")
    deferred.resolve(snapshot(5))
    await Promise.all([first, second])

    expect(harness.catalog.getState()).toMatchObject({
      syncState: "ready",
      snapshot: { revision: 5 },
    })
  })

  it("refreshes the catalog for an internal live revision", async () => {
    const harness = createHarness()
    harness.account.setAuthenticatedOnline("user-1")
    vi.mocked(harness.api.fetchSnapshot)
      .mockResolvedValueOnce(snapshot(4))
      .mockResolvedValueOnce(snapshot(5))
    await harness.catalog.initialize()

    harness.eventBus.emitInternal("account", "custom-apps.revision", { revision: 5 })
    await vi.waitFor(() => expect(harness.catalog.getState().snapshot?.revision).toBe(5))

    expect(harness.api.fetchSnapshot).toHaveBeenCalledTimes(2)
    expect(harness.listeners.at(-1)).toMatchObject({
      accountId: "user-1",
      syncState: "ready",
      snapshot: { revision: 5 },
    })
  })

  it("refreshes after the live connection recovers from a disconnect", async () => {
    const harness = createHarness()
    harness.account.setAuthenticatedOnline("user-1")
    vi.mocked(harness.api.fetchSnapshot)
      .mockResolvedValueOnce(snapshot(4))
      .mockResolvedValueOnce(snapshot(5))
    await harness.catalog.initialize()

    harness.eventBus.emitInternal("live", "live.stateChanged", { status: "disconnected" })
    harness.eventBus.emitInternal("live", "live.stateChanged", { status: "connected" })
    await vi.waitFor(() => expect(harness.catalog.getState().snapshot?.revision).toBe(5))
  })

  it("does not restore account A state when sign-out races its cache read", async () => {
    const harness = createHarness()
    const cachedEntry = {
      id: "user-1",
      schemaVersion: 1,
      accountId: "user-1",
      cachedAt: "2026-11-07T00:00:00.000Z",
      snapshot: snapshot(4),
    }
    const deferred = deferredValue<typeof cachedEntry>()
    harness.cache.set("user-1", cachedEntry)
    harness.account.setAuthenticatedOffline("user-1")
    harness.namespace.get.mockImplementation(async (id: string) => id === "user-1"
      ? deferred.promise
      : null)

    const pending = harness.catalog.initialize()
    harness.account.signOut()
    deferred.resolve(cachedEntry)
    await pending
    await vi.waitFor(() => expect(harness.catalog.getState().syncState).toBe("signed-out"))

    expect(harness.catalog.getState()).toMatchObject({
      accountId: null,
      snapshot: null,
      syncState: "signed-out",
    })
  })

  it("rejects a mutation response after the account has changed", async () => {
    const harness = createHarness()
    const deferred = deferredValue<CustomAppSnapshotDto>()
    harness.account.setAuthenticatedOnline("user-1")
    vi.mocked(harness.api.fetchSnapshot).mockResolvedValue(snapshot(4))
    await harness.catalog.initialize()
    vi.mocked(harness.api.create).mockReturnValueOnce(deferred.promise)

    const pending = harness.catalog.create({
      operationId: "create-a",
      id: appId,
      name: "阅读",
      startUrl: "https://example.com/read",
      openMode: "window",
      iconSource: "favicon",
    })
    harness.account.signOut()
    deferred.resolve(snapshot(5))

    await expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(harness.catalog.getState().syncState).toBe("signed-out"))
  })

  it("clears the active app list when the account signs out but keeps the cache", async () => {
    const harness = createHarness()
    await harness.catalog.seedCache("user-1", snapshot(4))
    harness.account.setAuthenticatedOnline("user-1")
    vi.mocked(harness.api.fetchSnapshot).mockResolvedValueOnce(snapshot(4))
    await harness.catalog.initialize()

    harness.account.signOut()
    await vi.waitFor(() => expect(harness.catalog.getState().syncState).toBe("signed-out"))

    expect(harness.catalog.getState()).toMatchObject({
      accountId: null,
      snapshot: null,
      syncState: "signed-out",
    })
    expect(await harness.cache.get("user-1")).toMatchObject({
      snapshot: { revision: 4 },
    })
  })
})

function createHarness() {
  const cache = new Map<string, unknown>()
  const listeners = new Set<(state: never) => void>()
  const namespace = {
    get: vi.fn(async (id: string) => cache.get(id) ?? null),
    upsert: vi.fn(async (value: { readonly id: string }) => {
      cache.set(value.id, value)
    }),
  }
  const repository = {
    namespace: vi.fn(() => namespace),
  }
  let state: Record<string, unknown> = { status: "unauthenticated" }
  let authRevision = 0
  const account = {
    getState: vi.fn(() => state),
    onStateChanged: vi.fn((listener: (next: never) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    captureAccountRequestScope: vi.fn(() => {
      if (state.status !== "authenticated" || state.connectivity !== "online") return null
      return { accountId: (state.profile as { user: { id: string } }).user.id, authRevision }
    }),
    fetchAuthenticated: vi.fn(),
    setAuthenticatedOnline(userId: string) {
      authRevision += 1
      state = authenticatedState(userId, "online")
      notify()
    },
    setAuthenticatedOffline(userId: string) {
      authRevision += 1
      state = authenticatedState(userId, "offline")
      notify()
    },
    switchTo(userId: string) {
      account.setAuthenticatedOnline(userId)
    },
    signOut() {
      authRevision += 1
      state = { status: "unauthenticated" }
      notify()
    },
  }
  function notify() {
    for (const listener of listeners) listener(state as never)
  }
  const api: CustomAppsApiPort = {
    fetchSnapshot: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bootstrap: vi.fn(),
    applyDockOperation: vi.fn(),
  }
  const eventBus = createEventBusFake()
  const emittedStates: unknown[] = []
  const catalog = new CustomAppsCatalogService({
    account: account as unknown as CustomAppsAccountPort,
    repository: repository as never,
    api,
    eventBus: eventBus as never,
    now: () => new Date("2026-11-07T00:00:00.000Z"),
  })
  catalog.subscribe((state) => emittedStates.push(state))
  return {
    catalog,
    account,
    api,
    cache,
    eventBus,
    namespace,
    get listeners() {
      return emittedStates as Array<{
        readonly accountId: string | null
        readonly syncState: string
        readonly snapshot: { readonly revision: number } | null
      }>
    },
  }
}

function createEventBusFake() {
  const listeners = new Map<string, Set<(event: {
    readonly domain: "account" | "live"
    readonly type: string
    readonly payload: unknown
    readonly timestamp: string
  }) => void>>()
  return {
    emit: vi.fn(),
    emitInternal(
      domain: "account" | "live",
      type: string,
      payload: unknown,
    ) {
      const event = { domain, type, payload, timestamp: "2026-11-07T00:00:00.000Z" } as const
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    onType(
      domain: "account" | "live",
      type: string,
      listener: (event: {
        readonly domain: "account" | "live"
        readonly type: string
        readonly payload: unknown
        readonly timestamp: string
      }) => void,
    ) {
      void domain
      const entries = listeners.get(type) ?? new Set()
      entries.add(listener)
      listeners.set(type, entries)
      return () => {
        entries.delete(listener)
      }
    },
  }
}

function authenticatedState(userId: string, connectivity: "online" | "offline") {
  return {
    status: "authenticated",
    connectivity,
    profile: {
      user: {
        id: userId,
        email: `${userId}@example.com`,
        handle: userId,
        nickname: userId,
      },
    },
  }
}

function snapshot(revision: number): CustomAppSnapshotDto {
  return {
    schemaVersion: 1,
    revision,
    initialized: true,
    dockCatalogVersion: 1,
    apps: [{
      id: appId,
      kind: "web",
      schemaVersion: 1,
      name: "阅读",
      startUrl: "https://example.com/read",
      openMode: "window",
      iconUrl: null,
      iconSource: "favicon",
      version: 1,
      createdAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    }],
    dockAppIds: ["agent", appId, "launcher"],
    dockMigrationIds: [],
  }
}

function deferredValue<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}
