import { describe, expect, it } from "vitest"

import {
  CONVERSATION_IDLE_ROLLOVER_PROMPT_MS,
  latestConversationActivityTimestamp,
  shouldShowConversationIdleRolloverPrompt,
} from "../conversation-rollover"

describe("conversation idle rollover prompt", () => {
  it("shows after one hour of inactivity", () => {
    const latestActivityTimestamp = "2026-06-08T10:00:00.000Z"
    const now = Date.parse(latestActivityTimestamp) + CONVERSATION_IDLE_ROLLOVER_PROMPT_MS

    expect(shouldShowConversationIdleRolloverPrompt({
      latestActivityTimestamp,
      now,
      sending: false,
      hasStartAction: true,
    })).toBe(true)
  })

  it("does not show before one hour of inactivity", () => {
    const latestActivityTimestamp = "2026-06-08T10:00:00.000Z"
    const now = Date.parse(latestActivityTimestamp) + CONVERSATION_IDLE_ROLLOVER_PROMPT_MS - 1

    expect(shouldShowConversationIdleRolloverPrompt({
      latestActivityTimestamp,
      now,
      sending: false,
      hasStartAction: true,
    })).toBe(false)
  })

  it("does not show while sending or when no start action exists", () => {
    const latestActivityTimestamp = "2026-06-08T10:00:00.000Z"
    const now = Date.parse(latestActivityTimestamp) + CONVERSATION_IDLE_ROLLOVER_PROMPT_MS

    expect(shouldShowConversationIdleRolloverPrompt({
      latestActivityTimestamp,
      now,
      sending: true,
      hasStartAction: true,
    })).toBe(false)
    expect(shouldShowConversationIdleRolloverPrompt({
      latestActivityTimestamp,
      now,
      sending: false,
      hasStartAction: false,
    })).toBe(false)
  })

  it("does not show for missing or invalid activity timestamps", () => {
    expect(shouldShowConversationIdleRolloverPrompt({
      latestActivityTimestamp: undefined,
      now: Date.parse("2026-06-08T11:00:00.000Z"),
      sending: false,
      hasStartAction: true,
    })).toBe(false)
    expect(shouldShowConversationIdleRolloverPrompt({
      latestActivityTimestamp: "not-a-date",
      now: Date.parse("2026-06-08T11:00:00.000Z"),
      sending: false,
      hasStartAction: true,
    })).toBe(false)
  })

  it("returns the latest valid activity timestamp", () => {
    expect(latestConversationActivityTimestamp([
      { timestamp: "not-a-date" },
      { timestamp: "2026-06-08T10:00:00.000Z" },
      { timestamp: "2026-06-08T10:30:00.000Z" },
    ])).toBe("2026-06-08T10:30:00.000Z")
  })

  it("returns undefined when no valid activity timestamp exists", () => {
    expect(latestConversationActivityTimestamp([])).toBeUndefined()
    expect(latestConversationActivityTimestamp([{ timestamp: "not-a-date" }])).toBeUndefined()
  })
})
