import { describe, expect, it, vi } from "vitest"
import { JSON_REPAIR_CAPABILITY_ID } from "../../shared/capability"
import { createJsonRepairCapabilityDispatcher } from "../dispatcher"

describe("createJsonRepairCapabilityDispatcher", () => {
  it("returns only the JSON text on success", async () => {
    const repair = vi.fn(() => ({ json: "{\"ok\":true}" }))
    const dispatcher = createJsonRepairCapabilityDispatcher({ service: { repair } })

    await expect(dispatcher.dispatch(
      JSON_REPAIR_CAPABILITY_ID,
      { text: "{ok:true}" },
      { source: "mcp-http", clientId: "client", controllerInstanceId: "controller" },
    )).resolves.toEqual({
      ok: true,
      data: { json: "{\"ok\":true}" },
    })
    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ text: "{ok:true}" }),
      expect.objectContaining({
        source: "mcp-http",
        clientId: "client",
        controllerInstanceId: "controller",
      }),
    )
  })

  it("uses the shared error payload for invalid and cancelled calls", async () => {
    const repair = vi.fn()
    const dispatcher = createJsonRepairCapabilityDispatcher({ service: { repair } })

    const invalid = await dispatcher.dispatch(
      JSON_REPAIR_CAPABILITY_ID,
      { text: " " },
      { source: "mcp-http" },
    )
    expect(invalid).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      error: "JSON 修复输入无效。",
      data: {
        code: "INVALID_INPUT",
        retryable: false,
        data: { field: "text", reason: "empty" },
      },
    })

    const controller = new AbortController()
    controller.abort()
    const cancelled = await dispatcher.dispatch(
      JSON_REPAIR_CAPABILITY_ID,
      { text: "{}" },
      { source: "mcp-http", abortSignal: controller.signal },
    )
    expect(cancelled).toMatchObject({
      ok: false,
      code: "CANCELLED",
      error: "JSON 修复已取消。",
    })
    expect(repair).not.toHaveBeenCalled()
  })

  it("rejects the retired stdio MCP source", async () => {
    const dispatcher = createJsonRepairCapabilityDispatcher({
      service: { repair: vi.fn() },
    })

    await expect(dispatcher.dispatch(
      JSON_REPAIR_CAPABILITY_ID,
      { text: "{}" },
      { source: "mcp-stdio" },
    )).rejects.toThrow("JSON repair MCP entry requires a trusted MCP source.")
  })
})
