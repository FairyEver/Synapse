import { createServer, type Server as HttpServer } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket } from "ws"
import { CHANNEL_WS_CLOSE_CODES } from "@synapse/shared/channel-contracts"
import { loadChannelConfig } from "./channel-config"
import { ChannelHub } from "./channel-hub"
import { ChannelGateway } from "./channel.gateway"
import type { ChannelService } from "./channel.service"

function nextJsonMessage(ws: WebSocket, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS message")), timeoutMs)
    ws.once("message", (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(raw.toString("utf8")) as Record<string, unknown>)
    })
  })
}

function waitClose(ws: WebSocket, timeoutMs = 2000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS close")), timeoutMs)
    ws.once("close", (code, reason) => {
      clearTimeout(timer)
      resolve({ code, reason: reason.toString("utf8") })
    })
  })
}

describe("ChannelGateway", () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!()
    }
  })

  async function startGateway(overrides: Partial<ReturnType<typeof loadChannelConfig>> = {}) {
    const config = { ...loadChannelConfig({}), ...overrides }
    const hub = new ChannelHub(config)
    const service = {
      hub,
      authenticateWsCredential: vi.fn(),
      loadRetainedItems: vi.fn().mockResolvedValue([
        { event: "scene.current", payload: { scene: "hero" }, seq: 5, updatedAt: "2026-11-25T08:00:00.000Z" },
      ]),
      publishFromWs: vi.fn(async (input) => {
        const res = hub.publishEvent({
          channelId: input.channelId,
          event: input.event,
          payload: input.payload,
          retain: input.retain,
          echo: input.echo,
          targetClientId: input.targetClientId,
          sender: input.sender,
        })
        return { ...res, retained: input.retain }
      }),
      clearRetainedDirect: vi.fn().mockResolvedValue({ deleted: true }),
    } as unknown as ChannelService

    const gateway = new ChannelGateway(service)
    const server: HttpServer = createServer((_req, res) => {
      res.statusCode = 404
      res.end()
    })
    gateway.attach(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0

    cleanups.push(async () => {
      gateway.onApplicationShutdown()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    return {
      gateway,
      hub,
      service,
      wsUrl: (channelId: string, query = "") => `ws://127.0.0.1:${port}/api/open/v1/channels/${channelId}/ws${query}`,
    }
  }

  it("rejects upgrade requests carrying credentials in URL query parameters", async () => {
    const { wsUrl, service } = await startGateway()

    for (const query of ["?token=syc_secret", "?access_token=syc_secret", "?api_key=syn_sk_secret"]) {
      const ws = new WebSocket(wsUrl("ch_1", query))
      const err = await new Promise<Error>((resolve) => {
        ws.once("error", (e) => resolve(e))
      })
      expect(err.message).toMatch(/400/u)
      expect(service.authenticateWsCredential).not.toHaveBeenCalled()
    }
  })

  it("closes unauthenticated connections with 4001 after auth timeout", async () => {
    const { wsUrl } = await startGateway({ authTimeoutMs: 80 })
    const ws = new WebSocket(wsUrl("ch_1"))
    const closed = await waitClose(ws)
    expect(closed.code).toBe(CHANNEL_WS_CLOSE_CODES.AUTH_FAILED)
  })

  it("supports first-frame auth, publish/ack, retained.clear, presence.update, ping/pong, and publish-only retained hiding", async () => {
    const { wsUrl, service } = await startGateway()
    vi.mocked(service.authenticateWsCredential).mockImplementation(async (token, channelId) => {
      if (token === "syc_screen") {
        return { channelId, ownerId: "u1", credentialType: "channel_token", credentialId: "t_sub", role: "subscribe", isObserver: false, seqFloor: 5 }
      }
      if (token === "syc_remote") {
        return { channelId, ownerId: "u1", credentialType: "channel_token", credentialId: "t_pub", role: "publish", isObserver: false, seqFloor: 5 }
      }
      return null
    })

    const screen = new WebSocket(wsUrl("ch_1"))
    await new Promise<void>((resolve) => screen.once("open", () => resolve()))
    screen.send(JSON.stringify({ type: "auth", token: "syc_screen", clientId: "screen-1", clientName: "大屏" }))
    const screenReady = await nextJsonMessage(screen)
    expect(screenReady).toMatchObject({
      type: "ready",
      channelId: "ch_1",
      clientId: "screen-1",
      role: "subscribe",
      retained: [{ event: "scene.current", payload: { scene: "hero" }, seq: 5 }],
    })

    // subscribe client cannot publish
    screen.send(JSON.stringify({ type: "publish", id: "bad-1", event: "slide.next", payload: 1 }))
    const forbiddenErr = await nextJsonMessage(screen)
    expect(forbiddenErr).toMatchObject({ type: "error", id: "bad-1", code: "FORBIDDEN_ROLE" })

    // publish-only remote connects via first-frame auth -> does NOT receive retained
    const remote = new WebSocket(wsUrl("ch_1"))
    await new Promise<void>((resolve) => remote.once("open", () => resolve()))
    const screenJoinPromise = nextJsonMessage(screen)
    remote.send(JSON.stringify({ type: "auth", token: "syc_remote", clientId: "remote-1", clientName: "遥控器" }))
    const remoteReady = await nextJsonMessage(remote)
    expect(remoteReady.type).toBe("ready")
    expect(remoteReady.retained).toBeUndefined()
    expect((remoteReady.presence as unknown[]).length).toBe(2)
    expect((await screenJoinPromise).type).toBe("presence.join")

    // remote publishes event -> screen receives event, remote receives ack
    const screenEventPromise = nextJsonMessage(screen)
    const remoteAckPromise = nextJsonMessage(remote)
    remote.send(JSON.stringify({ type: "publish", id: "p-1", event: "slide.next", payload: { step: 1 } }))
    expect(await screenEventPromise).toMatchObject({ type: "event", event: "slide.next", payload: { step: 1 } })
    expect(await remoteAckPromise).toMatchObject({ type: "ack", id: "p-1", deliveredCount: 1, retained: false })

    // remote clears retained silently -> receives ack
    remote.send(JSON.stringify({ type: "retained.clear", id: "c-1", event: "scene.current" }))
    expect(await nextJsonMessage(remote)).toMatchObject({ type: "ack", id: "c-1", deleted: true })

    // presence.update & ping/pong
    const screenUpdatePromise = nextJsonMessage(screen)
    const remoteUpdatePromise = nextJsonMessage(remote)
    remote.send(JSON.stringify({ type: "presence.update", clientName: "客厅遥控器", meta: { page: 2 } }))
    expect(await screenUpdatePromise).toMatchObject({ type: "presence.update", member: { clientName: "客厅遥控器", meta: { page: 2 } } })
    expect(await remoteUpdatePromise).toMatchObject({ type: "presence.update", member: { clientName: "客厅遥控器", meta: { page: 2 } } })

    remote.send(JSON.stringify({ type: "ping" }))
    expect((await nextJsonMessage(remote)).type).toBe("pong")

    screen.close()
    remote.close()
  })

  it("authenticates backend Upgrade Authorization Bearer header immediately and closes with 1001 on shutdown", async () => {
    const { wsUrl, service, gateway } = await startGateway()
    vi.mocked(service.authenticateWsCredential).mockResolvedValueOnce({
      channelId: "ch_1",
      ownerId: "u1",
      credentialType: "api_key",
      credentialId: "k1",
      role: "pubsub",
      isObserver: false,
      seqFloor: 0,
    })

    const backend = new WebSocket(wsUrl("ch_1"), {
      headers: {
        Authorization: "Bearer syn_sk_backend",
        Cookie: "__Host-synapse_session=ignored",
      },
    })
    const ready = await nextJsonMessage(backend)
    expect(ready).toMatchObject({ type: "ready", channelId: "ch_1", role: "pubsub" })
    expect(service.authenticateWsCredential).toHaveBeenCalledWith("syn_sk_backend", "ch_1")

    const closePromise = waitClose(backend)
    gateway.onApplicationShutdown()
    expect((await closePromise).code).toBe(CHANNEL_WS_CLOSE_CODES.GOING_AWAY)
  })
})
