import { afterEach, describe, expect, it, vi } from "vitest"
import { createPortalCredentialDispatcher } from "../credential-dispatcher"
import type { PortalSessionInput } from "../types"
import type { SynapseAccountState } from "../../../../src/types/account"
import { buildSynapseToolRouterTools, searchSynapseTools } from "../../../../electron/services/agent-runtime/synapse-tool-router"
import { MCP_TOOL_ACTIONS, getActionDomainId } from "../../../../synapse-capabilities/shared/registry"
import { createAppCapabilityDispatcher } from "../../../dispatcher"

const prodAction = "app.connectors.portal_link.credential.get"
const testAction = "app.connectors.portal_link_test.credential.get"
const context = { source: "mcp-http" as const, actor: { kind: "user" as const, id: "caller" } }
function authenticated(id = "owner"): SynapseAccountState {
  return { status: "authenticated", connectivity: "offline", profile: { user: { id, email: "synthetic@example.test", handle: id, status: "active" }, syncedAt: "2026-10-22T00:00:00Z" } }
}
function setup() {
  let accountState = authenticated()
  const sessions = new Map<string, PortalSessionInput>([
    ["portal-headless", { connectionGeneration: "prod-1", userId: "owner", environmentId: "prod", baseUrl: "https://biz-api.wodecorp.cn", language: "zh-CN", credential: { token: "prod-secret-canary", tenantId: "prod-tenant" }, account: { portalUserId: "prod-user", tenantId: "prod-tenant", displayName: "正式用户", tenantName: "正式企业" } }],
    ["portal-headless-test", { connectionGeneration: "test-1", userId: "owner", environmentId: "test", baseUrl: "https://biz-api-test.wodecorp.cn", language: "zh-CN", credential: { token: "test-secret-canary", tenantId: "test-tenant" }, account: { portalUserId: "test-user", tenantId: "test-tenant" } }],
  ])
  const getSessionInput = vi.fn(async (id: string) => {
    const session = sessions.get(id)
    if (!session) throw new Error("synthetic-secret-in-error")
    return structuredClone(session)
  })
  const auditSink = { record: vi.fn() }
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
  const dispatch = createPortalCredentialDispatcher({ connectors: { getSessionInput }, account: { getState: () => accountState }, permissionGuard: permissionGuard as never, auditSink: auditSink as never }).dispatch
  return { dispatch, sessions, getSessionInput, auditSink, permissionGuard, setAccount(state: SynapseAccountState) { accountState = state } }
}
afterEach(() => vi.unstubAllGlobals())

describe("Portal connector credentials", () => {
  it("reads production and test independently while offline, without a network request", async () => {
    const fetch = vi.fn(() => { throw new Error("Network is forbidden") })
    vi.stubGlobal("fetch", fetch)
    const h = setup()
    expect(await h.dispatch(prodAction, {}, context)).toEqual({ ok: true, data: { environment: "prod", baseUrl: "https://biz-api.wodecorp.cn", language: "zh-CN", token: "prod-secret-canary", tenantId: "prod-tenant", portalUserId: "prod-user", displayName: "正式用户", tenantName: "正式企业" } })
    expect(await h.dispatch(testAction, {}, { source: "mcp-stdio" })).toEqual({ ok: true, data: { environment: "test", baseUrl: "https://biz-api-test.wodecorp.cn", language: "zh-CN", token: "test-secret-canary", tenantId: "test-tenant", portalUserId: "test-user" } })
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(h.auditSink.record.mock.calls)).not.toContain("secret-canary")
    expect(h.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "secret.read", actor: context.actor }))
  })
  it.each([
    ["portal-headless-test", testAction, prodAction, "prod-secret-canary"],
    ["portal-headless", prodAction, testAction, "test-secret-canary"],
  ])("does not fall back after %s disconnects", async (id, disconnected, connected, token) => {
    const h = setup(); h.sessions.delete(id)
    const result = await h.dispatch(disconnected, {}, context)
    expect(result).toMatchObject({ ok: false, code: "CREDENTIAL_UNAVAILABLE" })
    expect(JSON.stringify(result)).not.toContain("synthetic-secret")
    expect(await h.dispatch(connected, {}, context)).toMatchObject({ ok: true, data: { token } })
  })
  it.each([{ environment: "test" }, { connectorId: "other" }, { baseUrl: "https://other.invalid" }, { owner: "other" }])("rejects argument overrides %j", async (params) => {
    const h = setup()
    expect(await h.dispatch(prodAction, params, context)).toMatchObject({ ok: false, code: "INVALID_INPUT" })
    expect(h.getSessionInput).not.toHaveBeenCalled()
  })
  it.each(["api", "workflow", "app.deep_link", undefined] as const)("does not expose credentials to %s", async (source) => {
    const h = setup()
    expect(await h.dispatch(prodAction, {}, { source })).toMatchObject({ ok: false, code: "MCP_REQUIRED" })
    expect(h.getSessionInput).not.toHaveBeenCalled()
  })
  it("requires an active SY account and permission before reading", async () => {
    const h = setup(); h.setAccount({ status: "unauthenticated" })
    expect(await h.dispatch(prodAction, {}, context)).toMatchObject({ ok: false, code: "SY_AUTH_REQUIRED" })
    h.setAccount(authenticated()); h.permissionGuard.check.mockResolvedValue({ allowed: false })
    expect(await h.dispatch(prodAction, {}, context)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" })
    expect(h.getSessionInput).not.toHaveBeenCalled()
    expect(h.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
  })
  it.each(["account", "generation", "environment", "owner", "abort"])("rejects a changed %s while credentials are being read", async (change) => {
    const h = setup(); const controller = new AbortController()
    h.getSessionInput.mockImplementationOnce(async (id) => {
      const initial = structuredClone(h.sessions.get(id)!)
      if (change === "account") h.setAccount(authenticated("other"))
      if (change === "generation") h.sessions.get(id)!.connectionGeneration = "replacement"
      if (change === "environment") h.sessions.get(id)!.environmentId = "test"
      if (change === "owner") h.sessions.get(id)!.userId = "other"
      if (change === "abort") controller.abort()
      return initial
    })
    expect(await h.dispatch(prodAction, {}, { ...context, abortSignal: controller.signal })).toMatchObject({ ok: false, code: "CONNECTION_CHANGED" })
    expect(JSON.stringify(h.auditSink.record.mock.calls)).not.toContain("secret-canary")
  })
  it("fails closed when permission or audit throws sensitive errors", async () => {
    const h = setup()
    h.permissionGuard.check.mockRejectedValueOnce(new Error("permission-secret-canary"))
    expect(await h.dispatch(prodAction, {}, context)).toMatchObject({ ok: false, code: "CREDENTIAL_UNAVAILABLE" })
    h.auditSink.record.mockImplementation(() => { throw new Error("audit-secret-canary") })
    const result = await h.dispatch(prodAction, {}, context)
    expect(result).toMatchObject({ ok: false, code: "CREDENTIAL_UNAVAILABLE" })
    expect(JSON.stringify(result)).not.toContain("secret-canary")
  })
  it("registers only the two new app tools and retires the extension tool", async () => {
    expect(MCP_TOOL_ACTIONS.app_connectors_portal_link_credential_get).toBe(prodAction)
    expect(MCP_TOOL_ACTIONS.app_connectors_portal_link_test_credential_get).toBe(testAction)
    expect(MCP_TOOL_ACTIONS.extend_portal_headless_credential_get).toBeUndefined()
    expect(getActionDomainId("extend.portal-headless.credential.get")).toBeNull()
    expect(buildSynapseToolRouterTools().map((tool) => tool.name)).toEqual(["search", "invoke"])
    for (const [query, name] of [["Portal Link 凭证", "app_connectors_portal_link_credential_get"], ["我的 Portal 信息", "app_connectors_portal_link_credential_get"], ["Portal 测试环境凭证", "app_connectors_portal_link_test_credential_get"]]) {
      const result = await searchSynapseTools({ query })
      expect(result.tools[0]).toMatchObject({ name, domain: "app", inputSchema: { type: "object", properties: {}, additionalProperties: false } })
      expect(JSON.stringify(result.tools)).not.toMatch(/headless|\/api\/extend\//i)
    }
  })
  it("dispatches both actions through the app router with MCP source checks intact", async () => {
    const h = setup()
    const unused = { dispatch: vi.fn() }
    const router = createAppCapabilityDispatcher({ account: unused, agentConversation: unused, documentTemplate: unused, textExtractor: unused, systemNotifier: unused, fileOpener: unused, textFileWriter: unused, htmlGenerator: unused, problemFeedback: unused, jsonRepair: unused, connectorCredentials: { dispatch: h.dispatch } })
    expect(await router.dispatch(prodAction, {}, context)).toMatchObject({ ok: true, data: { environment: "prod" } })
    expect(await router.dispatch(testAction, {}, { source: "api" })).toMatchObject({ ok: false, code: "MCP_REQUIRED" })
  })
})
