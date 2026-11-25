import { describe, expect, it, vi } from "vitest"
import { createChannelCapabilityDispatcher } from "../dispatcher"
import { CHANNELS_DOMAIN, CHANNELS_MCP_TOOL_ACTIONS, buildChannelTools } from "../../shared/capability"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../../electron/generated/deployment-config.generated"

const caller = { source: "mcp-http", actor: { kind: "agent", id: "agent-1" } } as const

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
  const dispatch = createChannelCapabilityDispatcher({ account, permissionGuard, auditSink }).dispatch
  return { dispatch, account, permissionGuard, auditSink, changeIdentity: () => identityChange?.() }
}

describe("channels MCP capability", () => {
  it("exposes all 12 canonical channel tools with strict JSON schemas", () => {
    expect(CHANNELS_DOMAIN.id).toBe("channels")
    expect(CHANNELS_DOMAIN.capabilities).toHaveLength(12)
    expect(Object.keys(CHANNELS_MCP_TOOL_ACTIONS)).toHaveLength(12)
    const tools = buildChannelTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      "app_channels_channel_create",
      "app_channels_channel_delete",
      "app_channels_channel_get",
      "app_channels_channel_list",
      "app_channels_channel_update",
      "app_channels_event_publish",
      "app_channels_publish_preflight_get",
      "app_channels_retained_clear",
      "app_channels_state_get",
      "app_channels_token_create",
      "app_channels_token_list",
      "app_channels_token_revoke",
    ])
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object")
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
  })

  it("runs publish preflight with environment mismatch detection and 404 handling", async () => {
    const f = build()
    const origin = new URL(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl).origin
    const payload = {
      accountId: "signed-in",
      publicAppUrl: origin,
      audience: "local_only",
      capabilities: { channels: true, websocket: true, retain: true, presence: true },
    }
    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json(payload))
    expect(await f.dispatch("app.channels.publish_preflight.get", {}, caller)).toEqual({ ok: true, data: payload })
    expect(f.account.fetchAuthenticated.mock.calls[0]?.slice(0, 2)).toEqual([
      "/console/channels/publish-preflight",
      expect.objectContaining({ method: "GET", body: undefined }),
    ])

    f.account.fetchAuthenticated.mockResolvedValueOnce(
      Response.json({ ...payload, publicAppUrl: "https://other-host.example" }),
    )
    expect(await f.dispatch("app.channels.publish_preflight.get", {}, caller)).toMatchObject({
      ok: true,
      data: { audience: "environment_mismatch", desktopPublicAppUrl: origin },
    })

    f.account.fetchAuthenticated.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }))
    expect(await f.dispatch("app.channels.publish_preflight.get", {}, caller)).toMatchObject({
      ok: false,
      code: "CHANNEL_PREFLIGHT_UNAVAILABLE",
    })
  })

  it("creates channels, issues tokens, publishes events, reads state, and clears retained via /console/channels/*", async () => {
    const f = build()
    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json({ id: "ch_1", name: "客厅大屏" }, { status: 201 }))
    expect(await f.dispatch("app.channels.channel.create", { name: "客厅大屏", description: "遥控器" }, caller)).toEqual({
      ok: true,
      data: { id: "ch_1", name: "客厅大屏" },
    })
    expect(f.account.fetchAuthenticated.mock.calls[0]?.[0]).toBe("/console/channels")
    expect(f.permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "synapse-channels",
      actor: caller.actor,
    }))
    expect(f.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "synapse-channels",
      outcome: "allowed",
    }))
    expect(JSON.stringify(f.auditSink.record.mock.calls)).not.toContain("客厅大屏")

    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json({ token: { id: "cht_1" }, secret: "syc_abc" }, { status: 201 }))
    await f.dispatch("app.channels.token.create", { channelId: "ch_1", name: "大屏", role: "subscribe" }, caller)
    expect(f.account.fetchAuthenticated.mock.calls[1]?.[0]).toBe("/console/channels/ch_1/tokens")

    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json({ seq: 3, deliveredCount: 1, retained: true }))
    await f.dispatch("app.channels.event.publish", {
      channelId: "ch_1",
      event: "slide.change",
      payload: { index: 2 },
      retain: true,
    }, caller)
    expect(f.account.fetchAuthenticated.mock.calls[2]?.[0]).toBe("/console/channels/ch_1/events")

    f.account.fetchAuthenticated.mockResolvedValueOnce(Response.json({ deleted: true }))
    await f.dispatch("app.channels.retained.clear", { channelId: "ch_1", event: "slide.change" }, caller)
    expect(f.account.fetchAuthenticated.mock.calls[3]?.[0]).toBe("/console/channels/ch_1/retained/slide.change")
    expect(f.account.fetchAuthenticated.mock.calls[3]?.[1]).toMatchObject({ method: "DELETE" })
  })

  it("enforces mcp-http/mcp-stdio source, strict validation, path traversal checks, and permissionGuard", async () => {
    const f = build()
    expect(await f.dispatch("app.channels.channel.list", {}, { source: "api" })).toMatchObject({
      ok: false,
      code: "CHANNEL_FORBIDDEN",
    })
    for (const [action, args] of [
      ["app.channels.channel.get", { channelId: ".." }],
      ["app.channels.channel.get", { channelId: "a/b" }],
      ["app.channels.channel.create", { name: "ok", apiKey: "unexpected" }],
      ["app.channels.event.publish", { channelId: "ch_1", event: "cmd", payload: {}, retain: true, targetClientId: "pc-1" }],
      ["app.channels.retained.clear", { channelId: "ch_1", event: "../bad" }],
    ] as const) {
      expect(await f.dispatch(action, args, caller)).toMatchObject({ ok: false, code: "CHANNEL_INVALID_INPUT" })
    }

    f.account.captureAccountRequestScope.mockReturnValueOnce(null)
    expect(await f.dispatch("app.channels.channel.list", {}, caller)).toMatchObject({
      ok: false,
      code: "CHANNEL_ACCOUNT_REQUIRED",
    })

    f.permissionGuard.check.mockResolvedValueOnce({ allowed: false, reason: "denied", policyId: "test" })
    expect(await f.dispatch("app.channels.channel.list", {}, caller)).toMatchObject({
      ok: false,
      code: "CHANNEL_FORBIDDEN",
    })
    expect(f.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
    expect(f.account.fetchAuthenticated).not.toHaveBeenCalled()
  })

  it("aborts in-flight requests on desktop account switch and returns CHANNEL_ACCOUNT_CHANGED", async () => {
    const f = build()
    f.account.fetchAuthenticated.mockImplementation(async (_path, init) => {
      f.changeIdentity()
      expect(init?.signal?.aborted).toBe(true)
      return Response.json({ data: [{ id: "ch_old", name: "旧账号频道" }] })
    })
    const result = await f.dispatch("app.channels.channel.list", {}, caller)
    expect(result).toMatchObject({ ok: false, code: "CHANNEL_ACCOUNT_CHANGED" })
    expect(JSON.stringify(result)).not.toContain("旧账号频道")
  })
})
