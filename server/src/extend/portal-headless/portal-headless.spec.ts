import { beforeAll, describe, expect, it, vi } from "vitest"
import { JwtService } from "@nestjs/jwt"
import { Logger } from "@nestjs/common"
import { PortalHeadlessAccessService } from "./access.service"
import { PortalHeadlessService, normalizePortalError, type PortalSdk } from "./portal-headless.service"
import { parseInput, readParameters } from "./contract"
import { PortalHeadlessController } from "./portal-headless.controller"

vi.mock("../../config/env", () => ({ loadEnv: () => ({ userAccessJwtSecret: "synthetic-sy-test-secret-not-real" }) }))
let sdk: PortalSdk
beforeAll(async () => { sdk = await import("portal-headless") })
const identity = { owner: "owner-one", credential: { token: "portal-canary", tenantId: "tenant-one", language: "zh-CN" as const } }
function fixture(options: { error?: unknown; menuFailure?: boolean } = {}) {
  const calls: Array<{ token: string; tenantId: string; request: Record<string, unknown> }> = []
  const runtimes: ReturnType<PortalSdk["createPortalServer"]>[] = []
  const loader = async () => ({ ...sdk,
    createPortalServer: (config: Parameters<PortalSdk["createPortalServer"]>[0]) => {
      const runtime = sdk.createPortalServer(config); runtimes.push(runtime); return runtime
    },
    createPortalRequestFactory: () => (context: { credential: { token: string; tenantId: string } }) => async (request: Record<string, unknown>) => {
      calls.push({ ...context.credential, request })
      if (options.error) throw options.error
      const url = String(request.url)
      if (url.endsWith("/sys/user/info")) return { id: "portal-user", realName: "测试用户", password2: "private-canary", salt: "salt-canary" }
      if (url.endsWith("getUserTenantsByPage")) return { list: [{ id: context.credential.tenantId }], total: 1 }
      if (url.endsWith("/sys/menu/nav")) {
        if (options.menuFailure) throw new Error("menu secret-canary")
        return [{ id: "menu", name: "个人年度", permissions: "/dashboard/year-agreement/main", url: "/dashboard/year-agreement/main", children: [] }]
      }
      if (url.endsWith("/meeting-room-usage")) return { meetingRooms: [{ meetingRoomId: "room", meetingRoomName: "会议室", timeSlots: [] }] }
      if (url.endsWith("/kpiyearprotocol/page")) return { list: [{ id: "agreement", year: 2026, status: "1" }], total: 1 }
      if (url.endsWith("/dict-data/grouped-list")) return [{ dictType: "protocol_status", dataList: [{ label: "已签订", value: "1" }] }]
      throw new Error(`Unexpected synthetic request: ${url}`)
    },
  }) as unknown as PortalSdk
  return { service: new PortalHeadlessService(loader), calls, runtimes }
}

describe("Portal Headless backend extension", () => {
  it("loads the packaged SDK, validates identity and returns only safe context", async () => {
    const { service, calls, runtimes } = fixture()
    const result = await service.run(identity, { op: "context" })
    expect(result).toMatchObject({ protocolVersion: 1, data: { portalUser: { id: "portal-user", name: "测试用户" }, tenantId: "tenant-one" } })
    expect(JSON.stringify(result)).not.toMatch(/private-canary|salt-canary|portal-canary/)
    expect(calls.some((call) => String(call.request.url).endsWith("getUserTenantsByPage"))).toBe(true)
    expect(calls.every((call) => call.request.maxRedirects === 0 && call.request.timeout === 10_000 && call.request.signal instanceof AbortSignal)).toBe(true)
    expect(runtimes).toHaveLength(1)
    expect(calls.every((call) => (call.request.signal as AbortSignal).aborted)).toBe(true)
  })
  it("uses real SDK discovery/contract/invoke for the same read capability", async () => {
    const { service } = fixture()
    const discovery = await service.run(identity, { op: "catalog", input: { op: "recommend", query: "查今天会议室预定" } })
    expect(JSON.stringify(discovery.data)).toContain("meeting-room-usage")
    const description = await service.run(identity, { op: "describe", input: { kind: "capability", capabilityId: "meeting-room-usage" } })
    expect(description.data).toMatchObject({ write: false, extensionInputSchema: { additionalProperties: false } })
    const result = await service.run(identity, { op: "read", input: { capabilityId: "meeting-room-usage", arguments: { date: "2026-09-22" } } })
    expect(result.data).toMatchObject({ result: { meetingRooms: [{ meetingRoomId: "room" }] } })
  })
  it("rejects write capabilities, guessed parameters and method paths", async () => {
    const { service, calls } = fixture()
    await expect(service.run(identity, { op: "read", input: { capabilityId: "meeting-application-submit", arguments: {} } })).rejects.toThrow("当前扩展目录")
    await expect(service.run(identity, { op: "read", input: { capabilityId: "meeting-room-usage", arguments: { readOnly: true, url: "https://evil.invalid" } } })).rejects.toThrow("参数无效")
    await expect(service.run(identity, { op: "describe", input: { kind: "method", capabilityId: "meeting-room-usage", id: "__proto__" } })).rejects.toThrow("引用")
    expect(calls.every((call) => !String(call.request.url).includes("submit"))).toBe(true)
    expect(() => parseInput(readParameters["perf-year-agreement-list"], { year: 2026 })).toThrow()
    expect(() => parseInput(readParameters["meeting-room-usage"], { date: "2026-02-30" })).toThrow()
  })
  it("invokes the personal yearly list with pagination and only the allowed status dictionary", async () => {
    const { service, calls } = fixture()
    const yearly = await service.run(identity, { op: "read", input: { capabilityId: "perf-year-agreement-list", arguments: { pageNo: 2, pageSize: 10 } } })
    expect(yearly.data).toMatchObject({ result: { list: [{ year: 2026 }], total: 1 } })
    expect(calls.find((call) => String(call.request.url).endsWith("/kpiyearprotocol/page"))?.request.params)
      .toMatchObject({ pageNo: 2, pageSize: 10 })
    const dict = await service.run(identity, { op: "read", input: { capabilityId: "base-dict-get", arguments: { dictType: "protocol_status" } } })
    expect(dict.data).toMatchObject({ result: { dictType: "protocol_status", entries: [{ label: "已签订", value: "1" }] } })
    await expect(service.run(identity, { op: "read", input: { capabilityId: "base-dict-get", arguments: { dictType: "other" } } })).rejects.toThrow("参数无效")
  })
  it("isolates credentials for concurrent owners and tenants", async () => {
    const { service, calls } = fixture()
    await Promise.all([
      service.run(identity, { op: "context" }),
      service.run({ owner: "owner-two", credential: { ...identity.credential, tenantId: "tenant-two", token: "other-canary" } }, { op: "context" }),
    ])
    expect(calls.every((call) => call.token === "portal-canary" ? call.tenantId === "tenant-one" : call.token === "other-canary" && call.tenantId === "tenant-two")).toBe(true)
  })
  it("fails closed on menu errors and strips SDK error details", async () => {
    const { service } = fixture({ menuFailure: true })
    await expect(service.run(identity, { op: "catalog", input: { op: "domains", offset: 0, limit: 20 } })).rejects.toThrow("菜单目录不可用")
    const failed = fixture({ error: Object.assign(new Error("token=leak-canary"), { code: 401 }) })
    await expect(failed.service.run(identity, { op: "context" })).rejects.toMatchObject({ response: { code: "PORTAL_CREDENTIAL_INVALID" } })
    expect(JSON.stringify(normalizePortalError(new Error("secret-canary")).getResponse())).not.toContain("secret-canary")
    expect(normalizePortalError({ response: { status: 403 } }).getStatus()).toBe(403)
    expect(normalizePortalError({ code: "ECONNABORTED" }).getStatus()).toBe(504)
  })
  it("replaces SDK diagnostics with structured events without upstream secret messages", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)
    try {
      const service = new PortalHeadlessService(async () => ({ ...sdk, createPortalServer(config) {
        config?.sessionOptions?.logger?.warn("token=log-canary", { error: "log-canary" })
        config?.sessionOptions?.logger?.error("token=log-canary", { error: "log-canary" })
        throw new Error("log-canary")
      } }))
      await expect(service.run(identity, { op: "context" })).rejects.toThrow("Portal 查询失败")
      expect(warn).toHaveBeenCalledWith({ event: "portal.session.degraded" })
      expect(error).toHaveBeenCalledWith({ event: "portal.session.failed" })
      expect(JSON.stringify([warn.mock.calls, error.mock.calls])).not.toContain("log-canary")
    } finally { warn.mockRestore(); error.mockRestore() }
  })
})

describe("SY extension authorization", () => {
  function auth() {
    const prisma = { user: { findUnique: vi.fn(async () => ({ status: "active", passwordChangedAt: null })) } }
    return { service: new PortalHeadlessAccessService(prisma as never), prisma }
  }
  it("issues a five-minute extension-only token for the authenticated SY owner", async () => {
    const { service } = auth()
    const grant = service.issue("owner-one")
    expect(await service.verify(`Bearer ${grant.accessToken}`)).toBe("owner-one")
    expect(Date.parse(grant.expiresAt) - Date.now()).toBeGreaterThan(298_000)
    const normalJwt = new JwtService({ secret: "synthetic-sy-test-secret-not-real" })
    expect(() => normalJwt.verify(grant.accessToken)).toThrow()
    const normalToken = normalJwt.sign({ sub: "owner-one", email: "person@example.invalid" })
    await expect(service.verify(`Bearer ${normalToken}`)).rejects.toThrow("扩展授权")
  })
  it("rejects missing, tampered, expired or disabled-user grants", async () => {
    const { service, prisma } = auth()
    await expect(service.verify(undefined)).rejects.toThrow("扩展授权")
    const grant = service.issue("owner-one")
    await expect(service.verify(`Bearer ${grant.accessToken}broken`)).rejects.toThrow("扩展授权")
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000)
    try { await expect(service.verify(`Bearer ${grant.accessToken}`)).rejects.toThrow("扩展授权") } finally { clock.mockRestore() }
    prisma.user.findUnique.mockResolvedValue({ status: "disabled", passwordChangedAt: null })
    await expect(service.verify(`Bearer ${grant.accessToken}`)).rejects.toThrow("账号不可用")
  })
  it("requires both identities on every business endpoint before invoking the SDK", async () => {
    const { service: access } = auth()
    const { service: portal, calls } = fixture()
    const controller = new PortalHeadlessController(access, portal)
    const headers = { authorization: `Bearer ${access.issue(identity.owner).accessToken}`,
      "x-portal-token": identity.credential.token, "x-portal-tenant-id": identity.credential.tenantId }
    const operations = [
      (h: typeof headers) => controller.context(h, {}),
      (h: typeof headers) => controller.catalog(h, { op: "domains" }),
      (h: typeof headers) => controller.describe(h, { kind: "capability", capabilityId: "meeting-room-usage" }),
      (h: typeof headers) => controller.read(h, { capabilityId: "meeting-room-usage" }),
    ]
    for (const operation of operations) {
      await expect(operation({ ...headers, authorization: "" })).rejects.toMatchObject({ status: 401 })
      await expect(operation({ ...headers, "x-portal-token": "" })).rejects.toMatchObject({ status: 400 })
      await expect(operation({ ...headers, "x-portal-tenant-id": "" })).rejects.toMatchObject({ status: 400 })
    }
    expect(calls).toHaveLength(0)
    await expect(controller.context(headers, {})).resolves.toMatchObject({ data: { portalUser: { id: "portal-user" } } })
    const invalid = fixture({ error: Object.assign(new Error("invalid-portal-canary"), { code: 401 }) })
    await expect(new PortalHeadlessController(access, invalid.service).context(headers, {}))
      .rejects.toMatchObject({ status: 401, response: { code: "PORTAL_CREDENTIAL_INVALID" } })
  })
  it("revokes existing grants after a SY password change", async () => {
    const { service, prisma } = auth()
    const grant = service.issue("owner-one")
    prisma.user.findUnique.mockResolvedValue({ status: "active", passwordChangedAt: new Date() } as never)
    await expect(service.verify(`Bearer ${grant.accessToken}`)).rejects.toThrow("账号不可用")
  })
})
