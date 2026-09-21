import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import { describe, expect, it, vi } from "vitest"
import { LIVE_MESSAGE_TYPES, createLiveEnvelope } from "@synapse/shared"
import type { UserAuthService } from "../auth/user-auth.service"
import { LiveClientRegistry } from "../live/live-client-registry"
import type { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { MobileLiveGateway, parseMobileMessage } from "./mobile-live.gateway"
import { MobileLiveRelayService } from "./mobile-live-relay.service"
import { MOBILE_LIVE_RATE_MESSAGES_PER_WINDOW } from "./mobile-live.types"

class FakeSocket extends EventEmitter {
  readonly sent: string[] = []
  readonly closeCalls: Array<{ readonly code: number; readonly reason: string }> = []
  readyState = 1

  send(payload: string): void {
    this.sent.push(payload)
  }

  close(code: number, reason: string): void {
    this.readyState = 3
    this.closeCalls.push({ code, reason })
  }

  terminate(): void {
    this.readyState = 3
  }

  json(): unknown[] {
    return this.sent.map((entry) => JSON.parse(entry))
  }
}

class FakeHttpServer extends EventEmitter {
  emitUpgrade(request: IncomingMessage, socket: FakeUpgradeSocket): void {
    this.emit("upgrade", request, socket, Buffer.alloc(0))
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

function upgradeRequest(token?: string): IncomingMessage {
  return {
    url: "/api/live/mobile",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as IncomingMessage
}

function helloMessage(clientInstanceId = "phone-1"): string {
  return JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.hello, {
    clientInstanceId,
    appVersion: "1.0.0",
    platform: "ios",
    deviceName: "iPhone",
  }, { id: "msg-1", sentAt: new Date().toISOString() }))
}

function intentMessage(desktopClientInstanceId = "desktop-1"): string {
  return JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileIntent, {
    desktopClientInstanceId,
    mobileClientInstanceId: "phone-1",
    intent: { v: 1, intentId: "intent-1", kind: "sync" },
  }, { id: "msg-2", sentAt: new Date().toISOString() }))
}

function createHarness(options: { deliverStatus?: "sent" | "desktop_offline" | "send_failed" } = {}) {
  const registry = LiveClientRegistry.withOptions({})
  const relay = {
    setFanout: vi.fn(),
    deliverIntent: vi.fn(async () => ({
      delivery: { status: options.deliverStatus ?? "sent" },
      result: undefined,
    })),
    handleMobileDisconnect: vi.fn(),
    handleSummary: vi.fn(),
    handleFrame: vi.fn(),
    handleIntentResult: vi.fn(),
    cachedSummary: vi.fn(() => null),
    onlineDesktops: vi.fn(() => []),
  } as unknown as MobileLiveRelayService
  const auth = {
    verifyAccessToken: vi.fn(async (token: string) => {
      if (token !== "good-token") throw new Error("invalid")
      return { userId: "user-1" }
    }),
  } as unknown as UserAuthService
  const gateway = new MobileLiveGateway(auth, registry, relay)
  gateway.onModuleInit()
  const httpServer = new FakeHttpServer()
  gateway.attach(httpServer as never)
  return { gateway, registry, relay, httpServer, auth }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe("MobileLiveGateway", () => {
  it("rejects an upgrade without a bearer token", async () => {
    const harness = createHarness()
    const socket = new FakeUpgradeSocket()
    harness.httpServer.emitUpgrade(upgradeRequest(), socket)
    await settle()

    expect(socket.written.join("")).toContain("401")
    expect(socket.destroyedByGateway).toBe(true)
  })

  it("reports a failing auth backend as unavailable, not unauthorized", async () => {
    // A phone must be able to tell "refresh your token" from "back off", which is
    // exactly the distinction the desktop channel collapses.
    const harness = createHarness()
    vi.mocked(harness.auth.verifyAccessToken).mockRejectedValueOnce(new Error("database down"))
    const socket = new FakeUpgradeSocket()
    harness.httpServer.emitUpgrade(upgradeRequest("good-token"), socket)
    await settle()

    expect(socket.written.join("")).toContain("503")
  })

  it("answering hello registers the phone and returns the handshake", async () => {
    const harness = createHarness()
    const socket = new FakeSocket()
    harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })

    socket.emit("message", Buffer.from(helloMessage()))
    await settle()

    const messages = socket.json() as { type: string }[]
    expect(messages[0].type).toBe(LIVE_MESSAGE_TYPES.welcome)
    expect(harness.registry.listOnlineByUser("user-1")).toHaveLength(1)
    expect(harness.registry.listOnlineByUser("user-1")[0].platform).toBe("ios")
  })

  it("closes a socket that sends anything before hello", async () => {
    const harness = createHarness()
    const socket = new FakeSocket()
    harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })

    socket.emit("message", Buffer.from(intentMessage()))
    await settle()

    expect(socket.closeCalls[0]).toMatchObject({ code: 1008, reason: "hello_required" })
  })

  it("routes an intent to the desktop named in the payload", async () => {
    const harness = createHarness()
    const socket = new FakeSocket()
    harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", Buffer.from(helloMessage()))
    await settle()

    socket.emit("message", Buffer.from(intentMessage("desktop-9")))
    await settle()

    expect(harness.relay.deliverIntent).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      mobileClientInstanceId: "phone-1",
      desktopClientInstanceId: "desktop-9",
    }))
  })

  it("answers the phone directly when the desktop is offline", async () => {
    const harness = createHarness({ deliverStatus: "desktop_offline" })
    const socket = new FakeSocket()
    harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", Buffer.from(helloMessage()))
    await settle()

    socket.emit("message", Buffer.from(intentMessage()))
    await settle()

    // Without this the phone would wait for a result that can never arrive.
    const messages = socket.json() as { type: string; payload: { result: { code: string } } }[]
    const result = messages.find((entry) => entry.type === LIVE_MESSAGE_TYPES.mobileIntentResult)
    expect(result?.payload.result.code).toBe("desktop_offline")
  })

  it("relays a summary to every phone of the account", async () => {
    const harness = createHarness()
    const first = new FakeSocket()
    const second = new FakeSocket()
    harness.gateway.bindAuthenticatedSocket(first as never, { userId: "user-1" })
    harness.gateway.bindAuthenticatedSocket(second as never, { userId: "user-1" })
    first.emit("message", Buffer.from(helloMessage("phone-1")))
    second.emit("message", Buffer.from(helloMessage("phone-2")))
    await settle()

    harness.gateway.sendToMobile({
      userId: "user-1",
      clientInstanceId: "phone-2",
      message: createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileSummary, {
        desktopClientInstanceId: "desktop-1",
        desktopName: "MacBook",
        revision: 1,
        groups: [],
        sessions: [],
      }, { id: "m", sentAt: new Date().toISOString() }),
    })

    expect(second.sent).toHaveLength(2)
    expect(first.sent).toHaveLength(1)
  })

  it("closes a phone that floods the socket", async () => {
    const harness = createHarness()
    const socket = new FakeSocket()
    harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", Buffer.from(helloMessage()))
    await settle()

    for (let index = 0; index < MOBILE_LIVE_RATE_MESSAGES_PER_WINDOW + 5; index += 1) {
      socket.emit("message", Buffer.from(intentMessage()))
    }
    await settle()

    expect(socket.closeCalls.some((call) => call.reason === "rate_limited")).toBe(true)
  })

  it("tells the desktops to release leases when a phone drops", async () => {
    const harness = createHarness()
    const socket = new FakeSocket()
    harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
    socket.emit("message", Buffer.from(helloMessage()))
    await settle()

    socket.emit("close")
    await settle()

    expect(harness.relay.handleMobileDisconnect).toHaveBeenCalledWith(
      "user-1",
      "phone-1",
      expect.any(String),
    )
  })

  it("parses only well-formed client messages", () => {
    expect(parseMobileMessage(Buffer.from(helloMessage()))).not.toBeNull()
    expect(parseMobileMessage(Buffer.from("not json"))).toBeNull()
    // A desktop-only message must not be accepted on the phone channel.
    expect(parseMobileMessage(JSON.stringify({
      type: LIVE_MESSAGE_TYPES.webhookDeliveryAck,
      id: "x",
      sentAt: new Date().toISOString(),
      payload: { deliveryId: "d1" },
    }))).toBeNull()
  })

})

/**
 * The fanout path a summary, a presence change, a toolbar, a phrase list and a
 * clipboard snapshot all take. It runs on a timer's schedule — a computer
 * publishes a summary every second — so the number of registry lookups and the
 * number of serializations it costs per phone set the server's steady-state cost.
 */
describe("MobileLiveGateway fanout", () => {
  async function connectPhones(
    harness: ReturnType<typeof createHarness>,
    clientInstanceIds: readonly string[],
  ): Promise<Map<string, FakeSocket>> {
    const sockets = new Map<string, FakeSocket>()
    for (const clientInstanceId of clientInstanceIds) {
      const socket = new FakeSocket()
      harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
      socket.emit("message", Buffer.from(helloMessage(clientInstanceId)))
      sockets.set(clientInstanceId, socket)
    }
    await settle()
    return sockets
  }

  const summaryPayload = () => ({
    desktopClientInstanceId: "desktop-1",
    desktopName: "MacBook",
    revision: 1,
    groups: [],
    sessions: [],
  })

  const summaryMessage = () => createLiveEnvelope(
    LIVE_MESSAGE_TYPES.mobileSummary,
    summaryPayload(),
    { id: "m", sentAt: new Date().toISOString() },
  )

  it("resolves the account's phones once for a whole fanout", async () => {
    // Turning a phone's client instance into a connection is what makes this
    // expensive: resolving it inside the send means one full-registry scan per
    // phone, on top of the one the caller already paid to learn who the phones are.
    const harness = createHarness()
    const phones = await connectPhones(harness, ["phone-1", "phone-2", "phone-3"])
    const relay = new MobileLiveRelayService({} as never, {} as never)
    relay.setFanout(harness.gateway)
    const listSpy = vi.spyOn(harness.registry, "listOnlineByUser")
    listSpy.mockClear()

    relay.handleSummary("user-1", summaryPayload())

    expect(listSpy).toHaveBeenCalledTimes(1)
    for (const socket of phones.values()) expect(socket.sent).toHaveLength(2)
  })

  it("serializes the payload once rather than once per phone", async () => {
    // A summary can approach the desktop's payload ceiling, so building one string
    // per recipient is a large string construction multiplied by the phone count —
    // every second, for every computer.
    const harness = createHarness()
    const phones = await connectPhones(harness, ["phone-1", "phone-2", "phone-3"])
    const stringifySpy = vi.spyOn(JSON, "stringify")

    harness.gateway.sendToMobileClients({ userId: "user-1", message: summaryMessage() })
    const stringifyCalls = stringifySpy.mock.calls.length
    stringifySpy.mockRestore()

    expect(stringifyCalls).toBe(1)
    for (const socket of phones.values()) expect(socket.sent).toHaveLength(2)
  })

  it("keeps delivering to the other phones when one send fails", async () => {
    const harness = createHarness()
    const phones = await connectPhones(harness, ["phone-1", "phone-2", "phone-3"])
    const broken = phones.get("phone-2")
    const offline = phones.get("phone-3")
    if (!broken || !offline) throw new Error("phones did not connect")
    broken.send = () => {
      throw new Error("socket is gone")
    }
    offline.readyState = 3

    expect(() => harness.gateway.sendToMobileClients({
      userId: "user-1",
      message: summaryMessage(),
    })).not.toThrow()

    // The one that failed is skipped, not fatal; the one that is not open is never
    // written to at all.
    expect(phones.get("phone-1")?.sent).toHaveLength(2)
    expect(broken.sent).toHaveLength(1)
    expect(offline.sent).toHaveLength(1)
  })
})

describe("MobileLiveGateway addressed send", () => {
  it("reports whether the phone it named was reachable", async () => {
    const harness = createHarness()
    const phones = await connectPhonesForAddressedSend(harness)
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.pong, {
      serverTime: new Date().toISOString(),
    }, { id: "m", sentAt: new Date().toISOString() })

    expect(harness.gateway.sendToMobile({ userId: "user-1", clientInstanceId: "phone-1", message })).toBe("sent")
    // A phone that never registered, and an account with no phones at all.
    expect(harness.gateway.sendToMobile({ userId: "user-1", clientInstanceId: "phone-9", message })).toBe("offline")
    expect(harness.gateway.sendToMobile({ userId: "user-2", clientInstanceId: "phone-1", message })).toBe("offline")
    expect(phones.get("phone-1")?.sent).toHaveLength(2)
  })

  it("reports a failing write rather than throwing at the caller", async () => {
    const harness = createHarness()
    const phones = await connectPhonesForAddressedSend(harness)
    const socket = phones.get("phone-1")
    if (!socket) throw new Error("phone did not connect")
    socket.send = () => {
      throw new Error("socket is gone")
    }

    expect(harness.gateway.sendToMobile({
      userId: "user-1",
      clientInstanceId: "phone-1",
      message: createLiveEnvelope(LIVE_MESSAGE_TYPES.pong, { serverTime: new Date().toISOString() }, {
        id: "m",
        sentAt: new Date().toISOString(),
      }),
    })).toBe("send_failed")
  })
})

async function connectPhonesForAddressedSend(
  harness: ReturnType<typeof createHarness>,
): Promise<Map<string, FakeSocket>> {
  const socket = new FakeSocket()
  harness.gateway.bindAuthenticatedSocket(socket as never, { userId: "user-1" })
  socket.emit("message", Buffer.from(helloMessage("phone-1")))
  await settle()
  return new Map([["phone-1", socket]])
}
