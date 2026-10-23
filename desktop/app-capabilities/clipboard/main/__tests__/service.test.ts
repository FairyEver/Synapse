import { describe, expect, it, vi } from "vitest"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { ClipboardService } from "../service"
import type { ClipboardAdapter } from "../adapter"

const context = {
  source: "workflow" as const,
  actor: { kind: "user" as const, id: "user-1" },
  workflowId: "workflow-1",
  runId: "run-1",
  nodeId: "node-1",
}

function logger() {
  return { warn: vi.fn() }
}

describe("ClipboardService", () => {
  it("reads and writes through one asynchronous native call with minimal audit metadata", async () => {
    const readText = vi.fn(() => "value")
    const writeText = vi.fn()
    const audit = new InMemoryAuditSink()
    const service = new ClipboardService(
      { kind: "electron", readText, writeText },
      audit,
      logger(),
    )

    expect(await service.read(context)).toEqual({ text: "value" })
    expect(await service.write("next", context)).toEqual({ success: true })
    expect(readText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith("next")
    expect(audit.list()).toEqual([
      expect.objectContaining({
        action: "clipboard.read",
        resource: "app.clipboard.text.read",
        outcome: "allowed",
        metadata: {
          source: "workflow",
          workflowId: "workflow-1",
          runId: "run-1",
          nodeId: "node-1",
        },
      }),
      expect.objectContaining({
        action: "clipboard.write",
        resource: "app.clipboard.text.write",
        outcome: "allowed",
        metadata: {
          source: "workflow",
          workflowId: "workflow-1",
          runId: "run-1",
          nodeId: "node-1",
        },
      }),
    ])
  })

  it("returns an empty string as a successful read", async () => {
    const audit = new InMemoryAuditSink()
    const service = new ClipboardService({
      kind: "electron",
      readText: () => "",
      writeText: vi.fn(),
    }, audit, logger())

    expect(await service.read(context)).toEqual({ text: "" })
    expect(audit.list()[0]).toMatchObject({ outcome: "allowed" })
  })

  it("normalizes native failures without exposing the exception", async () => {
    const log = logger()
    const audit = new InMemoryAuditSink()
    const adapter: ClipboardAdapter = {
      kind: "electron",
      readText: async () => {
        throw new Error("private read failure")
      },
      writeText: async () => {
        throw new Error("private write failure")
      },
    }
    const service = new ClipboardService(adapter, audit, log)

    await expect(service.read(context)).rejects.toThrowError(expect.objectContaining({
      code: "READ_FAILED",
    }))
    await expect(service.write("value", context)).rejects.toThrowError(expect.objectContaining({
      code: "WRITE_FAILED",
    }))
    expect(log.warn).toHaveBeenNthCalledWith(
      1,
      "Clipboard operation degraded.",
      { stage: "clipboard_read", reason: "native_exception" },
    )
    expect(log.warn).toHaveBeenNthCalledWith(
      2,
      "Clipboard operation degraded.",
      { stage: "clipboard_write", reason: "native_exception" },
    )
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("private")
    expect(audit.list().map((event) => event.metadata?.errorCode)).toEqual([
      "READ_FAILED",
      "WRITE_FAILED",
    ])
  })

  it("rejects invalid or oversized native results after access without returning a partial value", async () => {
    for (const [text, code] of [
      ["a\u0000b", "READ_FAILED"],
      ["\ud800", "READ_FAILED"],
      ["x".repeat(1024 * 1024 + 1), "TEXT_TOO_LARGE"],
    ] as const) {
      const audit = new InMemoryAuditSink()
      const service = new ClipboardService({
        kind: "electron",
        readText: () => text,
        writeText: vi.fn(),
      }, audit, logger())
      await expect(service.read(context)).rejects.toThrowError(expect.objectContaining({ code }))
      expect(audit.list()[0]).toMatchObject({
        outcome: "failed",
        metadata: { errorCode: code },
      })
    }
  })

  it("keeps node results independent from AuditSink failures", async () => {
    const log = logger()
    const audit = {
      record: () => {
        throw new Error("private sink failure")
      },
      list: () => [],
      clearForTests: () => undefined,
    }
    const service = new ClipboardService({
      kind: "electron",
      readText: () => "value",
      writeText: vi.fn(),
    }, audit, log)

    expect(await service.read(context)).toEqual({ text: "value" })
    expect(await service.write("value", context)).toEqual({ success: true })
    expect(log.warn).toHaveBeenCalledWith(
      "Clipboard operation degraded.",
      { stage: "audit_record", reason: "sink_failure" },
    )
  })

  it("stays registered with stable failures when the adapter is unavailable", async () => {
    const log = logger()
    const audit = new InMemoryAuditSink()
    const service = new ClipboardService(undefined, audit, log)

    expect(service.health()).toEqual({
      status: "degraded",
      reason: "adapter_unavailable",
    })
    await expect(service.read(context)).rejects.toThrowError(expect.objectContaining({
      code: "READ_FAILED",
    }))
    await expect(service.write("value", context)).rejects.toThrowError(expect.objectContaining({
      code: "WRITE_FAILED",
    }))
    expect(log.warn).toHaveBeenCalledWith(
      "Clipboard operation degraded.",
      { stage: "adapter_init", reason: "adapter_unavailable" },
    )
  })
})
