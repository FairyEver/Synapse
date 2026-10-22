import { describe, expect, it, vi } from "vitest"
import { WecomCliError } from "../cli-client"
import { createWecomCapabilityDispatcher } from "../dispatcher"
import { WecomInvocationService } from "../invocation-service"

function harness(options: {
  readonly output?: string
  readonly runError?: unknown
} = {}) {
  const runAgent = options.runError
    ? vi.fn(async () => { throw options.runError })
    : vi.fn(async () => ({
        output: options.output ?? '{"ok":true}',
        workingDirectory: "/tmp/synapse-wecom-work",
      }))
  const snapshot = vi.fn(async () => ({
    status: "connected" as const,
    enabled: true,
    qrCodeDataUrl: "data:image/png;base64,c2VjcmV0",
    errorMessage: "raw connector detail",
    connectedAt: "2026-10-22T09:00:00Z",
    lastValidatedAt: "2026-10-22T09:05:00Z",
  }))
  const withConnected = vi.fn(async (operation: (context: {
    ownerUserId: string
    client: { runAgent: typeof runAgent }
    signal: AbortSignal
  }) => Promise<unknown>) => operation({
    ownerUserId: "owner-a",
    client: { runAgent },
    signal: new AbortController().signal,
  }))
  const service = new WecomInvocationService({
    connection: { snapshot, withConnected } as never,
  })
  return {
    dispatcher: createWecomCapabilityDispatcher({ service }),
    runAgent,
    snapshot,
    withConnected,
  }
}

describe("Enterprise WeChat capability dispatcher", () => {
  it("returns only safe connection metadata", async () => {
    const h = harness()

    await expect(h.dispatcher.dispatch("app.wecom.connection.get", {}, {})).resolves.toEqual({
      ok: true,
      data: {
        status: "connected",
        enabled: true,
        connectedAt: "2026-10-22T09:00:00Z",
        lastValidatedAt: "2026-10-22T09:05:00Z",
      },
    })
  })

  it("passes canonical args and the trusted controller key to the CLI", async () => {
    const h = harness({ output: '{"sessions":[]}' })

    await expect(h.dispatcher.dispatch(
      "app.wecom.cli.run",
      { args: ["message", "aibot", "sessions", "list"] },
      { controllerInstanceId: "controller-1", source: "mcp-http" },
    )).resolves.toEqual({
      ok: true,
      data: {
        output: { sessions: [] },
        format: "json",
        workingDirectory: "/tmp/synapse-wecom-work",
      },
    })
    expect(h.runAgent).toHaveBeenCalledWith(
      "owner-a",
      "controller-1",
      ["message", "aibot", "sessions", "list"],
      expect.objectContaining({
        metadata: expect.objectContaining({
          operation: "wecom.cli.run",
          service: "message",
          argCount: 4,
        }),
      }),
    )
  })

  it("parses NDJSON and text outputs", async () => {
    const ndjson = harness({ output: '{"page":1}\n{"page":2}\n' })
    await expect(ndjson.dispatcher.dispatch("app.wecom.cli.run", {
      args: ["doc", "search", "--json", "{}", "--page-count", "2"],
    }, {})).resolves.toMatchObject({
      ok: true,
      data: {
        output: [{ page: 1 }, { page: 2 }],
        format: "ndjson",
      },
    })

    const text = harness({ output: "help text" })
    await expect(text.dispatcher.dispatch("app.wecom.cli.run", {
      args: ["schema", "list"],
    }, {})).resolves.toMatchObject({
      ok: true,
      data: { output: "help text", format: "text" },
    })
  })

  it("rejects auth and non-allowlisted services before invoking the connector", async () => {
    const h = harness()

    await expect(h.dispatcher.dispatch("app.wecom.cli.run", {
      args: ["auth", "show", "--status"],
    }, {})).resolves.toMatchObject({
      ok: false,
      code: "WECOM_INVALID_INPUT",
      data: { fields: ["args.0"] },
    })
    await expect(h.dispatcher.dispatch("app.wecom.cli.run", {
      args: ["cache", "clear"],
    }, {})).resolves.toMatchObject({
      ok: false,
      code: "WECOM_INVALID_INPUT",
    })
    expect(h.withConnected).not.toHaveBeenCalled()
  })

  it.each([
    ["disk", "files", "list"],
    ["todo", "list"],
    ["meeting", "create"],
    ["calendar", "agenda"],
    ["slide", "create"],
    ["smartpage", "create"],
    ["doc", "create"],
    ["doc", "import"],
    ["doc", "contents", "get"],
    ["doc", "contents", "append"],
    ["doc", "contents", "overwrite"],
  ])("rejects excluded business commands: %s %s %s", async (...args) => {
    const h = harness()

    await expect(h.dispatcher.dispatch("app.wecom.cli.run", { args }, {})).resolves.toMatchObject({
      ok: false,
      code: "WECOM_INVALID_INPUT",
    })
    expect(h.withConnected).not.toHaveBeenCalled()
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it.each([
    ["message", "aibot", "sessions", "list"],
    ["mail", "search"],
    ["contact", "users", "search"],
    ["media", "download"],
    ["sheet", "create"],
    ["smartsheet", "records", "get"],
    ["doc", "search"],
    ["doc", "names", "update"],
    ["doc", "members", "update"],
    ["doc", "rules", "update"],
    ["identity", "whoami"],
    ["schema", "list"],
  ])("keeps supported business commands: %s %s %s", async (...args) => {
    const h = harness()

    await expect(h.dispatcher.dispatch("app.wecom.cli.run", {
      args: [...args, "--json", "{}"],
    }, {})).resolves.toMatchObject({ ok: true })
    expect(h.runAgent).toHaveBeenCalled()
  })

  it("preserves connector, authentication and enterprise permission failures", async () => {
    const connector = harness({
      runError: new WecomCliError("connector_required", "请先连接企业微信。"),
    })
    await expect(connector.dispatcher.dispatch("app.wecom.cli.run", {
      args: ["identity", "whoami"],
    }, {})).resolves.toMatchObject({
      ok: false,
      code: "WECOM_CONNECTOR_REQUIRED",
    })

    const auth = harness({
      runError: new WecomCliError("auth_required", "企业微信授权已失效。"),
    })
    await expect(auth.dispatcher.dispatch("app.wecom.cli.run", {
      args: ["identity", "whoami"],
    }, {})).resolves.toMatchObject({
      ok: false,
      code: "WECOM_AUTH_REQUIRED",
    })

    const permission = harness({
      runError: new WecomCliError("permission_denied", "当前机器人未被授权「搜索与获取邮件内容」能力。", {
        permission: "搜索与获取邮件内容",
        helpUrl: "https://work.weixin.qq.com/ai/aiHelper/authorizationList?type=7",
      }),
    })
    await expect(permission.dispatcher.dispatch("app.wecom.cli.run", {
      args: ["mail", "search", "--json", "{}"],
    }, {})).resolves.toMatchObject({
      ok: false,
      code: "WECOM_PERMISSION_REQUIRED",
      data: {
        permission: "搜索与获取邮件内容",
        helpUrl: "https://work.weixin.qq.com/ai/aiHelper/authorizationList?type=7",
      },
    })
  })
})
