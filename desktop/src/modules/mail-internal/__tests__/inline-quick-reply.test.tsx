/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import type { MailMessage } from "@/types/mail"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))

import { InlineMailQuickReply } from "../inline-quick-reply"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

async function render(message: MailMessage, onSent = vi.fn()) {
  if (!root) {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(<InlineMailQuickReply source={message} onSent={onSent} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return onSent
}

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('input[aria-label="快速回复内容"]')
  if (!element) throw new Error("Input not found")
  return element
}

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label)
  if (!element) throw new Error(`Button not found: ${label}`)
  return element
}

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input(), value)
    input().dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function enter(composing = false) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
  if (composing) Object.defineProperty(event, "isComposing", { value: true })
  await act(async () => {
    input().dispatchEvent(event)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  mocks.request.mockReset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("InlineMailQuickReply", () => {
  it.each(["button", "enter"] as const)("previews and sends trimmed text with %s", async (submission) => {
    mocks.request
      .mockResolvedValueOnce({ previewId: "preview-1" })
      .mockResolvedValueOnce({ messageId: "reply-1", recipientCount: 1, sentAt: "2026-10-22T01:00:00.000Z" })
    const success = vi.spyOn(toast, "success")
    const onSent = await render(source)
    expect(input().placeholder).toBe("快速回复")
    expect(button("发送").disabled).toBe(true)

    await type("  收到  ")
    if (submission === "button") await act(async () => { button("发送").click(); await Promise.resolve() })
    else await enter()

    expect(mocks.request).toHaveBeenNthCalledWith(1, {
      kind: "sendPreview",
      content: expect.objectContaining({ body: "收到", toIds: ["writer"], relation: { kind: "reply", messageId: "message-1" } }),
    })
    expect(mocks.request).toHaveBeenNthCalledWith(2, {
      kind: "send",
      previewId: "preview-1",
      clientRequestId: expect.any(String),
    })
    expect(onSent).toHaveBeenCalledWith({ messageId: "reply-1", recipientCount: 1, sentAt: "2026-10-22T01:00:00.000Z" })
    expect(success).toHaveBeenCalledWith("已发送")
    expect(input().value).toBe("")
  })

  it("does not send while the input method is composing", async () => {
    await render(source)
    await type("收到")
    await enter(true)
    expect(mocks.request).not.toHaveBeenCalled()
    expect(input().value).toBe("收到")
  })

  it("keeps the draft when the open message refreshes but resets for another message", async () => {
    await render(source)
    await type("还没发")

    await render({ ...source, readAt: "2026-10-22T00:01:00.000Z" })
    expect(input().value).toBe("还没发")

    await render({ ...source, messageId: "message-2", conversationId: "conversation-2" })
    expect(input().value).toBe("")
  })

  it("keeps the text and shows the shared quick reply error after a failed send", async () => {
    mocks.request.mockRejectedValueOnce(new Error("网络失败"))
    const onSent = await render(source)
    await type("收到")
    await act(async () => { button("发送").click(); await Promise.resolve() })

    expect(input().value).toBe("收到")
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("网络失败")
    expect(onSent).not.toHaveBeenCalled()
  })
})
