import { describe, expect, it } from "vitest"
import { createLiveEnvelope, isLiveDesktopServerMessage, isLiveMobileServerMessage, isLiveDesktopClientMessage, isLiveMobileClientMessage } from "./live.js"
import { NOTIFICATION_SOURCES, DESKTOP_NOTIFICATION_SOURCES } from "./notifications.js"

describe("todo account events", () => {
  const event = { id: "event", type: "todos.changed", sentAt: "2026-10-11T00:00:00Z", payload: { id: "todo-1", version: 2 } }
  it("accepts the metadata-only server envelope on both clients", () => {
    expect(isLiveDesktopServerMessage(event)).toBe(true)
    expect(isLiveMobileServerMessage(event)).toBe(true)
  })
  it("rejects client spoofing and malformed or content-bearing payloads", () => {
    expect(isLiveDesktopClientMessage(event)).toBe(false)
    expect(isLiveMobileClientMessage(event)).toBe(false)
    for (const payload of [{ id: "", version: 2 }, { id: "t", version: 0 }, { id: "t", version: 1.5 }, { id: "t", version: 1, title: "secret" }]) {
      expect(isLiveDesktopServerMessage({ ...event, payload })).toBe(false)
    }
  })
  it("reserves the reminder source for the server", () => {
    expect(NOTIFICATION_SOURCES).toContain("todo-reminder")
    expect(DESKTOP_NOTIFICATION_SOURCES).not.toContain("todo-reminder")
  })
})
