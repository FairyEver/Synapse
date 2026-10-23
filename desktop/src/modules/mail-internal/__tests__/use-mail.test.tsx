/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MailMessage, MailSummary } from "@/types/mail"
import { useMail, type MailBox } from "../use-mail"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function message(messageId: string): MailSummary {
  const person = { userId: "person", nickname: "成员", handle: "member" }
  return { messageId, sender: person, recipients: [person], toRecipients: [person], ccRecipients: [], relationKind: null, subject: messageId, snippet: "正文", sentAt: "2026-09-27T00:00:00.000Z", readAt: null, attachmentCount: 0 }
}

function detail(messageId: string): MailMessage {
  return { ...message(messageId), viewerId: "reader", body: "正在阅读的正文", readAt: "2026-10-21T00:00:00.000Z", team: null, conversationId: "conversation", replyToId: null, relation: null, quote: null, attachments: [] }
}

let root: Root | null = null
let current: ReturnType<typeof useMail>
function Harness({ box, query = "", unreadOnly = false, contactKey }: { box: MailBox; query?: string; unreadOnly?: boolean; contactKey?: string }) {
  current = useMail(box, query, unreadOnly, contactKey)
  return null
}

function render(box: MailBox, query = "", unreadOnly = false, contactKey?: string) {
  if (!root) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => root?.render(<Harness box={box} query={query} unreadOnly={unreadOnly} contactKey={contactKey} />))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  mocks.request.mockReset()
  vi.useRealTimers()
})

describe("useMail", () => {
  it.each(["timer", "manual"])("keeps the open body visible during a %s refresh and applies the response", async (trigger) => {
    vi.useFakeTimers()
    const reloaded = deferred<MailMessage>()
    let reads = 0
    mocks.request.mockImplementation(async (operation: { kind: string }) => {
      if (operation.kind === "messageGet") return reads++ ? reloaded.promise : detail("opened")
      if (operation.kind === "messageCount") return { inboxTotal: 1, sentTotal: 0, unread: 0 }
      return { items: [], nextCursor: null }
    })
    render("inbox")
    await act(async () => { current.setSelectedId("opened") })
    expect(current.detail?.body).toBe("正在阅读的正文")

    await act(async () => {
      if (trigger === "timer") vi.advanceTimersByTime(30_000)
      else current.refresh()
    })
    expect(reads).toBe(2)
    expect(current.detail?.body).toBe("正在阅读的正文")

    await act(async () => { reloaded.resolve({ ...detail("opened"), readAt: null }); await reloaded.promise })
    expect(current.detail?.body).toBe("正在阅读的正文")
    expect(current.detail?.readAt).toBeNull()
  })

  it("preserves the open body on refresh failure but clears it if the message was deleted", async () => {
    const reloaded = deferred<MailMessage>()
    let reads = 0
    mocks.request.mockImplementation(async (operation: { kind: string }) => {
      if (operation.kind === "messageGet") return reads++ ? reloaded.promise : detail("opened")
      if (operation.kind === "messageCount") return { inboxTotal: 1, sentTotal: 0, unread: 0 }
      return { items: [], nextCursor: null }
    })
    render("inbox")
    await act(async () => { current.setSelectedId("opened") })
    await act(async () => { current.refresh() })
    await act(async () => { reloaded.reject(new Error("网络连接失败")) })
    expect(current.error).toBe("网络连接失败")
    expect(current.detail?.body).toBe("正在阅读的正文")

    mocks.request.mockImplementation(async (operation: { kind: string }) => {
      if (operation.kind === "messageGet") throw new Error("HTTP 404")
      return { items: [], nextCursor: null }
    })
    await act(async () => { current.refresh() })
    expect(current.selectedId).toBeNull()
    expect(current.detail).toBeNull()
  })

  it("clears the previous body on selection changes and ignores a late refresh response", async () => {
    const reloaded = deferred<MailMessage>()
    const next = deferred<MailMessage>()
    let reads = 0
    mocks.request.mockImplementation(async (operation: { kind: string; messageId?: string }) => {
      if (operation.kind === "messageGet") {
        if (operation.messageId === "next") return next.promise
        return reads++ ? reloaded.promise : detail("opened")
      }
      if (operation.kind === "messageCount") return { inboxTotal: 2, sentTotal: 0, unread: 0 }
      return { items: [], nextCursor: null }
    })
    render("inbox")
    await act(async () => { current.setSelectedId("opened") })
    await act(async () => { current.refresh() })
    await act(async () => { current.setSelectedId("next") })
    expect(current.detail).toBeNull()
    await act(async () => { reloaded.resolve(detail("opened")); await reloaded.promise })
    expect(current.detail).toBeNull()
    await act(async () => { next.resolve(detail("next")); await next.promise })
    expect(current.detail?.messageId).toBe("next")
    act(() => { current.setSelectedId(null) })
    expect(current.detail).toBeNull()
  })

  it("loads contacts independently of message searches and ignores a late result from another mailbox", async () => {
    const inbox = deferred<{ items: { key: string }[] }>()
    const sent = [{ key: "organization:team", kind: "organization", name: "研发部", handle: null, teamName: "团队", unread: 0, lastSentAt: "2026-10-16T00:00:00Z" }]
    mocks.request.mockImplementation((operation: { kind: string; box?: string }) => {
      if (operation.kind === "contactList") return operation.box === "inbox" ? inbox.promise : Promise.resolve({ items: sent })
      if (operation.kind === "messageCount") return Promise.resolve({ inboxTotal: 3, sentTotal: 1, unread: 2 })
      return Promise.resolve({ items: [], nextCursor: null })
    })
    render("inbox")
    render("inbox", "报告", true, "user:writer")
    expect(mocks.request.mock.calls.filter(([op]) => op.kind === "contactList")).toHaveLength(1)
    render("sent")
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(current.contacts).toEqual(sent)
    await act(async () => { inbox.resolve({ items: [{ key: "user:writer" }] }); await inbox.promise })
    expect(current.contacts).toEqual(sent)
  })

  it("drops a late page for the previous person and preserves the current person's filter", async () => {
    const oldPage = deferred<{ items: MailSummary[]; nextCursor: null }>()
    mocks.request.mockImplementation(async (operation: { kind: string; contactKey?: string; cursor?: string }) => {
      if (operation.kind === "messageCount") return { inboxTotal: 3, sentTotal: 0, unread: 2 }
      if (operation.kind === "contactList") return { items: [] }
      if (operation.cursor) return oldPage.promise
      return { items: [message(operation.contactKey ?? "all")], nextCursor: "older" }
    })
    render("inbox", "", false, "user:first")
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(current.messages[0]?.messageId).toBe("user:first")
    let loading!: Promise<void>
    act(() => { loading = current.loadMore() })
    render("inbox", "", false, "user:second")
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { oldPage.resolve({ items: [message("old-person-page")], nextCursor: null }); await loading })
    expect(current.messages.map(item => item.messageId)).toEqual(["user:second"])
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageList", box: "inbox", query: "", unreadOnly: false, contactKey: "user:first", cursor: "older" })
  })
  it("keeps unread and search filters through pagination, then starts a new list when search changes", async () => {
    mocks.request.mockImplementation(async (operation: { kind: string; query?: string; cursor?: string }) => {
      if (operation.kind === "messageCount") return { inboxTotal: 3, sentTotal: 1, unread: 2 }
      return operation.cursor ? { items: [message("second")], nextCursor: null } : { items: [message(operation.query === "new" ? "new" : "first")], nextCursor: "page-2" }
    })
    render("inbox", "old", true)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(current.counts?.unread).toBe(2)
    await act(async () => { await current.loadMore() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageList", box: "inbox", query: "old", cursor: "page-2", unreadOnly: true })
    expect(current.messages.map((item) => item.messageId)).toEqual(["first", "second"])
    render("inbox", "new", true)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(current.messages.map((item) => item.messageId)).toEqual(["new"])
  })
  it("does not show a previous mailbox while the new mailbox loads", async () => {
    const inbox = deferred<{ items: MailSummary[]; nextCursor: null }>()
    const sent = deferred<{ items: MailSummary[]; nextCursor: null }>()
    mocks.request.mockImplementation((operation: { kind: string; box?: string }) => operation.box === "sent" ? sent.promise : inbox.promise)
    render("inbox")
    expect(current.ready).toBe(false)
    await act(async () => { inbox.resolve({ items: [message("received")], nextCursor: null }); await inbox.promise })
    expect(current.ready).toBe(true)
    expect(current.messages.map((item) => item.messageId)).toEqual(["received"])
    expect(current.selectedId).toBeNull()
    render("sent")
    expect(current.ready).toBe(false)
    expect(current.messages).toEqual([])
    await act(async () => { sent.resolve({ items: [message("sent")], nextCursor: null }); await sent.promise })
    expect(current.ready).toBe(true)
    expect(current.messages.map((item) => item.messageId)).toEqual(["sent"])
  })

  it("returns to the inbox when a deep-linked message no longer exists", async () => {
    mocks.request.mockImplementation((operation: { kind: string }) => operation.kind === "messageGet" ? Promise.reject(new Error("HTTP 404")) : Promise.resolve({ items: [], nextCursor: null }))
    render("inbox")
    await act(async () => { current.setSelectedId("removed") })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(current.selectedId).toBeNull()
    expect(current.detail).toBeNull()
    expect(current.error).toBeNull()
  })

  it("marks only the opened deep-linked message as read", async () => {
    let detailReads = 0
    mocks.request.mockImplementation((operation: { kind: string }) => {
      if (operation.kind === "messageGet") return Promise.resolve({ ...message("opened"), viewerId: "reader", sender: { userId: "writer" }, body: "正文", readAt: detailReads++ ? "2026-09-28T00:00:00.000Z" : null })
      if (operation.kind === "messageSetRead") return Promise.resolve({ read: true })
      return Promise.resolve({ items: [message("opened"), message("other")], nextCursor: null })
    })
    render("inbox")
    await act(async () => { current.setSelectedId("opened") })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "opened", read: true })
    expect(mocks.request).not.toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "other", read: true })
  })

  it("marks self-sent mail read only when opened from the inbox", async () => {
    mocks.request.mockImplementation((operation: { kind: string; box?: string }) => {
      if (operation.kind === "messageGet") return Promise.resolve({ ...message("self"), viewerId: "reader", sender: { userId: "reader" }, body: "记录", readAt: null })
      if (operation.kind === "messageSetRead") return Promise.resolve({ read: true })
      return Promise.resolve({ items: [message("self")], nextCursor: null })
    })
    render("inbox")
    await act(async () => { current.setSelectedId("self") })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "self", read: true })

    mocks.request.mockClear()
    render("sent")
    await act(async () => { current.setSelectedId("self") })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.request).not.toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "self", read: true })
  })

  it("keeps the selected message unread until another message is opened and it is reopened", async () => {
    let openedReadAt: string | null = "2026-09-28T00:00:00.000Z"
    mocks.request.mockImplementation(async (operation: { kind: string; messageId?: string; read?: boolean }) => {
      if (operation.kind === "messageGet") return { ...message(operation.messageId!), viewerId: "reader", sender: { userId: "writer" }, body: "正文", readAt: operation.messageId === "opened" ? openedReadAt : "2026-09-28T00:00:00.000Z" }
      if (operation.kind === "messageSetRead") {
        openedReadAt = operation.read ? "2026-09-29T00:00:00.000Z" : null
        return { read: operation.read }
      }
      if (operation.kind === "messageCount") return { inboxTotal: 2, sentTotal: 0, unread: openedReadAt ? 0 : 1 }
      return { items: [message("opened"), message("other")], nextCursor: null }
    })
    render("inbox")
    await act(async () => { current.setSelectedId("opened") })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    await act(async () => { await mocks.request({ kind: "messageSetRead", messageId: "opened", read: false }); current.refresh() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(openedReadAt).toBeNull()
    expect(current.detail?.readAt).toBeNull()
    expect(mocks.request).not.toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "opened", read: true })

    await act(async () => { current.setSelectedId("other") })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { current.setSelectedId("opened") })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "opened", read: true })
  })
})
