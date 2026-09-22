import { afterEach, describe, expect, it, vi } from "vitest"
import { portalTestConnector } from "../definitions"
import { createPortalVerifier } from "../portal-verifier"
const credential = { token: "synthetic-token", tenantId: "2", portalUserId: "42" }
const envelope = (data: unknown) => new Response(JSON.stringify({ ret: "SUCCESS", data }))
const user = { id: 42, realName: "测试用户", password2: "sensitive-password", salt: "sensitive-salt", mobile: "sensitive-mobile" }
const tenant = { id: 2, name: "测试企业", identityNumber: "sensitive-identity" }
const run = (fetchImpl: typeof fetch) => createPortalVerifier(fetchImpl)(portalTestConnector.integration, credential, new AbortController().signal)
afterEach(() => vi.useRealTimers())

describe("Portal read-only identity validation", () => {
  it("uses trusted API URLs and paired headers, strips sensitive profile fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope(user)).mockResolvedValueOnce(envelope({ list: [tenant] }))
    expect(await run(fetchImpl)).toEqual({ portalUserId: "42", tenantId: "2", displayName: "测试用户", tenantName: "测试企业" })
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://biz-api-test.wodecorp.cn/admin-api/sys/user/info",
      "https://biz-api-test.wodecorp.cn/admin-api/hr/system-tenant/getUserTenantsByPage?pageNo=1&pageSize=200",
    ])
    for (const [, init] of fetchImpl.mock.calls) expect(init).toMatchObject({ method: "GET", redirect: "manual", headers: { token: credential.token, "tenant-id": "2", "Accept-Language": "zh-CN" } })
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("module-type")
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("Authorization")
  })
  it("finds the selected tenant on later pages", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope(user))
      .mockResolvedValueOnce(envelope({ list: Array.from({ length: 200 }, (_, i) => ({ id: i + 100 })) }))
      .mockResolvedValueOnce(envelope({ list: [tenant] }))
    await expect(run(fetchImpl)).resolves.toMatchObject({ tenantId: "2" })
    expect(fetchImpl.mock.calls[2][0]).toContain("pageNo=2")
  })
  it.each([
    [401, undefined, "credential_invalid"], [403, undefined, "permission_denied"],
    [503, undefined, "network_error"], [302, undefined, "redirect_not_allowed"],
    [200, { ret: "FAIL", code: 401 }, "credential_invalid"],
    [200, { ret: "FAIL", code: 1002015001 }, "tenant_unavailable"],
    [200, { ret: "FAIL", code: 10001 }, "credential_invalid"],
    [200, { code: 200, data: user }, "invalid_response"],
  ])("classifies HTTP %s and envelope without exposing upstream text", async (status, body, code) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body ?? { msg: credential.token }), { status: status as number }))
    await expect(run(fetchImpl)).rejects.toMatchObject({ code })
    await expect(run(fetchImpl)).rejects.not.toThrow(credential.token)
  })
  it("rejects another identity and a non-member tenant", async () => {
    await expect(run(vi.fn(async () => envelope({ id: "other" })))).rejects.toMatchObject({ code: "identity_mismatch" })
    await expect(run(vi.fn().mockResolvedValueOnce(envelope(user)).mockResolvedValueOnce(envelope({ list: [{ id: "other" }] })))).rejects.toMatchObject({ code: "tenant_mismatch" })
  })
  it("rejects malformed user, tenant, unsafe numeric IDs and oversized responses", async () => {
    for (const payload of [null, [], { id: Number.MAX_SAFE_INTEGER + 1 }, { name: "no id" }]) {
      await expect(run(vi.fn(async () => envelope(payload)))).rejects.toMatchObject({ code: "invalid_response" })
    }
    await expect(run(vi.fn().mockResolvedValueOnce(envelope(user)).mockResolvedValueOnce(envelope({ list: [null] })))).rejects.toMatchObject({ code: "invalid_response" })
    await expect(run(vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024 + 1))))).rejects.toMatchObject({ code: "invalid_response" })
  })
  it("does not invent display labels", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope({ id: 42 })).mockResolvedValueOnce(envelope({ list: [{ id: 2 }] }))
    expect(await run(fetchImpl)).toEqual({ portalUserId: "42", tenantId: "2", displayName: undefined, tenantName: undefined })
  })
  it("bounds pagination without claiming non-membership from an incomplete list", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope(user))
      .mockImplementation(async () => envelope({ list: Array.from({ length: 200 }, () => ({ id: "other" })) }))
    await expect(run(fetchImpl)).rejects.toMatchObject({ code: "invalid_response" })
    expect(fetchImpl).toHaveBeenCalledTimes(101)
  })
  it("classifies transport errors and enforces request timeout", async () => {
    await expect(run(vi.fn(async () => { throw new Error(credential.token) }))).rejects.toMatchObject({ code: "network_error" })
    vi.useFakeTimers()
    const pending = run(vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    })))
    const assertion = expect(pending).rejects.toMatchObject({ code: "verification_timeout" })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
  })
})
