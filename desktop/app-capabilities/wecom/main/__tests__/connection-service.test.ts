import { describe, expect, it, vi } from "vitest"
import type {
  WecomConnectionStateV1,
  WecomMailStateV1,
} from "../../../../electron/runtime/data-repo/schemas/connectors"
import type { SynapseAccountState } from "../../../../src/types/account"
import { WecomCliError, type WecomCliAuthSession, type WecomCliClient } from "../cli-client"
import { WecomConnectionService } from "../connection-service"

function authenticated(id: string): SynapseAccountState {
  return {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: { id, email: `${id}@example.test`, handle: id, status: "active" },
      syncedAt: "2026-10-22T00:00:00Z",
    },
  }
}

function fakeNamespace<T>(initial?: T) {
  let state = initial ?? null
  return {
    getSingleton: vi.fn(async () => state),
    setSingleton: vi.fn(async (next: T) => { state = next }),
    value: () => state,
  }
}

function harness(options: {
  readonly authorized?: boolean
  readonly legacy?: WecomMailStateV1
} = {}) {
  let accountState = authenticated("owner-a")
  const state = fakeNamespace<WecomConnectionStateV1>()
  const legacyState = fakeNamespace(options.legacy)
  let authorized = options.authorized ?? false
  let resolveAuth!: () => void
  const wait = new Promise<void>((resolve) => { resolveAuth = resolve })
  const authSession: WecomCliAuthSession = {
    qrCodeDataUrl: "data:image/png;base64,cXItY29kZQ==",
    wait: vi.fn(() => wait),
    cancel: vi.fn(async () => undefined),
  }
  const startAuth = vi.fn(async () => {
    authorized = true
    return authSession
  })
  const client: WecomCliClient = {
    isAuthorized: vi.fn(async () => authorized),
    validate: vi.fn(async () => {
      if (!authorized) throw new WecomCliError("auth_required", "企业微信授权已失效，请重新连接。")
    }),
    startAuth,
    disconnect: vi.fn(async () => undefined),
    clearAgentWork: vi.fn(async () => undefined),
    run: vi.fn(async () => "{}"),
    runAgent: vi.fn(async () => ({
      output: "{}",
      workingDirectory: "/tmp/fake-wecom-work",
    })),
  }
  const beforeIdentityListeners: Array<() => void | Promise<void>> = []
  const service = new WecomConnectionService({
    state: state as never,
    legacyState: legacyState as never,
    account: {
      getState: () => accountState,
      onBeforeIdentityChange: (listener) => {
        beforeIdentityListeners.push(listener)
        return () => undefined
      },
      onStateChanged: () => () => undefined,
    },
    client,
    now: () => Date.parse("2026-10-22T09:00:00Z"),
  })
  service.initialize()

  return {
    service,
    client,
    state,
    legacyState,
    resolveAuth,
    switchAccount: () => { accountState = authenticated("owner-b") },
    invalidateForAccountChange: async () => {
      for (const listener of beforeIdentityListeners) await listener()
    },
  }
}

describe("WeCom connection service", () => {
  it("starts a QR session and persists only owner-scoped connection metadata", async () => {
    const h = harness()
    const connecting = await h.service.connect()
    expect(connecting).toMatchObject({
      status: "connecting",
      enabled: true,
      qrCodeDataUrl: "data:image/png;base64,cXItY29kZQ==",
    })

    h.resolveAuth()
    await vi.waitFor(async () => {
      expect(await h.service.snapshot()).toMatchObject({
        status: "connected",
        enabled: true,
      })
    })

    expect(Object.values(h.state.value()?.bindings ?? {})).toEqual([
      expect.objectContaining({
        ownerUserId: "owner-a",
        connectorId: "wecom",
        enabled: true,
      }),
    ])
    expect(JSON.stringify(h.state.value())).not.toContain("credentials")
    expect(JSON.stringify(h.state.value())).not.toContain("token")
  })

  it("reuses an existing authorized bot without starting a new QR scan", async () => {
    const h = harness({ authorized: true })

    await expect(h.service.connect()).resolves.toMatchObject({
      status: "connected",
      enabled: true,
    })
    expect(h.client.startAuth).not.toHaveBeenCalled()
  })

  it("disconnects the local CLI credentials and removes both new and legacy bindings", async () => {
    const h = harness({
      authorized: true,
      legacy: {
        schemaVersion: 1,
        bindings: {
          legacy: {
            ownerUserId: "owner-a",
            connectorId: "wecom-mail",
            connectedAt: "2026-10-22T08:00:00Z",
            lastValidatedAt: "2026-10-22T08:00:00Z",
          },
        },
      },
    })
    await h.service.connect()
    await h.service.disconnect()

    expect(h.client.disconnect).toHaveBeenCalledWith("owner-a")
    expect(h.state.value()?.bindings).toEqual({})
    expect(h.legacyState.value()?.bindings).toEqual({})
    expect(await h.service.snapshot()).toMatchObject({ status: "disconnected", enabled: false })
  })

  it("requires an enabled binding and aborts active work on identity change", async () => {
    const h = harness()
    await expect(h.service.withConnected(async () => undefined)).rejects.toMatchObject({
      code: "connector_required",
    })

    const active = harness({ authorized: true })
    await active.service.connect()
    let observedSignal: AbortSignal | undefined
    const pending = active.service.withConnected(async ({ signal }) => {
      observedSignal = signal
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      throw new WecomCliError("auth_required", "账号已切换。")
    })
    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    await active.invalidateForAccountChange()
    await expect(pending).rejects.toMatchObject({ code: "auth_required" })
    expect(observedSignal?.aborted).toBe(true)
    expect(active.client.clearAgentWork).toHaveBeenCalledWith("owner-a")
  })

  it("migrates an old wecom-mail binding without requiring another scan", async () => {
    const h = harness({
      authorized: true,
      legacy: {
        schemaVersion: 1,
        bindings: {
          legacy: {
            ownerUserId: "owner-a",
            connectorId: "wecom-mail",
            connectedAt: "2026-10-22T08:00:00Z",
            lastValidatedAt: "2026-10-22T08:30:00Z",
          },
        },
      },
    })

    await expect(h.service.snapshot()).resolves.toMatchObject({ status: "connected", enabled: true })
    expect(Object.values(h.state.value()?.bindings ?? {})).toEqual([
      expect.objectContaining({
        ownerUserId: "owner-a",
        connectorId: "wecom",
        connectedAt: "2026-10-22T08:00:00Z",
      }),
    ])
    expect(h.legacyState.value()?.bindings).toEqual({})
    expect(h.client.startAuth).not.toHaveBeenCalled()
  })
})
