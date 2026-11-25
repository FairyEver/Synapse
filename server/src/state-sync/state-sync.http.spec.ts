import "reflect-metadata"
import { describe, expect, it, vi } from "vitest"
import {
  StateSyncExceptionFilter,
  StateSyncGuard,
  StateSyncHttpError,
  isStateSyncOpenPath,
  isStateSyncPath,
  registerStateSyncBodyErrors,
  registerStateSyncIngress,
  stateSyncCors,
  stateSyncLogRequest,
} from "./state-sync-http"
import { StateSyncController } from "./state-sync.controller"
import type { StateSyncService } from "./state-sync.service"

describe("state-sync-http", () => {
  it("recognizes Open and Console state-sync paths and configures CORS without credentials", () => {
    expect(isStateSyncOpenPath("/api/open/v1/state-sync")).toBe(true)
    expect(isStateSyncOpenPath("/api/open/v1/state-sync/spaces/ss_1/docs/ssd_1?path=/board")).toBe(true)
    expect(isStateSyncOpenPath("/api/console/state-sync/preflight")).toBe(false)
    expect(isStateSyncPath("/api/console/state-sync/spaces/ss_1")).toBe(true)
    expect(isStateSyncPath("/api/health")).toBe(false)

    const cors = stateSyncCors("/api/open/v1/state-sync/spaces/ss_1/docs")
    expect(cors).toEqual({
      origin: "*",
      credentials: false,
      allowedHeaders: ["Authorization", "Content-Type"],
      exposedHeaders: ["X-Request-Id", "Retry-After"],
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    })
    expect(stateSyncCors("/api/console/state-sync/spaces")).toBeNull()
  })

  it("redacts sensitive state-sync URLs in Pino request serializer", () => {
    expect(stateSyncLogRequest({ method: "PATCH", originalUrl: "/api/open/v1/state-sync/spaces/ss_secret/docs/ssd_1?path=/a" }))
      .toEqual({ method: "PATCH", url: "/api/open/v1/state-sync" })
    expect(stateSyncLogRequest({ method: "GET", originalUrl: "/api/console/state-sync/spaces/ss_secret" }))
      .toEqual({ method: "GET", url: "/api/console/state-sync" })
    expect(stateSyncLogRequest({ method: "GET", originalUrl: "/api/health" })).toBeNull()
  })

  it("strictly ignores cookies and normal SY login JWTs on Open API paths while allowing valid Bearer credentials", async () => {
    const service = {
      authenticateOpenCredential: vi.fn().mockResolvedValue(null),
    } as unknown as StateSyncService
    const userAuth = {
      canActivate: vi.fn().mockResolvedValue(true),
    }
    const guard = new StateSyncGuard(service, userAuth as never)

    // 1. Cookie-only request on Open API -> 401 without ever calling UserAuthGuard
    const openReqCookie = {
      path: "/api/open/v1/state-sync/spaces/ss_1/docs/ssd_1",
      params: { spaceId: "ss_1" },
      headers: { cookie: "__Host-synapse_session=valid_user_session" },
    }
    const ctxCookie = { switchToHttp: () => ({ getRequest: () => openReqCookie }) }
    await expect(guard.canActivate(ctxCookie as never)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIAL",
    })
    expect(userAuth.canActivate).not.toHaveBeenCalled()

    // 2. Normal SY login JWT in Authorization header -> rejected (authenticateOpenCredential returns null)
    const openReqJwt = {
      path: "/api/open/v1/state-sync/spaces/ss_1/docs/ssd_1",
      params: { spaceId: "ss_1" },
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MSJ9.sig" },
    }
    const ctxJwt = { switchToHttp: () => ({ getRequest: () => openReqJwt }) }
    await expect(guard.canActivate(ctxJwt as never)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_CREDENTIAL",
    })
    expect(userAuth.canActivate).not.toHaveBeenCalled()

    // 3. Valid space token Bearer -> succeeds and attaches stateSyncActor
    const openReqToken = {
      path: "/api/open/v1/state-sync/spaces/ss_1/docs/ssd_1",
      params: { spaceId: "ss_1" },
      headers: { authorization: "Bearer sys_" + "a".repeat(43) },
    }
    vi.mocked(service.authenticateOpenCredential).mockResolvedValueOnce({
      kind: "space_token",
      spaceId: "ss_1",
      ownerId: "u1",
      tokenId: "sst_1",
      role: "write",
    })
    const ctxToken = { switchToHttp: () => ({ getRequest: () => openReqToken }) }
    await expect(guard.canActivate(ctxToken as never)).resolves.toBe(true)
    expect((openReqToken as Record<string, unknown>).stateSyncActor).toMatchObject({
      kind: "space_token",
      spaceId: "ss_1",
      tokenId: "sst_1",
      role: "write",
    })

    // 4. Console path delegates to UserAuthGuard and sets console actor
    const consoleReq = {
      path: "/api/console/state-sync/preflight",
      params: {},
      headers: {},
      user: { id: "u1" },
    }
    const ctxConsole = { switchToHttp: () => ({ getRequest: () => consoleReq }) }
    await expect(guard.canActivate(ctxConsole as never)).resolves.toBe(true)
    expect(userAuth.canActivate).toHaveBeenCalledTimes(1)
    expect((consoleReq as Record<string, unknown>).stateSyncActor).toEqual({ kind: "console", userId: "u1" })
  })

  it("enforces 256 KiB pre/post body limits with CORS headers, formats JSON errors, and skips global Throttler", () => {
    const middlewares: Array<(...args: unknown[]) => void> = []
    const app = { use: (fn: (...args: unknown[]) => void) => middlewares.push(fn) }
    registerStateSyncIngress(app as never)
    registerStateSyncBodyErrors(app as never)

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

    // 1. Pre-parse ingress allows 200 KiB (within 256 KiB cap)
    const resAllowed = makeRes()
    const nextAllowed = vi.fn()
    middlewares[0]!(
      { path: "/api/open/v1/state-sync/spaces/ss_1/docs", headers: { "content-length": "204800" } },
      resAllowed,
      nextAllowed,
    )
    expect(nextAllowed).toHaveBeenCalledTimes(1)
    expect(resAllowed.headers["Access-Control-Allow-Origin"]).toBe("*")

    // 2. Pre-parse ingress rejects > 256 KiB Content-Length with structured envelope and CORS headers
    const resTooLarge = makeRes()
    const nextTooLarge = vi.fn()
    middlewares[0]!(
      { path: "/api/open/v1/state-sync/spaces/ss_1/docs", headers: { "content-length": String(262144 + 1) } },
      resTooLarge,
      nextTooLarge,
    )
    expect(nextTooLarge).not.toHaveBeenCalled()
    expect(resTooLarge.statusCode).toBe(413)
    expect(resTooLarge.headers["Access-Control-Allow-Origin"]).toBe("*")
    expect(resTooLarge.headers["Cache-Control"]).toBe("no-store")
    expect(resTooLarge.headers["X-Request-Id"]).toMatch(/^req_/u)
    expect(resTooLarge.payload).toMatchObject({
      requestId: resTooLarge.headers["X-Request-Id"],
      error: { code: "REQUEST_TOO_LARGE" },
    })

    // 3. Post-parse rejects chunked body > 256 KiB
    const resChunked = makeRes()
    const nextChunked = vi.fn()
    middlewares[1]!(
      { path: "/api/open/v1/state-sync/spaces/ss_1/docs/ssd_1", headers: {}, body: { value: "x".repeat(270000) } },
      resChunked,
      nextChunked,
    )
    expect(nextChunked).not.toHaveBeenCalled()
    expect(resChunked.statusCode).toBe(413)
    expect(resChunked.payload).toMatchObject({ error: { code: "REQUEST_TOO_LARGE" } })

    // 4. Error middleware formats malformed JSON as 400 INVALID_REQUEST
    const resBadJson = makeRes()
    const nextBadJson = vi.fn()
    middlewares[2]!(
      { status: 400 },
      { path: "/api/open/v1/state-sync/spaces/ss_1/docs/ssd_1", headers: {} },
      resBadJson,
      nextBadJson,
    )
    expect(resBadJson.statusCode).toBe(400)
    expect(resBadJson.payload).toMatchObject({ error: { code: "INVALID_REQUEST" } })

    // 5. StateSyncController skips global ThrottlerGuard
    expect(Reflect.getMetadata("THROTTLER:SKIPdefault", StateSyncController)).toBe(true)
  })

  it("serializes StateSyncHttpError currentRev and Retry-After via StateSyncExceptionFilter", () => {
    const filter = new StateSyncExceptionFilter()
    const headers: Record<string, string> = {}
    let statusCode = 200
    let body: unknown
    const req = { headers: {} }
    const res = {
      headersSent: false,
      setHeader: (k: string, v: string) => { headers[k] = v },
      status: (code: number) => ({ json: (payload: unknown) => { statusCode = code; body = payload } }),
    }
    const host = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    }

    filter.catch(
      new StateSyncHttpError(409, "REV_CONFLICT", "文档版本已更新，请重试。", { currentRev: 12 }),
      host as never,
    )
    expect(statusCode).toBe(409)
    expect(headers["Cache-Control"]).toBe("no-store")
    expect(headers["X-Request-Id"]).toMatch(/^req_/u)
    expect(body).toEqual({
      requestId: headers["X-Request-Id"],
      error: {
        code: "REV_CONFLICT",
        message: "文档版本已更新，请重试。",
        currentRev: 12,
      },
    })

    // Rate limit includes Retry-After
    filter.catch(
      new StateSyncHttpError(429, "RATE_LIMITED", "频率超限", { retryAfterSec: 4 }),
      host as never,
    )
    expect(statusCode).toBe(429)
    expect(headers["Retry-After"]).toBe("4")
  })
})
