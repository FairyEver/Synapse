import { describe, expect, it, vi } from "vitest"
import type { MobileSummaryPayload, MobileSummarySession } from "@synapse/shared"

import { MobileLiveRelayService } from "./mobile-live-relay.service"
import type { MobileLiveFanout } from "./mobile-live.types"

/** The cache bound the service keeps privately; the eviction test needs its arithmetic. */
const SUMMARY_CACHE_LIMIT = 200

function session(id: string, state: MobileSummarySession["attention"]["state"] = "not_waiting"): MobileSummarySession {
  return {
    id,
    groupId: "group-1",
    title: `终端 ${id}`,
    status: "running",
    attention: { state, kind: "approval" },
    cwd: "/tmp",
    cols: 80,
    rows: 24,
    startedAt: "2026-09-21T10:00:00.000Z",
    lastLine: "等待你的确认",
    lastOutputSeq: 1,
  }
}

function summary(
  desktopClientInstanceId: string,
  sessions: readonly MobileSummarySession[] = [],
): MobileSummaryPayload {
  return {
    desktopClientInstanceId,
    desktopName: "MacBook",
    revision: 1,
    groups: [],
    sessions,
  }
}

type FanoutSpies = {
  readonly sendToMobile: ReturnType<typeof vi.fn>
  readonly sendToMobileClients: ReturnType<typeof vi.fn>
  readonly fanout: MobileLiveFanout
}

function createFanout(): FanoutSpies {
  const sendToMobile = vi.fn((_input: Parameters<MobileLiveFanout["sendToMobile"]>[0]) => "sent" as const)
  const sendToMobileClients = vi.fn((_input: Parameters<MobileLiveFanout["sendToMobileClients"]>[0]) => undefined)
  return { sendToMobile, sendToMobileClients, fanout: { sendToMobile, sendToMobileClients } }
}

function createHarness() {
  const fanout = createFanout()
  const sendTerminalApproval = vi.fn(async (_userId: string, _notification: unknown) => undefined)
  const service = new MobileLiveRelayService(
    {} as never,
    { sendTerminalApproval } as never,
  )
  service.setFanout(fanout.fanout)
  return { service, sendTerminalApproval, ...fanout }
}

/**
 * Progress is addressed, not broadcast.
 *
 * A summary is fanned out to every phone because each one needs the whole list;
 * a transfer's progress only means anything to the phone whose own chip is
 * waiting on it. Sending it to the others would put a bar on a file they never
 * sent, so the fanout contract is the whole thing worth pinning down here.
 */
describe("MobileLiveRelayService transfer progress", () => {
  it("sends progress to the phone named in the payload and nobody else", () => {
    const { service, sendToMobile, sendToMobileClients } = createHarness()

    service.handleTransferProgress("user-1", {
      mobileClientInstanceId: "phone-1",
      intentId: "intent-1",
      completedBytes: 512,
      totalBytes: 4096,
    })

    expect(sendToMobile).toHaveBeenCalledTimes(1)
    expect(sendToMobileClients).not.toHaveBeenCalled()
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
    const service = new MobileLiveRelayService({} as never, {} as never)

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
 *
 * Who the phones are is no longer decided here: the batch call takes the account
 * and the gateway resolves it once, which is what keeps a fanout at one registry
 * lookup instead of one plus one per phone. What this file pins down is that the
 * relay asks for a fanout rather than addressing phones one by one.
 */
describe("MobileLiveRelayService toolbar", () => {
  const payload = {
    desktopClientInstanceId: "client-a",
    revision: 3,
    buttons: [
      { id: "enter", label: "回车", group: "key" as const, action: { type: "key" as const, key: "Enter" as const } },
    ],
  }

  it("asks for one fanout instead of addressing each phone", () => {
    // Unlike a frame, which is addressed to the one phone that attached: the payload
    // names its own computer, so a phone showing a different one discards it and
    // costs nothing. Fanning out is what lets a phone that connects to any of the
    // user's computers get the list without the cloud tracking subscriptions.
    const { service, sendToMobile, sendToMobileClients } = createHarness()

    service.handleToolbar("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(1)
    expect(sendToMobile).not.toHaveBeenCalled()
    expect(sendToMobileClients.mock.calls[0]?.[0]).toMatchObject({
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
    const { service, sendToMobileClients } = createHarness()

    service.handleToolbar("user-1", payload)
    service.handleToolbar("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(2)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService({} as never, {} as never)

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
  const payload = {
    desktopClientInstanceId: "client-a",
    revision: 1,
    phrases: [{ id: "q1", content: "整理成提交说明" }],
  }

  it("reaches every phone of the account and no other account's", () => {
    // Fanned out like the toolbar: the payload names its own computer, so a phone
    // showing a different one discards it. The account is named rather than its
    // phones, which is what keeps one account's sentences away from another's.
    const { service, sendToMobileClients } = createHarness()

    service.handleQuickPhrases("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(1)
    expect(sendToMobileClients.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      message: { type: "mobile.quickPhrases", payload },
    })
  })

  it("delivers an empty list rather than treating it as nothing to say", () => {
    const { service, sendToMobileClients } = createHarness()

    service.handleQuickPhrases("user-1", { ...payload, revision: 2, phrases: [] })

    expect(sendToMobileClients).toHaveBeenCalledTimes(1)
    expect(sendToMobileClients.mock.calls[0]?.[0].message.payload).toEqual({
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
    const { service, sendToMobileClients } = createHarness()

    service.handleQuickPhrases("user-1", payload)
    service.handleQuickPhrases("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(2)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService({} as never, {} as never)

    expect(() => service.handleQuickPhrases("user-1", payload)).not.toThrow()
  })
})

describe("MobileLiveRelayService clipboard", () => {
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
    // comparison. The account is named rather than its phones, which is what keeps
    // one account's copied text away from another's.
    const { service, sendToMobileClients } = createHarness()

    service.handleClipboard("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(1)
    expect(sendToMobileClients.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      message: { type: "mobile.clipboard", payload },
    })
  })

  it("sends the snapshot again on every call rather than remembering it", () => {
    // Nothing is cached here, and this message has the strongest reason of the three
    // families for that: its whole meaning is recency. A stored copy would answer a
    // phone with text its computer copied hours ago and has long since replaced, and
    // would keep answering after that computer had gone away entirely.
    const { service, sendToMobileClients } = createHarness()

    service.handleClipboard("user-1", payload)
    service.handleClipboard("user-1", payload)

    expect(sendToMobileClients).toHaveBeenCalledTimes(2)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService({} as never, {} as never)

    expect(() => service.handleClipboard("user-1", payload)).not.toThrow()
  })
})

describe("MobileLiveRelayService git status", () => {
  const payload = {
    desktopClientInstanceId: "client-a",
    mobileClientInstanceId: "phone-1",
    sessionId: "sess-1",
    revision: 1,
    status: {
      cwd: "/Users/liy/code/Synapse",
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      changeCount: 3,
      hasConflicts: false,
    },
  }

  it("reaches the one phone that asked and not its siblings", () => {
    /*
     * 这条断言的是「手机真的收到了」，而不是「服务端没报错」。
     *
     * 这个家族在服务端有两处会静默吃掉消息：`live-desktop.gateway.ts` 的类型门
     * （漏了走不到这里）与这里的收件人。所以断言落在 `sendToMobile` 上，并且点名
     * 收件人 —— 这份状态说的是「你正开着的那个终端」，扇出给账号里每台手机是错的。
     */
    const { service, sendToMobile, sendToMobileClients } = createHarness()

    service.handleGitStatus("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(1)
    expect(sendToMobile.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      clientInstanceId: "phone-1",
      message: { type: "mobile.gitStatus", payload },
    })
    expect(sendToMobileClients).not.toHaveBeenCalled()
  })

  it("sends again on every call rather than caching a computer's state", () => {
    // 不缓存：这份状态的意思就是「现在」。一台已经走开的电脑留下的缓存只会是错的，
    // 而手机在两个时刻（sync / attach）都会让电脑重发一次，不需要服务端替它记。
    const { service, sendToMobile } = createHarness()

    service.handleGitStatus("user-1", payload)
    service.handleGitStatus("user-1", payload)

    expect(sendToMobile).toHaveBeenCalledTimes(2)
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService({} as never, {} as never)

    expect(() => service.handleGitStatus("user-1", payload)).not.toThrow()
  })
})

/**
 * A summary arrives once a second per computer, so the work it does is what the
 * server's steady-state cost is made of.
 */
describe("MobileLiveRelayService summary fanout", () => {
  it("asks for one fanout rather than one registry lookup per phone", () => {
    // The recipients are resolved by the batch call, next to the sockets that have
    // to be written to. Addressing each phone here would mean this side resolving a
    // list it cannot use for anything else, and the gateway resolving it again per
    // phone to turn a client instance into a connection.
    const { service, sendToMobile, sendToMobileClients } = createHarness()

    service.handleSummary("user-1", summary("desktop-1", [session("session-1")]))

    expect(sendToMobileClients).toHaveBeenCalledTimes(1)
    expect(sendToMobile).not.toHaveBeenCalled()
    expect(sendToMobileClients.mock.calls[0]?.[0]).toMatchObject({
      userId: "user-1",
      message: { type: "mobile.summary" },
    })
  })

  it("keeps the published summary for a phone that connects later", () => {
    const { service } = createHarness()

    service.handleSummary("user-1", summary("desktop-1", [session("session-1")]))

    expect(service.cachedSummary("user-1", "desktop-1")?.sessions).toHaveLength(1)
    // Another account's phone asks for the same computer id and gets nothing.
    expect(service.cachedSummary("user-2", "desktop-1")).toBeNull()
  })

  it("stays quiet when no fanout is installed", () => {
    const service = new MobileLiveRelayService({} as never, {} as never)

    expect(() => service.handleSummary("user-1", summary("desktop-1"))).not.toThrow()
  })
})

describe("MobileLiveRelayService summary cache", () => {
  /**
   * The cache is bounded by dropping the *least recently updated* entry, which is
   * the computer a phone cold-starting has least use for — as opposed to the one
   * that has merely been present the longest.
   *
   * A computer that publishes every second would otherwise be the first to go: its
   * key was created early and `Map.set` does not move a key it already holds, so
   * "oldest inserted" would pick exactly the busiest computer. That is the shape of
   * the bug this pins: A is refreshed on every round while B is not, and A is the
   * one that has to survive.
   */
  it("evicts the computer that went quiet, not the one that keeps publishing", () => {
    const { service } = createHarness()

    service.handleSummary("user-1", summary("desktop-A"))
    service.handleSummary("user-1", summary("desktop-B"))
    // Enough new computers, each preceded by a fresh A, to push the cache past its
    // limit and force it to choose. The count only has to exceed the limit; A stays
    // the most recently written entry throughout, so the choice is B either way.
    for (let index = 0; index < SUMMARY_CACHE_LIMIT - 1; index += 1) {
      service.handleSummary("user-1", summary("desktop-A"))
      service.handleSummary("user-1", summary(`desktop-${index}`))
    }

    expect(service.cachedSummary("user-1", "desktop-A")).not.toBeNull()
    expect(service.cachedSummary("user-1", "desktop-B")).toBeNull()
  })

  it("keeps the newest list for a computer that republishes", () => {
    const { service } = createHarness()

    service.handleSummary("user-1", summary("desktop-1", [session("session-1")]))
    service.handleSummary("user-1", summary("desktop-1", [session("session-1"), session("session-2")]))

    expect(service.cachedSummary("user-1", "desktop-1")?.sessions.map((entry) => entry.id))
      .toEqual(["session-1", "session-2"])
  })
})

describe("MobileLiveRelayService attention", () => {
  it("does not notify when the desktop disabled terminal notifications", () => {
    const { service, sendTerminalApproval } = createHarness()
    service.handleSummary("user-1", { ...summary("desktop-1", [session("session-1", "waiting")]), notificationsEnabled: false })
    expect(sendTerminalApproval).not.toHaveBeenCalled()
  })

  it("persists only safe attention metadata and resolves the pending item", () => {
    const { service, sendTerminalApproval } = createHarness()
    const create = vi.fn(async () => undefined)
    const resolveAttention = vi.fn(async () => undefined)
    service.setNotificationSink({ create, resolveAttention } as never)
    service.handleSummary("user-1", summary("desktop-1", [session("session-1", "waiting")]))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      source: "terminal-attention", targetId: "session-1", deviceId: "desktop-1",
      body: "有一个终端正在等待你的操作。",
    }))
    expect(sendTerminalApproval).not.toHaveBeenCalled()
    service.handleSummary("user-1", summary("desktop-1", [session("session-1", "not_waiting")]))
    expect(resolveAttention).toHaveBeenCalledWith("user-1", "desktop-1", "session-1")
  })
  it("notifies on a transition into waiting, and only on the transition", () => {
    const { service, sendTerminalApproval } = createHarness()
    const waiting = () => summary("desktop-1", [session("session-1", "waiting")])

    service.handleSummary("user-1", waiting())
    service.handleSummary("user-1", waiting())
    service.handleSummary("user-1", summary("desktop-1", [session("session-1", "not_waiting")]))
    service.handleSummary("user-1", waiting())

    expect(sendTerminalApproval).toHaveBeenCalledTimes(2)
    expect(sendTerminalApproval.mock.calls[0]?.[0]).toBe("user-1")
  })

  it("never notifies for an unknown state", () => {
    // `unknown` is explicitly not `not_waiting`, but it is also not evidence that a
    // person is needed.
    const { service, sendTerminalApproval } = createHarness()

    service.handleSummary("user-1", summary("desktop-1", [session("session-1", "unknown")]))

    expect(sendTerminalApproval).not.toHaveBeenCalled()
  })

  it("forgets a departed session for its own computer and for no other", () => {
    // Two computers can list a session by the same id, and one of them dropping it
    // says nothing about the other. The states are kept per computer, so a summary
    // only ever inspects the sender's own.
    const { service, sendTerminalApproval } = createHarness()

    service.handleSummary("user-1", summary("desktop-1", [session("session-1", "waiting")]))
    service.handleSummary("user-1", summary("desktop-2", [session("session-1", "waiting")]))
    expect(sendTerminalApproval).toHaveBeenCalledTimes(2)

    // desktop-1's PTY exits: it publishes without the session.
    // desktop-2 still has it waiting and must not be re-notified.
    service.handleSummary("user-1", summary("desktop-1"))
    service.handleSummary("user-1", summary("desktop-2", [session("session-1", "waiting")]))

    expect(sendTerminalApproval).toHaveBeenCalledTimes(2)

    // desktop-1 running the same session id again is a fresh transition for it,
    // which is only true because its entry was forgotten rather than left standing.
    service.handleSummary("user-1", summary("desktop-1", [session("session-1", "waiting")]))

    expect(sendTerminalApproval).toHaveBeenCalledTimes(3)
  })
})
