import "reflect-metadata"
import { describe, expect, it, vi } from "vitest"
import { channelCors, ChannelGuard, channelLogRequest, isChannelOpenPath, isChannelPath, registerChannelBodyErrors, registerChannelIngress } from "./channel-http"
import { ChannelController } from "./channel.controller"
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

  it("enforces 128 KiB pre/post body limits, formats JSON parse errors, and skips global Throttler on ChannelController", () => {
    const middlewares: Array<(...args: unknown[]) => void> = []
    const app = { use: (fn: (...args: unknown[]) => void) => middlewares.push(fn) }
    registerChannelIngress(app as never)
    registerChannelBodyErrors(app as never)

    const makeRes = () => {
      const headers: Record<string, string> = {}
      let statusCode = 200
      let payload: unknown
      return {
        headers,
        get statusCode() { return statusCode },
        get payload() { return payload },
        setHeader: (k: string, v: string) => { headers[k] = v },
        status: (code: number) => ({ json: (body: unknown) => { statusCode = code; payload = body } }),
      }
    }

    // 1. Pre-parse ingress rejects > 128 KiB Content-Length
    const res1 = makeRes()
    const next1 = vi.fn()
    middlewares[0]!({ path: "/api/open/v1/channels/ch_1/events", headers: { "content-length": "200000" } }, res1, next1)
    expect(next1).not.toHaveBeenCalled()
    expect(res1.statusCode).toBe(413)
    expect(res1.payload).toMatchObject({ error: { code: "REQUEST_TOO_LARGE" } })

    // 2. Post-parse rejects chunked body > 128 KiB
    const res2 = makeRes()
    const next2 = vi.fn()
    middlewares[1]!({ path: "/api/open/v1/channels/ch_1/events", headers: {}, body: { data: "x".repeat(140000) } }, res2, next2)
    expect(next2).not.toHaveBeenCalled()
    expect(res2.statusCode).toBe(413)

    // 3. Error middleware formats malformed JSON as 400 INVALID_REQUEST
    const res3 = makeRes()
    const next3 = vi.fn()
    middlewares[2]!({ status: 400 }, { path: "/api/open/v1/channels/ch_1/events", headers: {} }, res3, next3)
    expect(res3.statusCode).toBe(400)
    expect(res3.payload).toMatchObject({ error: { code: "INVALID_REQUEST" } })

    // 4. ChannelController skips global ThrottlerGuard
    expect(Reflect.getMetadata("THROTTLER:SKIPdefault", ChannelController)).toBe(true)
  })
})
