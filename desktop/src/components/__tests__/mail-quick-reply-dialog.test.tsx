/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MailQuickReplyDialog } from "../mail-quick-reply-dialog"
import type { MailMessage } from "@/types/mail"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))

const source: MailMessage = {
  messageId: "message-1",
  sender: { userId: "writer", nickname: "发件人", handle: "writer" },
  recipients: [{ userId: "reader", nickname: "阅读者", handle: "reader" }],
  toRecipients: [{ userId: "reader", nickname: "阅读者", handle: "reader" }],
  ccRecipients: [],
  relationKind: null,
  subject: "项目进展",
  snippet: "正文",
  sentAt: "2026-10-22T00:00:00.000Z",
  readAt: null,
  attachmentCount: 0,
  viewerId: "reader",
  body: "正文",
  team: { id: "team-1", name: "团队" },
  conversationId: "conversation-1",
  replyToId: null,
  relation: null,
  quote: null,
  attachments: [],
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function render(current: MailMessage | null, onClose = vi.fn(), onSent = vi.fn()) {
  if (!root) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(<MailQuickReplyDialog source={current} onClose={onClose} onSent={onSent} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { onClose, onSent }
}

function textarea(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="回复内容"]')
  if (!element) throw new Error("Textarea not found")
  return element
}

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)
  if (!element) throw new Error(`Button not found: ${label}`)
  return element
}

async function enter(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea(), value)
    textarea().dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView ??= vi.fn()
  HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture ??= vi.fn()
  HTMLElement.prototype.releasePointerCapture ??= vi.fn()
  globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  mocks.request.mockReset()
  vi.restoreAllMocks()
})

describe("MailQuickReplyDialog", () => {
  it("focuses the textarea every time it opens", async () => {
    const handlers = await render(source)
    expect(document.activeElement).toBe(textarea())
    await render(null, handlers.onClose, handlers.onSent)
    await render(source, handlers.onClose, handlers.onSent)
    expect(document.activeElement).toBe(textarea())
  })

  it("discards text when closed and opened again for the same message", async () => {
    const handlers = await render(source)
    await enter("未发送")
    await render(null, handlers.onClose, handlers.onSent)
    await render(source, handlers.onClose, handlers.onSent)
    expect(textarea().value).toBe("")
  })

  it("previews and directly sends trimmed text", async () => {
    mocks.request
      .mockResolvedValueOnce({ previewId: "preview-1" })
      .mockResolvedValueOnce({ messageId: "reply-1", recipientCount: 1, sentAt: "2026-10-22T01:00:00.000Z" })
    const handlers = await render(source)
    expect(button("发送").disabled).toBe(true)
    await enter("  收到  ")
    await act(async () => { button("发送").click(); await Promise.resolve() })

    expect(mocks.request).toHaveBeenNthCalledWith(1, {
      kind: "sendPreview",
      content: expect.objectContaining({ body: "收到", toIds: ["writer"], relation: { kind: "reply", messageId: "message-1" } }),
    })
    expect(mocks.request).toHaveBeenNthCalledWith(2, {
      kind: "send",
      previewId: "preview-1",
      clientRequestId: expect.any(String),
    })
    expect(handlers.onSent).toHaveBeenCalledWith({ messageId: "reply-1", recipientCount: 1, sentAt: "2026-10-22T01:00:00.000Z" })
    expect(handlers.onClose).toHaveBeenCalledOnce()
  })

  it("keeps the text visible after a failed send", async () => {
    mocks.request.mockRejectedValueOnce(new Error("网络失败"))
    const handlers = await render(source)
    await enter("收到")
    await act(async () => { button("发送").click(); await Promise.resolve() })
    expect(textarea().value).toBe("收到")
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("网络失败")
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it("reuses the preview after a non-expiry send failure", async () => {
    mocks.request
      .mockResolvedValueOnce({ previewId: "preview-1" })
      .mockRejectedValueOnce(new Error("网络失败"))
      .mockResolvedValueOnce({ messageId: "reply-1", recipientCount: 1, sentAt: "2026-10-22T01:00:00.000Z" })
    await render(source)
    await enter("收到")
    await act(async () => { button("发送").click(); await Promise.resolve() })
    await act(async () => { button("发送").click(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledTimes(3)
    expect(mocks.request.mock.calls[2]?.[0]).toMatchObject({ kind: "send", previewId: "preview-1" })
    expect(mocks.request.mock.calls[2]?.[0].clientRequestId).toBe(mocks.request.mock.calls[1]?.[0].clientRequestId)
  })

  it("creates a new preview after expiry and ignores repeated clicks while sending", async () => {
    const preview = deferred<{ previewId: string }>()
    mocks.request.mockReturnValueOnce(preview.promise)
    await render(source)
    await enter("收到")
    await act(async () => {
      button("发送").click()
      button("发送").click()
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    await act(async () => { preview.resolve({ previewId: "expired-preview" }); await preview.promise })
    mocks.request
      .mockRejectedValueOnce(new Error("发送预览已过期，请重新确认。"))
      .mockResolvedValueOnce({ previewId: "preview-2" })
      .mockResolvedValueOnce({ messageId: "reply-2", recipientCount: 1, sentAt: "2026-10-22T01:00:00.000Z" })
    await act(async () => { button("发送").click(); await Promise.resolve() })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("发送预览已过期，请重试。")
    await act(async () => { button("发送").click(); await Promise.resolve() })
    expect(mocks.request.mock.calls.at(-2)?.[0]).toMatchObject({ kind: "sendPreview" })
    expect(mocks.request.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "send", previewId: "preview-2" })
  })
})
