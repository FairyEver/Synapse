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
  return { messageId, sender: person, recipients: [person], subject: messageId, snippet: "正文", sentAt: "2026-09-27T00:00:00.000Z", readAt: null, attachmentCount: 0 }
}

let root: Root | null = null
let current: ReturnType<typeof useMail>
function Harness({ box }: { box: MailBox }) {
  current = useMail(box, "")
  return null
}

function render(box: MailBox) {
  if (!root) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => root?.render(<Harness box={box} />))
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  mocks.request.mockReset()
})

describe("useMail", () => {
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
})
