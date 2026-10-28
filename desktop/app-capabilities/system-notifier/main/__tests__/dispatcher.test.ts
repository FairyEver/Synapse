import { describe, expect, it, vi } from "vitest"
import { SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID } from "../../shared/capability"
import type { SystemNotificationInput } from "../../shared/schema"
import { createSystemNotifierCapabilityDispatcher, mcpIdentityKey } from "../dispatcher"

const passThroughPrepare = async (input: SystemNotificationInput) => ({ ok: true as const, data: input })

describe("system notifier dispatcher", () => {
  it("returns the fixed success shape and forwards only trusted context", async () => {
    const trigger = vi.fn().mockReturnValue({ success: true })
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { trigger, prepare: passThroughPrepare } })
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
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { trigger, prepare: passThroughPrepare } })
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
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { trigger, prepare: passThroughPrepare } })
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

  it("awaits image preparation before entering the service", async () => {
    const order: string[] = []
    const prepare = vi.fn(async () => { order.push("prepare"); return { ok: true as const, data: { title: "图", body: "看图", imageId: "img-1" } } })
    const trigger = vi.fn(() => { order.push("trigger"); return { success: true as const } })
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { prepare, trigger } })
    await dispatcher.dispatch(
      SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      { title: "图", body: "看图", imagePath: "/tmp/a.png" },
      { source: "mcp-http" },
    )
    expect(order).toEqual(["prepare", "trigger"])
    // 只钉顺序不够：把暂存结果丢掉、直接拿校验输入去 trigger 的实现同样有序。
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({ title: "图", body: "看图", imageId: "img-1" }),
      expect.anything(),
    )
  })

  it("does not trigger when preparation is rejected", async () => {
    const rejection = {
      ok: false as const,
      code: "INVALID_INPUT" as const,
      error: "Invalid system notification input." as const,
      data: { field: "imagePath" as const, reason: "service_outdated" as const },
    }
    const prepare = vi.fn(async () => rejection)
    const trigger = vi.fn(() => ({ success: true as const }))
    const dispatcher = createSystemNotifierCapabilityDispatcher({ service: { prepare, trigger } })
    await expect(dispatcher.dispatch(
      SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      { title: "图", body: "看图", imagePath: "/tmp/a.png" },
      { source: "mcp-http" },
    )).resolves.toEqual(rejection)
    expect(trigger).not.toHaveBeenCalled()
  })
})
