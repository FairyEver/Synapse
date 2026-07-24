import { describe, expect, it, vi } from "vitest"
import { SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID } from "../../shared/capability"
import { createSystemNotifierCapabilityDispatcher, mcpIdentityKey } from "../dispatcher"

describe("system notifier dispatcher", () => {
  it("returns the fixed success shape and forwards only trusted context", async () => {
    const trigger = vi.fn().mockReturnValue({ success: true })
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { trigger } })
    await expect(dispatcher.dispatch(
      SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      { title: "Title", body: "Body" },
      {
        source: "mcp-http",
        clientId: "client-1",
        controllerInstanceId: "controller-1",
        actor: { kind: "agent", id: "agent-1" },
      },
    )).resolves.toEqual({ ok: true, data: { success: true } })
    expect(trigger).toHaveBeenCalledWith(
      { title: "Title", body: "Body" },
      expect.objectContaining({
        source: "mcp-http",
        clientId: "client-1",
        controllerInstanceId: "controller-1",
      }),
    )
  })

  it("returns the shared INVALID_INPUT result without entering the service", async () => {
    const trigger = vi.fn()
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { trigger } })
    await expect(dispatcher.dispatch(
      SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      { title: " Title", body: "Body" },
      { source: "mcp-stdio" },
    )).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      error: "Invalid system notification input.",
      data: { field: "title", reason: "leading_or_trailing_whitespace" },
    })
    expect(trigger).not.toHaveBeenCalled()
  })

  it("rejects non-MCP entry sources before validation", async () => {
    const trigger = vi.fn()
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { trigger } })
    await expect(dispatcher.dispatch(
      SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      { title: "Title", body: "Body" },
      { source: "workflow" },
    )).rejects.toThrow("trusted MCP source")
    expect(trigger).not.toHaveBeenCalled()
  })

  it("uses the specified stable identity fallback order", () => {
    const actor = { kind: "agent", id: "agent-1" } as const
    expect(mcpIdentityKey("mcp-http", "client", "controller", actor)).toContain("controller")
    expect(mcpIdentityKey("mcp-http", "client", undefined, actor)).toContain("client")
    expect(mcpIdentityKey("mcp-http", undefined, undefined, actor)).toContain("agent-1")
    expect(mcpIdentityKey("mcp-stdio", undefined, undefined, { kind: "system" }))
      .toBe("mcp-stdio\u0000anonymous")
  })
})
