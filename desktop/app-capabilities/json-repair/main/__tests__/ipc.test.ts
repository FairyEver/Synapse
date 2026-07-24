import { describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import { jsonRepairIpcModule } from "../ipc"

const repairText = jsonRepairIpcModule.methods.repairText

function context(options: {
  destroyed?: boolean
  repair?: (input: unknown, context: unknown) => { json: string }
} = {}): IpcHandlerContext {
  return {
    moduleId: "jsonRepair",
    sender: {
      id: 1,
      isDestroyed: () => options.destroyed ?? false,
      onDestroyed: () => () => undefined,
    },
    resolve: () => ({
      repair: options.repair ?? (() => ({ json: "{\"ok\":true}" })),
    }),
  }
}

describe("jsonRepairIpcModule", () => {
  it("routes valid input through the shared core service", async () => {
    const repair = vi.fn(() => ({ json: "{\"ok\":true}" }))
    await expect(Promise.resolve(
      repairText.handler(context({ repair }), { text: "{ok:true}" }),
    )).resolves.toEqual({
      ok: true,
      result: { json: "{\"ok\":true}" },
    })
    expect(repair).toHaveBeenCalledWith(
      expect.objectContaining({ text: "{ok:true}" }),
      {
        source: "app.ui",
        actor: { kind: "user", id: "system-app:json-repair" },
      },
    )
  })

  it("returns shared invalid input and pre-accept cancellation payloads", async () => {
    await expect(Promise.resolve(
      repairText.handler(context(), { text: "", extra: true }),
    )).resolves.toMatchObject({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "JSON 修复输入无效。",
        data: { field: "request", reason: "unknown_field" },
      },
    })
    await expect(Promise.resolve(
      repairText.handler(context({ destroyed: true }), { text: "{}" }),
    )).resolves.toEqual({
      ok: false,
      error: {
        code: "CANCELLED",
        message: "JSON 修复已取消。",
        retryable: false,
      },
    })
  })
})
