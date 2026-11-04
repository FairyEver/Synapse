import { describe, expect, it, vi } from "vitest"
import { createCloudTableCapabilityDispatcher } from "../dispatcher"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../../electron/generated/deployment-config.generated"

const caller = { source: "mcp-http", actor: { kind: "agent", id: "agent-1" } } as const
const build = () => {
  let identityChange: (() => void) | undefined
  const scope = { accountId: "signed-in", authRevision: 1 }
  const account = {
    captureAccountRequestScope: vi.fn<() => typeof scope | null>(() => scope),
    onBeforeIdentityChange: vi.fn((listener: () => void) => {
      identityChange = listener
      return () => { identityChange = undefined }
    }),
    fetchAuthenticated: vi.fn<(
      path: string, init?: RequestInit, message?: string, scope?: { accountId: string | null; authRevision: number },
    ) => Promise<Response>>(),
  }
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true, reason: "allowed", policyId: "test" })) }
  const auditSink = { record: vi.fn() }
  const dispatch = createCloudTableCapabilityDispatcher({ account, permissionGuard, auditSink }).dispatch
  return { dispatch, account, permissionGuard, auditSink, changeIdentity: () => identityChange?.() }
}

describe("cloud table MCP", () => {
  it("checks the pinned account and reports a deployment mismatch without publishing", async () => {
    const f = build()
    const origin = new URL(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).origin
    const accountId = "signed-in"
    const local = { accountId, publicAppUrl: origin, audience: "local_only", capabilities: { anonymousCreate: true, publicCount: true } }
    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json(local))
    expect(await f.dispatch("app.cloud_tables.publish_preflight.get", {}, caller)).toEqual({ ok: true, data: local })
    expect(f.account.fetchAuthenticated.mock.calls[0]?.slice(0, 2)).toEqual(["/console/tables/publish-preflight", expect.objectContaining({ method: "GET", body: undefined })])
    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json({ ...local, publicAppUrl: "https://mismatch.example" }))
    expect(await f.dispatch("app.cloud_tables.publish_preflight.get", {}, caller)).toMatchObject({ ok: true, data: { audience: "environment_mismatch", desktopPublicAppUrl: origin } })
    f.account.fetchAuthenticated.mockRejectedValueOnce(Object.assign(new Error(), { status: 404 }))
    expect(await f.dispatch("app.cloud_tables.publish_preflight.get", {}, caller)).toMatchObject({ ok: false, code: "CLOUD_TABLE_PREFLIGHT_UNAVAILABLE" })
  })
  it("creates a table via the pinned desktop account and audits without record content", async () => {
    const f = build()
    f.account.fetchAuthenticated.mockResolvedValue(Response.json({ id: "table_1", schemaVersion: 1 }, { status: 201 }))
    const args = { name: "中午吃什么", fields: [{ key: "dish", name: "想吃什么", type: "text", required: true }], idempotencyKey: "lunch-create" }
    expect(await f.dispatch("app.cloud_tables.table.create", args, caller)).toMatchObject({
      ok: true, data: { id: "table_1", schemaVersion: 1 },
    })
    const [path, init, , scope] = f.account.fetchAuthenticated.mock.calls[0]!
    expect(path).toBe("/console/tables")
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" })
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("lunch-create")
    expect(JSON.parse(String(init?.body))).toEqual({ name: args.name, fields: args.fields })
    expect(scope).toEqual({ accountId: "signed-in", authRevision: 1 })
    expect(f.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "network.connect", actor: caller.actor }))
    expect(f.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "allowed" }))
    expect(JSON.stringify(f.auditSink.record.mock.calls)).not.toContain(args.name)
  })

  it("never sends credential overrides, traversal IDs, or calls from other surfaces", async () => {
    const f = build()
    for (const [action, args] of [
      ["app.cloud_tables.table.get", { tableId: ".." }],
      ["app.cloud_tables.table.get", { tableId: "a%2fb" }],
      ["app.cloud_tables.record.get", { tableId: "table_1", recordId: "Trash" }],
      ["app.cloud_tables.table.create", { name: "午餐", apiKey: "not-an-input" }],
    ] as const) {
      expect(await f.dispatch(action, args, caller)).toMatchObject({ ok: false, code: "CLOUD_TABLE_INVALID_INPUT" })
    }
    expect(await f.dispatch("app.cloud_tables.table.list", {}, { source: "api" })).toMatchObject({ ok: false, code: "CLOUD_TABLE_FORBIDDEN" })
    expect(f.account.fetchAuthenticated).not.toHaveBeenCalled()
  })

  it("requires an online account and honors a denied local permission", async () => {
    const f = build()
    f.account.captureAccountRequestScope.mockReturnValueOnce(null)
    expect(await f.dispatch("app.cloud_tables.table.list", {}, caller)).toMatchObject({ ok: false, code: "CLOUD_TABLE_ACCOUNT_REQUIRED" })
    f.permissionGuard.check.mockResolvedValueOnce({ allowed: false, reason: "denied", policyId: "test" })
    expect(await f.dispatch("app.cloud_tables.table.list", {}, caller)).toMatchObject({ ok: false, code: "CLOUD_TABLE_FORBIDDEN" })
    expect(f.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
    expect(f.account.fetchAuthenticated).not.toHaveBeenCalled()
  })

  it("discards a late response after the account changes, even if fetch ignored the abort", async () => {
    const f = build()
    f.account.fetchAuthenticated.mockImplementation(async (_path, init) => {
      f.changeIdentity()
      expect(init?.signal?.aborted).toBe(true)
      return Response.json({ data: [{ name: "old account table" }], nextCursor: null })
    })
    const result = await f.dispatch("app.cloud_tables.table.list", {}, caller)
    expect(result).toMatchObject({ ok: false, code: "CLOUD_TABLE_ACCOUNT_CHANGED" })
    expect(JSON.stringify(result)).not.toContain("old account table")
  })

  it("preserves a structured conflict code and drops remote error text", async () => {
    const f = build()
    f.account.fetchAuthenticated.mockRejectedValue(Object.assign(new Error("private response body"), {
      status: 409, code: "VERSION_CONFLICT", requestId: "req-123",
    }))
    const result = await f.dispatch("app.cloud_tables.table.update", { tableId: "table_1", version: 2, name: "午餐" }, caller)
    expect(result).toMatchObject({ ok: false, code: "VERSION_CONFLICT", data: { status: 409, requestId: "req-123" } })
    expect(JSON.stringify(result)).not.toContain("private response body")
  })
})
