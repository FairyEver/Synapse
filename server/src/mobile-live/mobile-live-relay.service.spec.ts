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

/**
 * The same fanout-and-forget shape as the toolbar, with one thing the toolbar cannot
 * pin down: an empty list has to be *delivered*. That is what tells a phone its
 * second segment exists and its user has not configured anything yet — as opposed to
 * a computer that has never sent this message, which must leave the phone with no
 * second segment at all.
 */
describe("MobileLiveRelayService quick phrases", () => {
  function createHarness(phones: readonly string[] = ["phone-1", "phone-2"]) {
    const sendToMobile = vi.fn((_input: Parameters<MobileLiveFanout["sendToMobile"]>[0]) => "sent" as const)
    const fanout: MobileLiveFanout = { sendToMobile }
    const service = new MobileLiveRelayService(
      { listOnlineByUser: vi.fn(() => phones.map((clientInstanceId) => ({ clientInstanceId }))) } as never,
      {} as never,
      {} as never,
    )
    service.setFanout(fanout)
    return { service, sendToMobile }
  }

  const payload = {
    desktopClientInstanceId: "client-a",
    revision: 1,
    phrases: [{ id: "q1", content: "整理成提交说明" }],
  }

  it("reaches every phone of the account and no other account's", () => {
    // Fanned out like the toolbar: the payload names its own computer, so a phone
    // showing a different one discards it. The registry is asked by `userId`, which
    // is what keeps one account's sentences away from another's.
    const { service, sendToMobile } = createHarness()

    service.handleQuickPhrases("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(2)
    expect(sendToMobile.mock.calls.map((call) => call[0].clientInstanceId)).toEqual(["phone-1", "phone-2"])
    expect(sendToMobile.mock.calls.every((call) => call[0].userId === "user-1")).toBe(true)
    expect(sendToMobile.mock.calls[0]?.[0]).toMatchObject({
      message: { type: "mobile.quickPhrases", payload },
    })
  })

  it("delivers an empty list rather than treating it as nothing to say", () => {
    const { service, sendToMobile } = createHarness(["phone-1"])

    service.handleQuickPhrases("user-1", { ...payload, revision: 2, phrases: [] })

    expect(sendToMobile).toHaveBeenCalledTimes(1)
    expect(sendToMobile.mock.calls[0]?.[0].message.payload).toEqual({
      desktopClientInstanceId: "client-a",
      revision: 2,
      phrases: [],
    })
  })

  it("sends the list again on every call rather than remembering it", () => {
    // Nothing is cached here, for the toolbar's reason: a list belonging to a
    // computer that has since gone away would put the user's own sentences into a
    // phone's composer with no machine left to run them on — and no way for their
    // author to edit them. Deduplicating is the desktop's job, one layer closer to
    // the change, where an idle computer costs zero traffic.
    const { service, sendToMobile } = createHarness()

    service.handleQuickPhrases("user-1", payload)
    service.handleQuickPhrases("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(4)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService(
      { listOnlineByUser: vi.fn(() => []) } as never,
      {} as never,
      {} as never,
    )

    expect(() => service.handleQuickPhrases("user-1", payload)).not.toThrow()
  })
})

describe("MobileLiveRelayService clipboard", () => {
  // Its own harness rather than the file-scope one, which answers with no phones at
  // all: this family is fanned out, so the test needs a registry that has some.
  function createHarness(phones: readonly string[] = ["phone-1", "phone-2"]) {
    const sendToMobile = vi.fn((_input: Parameters<MobileLiveFanout["sendToMobile"]>[0]) => "sent" as const)
    const fanout: MobileLiveFanout = { sendToMobile }
    const service = new MobileLiveRelayService(
      { listOnlineByUser: vi.fn(() => phones.map((clientInstanceId) => ({ clientInstanceId }))) } as never,
      {} as never,
      {} as never,
    )
    service.setFanout(fanout)
    return { service, sendToMobile }
  }

  const payload = {
    desktopClientInstanceId: "client-a",
    revision: 1,
    entries: [
      { id: "a".repeat(64), text: "pnpm mobile:install", copiedAt: "2026-09-21T10:00:00.000Z" },
    ],
  }

  it("reaches every phone of the account and no other account's", () => {
    // Fanned out like the toolbar and the phrases: the payload names its own
    // computer, so a phone showing a different one discards it for the cost of a
    // comparison. The registry is asked by `userId`, which is what keeps one
    // account's copied text away from another's.
    const { service, sendToMobile } = createHarness()

    service.handleClipboard("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(2)
    expect(sendToMobile.mock.calls.map((call) => call[0].clientInstanceId)).toEqual(["phone-1", "phone-2"])
    expect(sendToMobile.mock.calls.every((call) => call[0].userId === "user-1")).toBe(true)
    expect(sendToMobile.mock.calls[0]?.[0]).toMatchObject({
      message: { type: "mobile.clipboard", payload },
    })
  })

  it("sends the snapshot again on every call rather than remembering it", () => {
    // Nothing is cached here, and this message has the strongest reason of the three
    // families for that: its whole meaning is recency. A stored copy would answer a
    // phone with text its computer copied hours ago and has long since replaced, and
    // would keep answering after that computer had gone away entirely.
    const { service, sendToMobile } = createHarness()

    service.handleClipboard("user-1", payload)
    service.handleClipboard("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(4)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService(
      { listOnlineByUser: vi.fn(() => []) } as never,
      {} as never,
      {} as never,
    )

    expect(() => service.handleClipboard("user-1", payload)).not.toThrow()
  })
})
