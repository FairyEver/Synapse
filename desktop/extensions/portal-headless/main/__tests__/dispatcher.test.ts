import { describe, expect, it, vi } from "vitest"
import { createPortalHeadlessDispatcher } from "../dispatcher"
import { PORTAL_CREDENTIAL_ACTION, PORTAL_CREDENTIAL_TOOL } from "../../shared/capability"
import { buildSynapseToolRouterTools, searchSynapseTools } from "../../../../electron/services/agent-runtime/synapse-tool-router"
import { capabilityIdToIpcChannel, capabilityIdToMcpTool, isCanonicalCapabilityId } from "../../../../synapse-capabilities/shared/naming"

function setup() {
  let generation = "one"
  const account = {
    getState: vi.fn(() => ({ status: "authenticated", profile: { user: { id: "owner", status: "active" } } })),
    getApiBaseUrlForLive: () => "https://synapse.example/api",
    fetchAuthenticated: vi.fn(async () => new Response(JSON.stringify({ accessToken: "sy-extension-canary", expiresAt: "2026-09-22T12:30:00.000Z" }))),
  }
  const connectors = { getSessionInput: vi.fn(async () => ({ connectionGeneration: generation, userId: "owner", baseUrl: "https://portal.example", language: "zh-CN", credential: { token: "portal-canary", tenantId: "tenant" } })) }
  const auditSink = { record: vi.fn() }
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })), registerPolicy: vi.fn() }
  const dispatch = createPortalHeadlessDispatcher({ account, connectors, auditSink, permissionGuard } as never).dispatch
  return { dispatch, account, connectors, auditSink, permissionGuard, changeGeneration() { generation = "two" } }
}
const context = { source: "mcp-http" as const, actor: { kind: "user" as const, id: "caller" } }

describe("Portal Headless extension credentials", () => {
  it("returns both credentials for direct HTTP calls and audits no values", async () => {
    const t = setup()
    const result = await t.dispatch(PORTAL_CREDENTIAL_ACTION, {}, context)
    expect(result).toMatchObject({ ok: true, data: { apiBaseUrl: "https://synapse.example/api/extend/portal-headless", authorization: { accessToken: "sy-extension-canary" }, portal: { token: "portal-canary" } } })
    const audit = JSON.stringify(t.auditSink.record.mock.calls)
    expect(audit).not.toContain("canary")
    expect(t.permissionGuard.check.mock.calls).toHaveLength(2)
    expect(t.account.fetchAuthenticated).toHaveBeenCalledWith("/extend/portal-headless/access", expect.objectContaining({ redirect: "error" }), expect.any(String))
  })
  it("rejects a connection changed while the SY grant was being issued", async () => {
    const t = setup()
    t.account.fetchAuthenticated.mockImplementation(async () => { t.changeGeneration(); return new Response(JSON.stringify({ accessToken: "canary", expiresAt: "2026-09-22T12:30:00.000Z" })) })
    expect(await t.dispatch(PORTAL_CREDENTIAL_ACTION, {}, context)).toMatchObject({ ok: false, code: "CONNECTION_CHANGED" })
  })
  it("denies credentials outside MCP, on extra arguments, or before permission", async () => {
    const t = setup()
    expect(await t.dispatch(PORTAL_CREDENTIAL_ACTION, {}, { source: "api" })).toMatchObject({ ok: false })
    expect(await t.dispatch(PORTAL_CREDENTIAL_ACTION, { owner: "other" }, context)).toMatchObject({ ok: false })
    t.permissionGuard.check.mockResolvedValue({ allowed: false, reason: "denied" } as never)
    expect(await t.dispatch(PORTAL_CREDENTIAL_ACTION, {}, context)).toMatchObject({ ok: false })
    expect(t.connectors.getSessionInput).not.toHaveBeenCalled()
    expect(t.account.fetchAuthenticated).not.toHaveBeenCalled()
  })
  it("does not disclose a credential-bearing network error", async () => {
    const t = setup()
    t.account.fetchAuthenticated.mockRejectedValue(new Error("Authorization Bearer secret-canary"))
    expect(JSON.stringify(await t.dispatch(PORTAL_CREDENTIAL_ACTION, {}, context))).not.toContain("secret-canary")
    expect(JSON.stringify(t.auditSink.record.mock.calls)).not.toContain("secret-canary")
  })
  it("registers as an extension without widening IPC or the two-tool public surface", async () => {
    expect(isCanonicalCapabilityId(PORTAL_CREDENTIAL_ACTION)).toBe(true)
    expect(capabilityIdToMcpTool(PORTAL_CREDENTIAL_ACTION)).toBe(PORTAL_CREDENTIAL_TOOL)
    expect(() => capabilityIdToIpcChannel(PORTAL_CREDENTIAL_ACTION)).toThrow()
    expect(buildSynapseToolRouterTools().map((tool) => tool.name)).toEqual(["search", "invoke"])
    const search = await searchSynapseTools({ domain: "extend", query: "Portal 凭证" })
    expect(search.tools).toEqual([expect.objectContaining({ name: PORTAL_CREDENTIAL_TOOL, domain: "extend" })])
  })
})
