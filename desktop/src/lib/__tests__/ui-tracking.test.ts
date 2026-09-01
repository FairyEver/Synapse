// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { redactSessionKey } from "../agent-redaction"
import {
  installNativeDataTrackCapture,
  resetRemoteTrackingForTests,
  runTrackedOperation,
  sanitizeTrackRecord,
  sanitizeTrackValue,
  startTrackedOperation,
  track,
} from "../ui-tracking"

const { rendererLog } = vi.hoisted(() => ({
  rendererLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ info: rendererLog }),
}))

afterEach(() => {
  resetRemoteTrackingForTests()
  vi.useRealTimers()
  rendererLog.mockClear()
  document.body.replaceChildren()
})

describe("ui tracking value sanitizers", () => {
  it("summarizes long text with an explicit log marker", () => {
    const value = "a".repeat(305)

    expect(sanitizeTrackValue("content", value)).toBe(
      `${"a".repeat(120)}...（日志自动优化：原始 305 字，仅记录前 120 字）`,
    )
  })

  it("redacts sensitive values", () => {
    expect(sanitizeTrackValue("apiKey", "sk-secret")).toBe("[redacted]")
    expect(sanitizeTrackValue("ownerId", "user-123")).toBe("[redacted]")
    expect(sanitizeTrackValue("sessionKey", "workflow:private-timeline")).toBe("[redacted]")
    expect(redactSessionKey("scheduled:private-timeline")).toBe("[redacted]")
    expect(redactSessionKey("external:private-timeline")).toBe("[redacted]")
    expect(redactSessionKey(undefined)).toBeUndefined()
  })

  it("keeps path context without logging the full path", () => {
    expect(sanitizeTrackValue("sourcePath", "/Users/liyang/Documents/orders.csv")).toBe(
      "[path redacted]/orders.csv",
    )
  })

  it("redacts generic tracked values that look sensitive or path-like", () => {
    expect(sanitizeTrackValue("value", "token=sk-secret")).toBe("[redacted]")
    expect(sanitizeTrackValue("value", "/Users/liyang/Documents/orders.csv")).toBe(
      "[path redacted]/orders.csv",
    )
  })

  it("sanitizes record fields recursively", () => {
    expect(sanitizeTrackRecord({
      title: "客户订单",
      token: "secret",
      sourcePath: "/tmp/orders.csv",
      content: "b".repeat(301),
    })).toEqual({
      title: "客户订单",
      token: "[redacted]",
      sourcePath: "[path redacted]/orders.csv",
      content: `${"b".repeat(120)}...（日志自动优化：原始 301 字，仅记录前 120 字）`,
    })
  })

  it("tracks opted-in native controls using only their stable identifier", () => {
    const cleanup = installNativeDataTrackCapture()
    const button = document.createElement("button")
    button.dataset.track = "content.item.open"
    button.dataset.trackNative = "true"
    button.textContent = "用户输入的标题"
    document.body.append(button)

    button.click()

    expect(rendererLog).toHaveBeenCalledWith(
      "content.item.open:click",
      expect.objectContaining({
        eventKey: "content.item.open",
        telemetry: expect.objectContaining({ eventKey: "content.item.open" }),
      }),
    )
    expect(JSON.stringify(rendererLog.mock.calls)).not.toContain("用户输入的标题")
    cleanup()
  })

  it("uses a stable generic event for raw native controls without reading their label", () => {
    const cleanup = installNativeDataTrackCapture()
    const button = document.createElement("button")
    button.textContent = "用户输入的标题"
    document.body.append(button)

    button.click()

    expect(rendererLog).toHaveBeenCalledWith(
      "native-button.click:click",
      expect.objectContaining({
        eventKey: "native-button.click",
        telemetry: expect.objectContaining({ eventKey: "native-button.click" }),
      }),
    )
    expect(JSON.stringify(rendererLog.mock.calls)).not.toContain("用户输入的标题")
    cleanup()
  })

  it("isolates tracking failures so the business callback still executes", () => {
    const businessCallback = vi.fn()
    rendererLog.mockImplementationOnce(() => {
      throw new Error("renderer telemetry IPC failed")
    })

    expect(() => {
      track({ component: "button", name: "test.action", action: "click", eventKey: "test.action" })
      businessCallback()
    }).not.toThrow()
    expect(businessCallback).toHaveBeenCalledOnce()
  })

  it("finishes an operation once with its stable result and duration", () => {
    const finish = startTrackedOperation({ component: "workflow", eventKey: "workflow.test.run" })

    finish("success")
    finish("failure")

    expect(rendererLog).toHaveBeenCalledTimes(1)
    expect(rendererLog).toHaveBeenCalledWith(
      "workflow.test.run:complete",
      expect.objectContaining({
        eventKey: "workflow.test.run",
        outcome: "success",
        durationMs: expect.any(Number),
      }),
    )
  })

  it("preserves the business result when tracking delivery fails", async () => {
    const businessCallback = vi.fn().mockResolvedValue("saved")
    rendererLog.mockImplementation(() => {
      throw new Error("renderer telemetry IPC failed")
    })

    await expect(runTrackedOperation(
      { component: "drive", eventKey: "drive.editor.save" },
      businessCallback,
    )).resolves.toBe("saved")
    expect(businessCallback).toHaveBeenCalledOnce()
  })

  it("preserves the business result when the telemetry clock fails", async () => {
    const businessCallback = vi.fn().mockResolvedValue("saved")
    vi.spyOn(performance, "now").mockImplementation(() => {
      throw new Error("clock unavailable")
    })

    await expect(runTrackedOperation(
      { component: "drive", eventKey: "drive.editor.save" },
      businessCallback,
    )).resolves.toBe("saved")
    expect(businessCallback).toHaveBeenCalledOnce()
  })

  it("records a failed or cancelled operation without retrying the business callback", async () => {
    const failure = new Error("save failed")
    const failedCallback = vi.fn().mockRejectedValue(failure)
    const cancelled = Object.assign(new Error("cancelled"), { name: "AbortError" })
    const cancelledCallback = vi.fn().mockRejectedValue(cancelled)

    await expect(runTrackedOperation(
      { component: "drive", eventKey: "drive.editor.save" },
      failedCallback,
    )).rejects.toBe(failure)
    await expect(runTrackedOperation(
      { component: "drive", eventKey: "drive.upload" },
      cancelledCallback,
    )).rejects.toBe(cancelled)

    expect(failedCallback).toHaveBeenCalledOnce()
    expect(cancelledCallback).toHaveBeenCalledOnce()
    expect(rendererLog).toHaveBeenCalledWith(
      "drive.editor.save:complete",
      expect.objectContaining({ outcome: "failure" }),
    )
    expect(rendererLog).toHaveBeenCalledWith(
      "drive.upload:complete",
      expect.objectContaining({ outcome: "cancelled" }),
    )
  })

  it("rate limits high-frequency events and emits the final action", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    track({ component: "scroll-area", name: "scroll", action: "scroll", eventKey: "content.list.scroll" })
    vi.setSystemTime(1_100)
    track({ component: "scroll-area", name: "scroll", action: "scroll", eventKey: "content.list.scroll" })

    expect(rendererLog.mock.calls[0]?.[1]).toHaveProperty("telemetry")
    expect(rendererLog.mock.calls[1]?.[1]).not.toHaveProperty("telemetry")
    vi.advanceTimersByTime(900)
    expect(rendererLog.mock.calls[2]?.[0]).toBe("content.list.scroll:scroll:final")
    expect(rendererLog.mock.calls[2]?.[1]).toHaveProperty("telemetry")
  })
})
