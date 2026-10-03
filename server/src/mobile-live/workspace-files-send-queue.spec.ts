import { afterEach, describe, expect, it, vi } from "vitest"
import { createLiveEnvelope, LIVE_MESSAGE_TYPES, MOBILE_WORKSPACE_FILES_LIMITS as L, type LiveMobileServerMessage } from "@synapse/shared"
import { WorkspaceFilesSendQueue } from "./workspace-files-send-queue"

function socket(bufferedAmount = 0) { return { readyState: 1, bufferedAmount, send: vi.fn() } }
function reply(id = "i-1"): LiveMobileServerMessage { return createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileIntentResult, { desktopClientInstanceId: "desktop", mobileClientInstanceId: "phone", result: { intentId: id, outcome: "rejected" as const, code: "content_stale" } }, { id: "message", sentAt: "2026-10-03T08:00:00.000Z" }) }
afterEach(() => vi.useRealTimers())
describe("WorkspaceFilesSendQueue", () => {
  it("counts the final UTF-8 envelope plus socket backlog before sending", () => {
    const queue = new WorkspaceFilesSendQueue()
    const message = reply()
    const bytes = Buffer.byteLength(JSON.stringify(message))
    const target = socket(L.maxSocketBufferedBytes - bytes + 1)
    expect(queue.send(target, message)).toBe("queued")
    expect(target.send).not.toHaveBeenCalled()
    queue.dispose()
    expect(queue.send(socket(L.maxSocketBufferedBytes - bytes), message)).toBe("sent")
  })
  it("queues at most two pages and preserves their order as the socket drains", async () => {
    vi.useFakeTimers()
    const queue = new WorkspaceFilesSendQueue()
    const target = socket(L.maxSocketBufferedBytes)
    expect(queue.send(target, reply("i-1"))).toBe("queued")
    expect(queue.send(target, reply("i-2"))).toBe("queued")
    expect(queue.send(target, reply("i-3"))).toBe("backpressure")
    target.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(25)
    expect(target.send.mock.calls.map(call => JSON.parse(call[0]).payload.result.intentId)).toEqual(["i-1", "i-2"])
    queue.dispose()
  })
  it("does not send expired source pages; returns an attributed compact error if possible", async () => {
    vi.useFakeTimers()
    const queue = new WorkspaceFilesSendQueue()
    const target = socket(L.maxSocketBufferedBytes)
    queue.send(target, reply())
    await vi.advanceTimersByTimeAsync(L.sendQueueTtlMs - 25)
    target.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(25)
    expect(JSON.parse(target.send.mock.calls[0]![0]).payload).toMatchObject({ desktopClientInstanceId: "desktop", mobileClientInstanceId: "phone", result: { intentId: "i-1", code: "transport_backpressure" } })
    queue.dispose()
  })
  it("rejects oversized complete JSON and closed sockets", () => {
    const queue = new WorkspaceFilesSendQueue()
    const large = { ...reply(), payload: { ...reply().payload, filler: "中".repeat(45000) } } as unknown as LiveMobileServerMessage
    expect(queue.send(socket(), large)).toBe("backpressure")
    expect(queue.send({ ...socket(), readyState: 3 }, reply())).toBe("offline")
  })
  it("places close before reads even when the page queue is full", async () => {
    vi.useFakeTimers()
    const queue = new WorkspaceFilesSendQueue()
    const target = socket(L.maxSocketBufferedBytes)
    queue.send(target, reply("read-1"))
    queue.send(target, reply("read-2"))
    const control: LiveMobileServerMessage = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileIntentResult, {
      desktopClientInstanceId: "desktop", mobileClientInstanceId: "phone", result: {
        intentId: "close", sessionId: "session", outcome: "accepted" as const, workspaceFiles: {
          filesVersion: 1 as const, operation: "close" as const, sessionId: "session", scopeId: "scope",
          readAt: "2026-10-03T08:00:00.000Z", data: { status: "closed" as const, pendingCancellationCount: 0 },
        },
      },
    }, { id: "close-message", sentAt: "2026-10-03T08:00:00.000Z" })
    expect(queue.send(target, control)).toBe("queued")
    target.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(25)
    expect(target.send.mock.calls.map(call => JSON.parse(call[0]).payload.result.intentId)).toEqual(["close", "read-1"])
    queue.dispose()
  })
})
