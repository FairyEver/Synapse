import { describe, expect, it, vi } from "vitest"
import { channelCors, ChannelGuard, channelLogRequest, isChannelOpenPath, isChannelPath } from "./channel-http"
import type { ChannelService } from "./channel.service"

describe("channel-http", () => {
  it("recognizes Open and Console channel paths and builds CORS without Idempotency-Key", () => {
    expect(isChannelOpenPath("/api/open/v1/channels")).toBe(true)
    expect(isChannelOpenPath("/api/open/v1/channels/ch_1/events?foo=1")).toBe(true)
    expect(isChannelOpenPath("/api/console/channels")).toBe(false)
    expect(isChannelPath("/api/console/channels/ch_1")).toBe(true)

    const cors = channelCors("/api/open/v1/channels/ch_1/events")
    expect(cors).toEqual({
      origin: "*",
      credentials: false,
      allowedHeaders: ["Authorization", "Content-Type"],
      exposedHeaders: ["X-Request-Id", "Retry-After"],
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    })
    expect(channelCors("/api/console/channels")).toBeNull()
  })

  it("redacts sensitive channel URLs in Pino request serializer", () => {
    expect(channelLogRequest({ method: "POST", originalUrl: "/api/open/v1/channels/ch_secret/events?x=1" }))
      .toEqual({ method: "POST", url: "/api/open/v1/channels" })
    expect(channelLogRequest({ method: "GET", originalUrl: "/api/console/channels/ch_secret" }))
      .toEqual({ method: "GET", url: "/api/console/channels" })
    expect(channelLogRequest({ method: "GET", originalUrl: "/api/health" })).toBeNull()
  })

  it("ignores cookies on Open API paths and requires a valid Bearer credential", async () => {
    const service = {
      authenticateOpenBearer: vi.fn().mockResolvedValue(null),
    } as unknown as ChannelService
    const userAuth = {
      canActivate: vi.fn().mockResolvedValue(true),
    }
    const guard = new ChannelGuard(service, userAuth as never)

    const openReqWithCookie = {
      path: "/api/open/v1/channels/ch_1/events",
      params: { channelId: "ch_1" },
      headers: { cookie: "__Host-synapse_session=valid_user_session" },
    }
    const ctx = { switchToHttp: () => ({ getRequest: () => openReqWithCookie }) }

    await expect(guard.canActivate(ctx as never)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIAL",
    })
    expect(userAuth.canActivate).not.toHaveBeenCalled()

    // Valid Bearer succeeds
    const openReqBearer = {
      path: "/api/open/v1/channels/ch_1/events",
      params: { channelId: "ch_1" },
      headers: { authorization: "Bearer syc_valid" },
    }
    vi.mocked(service.authenticateOpenBearer).mockResolvedValueOnce({
      kind: "channel_token",
      channelId: "ch_1",
      ownerId: "u1",
      tokenId: "cht_1",
      role: "publish",
    })
    const ctxBearer = { switchToHttp: () => ({ getRequest: () => openReqBearer }) }
    await expect(guard.canActivate(ctxBearer as never)).resolves.toBe(true)
    expect((openReqBearer as Record<string, unknown>).channelActor).toMatchObject({ kind: "channel_token", tokenId: "cht_1" })

    // Console path uses UserAuthGuard
    const consoleReq = {
      path: "/api/console/channels",
      params: {},
      headers: {},
      user: { id: "u1" },
    }
    const ctxConsole = { switchToHttp: () => ({ getRequest: () => consoleReq }) }
    await expect(guard.canActivate(ctxConsole as never)).resolves.toBe(true)
    expect(userAuth.canActivate).toHaveBeenCalledTimes(1)
    expect((consoleReq as Record<string, unknown>).channelActor).toEqual({ kind: "console", userId: "u1" })
  })
})
