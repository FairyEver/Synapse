import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { JwtService } from "@nestjs/jwt"
import { Logger } from "@nestjs/common"
import { PortalHeadlessAccessService } from "./access.service"
import { PortalHeadlessService, normalizePortalError, type PortalSdk } from "./portal-headless.service"
import { PortalHeadlessController } from "./portal-headless.controller"

vi.mock("../../config/env", () => ({ loadEnv: () => ({ userAccessJwtSecret: "synthetic-sy-test-secret-not-real" }) }))
let sdk: PortalSdk
let reviewedPolicy: NonNullable<ReturnType<PortalSdk["loadGeneratedPermissionPolicy"]>>
function syntheticPolicy() {
  const root = mkdtempSync(join(tmpdir(), "ph-server-policy-"))
  const source = "permissionCheck('page')\nhttp.post('/synthetic/target', body)\n"
  writeFileSync(join(root, "page.vue"), source)
  const sourceRevision = sdk.permissionSourceRevision(root)
  const accepted = new Set(["meeting-room-usage", "hr-post-type-list", "hr-post-type-create", "perf-year-agreement-list", "base-dict-get"])
  const candidates = sdk.permissionCapabilityRegistry().map(cap => ({ candidateId: cap.id, capabilityIds: [cap.id], pagePath: cap.pagePath,
    routeFile: "page.vue", actionFiles: ["page.vue"], importTrail: [], keywordHits: [], unresolved: [], sourceRevision,
    endpointRefs: [{ method: "post", path: "/synthetic/target", sourceFile: "page.vue", line: 2 }] }))
  const reviews = candidates.map(candidate => ({ candidateId: candidate.candidateId, capabilityId: candidate.candidateId, sdkPath: sdk.sdkPathOf(candidate.candidateId)!,
    pageChain: { kind: "code" as const, code: "/dashboard/year-agreement/main" }, actionChain: { kind: "code" as const, code: "action" }, contextRules: [],
    evidence: [{ file: "page.vue", line: 1, snippet: "permissionCheck('page')" }, { file: "page.vue", line: 2, snippet: "http.post('/synthetic/target', body)" }],
    sdkEvidence: [{ file: "src/capabilities/hr-post-type.ts", line: 47, snippet: "await request({ url: `${ROOT}/save`, method: 'post', data: draft(input) })" }],
    endpointRefs: candidate.endpointRefs, sourceRevision, status: accepted.has(candidate.candidateId) ? "accepted" as const : "blocked" as const, reason: "Synthetic reviewed test policy" }))
  return sdk.compilePermissionPolicy({ candidates, reviews, sourceRoot: root, sourceRevision })
}
// 这个包有 17 MB 编译产物，冷加载要数百毫秒；全量并行跑时 CPU 被占满会更慢，
// 默认的 10 秒 hook 超时会偶发性地判它失败。放宽到 30 秒，避免误报。
beforeAll(async () => { sdk = await import("@synapse/portal-headless"); reviewedPolicy = syntheticPolicy() }, 30_000)
const identity = { owner: "owner-one", environment: "test" as const, credential: { token: "portal-canary", tenantId: "tenant-one", language: "zh-CN" as const } }
function fixture(options: { error?: unknown; permissionFailure?: boolean; permissions?: unknown; yearlyError?: unknown; permissionsByTenant?: Record<string, string[]>; missingPolicy?: boolean; stalePolicy?: boolean; writeResponse?: (token: string, signal: AbortSignal) => Promise<unknown>; permissionResponse?: (signal: AbortSignal) => Promise<unknown> } = {}) {
  const calls: Array<{ token: string; tenantId: string; request: Record<string, unknown> }> = []
  const runtimes: ReturnType<PortalSdk["createPortalServer"]>[] = []
  const factoryBaseUrls: string[] = []
  const loader = async () => ({ ...sdk,
    loadGeneratedPermissionPolicy: () => options.missingPolicy ? null : options.stalePolicy ? { ...reviewedPolicy, sourceRevision: "old" } : reviewedPolicy,
    loadPermissionSourcePin: () => ({ sourceRevision: reviewedPolicy.sourceRevision, sdkSourceRevision: reviewedPolicy.sdkSourceRevision }),
    createPortalServer: (config: Parameters<PortalSdk["createPortalServer"]>[0]) => {
      const runtime = sdk.createPortalServer(config); runtimes.push(runtime); return runtime
    },
    createPortalRequestFactory: (config: { baseUrl: string }) => { factoryBaseUrls.push(config.baseUrl); return (context: { credential: { token: string; tenantId: string } }) => async (request: Record<string, unknown>) => {
      if ((request.signal as AbortSignal)?.aborted) throw { code: 'ERR_CANCELED' }
      calls.push({ ...context.credential, request })
      if (options.error) throw options.error
      const url = String(request.url)
      if (url.endsWith("/sys/user/info")) return { id: "portal-user", realName: "测试用户", password2: "private-canary", salt: "salt-canary" }
      if (url.endsWith("getUserTenantsByPage")) return { list: [{ id: context.credential.tenantId }], total: 1 }
      if (url.endsWith("/sys/menu/nav")) {
        // Real Portal nav exposes the old group, while the web UI uses exact page permissions.
        return [{ id: "menu", name: "双赢协议", permissions: "/dashboard/agreement", url: null, children: [] }]
      }
      if (url.endsWith("/sys/menu/permissionsNotBySystem")) {
        if (options.permissionResponse) return options.permissionResponse(request.signal as AbortSignal)
        if (options.permissionFailure) throw new Error("permission secret-canary")
        if (options.permissionsByTenant) return options.permissionsByTenant[context.credential.tenantId] ?? []
        return options.permissions === undefined ? ["/dashboard/year-agreement/main", "action"] : options.permissions
      }
      if (url.endsWith("/meeting-room-usage")) return { meetingRooms: [{ meetingRoomId: "room", meetingRoomName: "会议室", timeSlots: [] }] }
      if (url.endsWith("/org/hrposttype/page")) return { list: [{ id: "post-type", name: "测试类别" }], total: 1 }
      if (url.endsWith("/org/hrposttype/save")) return options.writeResponse ? options.writeResponse(context.credential.token, request.signal as AbortSignal) : null
      if (url.endsWith("/kpiyearprotocol/page")) {
        if (options.yearlyError) throw options.yearlyError
        return { list: [{ id: "agreement", year: 2026, status: "1" }], total: 1 }
      }
      if (url.endsWith("/dict-data/grouped-list")) return [{ dictType: "protocol_status", dataList: [{ label: "已签订", value: "1" }] }]
      throw new Error(`Unexpected synthetic request: ${url}`)
    } },
  }) as unknown as PortalSdk
  return { service: new PortalHeadlessService(loader), calls, runtimes, factoryBaseUrls }
}

describe("Portal Headless backend extension", () => {
  const writeOperation = { op: 'invoke' as const, input: { capabilityId: 'hr-post-type-create', arguments: { name: '测试类别', sort: 1 } } }
  it('shares SDK permission data across read/invoke calls without reusing an aborted request signal', async () => {
    const { service, calls, runtimes } = fixture()
    await service.run(identity, writeOperation)
    await service.run(identity, { ...writeOperation, op: 'read' })
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(1)
    expect(calls.filter(call => String(call.request.url).endsWith('/sys/user/info'))).toHaveLength(1)
    const targets = calls.filter(call => String(call.request.url).endsWith('/org/hrposttype/save'))
    expect(targets).toHaveLength(2)
    expect(targets[0]!.request.signal).not.toBe(targets[1]!.request.signal)
    expect(runtimes).toHaveLength(1)
  })
  it('coalesces concurrent permission loads for the same SDK user session', async () => {
    const { service, calls } = fixture()
    await Promise.all([service.run(identity, writeOperation), service.run(identity, writeOperation)])
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(1)
    expect(calls.filter(call => String(call.request.url).endsWith('/org/hrposttype/save'))).toHaveLength(2)
  })
  it('finishing one concurrent call does not abort another call using the same cached session', async () => {
    let releaseSecond!: () => void
    let reportBoth!: () => void
    let reportFirst!: () => void
    const firstStarted = new Promise<void>(resolve => { reportFirst = resolve })
    const bothStarted = new Promise<void>(resolve => { reportBoth = resolve })
    const secondPending = new Promise<void>(resolve => { releaseSecond = resolve })
    const signals: AbortSignal[] = []
    const { service } = fixture({ writeResponse: async (_token, signal) => {
      signals.push(signal)
      if (signals.length === 1) { reportFirst(); await bothStarted }
      else { reportBoth(); await secondPending }
      return null
    } })
    const first = service.run(identity, writeOperation)
    await firstStarted
    const second = service.run(identity, writeOperation)
    try {
      await bothStarted
      await first
      expect(signals[0]!.aborted).toBe(true)
      expect(signals[1]!.aborted).toBe(false)
      expect(signals[0]).not.toBe(signals[1])
    } finally { releaseSecond() }
    await second
  })
  it('an old credential failure cannot evict a newly rotated user session', async () => {
    let reportStarted!: () => void
    let rejectOld!: (reason: unknown) => void
    const started = new Promise<void>(resolve => { reportStarted = resolve })
    const oldPending = new Promise<unknown>((_resolve, reject) => { rejectOld = reject })
    const { service, calls } = fixture({ writeResponse: async token => {
      if (token === identity.credential.token) { reportStarted(); return oldPending }
      return null
    } })
    const old = service.run(identity, writeOperation)
    const rejected = expect(old).rejects.toMatchObject({ status: 401 })
    await started
    const rotated = { ...identity, credential: { ...identity.credential, token: 'rotated-canary' } }
    await service.run(rotated, writeOperation)
    rejectOld({ code: 401 })
    await rejected
    await service.run(rotated, writeOperation)
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(2)
    expect(calls.filter(call => String(call.request.url).endsWith('/sys/user/info'))).toHaveLength(2)
  })
  it('one caller timeout does not cancel a shared permission load needed by another caller', async () => {
    const deadlines = [new AbortController(), new AbortController()]
    let deadlineIndex = 0
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => deadlines[deadlineIndex++]!.signal)
    let loaded!: (value: unknown) => void
    let reportStarted!: () => void
    const started = new Promise<void>(resolve => { reportStarted = resolve })
    const pending = new Promise<unknown>(resolve => { loaded = resolve })
    let sharedSignal!: AbortSignal
    const { service, calls } = fixture({ permissionResponse: async signal => {
      sharedSignal = signal
      reportStarted()
      return pending
    } })
    try {
      const first = service.run(identity, writeOperation)
      const failed = expect(first).rejects.toMatchObject({ status: 504 })
      await started
      const second = service.run(identity, writeOperation)
      deadlines[0]!.abort()
      await failed
      loaded(['/dashboard/year-agreement/main', 'action'])
      await second
      expect(sharedSignal.aborted).toBe(false)
      expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(1)
      expect(calls.filter(call => String(call.request.url).endsWith('/org/hrposttype/save'))).toHaveLength(1)
      service.onModuleDestroy()
      expect(sharedSignal.aborted).toBe(true)
    } finally { loaded([]); timeout.mockRestore() }
  })
  it('refreshes invalidated permission data and denies without caching the prior allow decision', async () => {
    const options = { permissions: ['/dashboard/year-agreement/main', 'action'] }
    const { service, calls, runtimes } = fixture(options)
    await service.run(identity, writeOperation)
    options.permissions = ['/dashboard/year-agreement/main']
    const runtime = runtimes[0]!
    runtime.sessions.invalidateCapability({ userId: identity.owner, tenantId: identity.credential.tenantId, language: identity.credential.language }, 'permission-list')
    await expect(service.run(identity, writeOperation)).rejects.toMatchObject({ status: 403, response: { failedRule: 'action permission chain' } })
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(2)
    expect(calls.filter(call => String(call.request.url).endsWith('/org/hrposttype/save'))).toHaveLength(1)
  })
  it('does not share cached permissions across owners, tenants, languages, environments or rotated credentials', async () => {
    const { service, calls, runtimes } = fixture()
    const identities = [identity, { ...identity, owner: 'owner-two' },
      { ...identity, credential: { ...identity.credential, tenantId: 'tenant-two' } },
      { ...identity, credential: { ...identity.credential, language: 'en-US' as const } },
      { ...identity, environment: 'prod' as const },
      { ...identity, credential: { ...identity.credential, token: 'rotated-canary' } }]
    for (const item of identities) await service.run(item, writeOperation)
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(6)
    expect(runtimes).toHaveLength(2)
    await service.run(identities[5]!, writeOperation)
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(6)
    service.onModuleDestroy()
    expect(runtimes.every(runtime => runtime.sessions.list().length === 0)).toBe(true)
  })
  it('reloads permissions after the SDK session expires', async () => {
    const { service, calls } = fixture()
    let at = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => at)
    try {
      await service.run(identity, writeOperation)
      at += 31 * 60_000
      await service.run(identity, writeOperation)
    } finally { clock.mockRestore() }
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(2)
  })
  it('does not cache a failed permission fetch or send a target request on that failure', async () => {
    const options = { permissionFailure: true }
    const { service, calls } = fixture(options)
    await expect(service.run(identity, writeOperation)).rejects.toMatchObject({ status: 403 })
    expect(calls.some(call => String(call.request.url).endsWith('/org/hrposttype/save'))).toBe(false)
    options.permissionFailure = false
    await service.run(identity, writeOperation)
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(2)
  })
  it('clears the failing session after a business credential rejection', async () => {
    const options: { yearlyError?: unknown } = {}
    const { service, calls } = fixture(options)
    const operation = { op: 'read' as const, input: { capabilityId: 'perf-year-agreement-list', arguments: {} } }
    await service.run(identity, operation)
    options.yearlyError = { code: 401 }
    await expect(service.run(identity, operation)).rejects.toMatchObject({ status: 401 })
    options.yearlyError = undefined
    await service.run(identity, operation)
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(2)
    expect(calls.filter(call => String(call.request.url).endsWith('/sys/user/info'))).toHaveLength(2)
  })
  it('discards malformed permission data so a repaired source can load on the next call', async () => {
    const options: { permissions: unknown } = { permissions: ['/dashboard/year-agreement/main', 'action', 42] }
    const { service, calls } = fixture(options)
    await expect(service.run(identity, writeOperation)).rejects.toMatchObject({ status: 403 })
    expect(calls.some(call => String(call.request.url).endsWith('/org/hrposttype/save'))).toBe(false)
    options.permissions = ['/dashboard/year-agreement/main', 'action']
    await service.run(identity, writeOperation)
    expect(calls.filter(call => String(call.request.url).endsWith('/permissionsNotBySystem'))).toHaveLength(2)
  })
  it("loads the packaged SDK, validates identity and returns only safe context", async () => {
    const { service, calls, runtimes } = fixture()
    const result = await service.run(identity, { op: "context" })
    expect(result).toMatchObject({ protocolVersion: 1, data: { portalUser: { id: "portal-user", name: "测试用户" }, tenantId: "tenant-one",
      capabilityAccess: { mode: "all", total: sdk.createPortalServer({ baseUrl: "https://example.invalid" }).catalog.index.capabilities.length } } })
    expect(JSON.stringify(result)).not.toMatch(/private-canary|salt-canary|portal-canary/)
    expect(calls.some((call) => String(call.request.url).endsWith("getUserTenantsByPage"))).toBe(true)
    expect(calls.every((call) => call.request.maxRedirects === 0 && call.request.timeout === 10_000 && call.request.signal instanceof AbortSignal)).toBe(true)
    expect(runtimes).toHaveLength(1)
    service.onModuleDestroy()
    expect(calls.every((call) => (call.request.signal as AbortSignal).aborted)).toBe(true)
  })
  it("selects only the production API for production credentials", async () => {
    const { service, factoryBaseUrls } = fixture()
    const result = await service.run({ ...identity, environment: "prod" }, { op: "context" })
    expect(result).toMatchObject({ catalogRevision: expect.stringContaining(":full-prod-v1"), data: { environment: "prod" } })
    expect(factoryBaseUrls).toEqual(["https://biz-api.wodecorp.cn"])
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
  it("publishes and executes write capabilities through invoke and the read compatibility route", async () => {
    const { service, calls } = fixture()
    const description = await service.run(identity, { op: "describe", input: { kind: "capability", capabilityId: "hr-post-type-create" } })
    expect(description.data).toMatchObject({ write: true, extensionInputSchema: { required: ["name", "sort"], additionalProperties: false,
      properties: { name: { type: "string" }, sort: { type: "integer" } } } })
    await expect(service.run(identity, { op: "invoke", input: { capabilityId: "hr-post-type-create", arguments: { name: "测试类别", sort: 1 } } }))
      .resolves.toMatchObject({ data: { capabilityId: "hr-post-type-create" } })
    await expect(service.run(identity, { op: "read", input: { capabilityId: "hr-post-type-create", arguments: { name: "测试类别", sort: 1 } } }))
      .resolves.toMatchObject({ data: { capabilityId: "hr-post-type-create" } })
    await expect(service.run(identity, { op: "describe", input: { kind: "method", capabilityId: "meeting-room-usage", id: "__proto__" } })).rejects.toThrow("引用")
    expect(calls.filter((call) => String(call.request.url).endsWith("/org/hrposttype/save"))).toHaveLength(2)
    expect(calls.find((call) => String(call.request.url).endsWith("/org/hrposttype/save"))?.request)
      .toMatchObject({ method: "post", data: { name: "测试类别", sort: 1 } })
  })
  it("keeps the existing read entry compatible", async () => {
    const { service, calls } = fixture()
    const yearly = await service.run(identity, { op: "read", input: { capabilityId: "perf-year-agreement-list", arguments: { pageNo: 2, pageSize: 10 } } })
    expect(yearly.data).toMatchObject({ result: { list: [{ year: 2026 }], total: 1 } })
    expect(calls.find((call) => String(call.request.url).endsWith("/kpiyearprotocol/page"))?.request.params)
      .toMatchObject({ pageNo: 2, pageSize: 10 })
    const dict = await service.run(identity, { op: "read", input: { capabilityId: "base-dict-get", arguments: { dictType: "protocol_status" } } })
    expect(dict.data).toMatchObject({ result: { dictType: "protocol_status", entries: [{ label: "已签订", value: "1" }] } })
  })
  it("uses the full SDK catalog without allowlist or Portal page-permission filtering", async () => {
    const { service, calls } = fixture({ permissionFailure: true })
    const catalog = await service.run(identity, { op: "catalog", input: { op: "search", query: "岗位类别", offset: 0, limit: 20 } })
    expect(JSON.stringify(catalog.data)).toContain("hr-post-type-list")
    await expect(service.run(identity, { op: "describe", input: { kind: "capability", capabilityId: "hr-post-type-list" } }))
      .resolves.toMatchObject({ data: { ok: true, write: false } })
    await expect(service.run(identity, { op: "read", input: { capabilityId: "hr-post-type-list", arguments: {} } }))
      .rejects.toMatchObject({ response: { code: "PH_PERMISSION_DENIED" } })
    expect(calls.some((call) => String(call.request.url).endsWith("/permissionsNotBySystem"))).toBe(true)
    expect(calls.some((call) => String(call.request.url).endsWith("/org/hrposttype/page"))).toBe(false)
  })
  it("preserves Portal business denial even when the page permission is granted", async () => {
    const { service } = fixture({ yearlyError: { response: { status: 403 } } })
    await expect(service.run(identity, { op: "read", input: { capabilityId: "perf-year-agreement-list", arguments: {} } }))
      .rejects.toMatchObject({ response: { code: "PORTAL_FORBIDDEN" } })
  })
  it("isolates credentials for concurrent owners and tenants", async () => {
    const { service, calls } = fixture()
    await Promise.all([
      service.run(identity, { op: "context" }),
      service.run({ owner: "owner-two", environment: "test", credential: { ...identity.credential, tenantId: "tenant-two", token: "other-canary" } }, { op: "context" }),
    ])
    expect(calls.every((call) => call.token === "portal-canary" ? call.tenantId === "tenant-one" : call.token === "other-canary" && call.tenantId === "tenant-two")).toBe(true)
  })
  it.each(["read", "invoke"] as const)("denies %s with no page/action permission and sends zero target requests", async op => {
    for (const permissions of [[], ["/dashboard/year-agreement/main"]]) {
      const { service, calls } = fixture({ permissions })
      await expect(service.run(identity, { op, input: { capabilityId: "hr-post-type-create", arguments: { name: "测试类别", sort: 1, permissions: ["action"], tenantId: "override" } } }))
        .rejects.toMatchObject({ status: 403, response: { code: "PH_PERMISSION_DENIED", capabilityId: "hr-post-type-create" } })
      expect(calls.some(call => String(call.request.url).endsWith("/org/hrposttype/save"))).toBe(false)
    }
  })
  it.each(["missingPolicy", "stalePolicy"] as const)("denies %s before any permission or target request", async kind => {
    const { service, calls } = fixture({ [kind]: true })
    await expect(service.run(identity, { op: "invoke", input: { capabilityId: "hr-post-type-create", arguments: { name: "测试类别", sort: 1 } } }))
      .rejects.toMatchObject({ status: 403, response: { code: "PH_PERMISSION_DENIED" } })
    expect(calls.some(call => /permissionsNotBySystem|hrposttype/.test(String(call.request.url)))).toBe(false)
  })
  it("preserves denial audit fields without token or arguments", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    try {
      const { service } = fixture({ permissions: [] })
      await expect(service.run(identity, { op: "invoke", input: { capabilityId: "hr-post-type-create", arguments: { name: "argument-canary", sort: 1 } } })).rejects.toThrow()
      expect(warn).toHaveBeenCalledWith({ event: "portal.permission.denied", capabilityId: "hr-post-type-create", policyRevision: reviewedPolicy.revision, failedRule: "page permission chain" })
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/portal-canary|argument-canary/)
    } finally { warn.mockRestore() }
  })
  it("strips SDK error details", async () => {
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
      await expect(service.run(identity, { op: "context" })).rejects.toThrow("Portal 操作失败")
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
    const grant = service.issue("owner-one", "test")
    expect(await service.verify(`Bearer ${grant.accessToken}`)).toEqual({ owner: "owner-one", environment: "test" })
    expect(Date.parse(grant.expiresAt) - Date.now()).toBeGreaterThan(298_000)
    const normalJwt = new JwtService({ secret: "synthetic-sy-test-secret-not-real" })
    expect(() => normalJwt.verify(grant.accessToken)).toThrow()
    const normalToken = normalJwt.sign({ sub: "owner-one", email: "person@example.invalid" })
    await expect(service.verify(`Bearer ${normalToken}`)).rejects.toThrow("扩展授权")
  })
  it("rejects missing, tampered, expired or disabled-user grants", async () => {
    const { service, prisma } = auth()
    await expect(service.verify(undefined)).rejects.toThrow("扩展授权")
    const grant = service.issue("owner-one", "test")
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
    const headers = { authorization: `Bearer ${access.issue(identity.owner, "test").accessToken}`,
      "x-portal-token": identity.credential.token, "x-portal-tenant-id": identity.credential.tenantId }
    const operations = [
      (h: typeof headers) => controller.context(h, {}),
      (h: typeof headers) => controller.catalog(h, { op: "domains" }),
      (h: typeof headers) => controller.describe(h, { kind: "capability", capabilityId: "meeting-room-usage" }),
      (h: typeof headers) => controller.read(h, { capabilityId: "meeting-room-usage" }),
      (h: typeof headers) => controller.invoke(h, { capabilityId: "hr-post-type-create", arguments: { name: "测试", sort: 1 } }),
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
  it("binds the requested environment to the grant and rejects unsupported environments", async () => {
    const { service: access } = auth()
    const { service: portal, factoryBaseUrls } = fixture()
    const controller = new PortalHeadlessController(access, portal)
    const grant = controller.issue({ user: { id: identity.owner } } as never, { environment: "prod" })
    expect(await access.verify(`Bearer ${grant.accessToken}`)).toEqual({ owner: identity.owner, environment: "prod" })
    await controller.context({ authorization: `Bearer ${grant.accessToken}`, "x-portal-token": identity.credential.token,
      "x-portal-tenant-id": identity.credential.tenantId }, {})
    expect(factoryBaseUrls).toEqual(["https://biz-api.wodecorp.cn"])
    expect(() => controller.issue({ user: { id: identity.owner } } as never, { environment: "other" })).toThrow()
  })
  it("revokes existing grants after a SY password change", async () => {
    const { service, prisma } = auth()
    const grant = service.issue("owner-one", "test")
    prisma.user.findUnique.mockResolvedValue({ status: "active", passwordChangedAt: new Date() } as never)
    await expect(service.verify(`Bearer ${grant.accessToken}`)).rejects.toThrow("账号不可用")
  })
})
