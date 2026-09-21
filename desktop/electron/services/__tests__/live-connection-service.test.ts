import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LIVE_DESKTOP_CLOSE_CODES, LIVE_MESSAGE_TYPES, MOBILE_FRAME_LIMITS, createLiveEnvelope } from "@synapse/shared"
import type { MobileTerminalFrame } from "@synapse/shared"
import type { SynapseAccountState } from "../../../src/types/account"
import { MAX_SOCKET_BUFFERED_BYTES, LiveConnectionService } from "../live-connection-service"
import { buildTerminalFrames } from "../mobile-gateway/frame-builder"

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
  /** What `ws` is still holding for a link that has stopped draining. */
  bufferedAmount = 0
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

const welcomeMessage = JSON.stringify({
  type: "live.welcome",
  id: "msg-welcome",
  sentAt: "2026-06-06T10:00:01.000Z",
  payload: {
    connectionId: "conn-a",
    serverTime: "2026-06-06T10:00:01.000Z",
    heartbeatIntervalMs: 20_000,
    heartbeatTimeoutMs: 45_000,
  },
})

/** The two steps that make a socket a connection: it opens, and the cloud welcomes it. */
async function openAndWelcome(service: LiveConnectionService, socket: FakeSocket): Promise<void> {
  socket.emit("open")
  await waitForCondition(() => socket.sent.length > 0)
  socket.emit("message", welcomeMessage)
  await waitForCondition(() => service.getState().status === "connected")
}

async function connectAndWelcome(service: LiveConnectionService, socket: FakeSocket): Promise<void> {
  service.handleAccountState(authenticatedState)
  await flushPromises()
  await openAndWelcome(service, socket)
}

/** A frame, as opposed to the envelope around it or the summary and toolbar payloads. */
function isFrameLike(value: unknown): boolean {
  return typeof value === "object" && value !== null && "sessionId" in value && "lines" in value
}

/**
 * Whether a value being serialized carries a terminal frame inside it.
 *
 * The envelope is what reaches `JSON.stringify`, so asking whether its *argument* is a
 * frame would answer "no" for the implementation this replaced as readily as for this
 * one — the frame used to sit at `payload.frame`. What has to be absent is a frame
 * anywhere in the value: that is the second pass over the same bytes.
 */
function containsFrame(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  return Object.values(value).some((nested) => isFrameLike(nested) || containsFrame(nested))
}

/**
 * The frames whose bytes are most likely to be measured wrongly: a plain short line, the
 * characters `JSON.stringify` has to escape (quote, backslash, control characters, a
 * non-BMP emoji, a lone surrogate), and enough lines to reach the per-frame ceiling.
 *
 * Built by the real builder so the shapes are the ones the wire actually carries.
 */
function representativeFrames(): readonly MobileTerminalFrame[] {
  const escaping = [
    "plain ascii line",
    'quote " backslash \\ slash /',
    "tab\there newline\nthere bell\u0007",
    "中文行 中文 emoji 👍🏽",
    "lone\ud800surrogate",
  ]
  const shared = {
    sessionId: "sess-1",
    kind: "suffix" as const,
    from: 0,
    cursor: { row: 2, col: 5, visible: true },
    alt: false,
    truncated: false,
    seq: 42,
    sizeRevision: 3,
  }
  const atLineLimit = buildTerminalFrames({
    ...shared,
    from: 100,
    lines: Array.from(
      { length: MOBILE_FRAME_LIMITS.maxLinesPerFrame + 1 },
      (_, index) => ({ text: `line-${index}` }),
    ),
    total: 100 + MOBILE_FRAME_LIMITS.maxLinesPerFrame + 1,
  })
  return [
    ...buildTerminalFrames({
      ...shared,
      lines: escaping.map((text) => ({ text })),
      total: escaping.length,
    }),
    ...atLineLimit,
  ]
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

  it("stamps the toolbar with this computer's identity, and drops it without one", async () => {
    /*
     * A phone files the button list under the computer that sent it and discards the
     * rest, so the identity is what makes the message mean anything. A desktop that
     * cannot name itself must say nothing rather than send a list that would be filed
     * under nothing — and overwrite another computer's buttons doing it.
     */
    const socket = new FakeSocket()
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      now: () => new Date("2026-06-06T10:00:00.000Z"),
    })

    await service.sendMobileToolbar({ revision: 1, buttons: [] })
    expect(socket.sent).toHaveLength(0)

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("open")
    await waitForCondition(() => socket.sent.length > 0)
    socket.emit("message", JSON.stringify({
      type: "live.welcome",
      id: "msg-welcome",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: { connectionId: "conn-a", serverTime: "2026-06-06T10:00:01.000Z", heartbeatIntervalMs: 20_000, heartbeatTimeoutMs: 45_000 },
    }))
    await flushPromises()
    socket.sent.length = 0

    await service.sendMobileToolbar({
      revision: 2,
      buttons: [{ id: "enter", label: "回车", group: "key", action: { type: "key", key: "Enter" } }],
    })

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "mobile.toolbar",
      payload: {
        desktopClientInstanceId: "client-a",
        revision: 2,
        buttons: [{ id: "enter", label: "回车", group: "key", action: { type: "key", key: "Enter" } }],
      },
    })
  })

  it("stamps the sentences with this computer's identity, and drops them without one", async () => {
    // The same rule as the toolbar's, and the same reason: a phone files the list under
    // the computer that sent it, so a desktop that cannot name itself would file its
    // user's own sentences under nothing — and overwrite another machine's doing it.
    const socket = new FakeSocket()
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      now: () => new Date("2026-06-06T10:00:00.000Z"),
    })

    await service.sendMobileQuickPhrases({ revision: 1, phrases: [] })
    expect(socket.sent).toHaveLength(0)

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("open")
    await waitForCondition(() => socket.sent.length > 0)
    socket.emit("message", JSON.stringify({
      type: "live.welcome",
      id: "msg-welcome",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: { connectionId: "conn-a", serverTime: "2026-06-06T10:00:01.000Z", heartbeatIntervalMs: 20_000, heartbeatTimeoutMs: 45_000 },
    }))
    await flushPromises()
    socket.sent.length = 0

    await service.sendMobileQuickPhrases({
      revision: 2,
      phrases: [{ id: "q1", content: "整理成提交说明" }],
    })

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "mobile.quickPhrases",
      payload: {
        desktopClientInstanceId: "client-a",
        revision: 2,
        phrases: [{ id: "q1", content: "整理成提交说明" }],
      },
    })
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

  it("takes a new client instance id when the cloud says another machine holds it", async () => {
    const firstSocket = new FakeSocket()
    const secondSocket = new FakeSocket()
    const timers = createTimerFns()
    const reissue = vi.fn().mockResolvedValue("client-b")
    const createSocket = vi.fn()
      .mockReturnValueOnce(firstSocket as never)
      .mockReturnValueOnce(secondSocket as never)
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: {
        getOrCreate: vi.fn().mockResolvedValueOnce("client-a").mockResolvedValue("client-b"),
        reissue,
      } as never,
      createSocket,
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      reconnectDelay: () => 2_000,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    firstSocket.emit("close", LIVE_DESKTOP_CLOSE_CODES.clientInstanceIdConflict)
    await waitForCondition(() => reissue.mock.calls.length === 1)

    expect(reissue).toHaveBeenCalledTimes(1)
    // On the backoff timer, not straight into a new connection. A fresh id is the one
    // thing only this side can do about the refusal, but a relay that turns away the id
    // it was just handed must not be met with connections as fast as they can be built
    // — that is the loop this used to be, with no delay in it at all.
    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(timers.timers.map((timer) => timer.delay)).toEqual([2_000])

    timers.timers[0]?.callback()
    await flushPromises()
    secondSocket.emit("open")
    await waitForCondition(() => secondSocket.sent.length > 0)

    expect(JSON.parse(secondSocket.sent[0] ?? "{}")).toMatchObject({
      type: "live.hello",
      payload: { clientInstanceId: "client-b" },
    })
  })

  it("keeps the client instance id when a connection closes for any other reason", async () => {
    const socket = new FakeSocket()
    const timers = createTimerFns()
    const reissue = vi.fn().mockResolvedValue("client-b")
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: {
        getOrCreate: vi.fn().mockResolvedValue("client-a"),
        reissue,
      } as never,
      createSocket: vi.fn(() => socket as never),
      setTimeout: timers.setTimeout as never,
      clearTimeout: timers.clearTimeout as never,
      reconnectDelay: () => 2_000,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    socket.emit("close", 1006)

    expect(reissue).not.toHaveBeenCalled()
    expect(service.getState().clientInstanceId).toBe("client-a")
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

  it("connects after an offline account recovers without an active socket or retry timer", async () => {
    let token: string | null = null
    let accountState: SynapseAccountState = {
      ...authenticatedState,
      connectivity: "offline",
      offlineReason: "network_error",
    }
    const socket = new FakeSocket()
    const createSocket = vi.fn(() => socket as never)
    const accountService = {
      getAccessTokenForLive: vi.fn(() => token),
      getApiBaseUrlForLive: vi.fn().mockReturnValue("http://localhost:3000/api"),
      getState: vi.fn(() => accountState),
      refreshFromStorage: vi.fn(async () => accountState),
    }
    const service = new LiveConnectionService({
      accountService: accountService as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket,
    })

    service.handleAccountState(accountState)
    await flushPromises()

    expect(createSocket).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({
      status: "reconnecting",
      lastError: "网络不可用",
    })

    token = "fresh-token"
    accountState = authenticatedState
    service.handleAccountState(accountState)
    await flushPromises()

    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(createSocket).toHaveBeenCalledWith("ws://localhost:3000/api/live/desktop", {
      headers: { Authorization: "Bearer fresh-token" },
    })
  })

  it("retries immediately when a reconnect timer is pending", async () => {
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
      reconnectDelay: () => 30_000,
    })

    service.handleAccountState(authenticatedState)
    await flushPromises()
    firstSocket.emit("close")

    expect(createSocket).toHaveBeenCalledTimes(1)
    expect(timers.timers).toHaveLength(1)

    await service.retryNow()

    expect(timers.clearTimeout).toHaveBeenCalled()
    expect(createSocket).toHaveBeenCalledTimes(2)
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

  it("does not reset the backoff for a connection that closes straight after welcome", async () => {
    /*
     * A relay restarting, or a proxy draining a node, accepts the socket, sends `welcome`
     * and closes it again. Every one of those connections looked like a success for an
     * instant, and treating that as one held the delay at its floor: a two-second loop,
     * every two seconds, for as long as the flapping lasts. The counter has to survive it
     * so the delay can grow.
     */
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
      // A frozen clock: both connections are over in the same instant.
      now: () => new Date("2026-06-06T10:00:00.000Z"),
    })

    await connectAndWelcome(service, firstSocket)
    firstSocket.emit("close")

    expect(reconnectDelay).toHaveBeenNthCalledWith(1, 0)
    timers.timers.find((timer) => timer.delay === 2_000)?.callback()
    await flushPromises()
    await openAndWelcome(service, secondSocket)
    secondSocket.emit("close")

    // The second close is not a fresh start any more.
    expect(reconnectDelay).toHaveBeenNthCalledWith(2, 1)
  })

  it("forgives the backoff once a connection has stayed up", async () => {
    /*
     * The other half, and the reason the reset was not simply deleted: a connection that
     * has demonstrably worked must not leave the next ordinary drop inheriting the delay
     * of some failure an hour ago. Nothing here should reconnect more slowly than it did
     * before any of this existed.
     */
    let clockMs = Date.parse("2026-06-06T10:00:00.000Z")
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
      now: () => new Date(clockMs),
    })

    // A connection that flaps once, so the counter is not at zero when it matters.
    await connectAndWelcome(service, firstSocket)
    firstSocket.emit("close")
    timers.timers.find((timer) => timer.delay === 2_000)?.callback()
    await flushPromises()
    await openAndWelcome(service, secondSocket)
    expect(reconnectDelay).toHaveBeenNthCalledWith(1, 0)

    // Then it stays up for five minutes, and *that* is what earns the floor back.
    clockMs += 5 * 60_000
    secondSocket.emit("close")

    expect(reconnectDelay).toHaveBeenNthCalledWith(2, 0)
  })

  it("sends a frame as the gateway serialized it, byte for byte", async () => {
    /*
     * The frame arrives already JSON, because that string is what the phone's uplink
     * budget was charged for — the point being that one representation is measured and a
     * different one is not sent. What must not change is the message: the envelope is
     * still built by `createLiveEnvelope` and serialized by `JSON.stringify`, with the
     * frame spliced in, and the result has to be exactly what serializing the whole
     * envelope would have produced.
     */
    const socket = new FakeSocket()
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      now: () => new Date("2026-06-06T10:00:00.000Z"),
    })
    await connectAndWelcome(service, socket)
    socket.sent.length = 0

    const frames = representativeFrames()
    // Serialized before the spy goes on, or the test's own call would be the one counted.
    const payloads = frames.map((frame) => JSON.stringify(frame))
    const stringify = vi.spyOn(JSON, "stringify")
    for (const frameJson of payloads) {
      await service.sendMobileFrame("phone-1", frameJson)
    }
    // The pass this removes: nothing here carried a frame into `JSON.stringify` — the
    // strings arrived ready to send.
    const serializedAFrame = stringify.mock.calls.some(([value]) => containsFrame(value))
    stringify.mockRestore()
    expect(serializedAFrame).toBe(false)

    expect(socket.sent).toHaveLength(frames.length)
    for (const [index, frame] of frames.entries()) {
      const sent = socket.sent[index] ?? ""
      // The reference is the implementation this replaced: the frame object inside the
      // envelope, serialized once. Escaping, key order and placement all have to match.
      const envelope = JSON.parse(sent) as { readonly id: string; readonly sentAt: string }
      expect(sent).toBe(JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileFrame, {
        desktopClientInstanceId: "client-a",
        mobileClientInstanceId: "phone-1",
        frame,
      }, { id: envelope.id, sentAt: envelope.sentAt })))
      // And what the phone parses back is the very frame the gateway measured.
      expect(JSON.parse(sent)).toMatchObject({
        type: LIVE_MESSAGE_TYPES.mobileFrame,
        payload: { desktopClientInstanceId: "client-a", mobileClientInstanceId: "phone-1", frame },
      })
    }
    // One of them really did reach the per-frame line ceiling, which is the shape whose
    // bytes the budget decision is most likely to be wrong about.
    expect(frames.some((frame) => frame.lines.length === MOBILE_FRAME_LIMITS.maxLinesPerFrame))
      .toBe(true)
  })

  it("drops a message rather than queueing it behind a backed-up socket", async () => {
    /*
     * `ws` buffers without limit, and the gateway produces frames whether or not anyone
     * is reading — a stalled link must cost a lost frame, not unbounded memory in the
     * main process. Dropping is safe by protocol: the next frame carries the state that
     * matters, and a summary is re-sent on the next tick.
     */
    const socket = new FakeSocket()
    const service = new LiveConnectionService({
      accountService: createAccountService() as never,
      clientIdStore: { getOrCreate: vi.fn().mockResolvedValue("client-a") } as never,
      createSocket: vi.fn(() => socket as never),
      now: () => new Date("2026-06-06T10:00:00.000Z"),
    })
    await connectAndWelcome(service, socket)
    socket.sent.length = 0
    const frameJson = JSON.stringify(representativeFrames()[0]!)

    socket.bufferedAmount = MAX_SOCKET_BUFFERED_BYTES + 1
    await expect(service.sendMobileFrame("phone-1", frameJson)).resolves.toBeUndefined()
    expect(socket.sent).toHaveLength(0)

    // At the limit and below, the message goes out exactly as it always did.
    socket.bufferedAmount = MAX_SOCKET_BUFFERED_BYTES
    await service.sendMobileFrame("phone-1", frameJson)
    expect(socket.sent).toHaveLength(1)

    socket.bufferedAmount = 0
    await service.sendMobileFrame("phone-1", frameJson)
    expect(socket.sent).toHaveLength(2)
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
      lastError: "网络不可用",
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
