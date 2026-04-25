import { describe, expect, it } from "vitest"
import {
  AutomationHookManager,
  hookEventToEnv,
  matchHookEvent,
  validateHookConfig,
} from "../../electron/services/automation-hooks-service"

describe("automation hooks service", () => {
  it("validates configs and keeps only valid hooks", () => {
    expect(() => validateHookConfig({ event: "", type: "command", command: "echo ok" })).toThrow("event is required")
    expect(() => validateHookConfig({ event: "error", type: "command" })).toThrow("command is required")
    expect(() => validateHookConfig({ event: "error", type: "http", url: "ftp://bad" })).toThrow("url must start")
    expect(() => validateHookConfig({ event: "error", type: "unknown" })).toThrow("unknown handler type")

    const manager = new AutomationHookManager("proj", [
      { event: "message.received", type: "command", command: "echo ok" },
      { event: "", type: "command", command: "echo bad" },
      { event: "error", type: "http", url: "https://example.test/hook" },
    ])
    expect(manager.listHooks()).toHaveLength(2)
  })

  it("matches exact events case-insensitively and wildcard events", () => {
    expect(matchHookEvent("*", "message.received")).toBe(true)
    expect(matchHookEvent("MESSAGE.RECEIVED", "message.received")).toBe(true)
    expect(matchHookEvent("message.sent", "message.received")).toBe(false)
  })

  it("builds command hook env and returns a permission-gated plan without running shell", async () => {
    const manager = new AutomationHookManager("my-proj", [
      { event: "message.received", type: "command", command: "touch /tmp/should-not-run", async: false },
    ], {
      now: () => new Date("2026-04-26T01:00:00.000Z"),
    })

    const results = await manager.emit({
      event: "message.received",
      sessionKey: "slack:C1:U1",
      platform: "slack",
      userId: "U1",
      userName: "bob",
      content: "hello",
    })

    expect(results).toEqual([{
      status: "permission_required",
      type: "command",
      event: "message.received",
      command: "touch /tmp/should-not-run",
      env: {
        CC_HOOK_EVENT: "message.received",
        CC_HOOK_PROJECT: "my-proj",
        CC_HOOK_TIMESTAMP: "2026-04-26T01:00:00.000Z",
        CC_HOOK_SESSION_KEY: "slack:C1:U1",
        CC_HOOK_PLATFORM: "slack",
        CC_HOOK_USER_ID: "U1",
        CC_HOOK_USER_NAME: "bob",
        CC_HOOK_CONTENT: "hello",
      },
      timeoutMs: 10_000,
      requiresPermission: true,
    }])
  })

  it("delivers HTTP hooks through injected transport and reports HTTP 500", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string; timeoutMs: number }> = []
    const manager = new AutomationHookManager("proj", [
      { event: "error", type: "http", url: "https://example.test/hook", async: false },
      { event: "error", type: "http", url: "https://example.test/fail", async: false, timeout: 3 },
    ], {
      httpTransport: async (input) => {
        calls.push(input)
        return { statusCode: input.url.endsWith("/fail") ? 500 : 200 }
      },
      now: () => new Date("2026-04-26T02:00:00.000Z"),
    })

    const results = await manager.emit({ event: "error", error: "boom" })

    expect(results).toEqual([
      {
        status: "delivered",
        type: "http",
        event: "error",
        url: "https://example.test/hook",
        statusCode: 200,
        timeoutMs: 5_000,
      },
      {
        status: "failed",
        type: "http",
        event: "error",
        error: "http response error: 500",
        statusCode: 500,
        timeoutMs: 3_000,
      },
    ])
    expect(calls[0]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "User-Agent": "Synapse-Hooks/1.0",
      "X-Hook-Event": "error",
    })
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      event: "error",
      project: "proj",
      error: "boom",
    })
  })

  it("queues async hooks and can drain their run results", async () => {
    const manager = new AutomationHookManager("proj", [
      { event: "*", type: "http", url: "https://example.test/hook" },
    ], {
      httpTransport: async () => ({ statusCode: 204 }),
    })

    await expect(manager.emit({ event: "session.started" })).resolves.toEqual([{
      status: "queued",
      type: "http",
      event: "session.started",
    }])
    await expect(manager.drainAsync()).resolves.toMatchObject([{
      status: "delivered",
      type: "http",
      statusCode: 204,
    }])
  })

  it("omits empty env fields and reports injected transport failures", async () => {
    expect(hookEventToEnv({
      event: "cron.triggered",
      project: "proj",
      timestamp: new Date("2026-04-26T03:00:00.000Z"),
    })).toEqual({
      CC_HOOK_EVENT: "cron.triggered",
      CC_HOOK_PROJECT: "proj",
      CC_HOOK_TIMESTAMP: "2026-04-26T03:00:00.000Z",
    })

    const manager = new AutomationHookManager("proj", [
      { event: "error", type: "http", url: "https://example.test/hook", async: false },
    ], {
      httpTransport: async () => {
        throw new Error("timeout")
      },
    })

    await expect(manager.emit({ event: "error" })).resolves.toEqual([{
      status: "failed",
      type: "http",
      event: "error",
      error: "timeout",
      timeoutMs: 5_000,
    }])
  })
})
