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
  const namespace = {
    get: vi.fn(async (id: string) => cache.get(id) ?? null),
    upsert: vi.fn(async (value: { readonly id: string }) => {
      cache.set(value.id, value)
    }),
  }
  const repository = {
    namespace: vi.fn(() => namespace),
  }
  const listeners = new Set<(state: never) => void>()
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
  const catalog = new CustomAppsCatalogService({
    account: account as unknown as CustomAppsAccountPort,
    repository: repository as never,
    api,
    now: () => new Date("2026-11-07T00:00:00.000Z"),
  })
  return { catalog, account, api, cache }
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
