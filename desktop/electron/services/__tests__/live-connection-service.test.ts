import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LIVE_MESSAGE_TYPES, createLiveEnvelope } from "@synapse/shared"
import type { SynapseAccountState } from "../../../src/types/account"
import { LiveConnectionService } from "../live-connection-service"

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.2.253",
  },
}))

vi.mock("node:os", () => ({
  default: {
    hostname: () => "MacBook",
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

class FakeSocket extends EventEmitter {
  readonly sent: string[] = []
  readonly close = vi.fn()
  readyState = 1
  throwOnWebhookAck = false

  send(payload: string): void {
    if (this.throwOnWebhookAck && JSON.parse(payload).type === LIVE_MESSAGE_TYPES.webhookDeliveryAck) {
      throw new Error("ack failed")
    }
    this.sent.push(payload)
  }
}

const authenticatedState: SynapseAccountState = {
  status: "authenticated",
  connectivity: "online",
  profile: {
    user: { id: "user-1", email: "u@example.com", handle: "user-1", status: "active" },
    syncedAt: "2026-06-06T10:00:00.000Z",
  },
}

function createAccountService(input: {
  readonly token?: string | null
  readonly apiBaseUrl?: string
  readonly state?: SynapseAccountState
  readonly refreshFromStorage?: (options?: unknown) => Promise<unknown>
} = {}) {
  const token = Object.prototype.hasOwnProperty.call(input, "token") ? input.token : "access-token"

  return {
    getAccessTokenForLive: vi.fn().mockReturnValue(token),
    getApiBaseUrlForLive: vi.fn().mockReturnValue(input.apiBaseUrl ?? "http://localhost:3000/api"),
    getState: vi.fn().mockReturnValue(input.state ?? authenticatedState),
    refreshFromStorage: vi.fn(input.refreshFromStorage ?? (async () => ({ status: "unauthenticated" }))),
  }
}

function createTimerFns() {
  const timers: Array<{ readonly delay: number; readonly callback: () => void }> = []
  return {
    timers,
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      timers.push({ delay, callback })
      return { delay } as unknown as NodeJS.Timeout
    }),
    clearTimeout: vi.fn(),
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await flushPromises()
    if (condition()) {
      return
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
  }
  throw new Error("Timed out waiting for condition")
}

describe("LiveConnectionService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates socket with bearer header and waits for welcome before connected", async () => {
    const socket = new FakeSocket()
    const accountService = createAccountService()
    const createSocket = vi.fn(() => socket as never)
    const eventBus = { emit: vi.fn() }
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
      now: () => new Date("2026-06-06T10:00:00.000Z"),
    })
    service.setEventBus(eventBus as never)

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("open")
    await waitForCondition(() => socket.sent.length > 0)

    expect(createSocket).toHaveBeenCalledWith("ws://localhost:3000/api/live/desktop", {
      headers: { Authorization: "Bearer access-token" },
    })
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "live.hello",
      payload: {
        clientInstanceId: "client-a",
        appVersion: "0.2.253",
        platform: `${process.platform}-${process.arch}`,
        deviceName: "MacBook",
      },
    })
    expect(service.getState()).toMatchObject({ status: "reconnecting", clientInstanceId: "client-a" })

    socket.emit("message", JSON.stringify({
      type: "live.welcome",
      id: "msg-welcome",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: {
        connectionId: "conn-a",
        serverTime: "2026-06-06T10:00:01.000Z",
        heartbeatIntervalMs: 20_000,
        heartbeatTimeoutMs: 45_000,
      },
    }))
    await waitForCondition(() => service.getState().status === "connected")

    expect(service.getState()).toMatchObject({
      status: "connected",
      clientInstanceId: "client-a",
      connectedAt: "2026-06-06T10:00:00.000Z",
      lastSeenAt: "2026-06-06T10:00:00.000Z",
    })
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "live",
      type: "live.stateChanged",
    }))
  })

  it("updates last seen when pong arrives", async () => {
    const socket = new FakeSocket()
    const times = [
      new Date("2026-06-06T10:00:00.000Z"),
      new Date("2026-06-06T10:00:05.000Z"),
    ]
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      now: () => times.shift() ?? new Date("2026-06-06T10:00:05.000Z"),
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("open")
    await waitForCondition(() => socket.sent.length > 0)
    socket.emit("message", JSON.stringify({
      type: "live.welcome",
      id: "msg-welcome",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: {
        connectionId: "conn-a",
        serverTime: "2026-06-06T10:00:01.000Z",
        heartbeatIntervalMs: 20_000,
        heartbeatTimeoutMs: 45_000,
      },
    }))
    await waitForCondition(() => service.getState().status === "connected")
    socket.emit("message", JSON.stringify({
      type: "live.pong",
      id: "msg-pong",
      sentAt: "2026-06-06T10:00:05.000Z",
      payload: { serverTime: "2026-06-06T10:00:05.000Z" },
    }))
    await waitForCondition(() => service.getState().lastSeenAt === "2026-06-06T10:00:05.000Z")

    expect(service.getState().lastSeenAt).toBe("2026-06-06T10:00:05.000Z")
  })

  it("acknowledges webhook delivery downlinks before dispatching to the installed handler", async () => {
    const socket = new FakeSocket()
    const webhookDeliveryHandler = { handle: vi.fn().mockResolvedValue(undefined) }
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      webhookDeliveryHandler,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("message", JSON.stringify(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      {
        deliveryId: "delivery-1",
        webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
        request: {
          method: "POST",
          url: "https://synapse.test/webhooks/wh_public/***",
          query: { event: "push" },
          headers: { "x-github-event": "push" },
          body: { repository: { full_name: "FairyEver/Synapse" } },
          contentType: "application/json",
          receivedAt: "2026-06-06T10:00:00.000Z",
        },
      },
      { id: "msg-webhook", sentAt: "2026-06-06T10:00:01.000Z" },
    )))

    await waitForCondition(() => webhookDeliveryHandler.handle.mock.calls.length > 0)

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: LIVE_MESSAGE_TYPES.webhookDeliveryAck,
      payload: { deliveryId: "delivery-1" },
    })
    expect(webhookDeliveryHandler.handle).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: "delivery-1",
      webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
    }))
  })

  it("still dispatches webhook delivery downlinks when ack sending fails", async () => {
    const socket = new FakeSocket()
    socket.throwOnWebhookAck = true
    const webhookDeliveryHandler = { handle: vi.fn().mockResolvedValue(undefined) }
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      webhookDeliveryHandler,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("message", JSON.stringify(createLiveEnvelope(
      LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      {
        deliveryId: "delivery-1",
        webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
        request: {
          method: "POST",
          url: "https://synapse.test/webhooks/wh_public/***",
          query: {},
          headers: {},
          body: { ok: true },
          receivedAt: "2026-06-06T10:00:00.000Z",
        },
      },
      { id: "msg-webhook", sentAt: "2026-06-06T10:00:01.000Z" },
    )))

    await waitForCondition(() => webhookDeliveryHandler.handle.mock.calls.length > 0)

    expect(webhookDeliveryHandler.handle).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: "delivery-1",
    }))
  })

  it("ignores malformed webhook delivery downlinks", async () => {
    const socket = new FakeSocket()
    const webhookDeliveryHandler = { handle: vi.fn().mockResolvedValue(undefined) }
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      webhookDeliveryHandler,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("message", JSON.stringify({
      type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      id: "msg-webhook",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: {
        deliveryId: "delivery-1",
        webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
      },
    }))
    await flushPromises()

    expect(socket.sent).toHaveLength(0)
    expect(webhookDeliveryHandler.handle).not.toHaveBeenCalled()
  })

  it("sends heartbeat ping envelopes", async () => {
    const socket = new FakeSocket()
    const timers = createTimerFns()
    const times = [
      new Date("2026-06-06T10:00:00.000Z"),
      new Date("2026-06-06T10:00:05.000Z"),
    ]
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      now: () => times.shift() ?? new Date("2026-06-06T10:00:05.000Z"),
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("open")
    await waitForCondition(() => socket.sent.length > 0)
    socket.emit("message", JSON.stringify({
      type: "live.welcome",
      id: "msg-welcome",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: {
        connectionId: "conn-a",
        serverTime: "2026-06-06T10:00:01.000Z",
        heartbeatIntervalMs: 20_000,
        heartbeatTimeoutMs: 45_000,
      },
    }))
    await waitForCondition(() => timers.timers.length > 0)
    timers.timers[0]?.callback()
    await waitForCondition(() => socket.sent.length > 1)

    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 20_000)
    expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({
      type: "live.ping",
      payload: { sentAt: "2026-06-06T10:00:05.000Z" },
    })
  })

  it("reconnects when a welcomed socket stops receiving server heartbeats", async () => {
    const firstSocket = new FakeSocket()
    const secondSocket = new FakeSocket()
    const timers = createTimerFns()
    const createSocket = vi.fn()
      .mockReturnValueOnce(firstSocket as never)
      .mockReturnValueOnce(secondSocket as never)
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      reconnectDelay: () => 2_000,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    firstSocket.emit("open")
    await waitForCondition(() => firstSocket.sent.length > 0)
    firstSocket.emit("message", JSON.stringify({
      type: "live.welcome",
      id: "msg-welcome",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: {
        connectionId: "conn-a",
        serverTime: "2026-06-06T10:00:01.000Z",
        heartbeatIntervalMs: 20_000,
        heartbeatTimeoutMs: 45_000,
      },
    }))
    await waitForCondition(() => service.getState().status === "connected")

    timers.timers.find((timer) => timer.delay === 45_000)?.callback()
    await flushPromises()

    expect(firstSocket.close).toHaveBeenCalledWith(1000, "heartbeat_timeout")
    expect(service.getState()).toMatchObject({
      status: "reconnecting",
      lastError: "连接超时",
    })

    timers.timers.find((timer) => timer.delay === 2_000)?.callback()
    await flushPromises()

    expect(createSocket).toHaveBeenCalledTimes(2)
    expect(secondSocket.close).not.toHaveBeenCalled()
  })

  it("closes the socket when account becomes unauthenticated", async () => {
    const socket = new FakeSocket()
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    service.handleAccountState({ status: "unauthenticated" })

    expect(socket.close).toHaveBeenCalled()
    expect(service.getState().status).toBe("unauthenticated")
  })

  it("cancels pending socket creation when account logs out during connect", async () => {
    let resolveClientId: (clientInstanceId: string) => void = () => {}
    const clientIdPromise = new Promise<string>((resolve) => {
      resolveClientId = resolve
    })
    const createSocket = vi.fn()
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockReturnValue(clientIdPromise) } as never,
      createSocket,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    service.handleAccountState({ status: "unauthenticated" })
    resolveClientId("client-a")
    await flushPromises()

    expect(createSocket).not.toHaveBeenCalled()
    expect(service.getState().status).toBe("unauthenticated")
  })

  it("refreshes the token after websocket auth failure and reconnects with the new token", async () => {
    const firstSocket = new FakeSocket()
    const secondSocket = new FakeSocket()
    let token: string | null = "expired-token"
    const accountService = {
      getAccessTokenForLive: vi.fn(() => token),
      getApiBaseUrlForLive: vi.fn().mockReturnValue("http://localhost:3000/api"),
      refreshFromStorage: vi.fn(async () => {
        token = "fresh-token"
        return { status: "authenticated" }
      }),
    }
    const createSocket = vi.fn()
      .mockReturnValueOnce(firstSocket as never)
      .mockReturnValueOnce(secondSocket as never)
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    firstSocket.emit("error", new Error("Unexpected server response: 401"))
    await flushPromises()

    expect(accountService.refreshFromStorage).toHaveBeenCalledTimes(1)
    expect(accountService.refreshFromStorage).toHaveBeenCalledWith({ reason: "live-auth-failure" })
    expect(createSocket).toHaveBeenNthCalledWith(1, "ws://localhost:3000/api/live/desktop", {
      headers: { Authorization: "Bearer expired-token" },
    })
    expect(createSocket).toHaveBeenNthCalledWith(2, "ws://localhost:3000/api/live/desktop", {
      headers: { Authorization: "Bearer fresh-token" },
    })
  })

  it("schedules reconnect on close without an immediate tight loop", async () => {
    const socket = new FakeSocket()
    const timers = createTimerFns()
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      reconnectDelay: () => 2_000,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("close")

    expect(service.getState()).toMatchObject({
      status: "reconnecting",
      lastError: "连接已断开",
    })
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 2_000)
    expect(timers.timers).toHaveLength(1)
  })

  it("does not rebuild the socket for duplicate authenticated state of the same account", async () => {
    const socket = new FakeSocket()
    const createSocket = vi.fn(() => socket as never)
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    service.handleAccountState(authenticatedState)
    await flushPromises()

    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(socket.close).not.toHaveBeenCalled()
  })

  it("reconnects after a normal close without refreshing the account token", async () => {
    const firstSocket = new FakeSocket()
    const secondSocket = new FakeSocket()
    const timers = createTimerFns()
    const accountService = createAccountService()
    const createSocket = vi.fn()
      .mockReturnValueOnce(firstSocket as never)
      .mockReturnValueOnce(secondSocket as never)
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      reconnectDelay: () => 2_000,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    firstSocket.emit("close", 1006)
    timers.timers[0]?.callback()
    await flushPromises()

    expect(accountService.refreshFromStorage).not.toHaveBeenCalled()
    expect(createSocket).toHaveBeenCalledTimes(2)
    expect(createSocket).toHaveBeenNthCalledWith(2, "ws://localhost:3000/api/live/desktop", {
      headers: { Authorization: "Bearer access-token" },
    })
  })

  it("schedules reconnect when startup fails before socket creation", async () => {
    const socket = new FakeSocket()
    const timers = createTimerFns()
    const eventBus = { emit: vi.fn() }
    const clientIdStore = {
      getOrCreate: vi.fn()
        .mockRejectedValueOnce(new Error("client id unavailable"))
        .mockResolvedValueOnce("client-a"),
    }
    const createSocket = vi.fn(() => socket as never)
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: clientIdStore as never,
      createSocket,
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      reconnectDelay: () => 2_000,
    })
    service.setEventBus(eventBus as never)

    service.handleAccountState(authenticatedState)
    await flushPromises()

    expect(createSocket).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({
      status: "reconnecting",
      lastError: "连接失败",
    })
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 2_000)
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "live",
      type: "live.stateChanged",
    }))

    timers.timers[0]?.callback()
    await flushPromises()

    expect(createSocket).toHaveBeenCalledWith("ws://localhost:3000/api/live/desktop", {
      headers: { Authorization: "Bearer access-token" },
    })
    expect(service.getState()).toMatchObject({
      status: "reconnecting",
      clientInstanceId: "client-a",
      lastError: null,
    })
  })

  it("does not reset reconnect attempts before welcome", async () => {
    const firstSocket = new FakeSocket()
    const secondSocket = new FakeSocket()
    const timers = createTimerFns()
    const reconnectDelay = vi.fn((attempt: number) => 2_000 + attempt)
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn()
        .mockReturnValueOnce(firstSocket as never)
        .mockReturnValueOnce(secondSocket as never),
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      reconnectDelay,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    firstSocket.emit("open")
    firstSocket.emit("close")
    timers.timers[0]?.callback()
    await flushPromises()
    secondSocket.emit("open")
    secondSocket.emit("close")

    expect(reconnectDelay).toHaveBeenNthCalledWith(1, 0)
    expect(reconnectDelay).toHaveBeenNthCalledWith(2, 1)
  })

  it("refreshes once for a missing token and does not connect when still missing", async () => {
    const accountService = createAccountService({ token: null })
    const createSocket = vi.fn()
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
    })

    await service.connect()

    expect(accountService.refreshFromStorage).toHaveBeenCalledTimes(1)
    expect(accountService.refreshFromStorage).toHaveBeenCalledWith({ reason: "live-auth-failure" })
    expect(createSocket).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({
      status: "unauthenticated",
      lastError: "账号未登录",
    })
  })

  it("keeps reconnecting when an offline authenticated account cannot refresh a live token", async () => {
    const accountService = createAccountService({
      token: null,
      state: {
        ...authenticatedState,
        connectivity: "offline",
        offlineReason: "network_error",
      },
      refreshFromStorage: async () => ({
        ...authenticatedState,
        connectivity: "offline",
        offlineReason: "network_error",
      }),
    })
    const createSocket = vi.fn()
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
    })

    await service.connect()

    expect(accountService.refreshFromStorage).toHaveBeenCalledTimes(1)
    expect(accountService.refreshFromStorage).toHaveBeenCalledWith({ reason: "live-auth-failure" })
    expect(createSocket).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({
      status: "reconnecting",
      lastError: "网络不可用，正在重试",
    })
  })

  it("stops reconnecting when token refresh clears an offline account", async () => {
    let currentState: SynapseAccountState = {
      ...authenticatedState,
      connectivity: "offline",
      offlineReason: "server_unavailable",
    }
    const accountService = createAccountService({
      token: null,
      refreshFromStorage: async () => {
        currentState = { status: "unauthenticated" }
        return currentState
      },
    })
    accountService.getState.mockImplementation(() => currentState)
    const createSocket = vi.fn()
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
    })

    await service.connect()

    expect(accountService.refreshFromStorage).toHaveBeenCalledTimes(1)
    expect(createSocket).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({
      status: "unauthenticated",
      lastError: "账号未登录",
    })
  })
})
