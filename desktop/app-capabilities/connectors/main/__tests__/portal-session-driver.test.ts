import { afterEach, describe, expect, it, vi } from "vitest"
import type { ConnectorCredentialEntryV1, ConnectorStateStoreV1 } from "../../../../electron/runtime/data-repo/schemas/connectors"
import type { SynapseAccountState } from "../../../../src/types/account"
import { portalTestConnector } from "../definitions"
import { PortalConnectionError } from "../portal-errors"
import { createPortalSessionDriver } from "../portal-session-driver"
import type { PortalProfile } from "../portal-verifier"

const token = "synthetic-portal-secret-not-real"
const profile: PortalProfile = { portalUserId: "portal-user", tenantId: "tenant-2", displayName: "测试用户", tenantName: "测试企业" }
function namespace<T extends Record<string, unknown>>() {
  const entries = new Map<string, T>()
  return { entries, get: vi.fn(async (id: string) => entries.get(id) ?? null),
    upsert: vi.fn(async (value: T & { id: string }) => { entries.set(value.id, structuredClone(value)) }),
    remove: vi.fn(async (id: string) => { entries.delete(id) }), list: vi.fn(async () => [...entries.values()]) }
}
function authenticated(id: string): SynapseAccountState {
  return { status: "authenticated", connectivity: "online", profile: { user: { id, email: "test@example.test", handle: id, status: "active" }, syncedAt: "2026-09-22T00:00:00Z" } }
}
const disposers: (() => void)[] = []
afterEach(() => { disposers.splice(0).forEach((fn) => fn()); vi.useRealTimers() })
function harness() {
  const state = namespace<ConnectorStateStoreV1>()
  const credentials = namespace<ConnectorCredentialEntryV1>()
  let accountState = authenticated("owner-a")
  const before = new Set<() => void | Promise<void>>()
  const changed = new Set<(state: SynapseAccountState) => void>()
  const verify = vi.fn(async () => profile)
  const openExternal = vi.fn(async (_url: string) => undefined)
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
  const auditSink = { record: vi.fn() }
  const notify = vi.fn()
  let time = Date.parse("2026-09-22T00:00:00Z")
  const deps = { definitions: [portalTestConnector], state: state as never, credentials: credentials as never,
    account: { getState: () => accountState,
      onBeforeIdentityChange: (fn: () => void | Promise<void>) => { before.add(fn); return () => { before.delete(fn) } },
      onStateChanged: (fn: (state: SynapseAccountState) => void) => { changed.add(fn); return () => { changed.delete(fn) } } },
    verify, openExternal, permissionGuard: permissionGuard as never, auditSink: auditSink as never,
    now: () => time, secureStorageAvailable: () => true }
  const driver = createPortalSessionDriver(deps)
  disposers.push(() => driver.lifecycle!.dispose())
  const item = () => driver.lifecycle!.item(portalTestConnector)
  async function init() { await driver.lifecycle!.initialize(notify); await vi.waitFor(() => expect(credentials.list).toHaveBeenCalled()) }
  async function start() {
    await driver.lifecycle!.connect(portalTestConnector)
    const url = new URL(openExternal.mock.calls.at(-1)![0])
    return new URLSearchParams(url.hash.split("?")[1]).get("state")!
  }
  const callback = (stateValue: string, extra: Record<string, string> = {}) => `${portalTestConnector.integration.callbackUrl}?${new URLSearchParams({ status: "success", state: stateValue, token, tenantId: profile.tenantId, portalUserId: profile.portalUserId, ...extra })}`
  async function switchUser(id: string) {
    await Promise.all([...before].map((fn) => fn()))
    accountState = authenticated(id)
    changed.forEach((fn) => fn(accountState))
  }
  return { driver, deps, state, credentials, verify, openExternal, permissionGuard, auditSink, notify, init, start, callback, item, switchUser,
    advance: (ms: number) => { time += ms },
    changeState: (next: SynapseAccountState) => { accountState = next; changed.forEach((fn) => fn(next)) } }
}

describe("Portal session connector", () => {
  it("opens the fixed authorization page, verifies before persisting, and exposes no credentials publicly", async () => {
    const h = harness(); await h.init()
    const state = await h.start()
    expect(state).toMatch(/^[\w-]{43}$/)
    expect(h.openExternal.mock.calls[0][0]).toContain("portal.html#/connect/synapse?")
    expect(h.openExternal.mock.calls[0][0]).not.toContain(token)
    expect(await h.item()).toMatchObject({ connectionStatus: "connecting", enabled: true })
    expect(h.credentials.entries.size).toBe(0)
    await expect(h.driver.getSessionInput(portalTestConnector.id)).rejects.toThrow()
    await h.driver.handleCallback(h.callback(state))
    const publicItem = await h.item()
    expect(publicItem).toMatchObject({ connectionStatus: "connected", account: profile })
    expect(JSON.stringify([publicItem, [...h.state.entries.values()], h.auditSink.record.mock.calls])).not.toContain(token)
    const sdkInput = await h.driver.getSessionInput(portalTestConnector.id)
    expect(sdkInput).toEqual({ baseUrl: portalTestConnector.integration.baseUrl, userId: "owner-a", language: "zh-CN", credential: { token, tenantId: profile.tenantId } })
    expect(h.driver.createAgentContribution(portalTestConnector)).toEqual({ mcpServers: [], skillPackageIds: [] })
  })
  it("cancels without storing credentials and rejects replay", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    await h.driver.handleCallback(`${portalTestConnector.integration.callbackUrl}?status=cancelled&state=${state}`)
    expect(await h.item()).toMatchObject({ connectionStatus: "disconnected" })
    await expect(h.driver.handleCallback(h.callback(state))).rejects.toThrow()
    expect(h.verify).not.toHaveBeenCalled()
  })
  it("rejects expired, mismatched, missing and repeated callbacks", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    await expect(h.driver.handleCallback(h.callback("a".repeat(43)))).rejects.toThrow()
    await expect(h.driver.handleCallback(h.callback(state, { token: "" }))).rejects.toThrow()
    h.advance(300_000)
    await expect(h.driver.handleCallback(h.callback(state))).rejects.toThrow("过期")
    expect(h.verify).not.toHaveBeenCalled()
    const fresh = await h.start()
    await h.driver.handleCallback(h.callback(fresh))
    await expect(h.driver.handleCallback(h.callback(fresh))).rejects.toThrow()
    expect(h.verify).toHaveBeenCalledTimes(1)
  })
  it.each(["credential_invalid", "tenant_mismatch", "identity_mismatch", "tenant_unavailable"] as const)("requires reconnect for %s", async (code) => {
    const h = harness(); await h.init(); const state = await h.start()
    h.verify.mockRejectedValueOnce(new PortalConnectionError(code))
    await h.driver.handleCallback(h.callback(state))
    expect(await h.item()).toMatchObject({ connectionStatus: "reconnect_required", canRetry: false })
    expect(h.credentials.entries.size).toBe(0)
  })
  it("keeps unverified credentials only in memory after network failure and supports retry", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    h.verify.mockRejectedValueOnce(new PortalConnectionError("network_error"))
    await h.driver.handleCallback(h.callback(state))
    expect(await h.item()).toMatchObject({ connectionStatus: "failed", canRetry: true })
    expect(h.credentials.entries.size).toBe(0)
    await expect(h.driver.getSessionInput(portalTestConnector.id)).rejects.toThrow()
    await h.driver.lifecycle!.retry(portalTestConnector)
    expect(await h.item()).toMatchObject({ connectionStatus: "connected" })
  })
  it("blocks late callbacks and late verification after disconnect", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    let resolve!: (value: PortalProfile) => void
    h.verify.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const handling = h.driver.handleCallback(h.callback(state))
    await vi.waitFor(() => expect(h.verify).toHaveBeenCalled())
    await h.driver.lifecycle!.disconnect(portalTestConnector)
    resolve(profile); await handling
    expect(await h.item()).toMatchObject({ connectionStatus: "disconnected" })
    expect(h.credentials.entries.size).toBe(0)
    await expect(h.driver.handleCallback(h.callback(state))).rejects.toThrow()
  })
  it("rolls back when disconnect happens during credential persistence", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    const original = h.credentials.upsert.getMockImplementation()!
    let resolve!: () => void
    h.credentials.upsert.mockImplementationOnce(async (value) => { await original(value); await new Promise<void>((done) => { resolve = done }) })
    const handling = h.driver.handleCallback(h.callback(state))
    await vi.waitFor(() => expect(h.credentials.entries.size).toBe(1))
    const disconnect = h.driver.lifecycle!.disconnect(portalTestConnector)
    resolve(); await Promise.all([handling, disconnect])
    expect(h.credentials.entries.size).toBe(0)
    expect(await h.item()).toMatchObject({ connectionStatus: "disconnected" })
  })
  it("invalidates replaced attempts and isolates account changes", async () => {
    const h = harness(); await h.init(); const old = await h.start(); const fresh = await h.start()
    await expect(h.driver.handleCallback(h.callback(old))).rejects.toThrow()
    await h.switchUser("owner-b")
    await expect(h.driver.handleCallback(h.callback(fresh))).rejects.toThrow()
    expect(await h.item()).toMatchObject({ connectionStatus: "disconnected" })
    const b = await h.start(); await h.driver.handleCallback(h.callback(b))
    expect((await h.driver.getSessionInput(portalTestConnector.id)).userId).toBe("owner-b")
  })
  it("revalidates saved bindings after restart and retains them through network failure", async () => {
    const h = harness(); await h.init(); const state = await h.start(); await h.driver.handleCallback(h.callback(state))
    h.driver.lifecycle!.dispose()
    h.verify.mockRejectedValueOnce(new PortalConnectionError("network_error"))
    const restarted = createPortalSessionDriver(h.deps); disposers.push(() => restarted.lifecycle!.dispose())
    await restarted.lifecycle!.initialize(h.notify)
    await vi.waitFor(async () => expect(await restarted.lifecycle!.item(portalTestConnector)).toMatchObject({ connectionStatus: "failed", canRetry: true }))
    expect(h.credentials.entries.size).toBe(1)
    await expect(restarted.getSessionInput(portalTestConnector.id)).rejects.toThrow()
    await restarted.lifecycle!.retry(portalTestConnector)
    expect(await restarted.lifecycle!.item(portalTestConnector)).toMatchObject({ connectionStatus: "connected" })
    await expect(restarted.handleCallback(h.callback(state))).rejects.toThrow()
  })
  it("persists a disabled binding if credential deletion fails", async () => {
    const h = harness(); await h.init(); const state = await h.start(); await h.driver.handleCallback(h.callback(state))
    h.credentials.remove.mockRejectedValueOnce(new Error(token))
    await expect(h.driver.lifecycle!.disconnect(portalTestConnector)).rejects.toThrow("清理")
    expect([...h.state.entries.values()][0].portalBinding?.enabled).toBe(false)
    await expect(h.driver.getSessionInput(portalTestConnector.id)).rejects.toThrow()
    expect(JSON.stringify([await h.item(), h.auditSink.record.mock.calls])).not.toContain(token)
    await h.driver.lifecycle!.disconnect(portalTestConnector)
    expect(h.credentials.entries.size).toBe(0)
  })
  it("fails closed when safe storage or browser opening fails", async () => {
    const h = harness(); await h.init()
    h.deps.secureStorageAvailable = () => false
    await expect(h.start()).rejects.toThrow("安全")
    expect(h.openExternal).not.toHaveBeenCalled()
    h.deps.secureStorageAvailable = () => true
    h.openExternal.mockRejectedValueOnce(new Error(token))
    await expect(h.start()).rejects.toThrow("浏览器")
    expect(JSON.stringify(await h.item())).not.toContain(token)
  })
  it("does not retain a credential when committing its reference fails", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    h.state.upsert.mockRejectedValueOnce(new Error(token))
    await h.driver.handleCallback(h.callback(state))
    expect(await h.item()).toMatchObject({ connectionStatus: "failed" })
    expect(h.credentials.entries.size).toBe(0)
  })
  it("cleans orphaned credentials on startup", async () => {
    const h = harness()
    h.credentials.entries.set("orphan", { id: "orphan", schemaVersion: 1, accessToken: token, updatedAt: "2026-09-22T00:00:00Z",
      portal: { ownerUserId: "owner-a", connectorId: portalTestConnector.id, environmentId: "test", tenantId: "tenant-2", portalUserId: "portal-user" } })
    await h.init(); await vi.waitFor(() => expect(h.credentials.entries.size).toBe(0))
  })
  it("separates environments and never accepts a callback for another route", async () => {
    const h = harness(); await h.init(); const state = await h.start(); await h.driver.handleCallback(h.callback(state))
    const alternate = { ...portalTestConnector, id: "portal-fixture", integration: { ...portalTestConnector.integration,
      environmentId: "fixture", baseUrl: "https://fixture.invalid", callbackUrl: "synapse://portal-fixture/callback" } }
    const other = createPortalSessionDriver({ ...h.deps, definitions: [alternate] })
    disposers.push(() => other.lifecycle!.dispose())
    await other.lifecycle!.initialize(h.notify)
    await other.lifecycle!.connect(alternate)
    const otherState = new URLSearchParams(new URL(h.openExternal.mock.calls.at(-1)![0]).hash.split("?")[1]).get("state")!
    await expect(other.handleCallback(h.callback(otherState))).rejects.toThrow()
    await other.handleCallback(h.callback(otherState).replace(portalTestConnector.integration.callbackUrl, alternate.integration.callbackUrl))
    expect(h.credentials.entries.size).toBe(2)
    expect([...h.state.entries.values()].map((row) => row.portalBinding?.environmentId).sort()).toEqual(["fixture", "test"])
    await other.lifecycle!.disconnect(alternate)
    expect((await h.driver.getSessionInput(portalTestConnector.id)).credential.token).toBe(token)
    expect(h.credentials.entries.size).toBe(1)
  })
  it("never sends a callback credential into verification after switching SY accounts", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    let resolve!: (value: PortalProfile) => void
    h.verify.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const handling = h.driver.handleCallback(h.callback(state))
    await vi.waitFor(() => expect(h.verify).toHaveBeenCalled())
    await h.switchUser("owner-b")
    resolve(profile); await handling
    expect(h.credentials.entries.size).toBe(0)
    expect(await h.item()).toMatchObject({ connectionStatus: "disconnected" })
  })
  it("rejects credential records bound to a different tenant on restore", async () => {
    const h = harness(); await h.init(); const state = await h.start(); await h.driver.handleCallback(h.callback(state))
    h.driver.lifecycle!.dispose()
    const entry = [...h.credentials.entries.values()][0]
    entry.portal!.tenantId = "wrong-tenant"
    const restarted = createPortalSessionDriver(h.deps); disposers.push(() => restarted.lifecycle!.dispose())
    await restarted.lifecycle!.initialize(h.notify)
    await vi.waitFor(async () => expect(await restarted.lifecycle!.item(portalTestConnector)).toMatchObject({ connectionStatus: "reconnect_required" }))
    expect(h.verify).toHaveBeenCalledTimes(1)
  })
  it("requires a trusted SY login and respects permission denial", async () => {
    const h = harness(); await h.init()
    h.deps.account.getState = () => ({ status: "unauthenticated" })
    await expect(h.start()).rejects.toThrow("登录 Synapse")
    h.deps.account.getState = () => authenticated("owner-a")
    h.permissionGuard.check.mockResolvedValue({ allowed: false })
    await expect(h.start()).rejects.toThrow("权限")
    expect(h.openExternal).not.toHaveBeenCalled()
  })
  it("maps Portal failure callbacks without accepting arbitrary error text", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    await h.driver.handleCallback(`${portalTestConnector.integration.callbackUrl}?status=error&state=${state}&errorCode=login_failed`)
    expect(await h.item()).toMatchObject({ connectionStatus: "failed", errorMessage: "Portal 授权失败，请重新连接。" })
    expect(h.verify).not.toHaveBeenCalled()
  })

  it("invalidates on loss of login even without a before-identity callback", async () => {
    const h = harness(); await h.init(); const state = await h.start(); await h.driver.handleCallback(h.callback(state))
    h.changeState({ status: "unauthenticated" })
    expect(await h.item()).toMatchObject({ connectionStatus: "disconnected" })
    await expect(h.driver.getSessionInput(portalTestConnector.id)).rejects.toThrow()
    h.verify.mockRejectedValueOnce(new PortalConnectionError("network_error"))
    h.changeState(authenticated("owner-a"))
    await vi.waitFor(async () => expect(await h.item()).toMatchObject({ connectionStatus: "failed" }))
    expect(h.verify).toHaveBeenCalledTimes(2)
  })
  it("sanitizes audit sink failures from the internal credential provider", async () => {
    const h = harness(); await h.init(); const state = await h.start(); await h.driver.handleCallback(h.callback(state))
    h.auditSink.record.mockImplementation(() => { throw new Error(token) })
    await expect(h.driver.getSessionInput(portalTestConnector.id)).rejects.toThrow("权限")
    await expect(h.driver.getSessionInput(portalTestConnector.id)).rejects.not.toThrow(token)
  })
  it("expires a browser authorization attempt without waiting for its callback", async () => {
    const h = harness(); await h.init()
    vi.useFakeTimers()
    const state = await h.start()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await h.item()).toMatchObject({ connectionStatus: "failed", errorMessage: "连接已过期，请重新连接。" })
    await expect(h.driver.handleCallback(h.callback(state))).rejects.toThrow()
  })

  it("rejects a late browser callback after the switch was turned off", async () => {
    const h = harness(); await h.init(); const state = await h.start()
    await h.driver.lifecycle!.disconnect(portalTestConnector)
    await expect(h.driver.handleCallback(h.callback(state))).rejects.toThrow()
    expect(h.verify).not.toHaveBeenCalled()
    expect(await h.item()).toMatchObject({ connectionStatus: "disconnected", enabled: false })
  })

})
