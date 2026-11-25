import { describe, expect, it, vi } from "vitest"
import { createStateSyncCapabilityDispatcher } from "../dispatcher"
import {
  STATE_SYNC_DOMAIN,
  STATE_SYNC_MCP_TOOL_ACTIONS,
  buildStateSyncTools,
} from "../../shared/capability"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../../electron/generated/deployment-config.generated"

const caller = { source: "mcp-http", actor: { kind: "agent", id: "agent-1" } } as const
const stdioCaller = { source: "mcp-stdio", actor: { kind: "agent", id: "agent-stdio" } } as const

function build() {
  let identityChange: (() => void) | undefined
  const scope = { accountId: "signed-in", authRevision: 1 }
  const account = {
    captureAccountRequestScope: vi.fn<() => typeof scope | null>(() => scope),
    onBeforeIdentityChange: vi.fn((listener: () => void) => {
      identityChange = listener
      return () => { identityChange = undefined }
    }),
    fetchAuthenticated: vi.fn<(
      path: string,
      init?: RequestInit,
      message?: string,
      scope?: { accountId: string | null; authRevision: number },
    ) => Promise<Response>>(),
  }
  const permissionGuard = {
    check: vi.fn(async () => ({ allowed: true, reason: "allowed", policyId: "test" })),
  }
  const auditSink = { record: vi.fn() }
  const dispatch = createStateSyncCapabilityDispatcher({ account, permissionGuard, auditSink }).dispatch
  return { dispatch, account, permissionGuard, auditSink, changeIdentity: () => identityChange?.() }
}

describe("state_sync MCP capability", () => {
  it("exposes all 14 canonical state_sync tools with strict JSON schemas", () => {
    expect(STATE_SYNC_DOMAIN.id).toBe("state_sync")
    expect(STATE_SYNC_DOMAIN.capabilities).toHaveLength(14)
    expect(Object.keys(STATE_SYNC_MCP_TOOL_ACTIONS)).toHaveLength(14)
    const tools = buildStateSyncTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      "app_state_sync_doc_create",
      "app_state_sync_doc_delete",
      "app_state_sync_doc_get",
      "app_state_sync_doc_list",
      "app_state_sync_doc_mutate",
      "app_state_sync_publish_preflight_get",
      "app_state_sync_space_create",
      "app_state_sync_space_delete",
      "app_state_sync_space_get",
      "app_state_sync_space_list",
      "app_state_sync_space_update",
      "app_state_sync_token_create",
      "app_state_sync_token_list",
      "app_state_sync_token_revoke",
    ])
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object")
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
  })

  it("runs publish preflight with SDK metadata, environment mismatch detection, and 404 handling", async () => {
    const f = build()
    const origin = new URL(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).origin
    const wsOrigin = origin.replace(/^https:\/\//iu, "wss://").replace(/^http:\/\//iu, "ws://")
    const payload = {
      ready: true,
      accountId: "signed-in",
      publicAppUrl: origin,
      publicHttpBaseUrl: `${origin}/api/open/v1/state-sync`,
      publicWsBaseUrl: `${wsOrigin}/api/open/v1/state-sync`,
      audience: "local_only",
      sdkManifestUrl: `${origin}/sdk/manifest.json`,
      stateSyncSdkManifestUrl: `${origin}/sdk/state-sync/manifest.json`,
      latestStateSyncSdkVersion: "1.0.0",
      sdkUrls: {
        browserGlobal: `${origin}/sdk/state-sync/v1/state-sync.global.min.js`,
        esm: `${origin}/sdk/state-sync/v1/state-sync.esm.min.js`,
        cjs: `${origin}/sdk/state-sync/v1/state-sync.cjs`,
        types: `${origin}/sdk/state-sync/v1/index.d.ts`,
      },
    }
    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json(payload))
    expect(await f.dispatch("app.state_sync.publish_preflight.get", {}, caller)).toEqual({ ok: true, data: payload })
    expect(f.account.fetchAuthenticated.mock.calls[0]?.slice(0, 2)).toEqual([
      "/console/state-sync/preflight",
      expect.objectContaining({ method: "GET", body: undefined }),
    ])

    f.account.fetchAuthenticated.mockResolvedValueOnce(
      Response.json({ ...payload, publicAppUrl: "https://other-host.example" }),
    )
    expect(await f.dispatch("app.state_sync.publish_preflight.get", {}, stdioCaller)).toMatchObject({
      ok: true,
      data: { audience: "environment_mismatch", desktopPublicAppUrl: origin },
    })

    f.account.fetchAuthenticated.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }))
    expect(await f.dispatch("app.state_sync.publish_preflight.get", {}, caller)).toMatchObject({
      ok: false,
      code: "STATE_SYNC_PREFLIGHT_UNAVAILABLE",
    })
  })

  it("routes all 14 actions to /console/state-sync/* with PermissionGuard and AuditSink", async () => {
    const f = build()
    const calls: Array<{
      action: string
      params: Record<string, unknown>
      expectedPath: string
      expectedMethod: string
      response: unknown
      status?: number
    }> = [
      {
        action: "app.state_sync.space.list",
        params: {},
        expectedPath: "/console/state-sync/spaces",
        expectedMethod: "GET",
        response: { data: [{ id: "sp_1", name: "五子棋大厅" }] },
      },
      {
        action: "app.state_sync.space.get",
        params: { spaceId: "sp_1" },
        expectedPath: "/console/state-sync/spaces/sp_1",
        expectedMethod: "GET",
        response: { id: "sp_1", name: "五子棋大厅" },
      },
      {
        action: "app.state_sync.space.create",
        params: { name: "五子棋大厅", description: "双人对战", defaultDocTtlSeconds: 3600, maxDocs: 50 },
        expectedPath: "/console/state-sync/spaces",
        expectedMethod: "POST",
        response: { id: "sp_1", name: "五子棋大厅" },
        status: 201,
      },
      {
        action: "app.state_sync.space.update",
        params: { spaceId: "sp_1", name: "五子棋大厅 v2" },
        expectedPath: "/console/state-sync/spaces/sp_1",
        expectedMethod: "PATCH",
        response: { id: "sp_1", name: "五子棋大厅 v2" },
      },
      {
        action: "app.state_sync.space.delete",
        params: { spaceId: "sp_1" },
        expectedPath: "/console/state-sync/spaces/sp_1",
        expectedMethod: "DELETE",
        response: { deleted: true },
      },
      {
        action: "app.state_sync.token.list",
        params: { spaceId: "sp_1" },
        expectedPath: "/console/state-sync/spaces/sp_1/tokens",
        expectedMethod: "GET",
        response: { data: [{ id: "sst_1", role: "create_write" }] },
      },
      {
        action: "app.state_sync.token.create",
        params: { spaceId: "sp_1", name: "玩家端", role: "create_write" },
        expectedPath: "/console/state-sync/spaces/sp_1/tokens",
        expectedMethod: "POST",
        response: { token: { id: "sst_1" }, secret: "sys_secret_123" },
        status: 201,
      },
      {
        action: "app.state_sync.token.revoke",
        params: { spaceId: "sp_1", tokenId: "sst_1" },
        expectedPath: "/console/state-sync/spaces/sp_1/tokens/sst_1",
        expectedMethod: "DELETE",
        response: { revoked: true },
      },
      {
        action: "app.state_sync.doc.list",
        params: { spaceId: "sp_1", limit: 20, cursor: "ssd_prev" },
        expectedPath: "/console/state-sync/spaces/sp_1/docs?limit=20&cursor=ssd_prev",
        expectedMethod: "GET",
        response: { data: [{ docId: "ssd_1", rev: 0 }], nextCursor: null },
      },
      {
        action: "app.state_sync.doc.create",
        params: { spaceId: "sp_1", docId: "room-001", initialData: { turn: "X" }, ttlSeconds: 3600 },
        expectedPath: "/console/state-sync/spaces/sp_1/docs",
        expectedMethod: "POST",
        response: { spaceId: "sp_1", docId: "room-001", rev: 0 },
        status: 201,
      },
      {
        action: "app.state_sync.doc.get",
        params: { spaceId: "sp_1", docId: "room:001", path: "/board/0" },
        expectedPath: "/console/state-sync/spaces/sp_1/docs/room%3A001?path=%2Fboard%2F0",
        expectedMethod: "GET",
        response: { spaceId: "sp_1", docId: "room:001", path: "/board/0", exists: true, value: "X", rev: 1 },
      },
      {
        action: "app.state_sync.doc.mutate",
        params: { spaceId: "sp_1", docId: "room-001", op: "set", path: "/turn", value: "O", expectedRev: 1 },
        expectedPath: "/console/state-sync/spaces/sp_1/docs/room-001",
        expectedMethod: "PATCH",
        response: { rev: 2, changed: true, expiresAt: null },
      },
      {
        action: "app.state_sync.doc.delete",
        params: { spaceId: "sp_1", docId: "room-001" },
        expectedPath: "/console/state-sync/spaces/sp_1/docs/room-001",
        expectedMethod: "DELETE",
        response: { deleted: true },
      },
    ]

    for (const [index, entry] of calls.entries()) {
      f.account.fetchAuthenticated.mockResolvedValueOnce(
        Response.json(entry.response, { status: entry.status ?? 200 }),
      )
      const res = await f.dispatch(entry.action, entry.params, caller)
      expect(res, entry.action).toEqual({ ok: true, data: entry.response })
      expect(f.account.fetchAuthenticated.mock.calls[index]?.[0], entry.action).toBe(entry.expectedPath)
      expect(f.account.fetchAuthenticated.mock.calls[index]?.[1], entry.action).toMatchObject({
        method: entry.expectedMethod,
      })
    }

    // Verify doc.create preserves optional custom docId in request body while doc.mutate excludes path params.
    const docCreateInit = f.account.fetchAuthenticated.mock.calls[9]?.[1]
    expect(JSON.parse(String(docCreateInit?.body))).toEqual({
      docId: "room-001",
      initialData: { turn: "X" },
      ttlSeconds: 3600,
    })
    const docMutateInit = f.account.fetchAuthenticated.mock.calls[11]?.[1]
    expect(JSON.parse(String(docMutateInit?.body))).toEqual({
      op: "set",
      path: "/turn",
      value: "O",
      expectedRev: 1,
    })

    expect(f.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "synapse-state-sync",
      actor: caller.actor,
    }))
    expect(f.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "synapse-state-sync",
      outcome: "allowed",
    }))
    expect(JSON.stringify(f.auditSink.record.mock.calls)).not.toContain("五子棋大厅")
    expect(JSON.stringify(f.auditSink.record.mock.calls)).not.toContain("sys_secret_123")
  })

  it("enforces mcp-http/mcp-stdio boundary, strict validation, path traversal checks, and permissionGuard", async () => {
    const f = build()
    expect(await f.dispatch("app.state_sync.space.list", {}, { source: "api" })).toMatchObject({
      ok: false,
      code: "STATE_SYNC_FORBIDDEN",
    })
    expect(await f.dispatch("app.state_sync.space.list", {}, { source: "ipc" })).toMatchObject({
      ok: false,
      code: "STATE_SYNC_FORBIDDEN",
    })

    for (const [action, args] of [
      ["app.state_sync.space.get", { spaceId: ".." }],
      ["app.state_sync.space.get", { spaceId: "a/b" }],
      ["app.state_sync.space.create", { name: "ok", apiKey: "unexpected" }],
      ["app.state_sync.space.update", { spaceId: "sp_1" }],
      ["app.state_sync.token.create", { spaceId: "sp_1", name: "bad", role: "admin" }],
      ["app.state_sync.doc.get", { spaceId: "sp_1", docId: "../escape" }],
      ["app.state_sync.doc.get", { spaceId: "sp_1", docId: "room-1", path: "no-leading-slash" }],
      ["app.state_sync.doc.mutate", { spaceId: "sp_1", docId: "room-1", op: "delete", path: "/" }],
      ["app.state_sync.doc.mutate", { spaceId: "sp_1", docId: "room-1", op: "patch", path: "/a", value: "not-object" }],
      ["app.state_sync.doc.create", { spaceId: "sp_1", docId: "x" }],
    ] as const) {
      expect(await f.dispatch(action, args, caller), action).toMatchObject({
        ok: false,
        code: "STATE_SYNC_INVALID_INPUT",
      })
    }

    f.account.captureAccountRequestScope.mockReturnValueOnce(null)
    expect(await f.dispatch("app.state_sync.space.list", {}, caller)).toMatchObject({
      ok: false,
      code: "STATE_SYNC_ACCOUNT_REQUIRED",
    })

    f.permissionGuard.check.mockResolvedValueOnce({ allowed: false, reason: "denied", policyId: "test" })
    expect(await f.dispatch("app.state_sync.space.list", {}, caller)).toMatchObject({
      ok: false,
      code: "STATE_SYNC_FORBIDDEN",
    })
    expect(f.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
    expect(f.account.fetchAuthenticated).not.toHaveBeenCalled()
  })

  it("aborts in-flight requests on desktop account switch and returns STATE_SYNC_ACCOUNT_CHANGED", async () => {
    const f = build()
    f.account.fetchAuthenticated.mockImplementation(async (_path, init) => {
      f.changeIdentity()
      expect(init?.signal?.aborted).toBe(true)
      return Response.json({ data: [{ id: "sp_old", name: "旧账号空间" }] })
    })
    const result = await f.dispatch("app.state_sync.space.list", {}, caller)
    expect(result).toMatchObject({ ok: false, code: "STATE_SYNC_ACCOUNT_CHANGED" })
    expect(JSON.stringify(result)).not.toContain("旧账号空间")
  })
})
