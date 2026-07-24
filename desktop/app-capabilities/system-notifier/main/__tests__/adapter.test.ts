import { describe, expect, it, vi } from "vitest"
import {
  createElectronSystemNotificationAdapter,
  createNoopSystemNotificationAdapter,
} from "../adapter"

describe("system notification adapter", () => {
  it("uses only title, body and silent and registers no event listeners", () => {
    const show = vi.fn()
    const construct = vi.fn()
    class Notification {
      static isSupported() { return true }
      constructor(options: { title: string; body: string; silent: boolean }) {
        construct(options)
      }
      show() { show() }
    }
    const onFailure = vi.fn()
    const adapter = createElectronSystemNotificationAdapter(Notification, onFailure)
    adapter.show({ title: "Title", body: "Body", silent: true })

    expect(construct).toHaveBeenCalledWith({ title: "Title", body: "Body", silent: true })
    expect(show).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it("degrades safely when unsupported", () => {
    class Notification {
      static isSupported() { return false }
      show() {}
    }
    const onFailure = vi.fn()
    const adapter = createElectronSystemNotificationAdapter(Notification, onFailure)
    expect(adapter.kind).toBe("noop")
    expect(() => adapter.show({ title: "Title", body: "Body", silent: false })).not.toThrow()
    expect(onFailure).toHaveBeenCalledWith("adapter_init", "unsupported")
  })

  it("swallows constructor and show synchronous exceptions with redacted reasons", () => {
    const onConstructFailure = vi.fn()
    class ConstructFailure {
      static isSupported() { return true }
      constructor() { throw new Error("secret constructor text") }
      show() {}
    }
    createElectronSystemNotificationAdapter(ConstructFailure, onConstructFailure)
      .show({ title: "secret title", body: "secret body", silent: false })
    expect(onConstructFailure).toHaveBeenCalledWith(
      "notification_construct",
      "synchronous_exception",
    )

    const onShowFailure = vi.fn()
    class ShowFailure {
      static isSupported() { return true }
      show() { throw new Error("secret show text") }
    }
    createElectronSystemNotificationAdapter(ShowFailure, onShowFailure)
      .show({ title: "secret title", body: "secret body", silent: false })
    expect(onShowFailure).toHaveBeenCalledWith("notification_show", "synchronous_exception")
    expect(JSON.stringify([onConstructFailure.mock.calls, onShowFailure.mock.calls]))
      .not.toContain("secret")
  })

  it("provides an inert no-op adapter", () => {
    expect(createNoopSystemNotificationAdapter().kind).toBe("noop")
  })
})
