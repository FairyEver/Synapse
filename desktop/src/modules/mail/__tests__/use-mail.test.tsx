/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MailSummary } from "@/types/mail"
import { useMail, type MailBox } from "../use-mail"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function message(messageId: string): MailSummary {
  const person = { userId: "person", nickname: "成员", handle: "member" }
  return { messageId, sender: person, recipients: [person], toRecipients: [person], ccRecipients: [], relationKind: null, subject: messageId, snippet: "正文", sentAt: "2026-09-27T00:00:00.000Z", readAt: null, attachmentCount: 0 }
}

let root: Root | null = null
let current: ReturnType<typeof useMail>
function Harness({ box, query = "", unreadOnly = false }: { box: MailBox; query?: string; unreadOnly?: boolean }) {
  current = useMail(box, query, unreadOnly)
  return null
}

function render(box: MailBox, query = "", unreadOnly = false) {
  if (!root) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => root?.render(<Harness box={box} query={query} unreadOnly={unreadOnly} />))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  mocks.request.mockReset()
})

describe("useMail", () => {
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
