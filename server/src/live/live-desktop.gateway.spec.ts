import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import { Logger } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { LIVE_MESSAGE_TYPES } from "@synapse/shared"
import {
  createLiveDesktopGatewayForTest,
  LiveDesktopGateway,
  parseLiveDesktopMessage,
} from "./live-desktop.gateway"
import { LiveClientRegistry } from "./live-client-registry"
import type { LiveStreamService } from "./live-stream.service"
import type { LiveClientInstance } from "./live.types"
import type { UserAuthService } from "../auth/user-auth.service"

class FakeSocket extends EventEmitter {
  readonly sent: string[] = []
  readonly closeCalls: Array<{ readonly code: number; readonly reason: string }> = []
  readyState = 1
  shouldThrowOnSend = false

  send(payload: string): void {
    if (this.shouldThrowOnSend) {
      throw new Error("send failed with secret-token-123")
    }
    this.sent.push(payload)
  }

  close(code: number, reason: string): void {
    this.closeCalls.push({ code, reason })
  }
}

class FakeHttpServer extends EventEmitter {
  readonly upgrades: Array<{
    readonly request: IncomingMessage
    readonly socket: FakeUpgradeSocket
    readonly head: Buffer
  }> = []

  emitUpgrade(request: IncomingMessage, socket: FakeUpgradeSocket, head = Buffer.alloc(0)): void {
    this.upgrades.push({ request, socket, head })
    this.emit("upgrade", request, socket, head)
  }
}

class FakeUpgradeSocket extends Socket {
  readonly written: string[] = []
  destroyedByGateway = false

  override write(buffer: string | Uint8Array): boolean {
    this.written.push(typeof buffer === "string" ? buffer : Buffer.from(buffer).toString("utf8"))
    return true
  }

  override destroy(): this {
    this.destroyedByGateway = true
    return this
  }
}

async function flushUpgrade(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

function createClient(overrides: Partial<LiveClientInstance> = {}): LiveClientInstance {
  return {
    userId: "user-1",
    clientInstanceId: "client-a",
    connectionId: "conn-test",
    status: "online",
    appVersion: "0.2.253",
    platform: "darwin-arm64",
    deviceName: "MacBook",
    connectedAt: "2026-06-06T10:00:00.000Z",
    lastSeenAt: "2026-06-06T10:00:00.000Z",
    ...overrides,
  }
}

function helloFor(clientInstanceId: string) {
  return {
    type: "live.hello",
    id: `msg-hello-${clientInstanceId}`,
    sentAt: "2026-06-06T10:00:00.000Z",
    payload: {
      clientInstanceId,
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
    },
  }
}

function webhookDeliveryPayload() {
  return {
    deliveryId: "delivery-1",
    webhook: {
      id: "webhook-1",
      publicId: "wh_public_1",
      name: "Deploy",
    },
    request: {
      method: "POST",
      url: "https://example.com/webhooks/wh_public_1",
      query: {},
      headers: { "content-type": "application/json" },
      body: { ok: true },
      bodyText: "{\"secret\":\"secret-token-123\"}",
      contentType: "application/json",
      receivedAt: "2026-06-06T10:00:02.000Z",
      remoteAddress: "127.0.0.1",
    },
  }
}

function createGateway(input: {
  readonly verifyAccessToken?: UserAuthService["verifyAccessToken"]
  readonly registry?: Partial<LiveClientRegistry>
  readonly streams?: Partial<LiveStreamService>
  readonly randomId?: () => string
  readonly now?: () => Date
} = {}): LiveDesktopGateway {
  return createLiveDesktopGatewayForTest({
    auth: {
      verifyAccessToken: input.verifyAccessToken ?? vi.fn(),
    } as unknown as UserAuthService,
    registry: {
      register: vi.fn().mockReturnValue(createClient()),
      touch: vi.fn().mockReturnValue(createClient({ lastSeenAt: "2026-06-06T10:00:01.000Z" })),
      markDisconnected: vi.fn(),
      markStaleClients: vi.fn().mockReturnValue([]),
      ...input.registry,
    } as unknown as LiveClientRegistry,
    streams: {
      publish: vi.fn(),
      ...input.streams,
    } as unknown as LiveStreamService,
    clock: {
      randomId: input.randomId ?? (() => "conn-test"),
      now: input.now ?? (() => new Date("2026-06-06T10:00:00.000Z")),
    },
  })
}

describe("parseLiveDesktopMessage", () => {
  it("accepts valid hello and ping messages", () => {
    expect(parseLiveDesktopMessage(JSON.stringify(helloFor("client-a")))).toMatchObject({
      type: "live.hello",
      payload: { clientInstanceId: "client-a" },
    })
    expect(parseLiveDesktopMessage(JSON.stringify({
      type: "live.ping",
      id: "msg-ping",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: { sentAt: "2026-06-06T10:00:01.000Z" },
    }))).toMatchObject({
      type: "live.ping",
      payload: { sentAt: "2026-06-06T10:00:01.000Z" },
    })
  })

  it("rejects invalid JSON, empty hello fields, and unknown types", () => {
    expect(parseLiveDesktopMessage("{")).toBeNull()
    expect(parseLiveDesktopMessage(JSON.stringify({
      ...helloFor("client-a"),
      payload: {
        clientInstanceId: "",
        appVersion: "0.2.253",
        platform: "darwin-arm64",
        deviceName: "MacBook",
      },
    }))).toBeNull()
    expect(parseLiveDesktopMessage(JSON.stringify({ type: "unknown" }))).toBeNull()
  })
})

describe("LiveDesktopGateway", () => {
  it("registers a client after hello, sends welcome, responds to ping, and publishes events", () => {
    const socket = new FakeSocket()
    const register = vi.fn().mockReturnValue(createClient())
    const touch = vi.fn().mockReturnValue(createClient({ lastSeenAt: "2026-06-06T10:00:01.000Z" }))
    const publish = vi.fn()
    const gateway = createGateway({
      registry: { register, touch },
      streams: { publish },
      randomId: () => "connection-1",
      now: vi.fn()
        .mockReturnValueOnce(new Date("2026-06-06T10:00:00.000Z"))
        .mockReturnValue(new Date("2026-06-06T10:00:01.000Z")),
    })

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", JSON.stringify({
      type: "live.hello",
      id: "msg-hello",
      sentAt: "2026-06-06T10:00:00.000Z",
      payload: {
        clientInstanceId: "client-a",
        appVersion: "0.2.253",
        platform: "darwin-arm64",
        deviceName: "MacBook",
      },
    }))
    socket.emit("message", JSON.stringify({
      type: "live.ping",
      id: "msg-ping",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: { sentAt: "2026-06-06T10:00:01.000Z" },
    }))

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "connection-1",
    }))
    expect(touch).toHaveBeenCalledWith("connection-1", expect.any(Date))
    expect(socket.sent.map((item) => JSON.parse(item).type)).toEqual(["live.welcome", "live.pong"])
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "live.welcome",
      payload: {
        connectionId: "connection-1",
        heartbeatIntervalMs: 20_000,
        heartbeatTimeoutMs: 45_000,
      },
    })
    expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({
      type: "live.pong",
      payload: {
        serverTime: "2026-06-06T10:00:01.000Z",
      },
    })
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: "live.client.changed",
      client: expect.objectContaining({ userId: "user-1" }),
    }))
  })

  it("closes when ping arrives before hello", () => {
    const socket = new FakeSocket()
    const gateway = createGateway()

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", JSON.stringify({
      type: "live.ping",
      id: "msg-ping",
      sentAt: "2026-06-06T10:00:01.000Z",
      payload: { sentAt: "2026-06-06T10:00:01.000Z" },
    }))

    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "hello_required" }])
  })

  it("closes invalid messages", () => {
    const socket = new FakeSocket()
    const gateway = createGateway()

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", "{")

    expect(socket.closeCalls).toEqual([{ code: 1003, reason: "invalid_message" }])
  })

  it("rejects duplicate hello messages before registering again", () => {
    const socket = new FakeSocket()
    const register = vi.fn().mockReturnValue(createClient())
    const gateway = createGateway({ registry: { register } })

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", JSON.stringify(helloFor("client-a")))
    socket.emit("message", JSON.stringify({
      ...helloFor("client-b"),
      payload: {
        clientInstanceId: "client-b",
        appVersion: "0.2.253",
        platform: "win32-x64",
        deviceName: "Workstation",
      },
    }))

    expect(register).toHaveBeenCalledTimes(1)
    expect(socket.closeCalls).toEqual([{ code: 1008, reason: "hello_already_received" }])
  })

  it("marks disconnection on close and error and publishes changed clients", () => {
    const socket = new FakeSocket()
    const closeClient = createClient({
      status: "offline",
      connectionId: null,
      disconnectReason: "socket_close",
    })
    const errorClient = createClient({
      status: "offline",
      connectionId: null,
      disconnectReason: "socket_error",
    })
    const markDisconnected = vi.fn()
      .mockReturnValueOnce(closeClient)
      .mockReturnValueOnce(errorClient)
    const publish = vi.fn()
    const gateway = createGateway({
      registry: { markDisconnected },
      streams: { publish },
    })

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("close")
    socket.emit("error", new Error("socket failed"))

    expect(markDisconnected).toHaveBeenNthCalledWith(1, {
      connectionId: "conn-test",
      now: expect.any(Date),
      reason: "socket_close",
    })
    expect(markDisconnected).toHaveBeenNthCalledWith(2, {
      connectionId: "conn-test",
      now: expect.any(Date),
      reason: "socket_error",
    })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ disconnectReason: "socket_close" }),
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ disconnectReason: "socket_error" }),
    }))
  })

  it("closes the superseded socket for the same client instance", () => {
    const oldSocket = new FakeSocket()
    const newSocket = new FakeSocket()
    let supersede: ((connectionId: string) => void) | undefined
    const register = vi.fn((input: { readonly onSupersede?: (connectionId: string) => void }) => {
      supersede = input.onSupersede
      return createClient()
    })
    const gateway = createGateway({
      registry: { register },
      randomId: vi.fn()
        .mockReturnValueOnce("conn-old")
        .mockReturnValueOnce("conn-new"),
    })

    gateway.bindAuthenticatedSocket(oldSocket as never, { userId: "user-1" })
    oldSocket.emit("message", JSON.stringify(helloFor("client-a")))
    gateway.bindAuthenticatedSocket(newSocket as never, { userId: "user-1" })
    newSocket.emit("message", JSON.stringify({
      ...helloFor("client-a"),
      payload: {
        clientInstanceId: "client-a",
        appVersion: "0.2.254",
        platform: "darwin-arm64",
        deviceName: "MacBook Pro",
      },
    }))
    supersede?.("conn-old")

    expect(oldSocket.closeCalls).toEqual([{ code: 1000, reason: "superseded" }])
  })

  it("broadcasts a server message to every online socket for one user", () => {
    const first = new FakeSocket()
    const second = new FakeSocket()
    const other = new FakeSocket()
    const gateway = createLiveDesktopGatewayForTest({
      auth: { verifyAccessToken: vi.fn() } as unknown as UserAuthService,
      registry: new LiveClientRegistry(),
      streams: { publish: vi.fn() } as unknown as LiveStreamService,
      clock: {
        randomId: vi.fn()
          .mockReturnValueOnce("connection-1")
          .mockReturnValueOnce("connection-2")
          .mockReturnValueOnce("connection-3"),
        now: () => new Date("2026-06-06T10:00:00.000Z"),
      },
    })

    gateway.bindAuthenticatedSocket(first as never, { userId: "user-1" })
    gateway.bindAuthenticatedSocket(second as never, { userId: "user-1" })
    gateway.bindAuthenticatedSocket(other as never, { userId: "user-2" })

    first.emit("message", JSON.stringify(helloFor("client-a")))
    second.emit("message", JSON.stringify(helloFor("client-b")))
    other.emit("message", JSON.stringify(helloFor("client-c")))

    const result = gateway.broadcastToUser("user-1", {
      type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      id: "delivery-msg-1",
      sentAt: "2026-06-06T10:00:02.000Z",
      payload: webhookDeliveryPayload(),
    })

    expect(result).toEqual({
      onlineClientCount: 2,
      sentClientCount: 2,
      failedClientCount: 0,
    })
    expect(first.sent.some((item) => JSON.parse(item).type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived)).toBe(true)
    expect(second.sent.some((item) => JSON.parse(item).type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived)).toBe(true)
    expect(other.sent.some((item) => JSON.parse(item).type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived)).toBe(false)
  })

  it("counts closed online sockets as failed broadcasts", () => {
    const socket = new FakeSocket()
    const gateway = createLiveDesktopGatewayForTest({
      auth: { verifyAccessToken: vi.fn() } as unknown as UserAuthService,
      registry: new LiveClientRegistry(),
      streams: { publish: vi.fn() } as unknown as LiveStreamService,
      clock: {
        randomId: () => "connection-1",
        now: () => new Date("2026-06-06T10:00:00.000Z"),
      },
    })

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", JSON.stringify(helloFor("client-a")))
    socket.readyState = 3

    const result = gateway.broadcastToUser("user-1", {
      type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      id: "delivery-msg-1",
      sentAt: "2026-06-06T10:00:02.000Z",
      payload: webhookDeliveryPayload(),
    })

    expect(result).toEqual({
      onlineClientCount: 1,
      sentClientCount: 0,
      failedClientCount: 1,
    })
    expect(socket.sent.some((item) => JSON.parse(item).type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived)).toBe(false)
  })

  it("counts send failures without logging raw delivery payload", () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const socket = new FakeSocket()
    const gateway = createLiveDesktopGatewayForTest({
      auth: { verifyAccessToken: vi.fn() } as unknown as UserAuthService,
      registry: new LiveClientRegistry(),
      streams: { publish: vi.fn() } as unknown as LiveStreamService,
      clock: {
        randomId: () => "connection-1",
        now: () => new Date("2026-06-06T10:00:00.000Z"),
      },
    })

    gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", JSON.stringify(helloFor("client-a")))
    socket.shouldThrowOnSend = true

    const result = gateway.broadcastToUser("user-1", {
      type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
      id: "delivery-msg-1",
      sentAt: "2026-06-06T10:00:02.000Z",
      payload: webhookDeliveryPayload(),
    })

    expect(result).toEqual({
      onlineClientCount: 1,
      sentClientCount: 0,
      failedClientCount: 1,
    })
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain("Live user broadcast failed")
    expect(logged).not.toContain("secret-token-123")
    expect(logged).not.toContain("bodyText")
    expect(logged).not.toContain(LIVE_MESSAGE_TYPES.webhookDeliveryReceived)
    warn.mockRestore()
  })

  it("authenticates upgrade requests and binds accepted sockets", async () => {
    const request = {
      url: "/api/live/desktop",
      headers: { authorization: "Bearer token-value" },
    } as IncomingMessage
    const upgradeSocket = new FakeUpgradeSocket()
    const acceptedSocket = new FakeSocket()
    const server = new FakeHttpServer()
    const verifyAccessToken = vi.fn().mockResolvedValue({ userId: "user-1" })
    const gateway = createGateway({ verifyAccessToken })
    const bindAuthenticatedSocket = vi.spyOn(gateway, "bindAuthenticatedSocket").mockImplementation(() => undefined)
    const handleUpgrade = vi.fn((_request, _socket, _head, callback: (socket: FakeSocket) => void) => {
      callback(acceptedSocket)
    })
    vi.spyOn(gateway, "createWebSocketServer").mockReturnValue({ handleUpgrade } as never)

    gateway.attach(server as never)
    server.emitUpgrade(request, upgradeSocket)
    await flushUpgrade()

    expect(verifyAccessToken).toHaveBeenCalledWith("token-value")
    expect(handleUpgrade).toHaveBeenCalledWith(request, upgradeSocket, Buffer.alloc(0), expect.any(Function))
    expect(bindAuthenticatedSocket).toHaveBeenCalledWith(acceptedSocket, { userId: "user-1" })
    expect(upgradeSocket.destroyedByGateway).toBe(false)
  })

  it("rejects unauthenticated upgrade requests", async () => {
    const request = {
      url: "/api/live/desktop",
      headers: {},
    } as IncomingMessage
    const upgradeSocket = new FakeUpgradeSocket()
    const server = new FakeHttpServer()
    const verifyAccessToken = vi.fn()
    const gateway = createGateway({ verifyAccessToken })
    vi.spyOn(gateway, "createWebSocketServer").mockReturnValue({
      handleUpgrade: vi.fn(),
    } as never)

    gateway.attach(server as never)
    server.emitUpgrade(request, upgradeSocket)
    await flushUpgrade()

    expect(verifyAccessToken).not.toHaveBeenCalled()
    expect(upgradeSocket.written).toEqual(["HTTP/1.1 401 Unauthorized\r\n\r\n"])
    expect(upgradeSocket.destroyedByGateway).toBe(true)
  })

  it("publishes clients changed by stale sweep", () => {
    const changedClient = createClient({ status: "stale" })
    const markStaleClients = vi.fn().mockReturnValue([changedClient])
    const publish = vi.fn()
    const gateway = createGateway({
      registry: { markStaleClients },
      streams: { publish },
    })

    gateway.sweepStaleClients()

    expect(markStaleClients).toHaveBeenCalledWith(expect.any(Date))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ status: "stale" }),
    }))
  })
})
