import { createLiveEnvelope, LIVE_MESSAGE_TYPES } from "@synapse/shared"
import { Logger } from "@nestjs/common"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { CustomAppEvents } from "./custom-app-events"

describe("CustomAppEvents", () => {
  afterEach(() => vi.restoreAllMocks())

  it("broadcasts a revision-only live event to the account", () => {
    const live = { broadcastToUser: vi.fn().mockReturnValue({ delivered: 1, attempted: 1 }) }
    const events = new CustomAppEvents(live as unknown as LiveDesktopGateway)

    events.publish("user-1", 7)

    expect(live.broadcastToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: LIVE_MESSAGE_TYPES.customAppsChanged,
        payload: { revision: 7 },
      }),
    )
  })

  it("does not fail a committed mutation when broadcast fails", () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const live = { broadcastToUser: vi.fn(() => { throw new Error("offline") }) }
    const events = new CustomAppEvents(live as unknown as LiveDesktopGateway)

    expect(() => events.publish("user-1", 8)).not.toThrow()
  })

  it("creates the shared live envelope shape", () => {
    const envelope = createLiveEnvelope(
      LIVE_MESSAGE_TYPES.customAppsChanged,
      { revision: 9 },
      { id: "custom-apps-9", sentAt: "2026-11-07T00:00:00.000Z" },
    )
    expect(envelope.payload).toEqual({ revision: 9 })
  })
})
