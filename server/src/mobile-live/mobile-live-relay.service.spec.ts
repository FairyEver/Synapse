import { describe, expect, it, vi } from "vitest"

import { MobileLiveRelayService } from "./mobile-live-relay.service"
import type { MobileLiveFanout } from "./mobile-live.types"

/**
 * Progress is addressed, not broadcast.
 *
 * A summary is fanned out to every phone because each one needs the whole list;
 * a transfer's progress only means anything to the phone whose own chip is
 * waiting on it. Sending it to the others would put a bar on a file they never
 * sent, so the fanout contract is the whole thing worth pinning down here.
 */
function createHarness() {
  const sendToMobile = vi.fn((_input: Parameters<MobileLiveFanout["sendToMobile"]>[0]) => "sent" as const)
  const fanout: MobileLiveFanout = { sendToMobile }
  const service = new MobileLiveRelayService(
    { listOnlineByUser: vi.fn(() => []) } as never,
    {} as never,
    {} as never,
  )
  service.setFanout(fanout)
  return { service, sendToMobile }
}

describe("MobileLiveRelayService transfer progress", () => {
  it("sends progress to the phone named in the payload and nobody else", () => {
    const { service, sendToMobile } = createHarness()

    service.handleTransferProgress("user-1", {
      mobileClientInstanceId: "phone-1",
      intentId: "intent-1",
      completedBytes: 512,
      totalBytes: 4096,
    })

    expect(sendToMobile).toHaveBeenCalledTimes(1)
    expect(sendToMobile.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      clientInstanceId: "phone-1",
      message: {
        type: "mobile.transferProgress",
        payload: { mobileClientInstanceId: "phone-1", intentId: "intent-1", completedBytes: 512, totalBytes: 4096 },
      },
    })
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService(
      { listOnlineByUser: vi.fn(() => []) } as never,
      {} as never,
      {} as never,
    )

    expect(() => service.handleTransferProgress("user-1", {
      mobileClientInstanceId: "phone-1",
      intentId: "intent-1",
      completedBytes: 0,
      totalBytes: 0,
    })).not.toThrow()
  })
})
