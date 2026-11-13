import "reflect-metadata"
import { describe, expect, it } from "vitest"
import { EventEmitter } from "node:events"
import { cloudTableCors, CloudTableGuard, isCloudTableOpenPath, registerCloudTableIngress } from "./cloud-table-http"
import { ApiKeyService } from "../api-keys/api-key.service"
import { createApiKeySecret } from "../api-keys/api-key-token"
import { CloudTableController } from "./cloud-table.controller"

describe("cloud table route identity", () => {
  it.each(["gzip", "deflate", "br"])("reserves the decompressed body budget for %s", encoding => {
    let middleware!: (req: any, res: any, next: () => void) => void
    const app = { get: () => ({ db: { config: { globalQueue: 128, bytes: 1048576 } } }), use: (handler: typeof middleware) => { middleware = handler } }
    registerCloudTableIngress(app as never)
    function response() { return Object.assign(new EventEmitter(), { code: 200, setHeader: () => undefined, status(code: number) { this.code = code; return this }, json: () => undefined }) }
    const req = { path: "/api/open/v1/tables", method: "POST", headers: { "content-length": "1027", "content-encoding": encoding } }
    const first = response(), second = response()
    let admitted = 0
    middleware(req, first, () => { admitted++ }); middleware(req, second, () => { admitted++ })
    expect(admitted).toBe(1)
    expect(second.code).toBe(503)
    first.emit("close")
    middleware(req, response(), () => { admitted++ })
    expect(admitted).toBe(2)
  })
  it("passes an already disconnected response to the service as canceled", async () => {
    let signal!: AbortSignal
    const service = { execute: async (_actor: unknown, _id: unknown, _op: unknown, _body: unknown, context: { signal: AbortSignal }) => { signal = context.signal } }
    const controller = new CloudTableController(service as never)
    const req = { cloudActor: { console: true, userId: "owner" }, headers: {} }
    const res = Object.assign(new EventEmitter(), { destroyed: true, writableEnded: false, setHeader: () => undefined })
    await controller.create(req as never, res as never, { name: "canceled" })
    expect(signal.aborted).toBe(true)
    expect(res.listenerCount("close")).toBe(0)
  })
  it("reserves the body budget for chunked GET requests before parsing", () => {
    let middleware!: (req: any, res: any, next: () => void) => void
    const app = { get: () => ({ db: { config: { globalQueue: 128, bytes: 1048576 } } }), use: (handler: typeof middleware) => { middleware = handler } }
    registerCloudTableIngress(app as never)
    function response() { return Object.assign(new EventEmitter(), { code: 200, body: null as unknown, setHeader: () => undefined, status(code: number) { this.code = code; return this }, json(value: unknown) { this.body = value } }) }
    const req = { path: "/api/open/v1/tables", method: "GET", headers: { "transfer-encoding": "chunked" } }
    const first = response(), second = response()
    let admitted = 0
    middleware(req, first, () => { admitted++ }); middleware(req, second, () => { admitted++ })
    expect(admitted).toBe(1)
    expect(second.code).toBe(503)
    expect(second.body).toMatchObject({ error: { code: "QUEUE_BYTES_FULL" } })
    first.emit("finish")
  })
  it("verifies open API keys through the cloud-table transaction client instead of the core pool", async () => {
    const tx = { userApiKey: { findUnique: async () => ({ id: "key", userId: "owner", scopes: ["tables.records.read"], revokedAt: null, user: { status: "active" } }) } }
    const core = { userApiKey: { findUnique: async () => { throw new Error("core pool must not be used") } } }
    const service = { routingOwner: () => "owner", authentication: { runScoped: (_scope: { owner: string; key: string }, _bytes: number, work: () => unknown) => work() }, db: { transaction: (work: (client: typeof tx) => unknown) => work(tx) } }
    const guard = new CloudTableGuard(service as never, new ApiKeyService(core as never, {} as never), {} as never)
    const request = { path: "/api/open/v1/tables/table", params: { id: "table" }, headers: { authorization: `Bearer ${createApiKeySecret()}` } }
    const context = { switchToHttp: () => ({ getRequest: () => request }) }
    await expect(guard.canActivate(context as never)).resolves.toBe(true)
    expect(request).toHaveProperty("cloudActor", { userId: "owner", apiKeyId: "key", console: false })
  })
  it.each(["/API/OPEN/V1/TABLES", "/api/open/v1/TABLES/table/records/query", "/Api/Open/v1/Tables/table?cursor=x"])("treats Express-matched public path %s as open API", path => {
    expect(isCloudTableOpenPath(path)).toBe(true)
    expect(cloudTableCors(path)).toMatchObject({ origin: "*", credentials: false })
  })
  it.each(["/api/console/tables", "/api/open/v1/tables-extra", "/api/open/v1/other"])("keeps unrelated path %s outside open tables", path => {
    expect(isCloudTableOpenPath(path)).toBe(false)
    expect(cloudTableCors(path)).toBeNull()
  })
})
