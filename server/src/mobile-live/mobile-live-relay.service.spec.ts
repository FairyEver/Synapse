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

/**
 * The toolbar is fanned out and never cached, which is the opposite of what the
 * summary beside it does — so both halves of that are worth pinning.
 */
describe("MobileLiveRelayService toolbar", () => {
  function createToolbarHarness() {
    const sendToMobile = vi.fn((_input: Parameters<MobileLiveFanout["sendToMobile"]>[0]) => "sent" as const)
    const fanout: MobileLiveFanout = { sendToMobile }
    const service = new MobileLiveRelayService(
      {
        listOnlineByUser: vi.fn(() => [
          { clientInstanceId: "phone-1" },
          { clientInstanceId: "phone-2" },
        ]),
      } as never,
      {} as never,
      {} as never,
    )
    service.setFanout(fanout)
    return { service, sendToMobile }
  }

  const payload = {
    desktopClientInstanceId: "client-a",
    revision: 3,
    buttons: [
      { id: "enter", label: "回车", group: "key" as const, action: { type: "key" as const, key: "Enter" as const } },
    ],
  }

  it("reaches every phone of the account, leaving each to filter by computer", () => {
    // Unlike a frame, which is addressed to the one phone that attached: the payload
    // names its own computer, so a phone showing a different one discards it and
    // costs nothing. Fanning out is what lets a phone that connects to any of the
    // user's computers get the list without the cloud tracking subscriptions.
    const { service, sendToMobile } = createToolbarHarness()

    service.handleToolbar("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(2)
    expect(sendToMobile.mock.calls.map((call) => call[0].clientInstanceId)).toEqual(["phone-1", "phone-2"])
    expect(sendToMobile.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      message: { type: "mobile.toolbar", payload },
    })
  })

  it("sends the list again on every call rather than deduplicating it", () => {
    /*
     * Every send is a full snapshot with its own revision, and a phone replaces what
     * it has — so two identical sends are merely redundant, never wrong. Suppressing
     * the second one is what the desktop's own fingerprint check already does, one
     * layer closer to the change; doing it again here would mean the cloud deciding
     * which phone has already seen what, which it cannot know.
     */
    const { service, sendToMobile } = createToolbarHarness()

    service.handleToolbar("user-1", payload)
    service.handleToolbar("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(4)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService(
      { listOnlineByUser: vi.fn(() => []) } as never,
      {} as never,
      {} as never,
    )

    expect(() => service.handleToolbar("user-1", payload)).not.toThrow()
  })
})
