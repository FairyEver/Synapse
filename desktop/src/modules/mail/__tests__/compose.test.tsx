/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MailCompose, type ComposeStart } from "../compose"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const people = [
  { userId: "a", nickname: "甲", handle: "person-a", matchKind: "browse", similarity: 1, sharedTeamIds: ["team"] },
  { userId: "b", nickname: "乙", handle: "person-b", matchKind: "browse", similarity: 1, sharedTeamIds: ["team"] },
]

let root: Root | null = null

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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function renderCompose(start: ComposeStart = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<MailCompose start={start} onClose={() => {}} onSent={() => {}} />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function openPicker() {
  const trigger = document.querySelector<HTMLButtonElement>('#mail-recipient-picker')
  await act(async () => { trigger?.click() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  mocks.request.mockReset()
})

describe("MailCompose recipients", () => {
  it("keeps a forwarded source readable and lets the sender remove its default attachment", async () => {
    mocks.request.mockImplementation((operation: { kind: string; query?: string }) => {
      if (operation.kind === "recipientSearch") return Promise.resolve({ items: people.filter((person) => person.userId === operation.query), nextCursor: null })
      if (operation.kind === "sendPreview") return Promise.resolve({ previewId: "preview-1" })
      return Promise.resolve({ messageId: "message-1" })
    })
    const source = {
      messageId: "original", viewerId: "owner", sender: people[0], recipients: [people[1]], toRecipients: [people[1]], ccRecipients: [],
      relationKind: null, subject: "原信", body: "原文", sentAt: "2026-09-27T00:00:00.000Z", readAt: null,
      conversationId: "old", replyToId: null, relation: null, quote: null,
      attachments: [{ attachmentId: "original-file", fileName: "报告.pdf", mimeType: "application/pdf", size: 100 }],
    } as const
    await renderCompose({ toIds: ["a"], subject: "转发：原信", relation: { kind: "forward", messageId: "original" }, source: source as never })
    expect(document.body.textContent).toContain("原文")
    const attachment = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("移除 报告.pdf"))
    expect(attachment).toBeDefined()
    await act(async () => { attachment?.click() })
    const send = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "发送")
    await act(async () => { send?.click(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "sendPreview", content: expect.objectContaining({ body: "", forwardAttachmentIds: [] }) })
  })

  it("keeps To and Cc separate in the send preview", async () => {
    mocks.request.mockImplementation((operation: { kind: string; query?: string }) => {
      if (operation.kind === "recipientSearch") return Promise.resolve({ items: people.filter((person) => person.userId === operation.query), nextCursor: null })
      if (operation.kind === "sendPreview") return Promise.resolve({ previewId: "preview-1" })
      return Promise.resolve({ messageId: "message-1" })
    })
    await renderCompose({ toIds: ["a"], ccIds: ["b"], subject: "报告", body: "正文" })
    expect(document.querySelector('[aria-label="已选收件人"]')?.textContent).toContain("甲")
    expect(document.querySelector('[aria-label="已选抄送"]')?.textContent).toContain("乙")
    const send = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "发送")
    await act(async () => { send?.click(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "sendPreview", content: expect.objectContaining({ formatVersion: 2, toIds: ["a"], ccIds: ["b"] }) })
  })

  it("allows wheel scrolling through a long recipient list", async () => {
    mocks.request.mockResolvedValue({ items: Array.from({ length: 12 }, (_, index) => ({ ...people[0], userId: `person-${index}` })), nextCursor: null })
    await renderCompose()
    await openPicker()

    const list = document.querySelector<HTMLElement>('[cmdk-list]')!
    expect(list.querySelectorAll('[cmdk-item]')).toHaveLength(12)
    list.style.overflowY = "auto"
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 480 },
      clientHeight: { configurable: true, value: 224 },
    })
    const outsideWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 })
    document.body.dispatchEvent(outsideWheel)
    expect(outsideWheel.defaultPrevented).toBe(true)
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 })
    list.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(false)
  })

  it("opens a searchable dropdown and keeps multiple selections visible", async () => {
    mocks.request.mockResolvedValue({ items: people, nextCursor: null })
    await renderCompose()

    expect(document.querySelector('[data-slot="dialog-frame"]')).toBeNull()
    expect(document.querySelector('[data-slot="dialog-close"]')).not.toBeNull()
    expect(document.querySelector('[cmdk-list]')).toBeNull()
    expect(mocks.request).not.toHaveBeenCalled()
    await openPicker()
    expect(mocks.request).toHaveBeenCalledWith({ kind: "recipientSearch", query: "" })
    expect(document.activeElement?.hasAttribute("cmdk-input")).toBe(true)
    const list = document.querySelector('[cmdk-list]')
    const choices = list?.querySelectorAll<HTMLElement>('[cmdk-item]')
    expect(choices).toHaveLength(2)

    await act(async () => { choices?.[0].click(); choices?.[1].click() })
    expect(list?.querySelectorAll('[cmdk-item][data-checked="true"]')).toHaveLength(2)
    expect(document.querySelector('[aria-label="已选收件人"]')?.textContent).toContain("甲")
    expect(document.querySelector('[aria-label="已选收件人"]')?.textContent).toContain("乙")
    expect(document.querySelector('#mail-recipient-picker')?.textContent).toContain("添加收件人")

    await act(async () => { list?.querySelector<HTMLElement>('[cmdk-item][data-checked="true"]')?.click() })
    expect(list?.querySelectorAll('[cmdk-item][data-checked="true"]')).toHaveLength(1)
  })

  it("loads the next page without losing the existing selection", async () => {
    mocks.request.mockImplementation(({ cursor }: { cursor?: string }) => Promise.resolve(cursor ? { items: [people[1]], nextCursor: null } : { items: [people[0]], nextCursor: "a" }))
    await renderCompose()
    await openPicker()
    const list = document.querySelector('[cmdk-list]')
    await act(async () => { list?.querySelector<HTMLElement>('[cmdk-item]')?.click() })
    const more = Array.from(list?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) => button.textContent === "加载更多")
    await act(async () => { more?.click(); await Promise.resolve() })

    expect(mocks.request).toHaveBeenCalledWith({ kind: "recipientSearch", query: "", cursor: "a" })
    expect(list?.querySelectorAll('[cmdk-item]')).toHaveLength(2)
    expect(list?.querySelectorAll('[cmdk-item][data-checked="true"]')).toHaveLength(1)
  })

  it("shows only the newest search results when an older request finishes late", async () => {
    const stale = deferred<{ items: typeof people; nextCursor: null }>()
    mocks.request.mockImplementation(({ query }: { query: string }) => query === "乙" ? stale.promise : Promise.resolve({ items: query ? [people[0]] : people, nextCursor: null }))
    await renderCompose()
    await openPicker()

    const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!
    const changeSearch = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)) })
    }

    await changeSearch("乙")
    expect(mocks.request).toHaveBeenCalledWith({ kind: "recipientSearch", query: "乙" })
    await changeSearch("甲")
    const list = document.querySelector('[cmdk-list]')
    expect(list?.querySelectorAll('[cmdk-item]')).toHaveLength(1)
    expect(list?.textContent).toContain("甲")

    await act(async () => { stale.resolve({ items: [people[1]], nextCursor: null }); await stale.promise })
    expect(list?.textContent).toContain("甲")
    expect(list?.textContent).not.toContain("乙")
  })

  it("offers a retry when the member list fails to load", async () => {
    mocks.request.mockRejectedValueOnce(new Error("成员加载失败")).mockResolvedValue({ items: people, nextCursor: null })
    await renderCompose()
    await openPicker()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("成员加载失败")

    const retry = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "重试")
    await act(async () => { retry?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.querySelector('[cmdk-list]')?.querySelectorAll('[cmdk-item]')).toHaveLength(2)
  })
})
