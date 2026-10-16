/** @vitest-environment jsdom */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import type { MailContact, MailMessage, MailSummary } from "@/types/mail"

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), setSelectedId: vi.fn(), useMailArgs: vi.fn(), contacts: [] as MailContact[], messages: [] as MailSummary[], detail: null as MailMessage | null, selectedId: null as string | null }))
const openExternal = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => ({ openExternal }) }))
vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "reader" } } } }) }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))
vi.mock("../use-mail", () => ({ useMail: (...args: unknown[]) => { mocks.useMailArgs(...args); return { contacts: mocks.contacts, contactsReady: true, contactsError: null, messages: mocks.messages, ready: true, loading: false, error: null, selectedId: mocks.selectedId, detail: mocks.detail, nextCursor: null, counts: { inboxTotal: 3, sentTotal: 0, unread: 2 }, refresh: mocks.refresh, setSelectedId: mocks.setSelectedId } } }))
vi.mock("../use-mail-context", () => ({ useMailContext: () => ({ items: [], nextCursor: null, error: null }) }))
vi.mock("../compose", () => ({ MailCompose: () => null }))
vi.mock("../layout", () => ({ MailLayout: ({ navigation, list, detail }: { navigation: ReactNode; list: ReactNode; detail: ReactNode }) => <div>{navigation}{list}{detail}</div> }))
vi.mock("@/modules/apps/components/system-app-window-shell", () => ({ SystemAppWindowShell: ({ left, actions, children }: { left: ReactNode; actions: ReactNode; children: ReactNode }) => <div>{left}{actions}{children}</div> }))
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

import { MailModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const person = { userId: "writer", nickname: "发件人", handle: "writer" }
function message(messageId: string): MailSummary {
  return { messageId, sender: person, recipients: [person], toRecipients: [person], ccRecipients: [], relationKind: null, subject: messageId, snippet: "正文", sentAt: "2026-09-28T00:00:00.000Z", readAt: null, attachmentCount: 0 }
}

let root: Root | null = null
let container: HTMLDivElement | null = null
function render(openRequest?: { requestId: string; messageId: string }) {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container) }
  act(() => root?.render(<MailModule openRequest={openRequest} />))
}
function click(label: string) {
  const buttons = [...document.querySelectorAll("button")]
  const button = buttons.find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label)
    ?? buttons.find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  act(() => button.click())
}

afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; mocks.request.mockReset(); mocks.refresh.mockReset(); mocks.setSelectedId.mockReset(); mocks.useMailArgs.mockClear(); mocks.contacts = []; openExternal.mockClear(); mocks.messages = []; mocks.detail = null; mocks.selectedId = null })

describe("mail bulk controls", () => {
  it("distinguishes a user named Synapse from the system sender without exposing a malformed identity", () => {
    const common = { name: "Synapse", teamName: null, unread: 0, lastSentAt: "2026-10-16T00:00:00Z" }
    mocks.contacts = [{ ...common, key: "platform", kind: "platform", handle: null }, { ...common, key: "user:writer", kind: "user", handle: "writer" }]
    render()
    expect(document.querySelector('button[aria-label="Synapse"]')?.textContent).toBe("Synapse系统")
    expect(document.querySelector('button[aria-label="Synapse @writer"]')).not.toBeNull()
  })

  it("limits person views to scoped actions and resets filters when switching mailbox", () => {
    mocks.contacts = [{ key: "user:writer", kind: "user", name: "乔娜", handle: "qiaona", teamName: null, unread: 2, lastSentAt: "2026-10-16T00:00:00Z" }]
    mocks.messages = [message("first")]
    render()
    click("选择")
    click("first")
    click("乔娜")
    expect(mocks.useMailArgs).toHaveBeenLastCalledWith("inbox", "", false, "user:writer")
    expect(document.body.textContent).not.toContain("清空收件箱")
    expect(document.body.textContent).not.toContain("全部设已读")
    expect(document.body.textContent).not.toContain("删除选中（1）")
    click("只看未读")
    click("已发送")
    expect(mocks.useMailArgs).toHaveBeenLastCalledWith("sent", "", false, undefined)
    expect(document.body.textContent).toContain("全部收件人")
    expect(document.body.textContent).toContain("清空已发送")
  })
  it("distinguishes organizations with the same name in the same team", () => {
    const common = { kind: "organization" as const, name: "运营部", teamName: "公司", unread: 0, handle: null, lastSentAt: "2026-10-16T00:00:00Z" }
    mocks.contacts = [{ ...common, key: "organization:east" }, { ...common, key: "organization:west" }]
    render()
    click("已发送")
    expect(document.querySelector('button[aria-label="运营部 公司 · east"]')).not.toBeNull()
    expect(document.querySelector('button[aria-label="运营部 公司 · west"]')).not.toBeNull()
  })
  it("clears bulk selection when a notification opens another message in the same unfiltered mailbox", () => {
    mocks.messages = [message("first")]
    render()
    click("选择")
    click("first")
    render({ requestId: "notification-1", messageId: "target" })
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith("target")
    expect(document.body.textContent).not.toContain("删除选中（1）")
    expect(document.body.textContent).not.toContain("取消选择")
  })

  it("keeps a selected person after deleting their last message and offers a return to all mail", async () => {
    mocks.contacts = [{ key: "user:writer", kind: "user", name: "乔娜", handle: "qiaona", teamName: null, unread: 1, lastSentAt: "2026-10-16T00:00:00Z" }]
    mocks.messages = [message("last")]
    mocks.request.mockResolvedValue({ deleted: 1, skippedIds: [] })
    render()
    click("乔娜")
    click("选择")
    click("last")
    click("删除选中")
    await act(async () => { click("删除"); await Promise.resolve() })
    mocks.messages = []; mocks.contacts = []
    render()
    expect(mocks.useMailArgs).toHaveBeenLastCalledWith("inbox", "", false, "user:writer")
    expect(document.body.textContent).toContain("没有匹配的信件")
    click("查看全部")
    expect(mocks.useMailArgs).toHaveBeenLastCalledWith("inbox", "", false, undefined)
  })
  it("opens Markdown links from a mail message with the system browser", async () => {
    mocks.messages = [message("mail-1")]
    mocks.selectedId = "mail-1"
    mocks.detail = {
      ...mocks.messages[0], viewerId: "reader", body: "[查看更新](https://synapse.d2.pub/desktop/update)",
      team: null, conversationId: "mail-1", replyToId: null, relation: null, quote: null, attachments: [],
    }
    render()
    const link = document.querySelector<HTMLAnchorElement>('a[href="https://synapse.d2.pub/desktop/update"]')
    expect(link?.textContent).toBe("查看更新")
    await act(async () => { link?.click() })
    expect(openExternal).toHaveBeenCalledWith("https://synapse.d2.pub/desktop/update")
  })

  it("shows platform announcements without reply or forward actions", () => {
    mocks.messages = [{ ...message("broadcast-1"), kind: "platform_broadcast", sender: { userId: "platform", nickname: "Synapse", handle: null } }]
    mocks.selectedId = "broadcast-1"
    mocks.detail = {
      ...mocks.messages[0], viewerId: "reader", body: "更新正文", team: null, conversationId: "broadcast-1",
      replyToId: null, relation: null, quote: null, attachments: [],
    }
    render()
    expect(document.body.textContent).toContain("Synapse")
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="信件操作"]')
    expect(trigger).not.toBeNull()
    act(() => trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())
    expect(labels).not.toContain("回复")
    expect(labels).not.toContain("转发")
    expect(labels).toContain("设为已读")
    expect(labels).toContain("删除")
  })

  it("uses the row target for context actions and the open message for detail actions", async () => {
    mocks.request.mockResolvedValue(undefined)
    mocks.messages = [message("first"), message("second")]
    mocks.selectedId = "first"
    mocks.detail = { ...mocks.messages[0], viewerId: "reader", body: "正文", team: null, conversationId: "first", replyToId: null, relation: null, quote: null, attachments: [] }
    render()
    const second = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("second"))!
    act(() => second.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "设为已读")?.click(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "second", read: true })

    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="信件操作"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "设为已读")?.click(); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "first", read: true })
  })

  it("copies the selected row or open message as a typed mail reference", async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    mocks.messages = [message("first"), message("second")]
    mocks.selectedId = "first"
    mocks.detail = { ...mocks.messages[0], viewerId: "reader", body: "正文", team: null, conversationId: "first", replyToId: null, relation: null, quote: null, attachments: [] }
    render()
    const second = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("second"))!
    act(() => second.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "复制 ID")?.click() })
    expect(writeText).toHaveBeenCalledWith("synapse://mail/second")

    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="信件操作"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "复制 ID")?.click() })
    expect(writeText).toHaveBeenCalledWith("synapse://mail/first")
  })

  it("copies the full title and Markdown body from detail without attachments or mail metadata", async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    mocks.messages = [message("mail-1")]
    mocks.selectedId = "mail-1"
    mocks.detail = {
      ...mocks.messages[0], subject: "完整标题", viewerId: "reader", body: "## 正文\n\n第一段\n\n- 第二段\n- [链接](https://example.com)",
      team: null, conversationId: "mail-1", replyToId: null, relation: null, quote: null,
      attachmentCount: 1, attachments: [{ attachmentId: "attachment-1", fileName: "附件.pdf", size: 1024 }],
    }
    render()
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="信件操作"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "复制全文")?.click() })
    expect(writeText).toHaveBeenCalledExactlyOnceWith("完整标题\n\n## 正文\n\n第一段\n\n- 第二段\n- [链接](https://example.com)")
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it("loads the right-clicked message's full body instead of copying its snippet or the open message", async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    mocks.messages = [message("first"), message("second")]
    mocks.selectedId = "first"
    mocks.detail = { ...mocks.messages[0], viewerId: "reader", body: "当前打开的正文", team: null, conversationId: "first", replyToId: null, relation: null, quote: null, attachments: [] }
    mocks.request.mockResolvedValue({ ...mocks.detail, ...mocks.messages[1], subject: "另一封信", body: "摘要之后的完整正文\n\n最后一段", attachments: [{ attachmentId: "attachment-2", fileName: "不复制.txt", size: 10 }] })
    render()
    const second = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("second"))!
    act(() => second.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "复制全文")?.click() })
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ kind: "messageGet", messageId: "second" })
    expect(writeText).toHaveBeenCalledExactlyOnceWith("另一封信\n\n摘要之后的完整正文\n\n最后一段")
    expect(mocks.setSelectedId).not.toHaveBeenCalled()
  })

  it.each(["read", "clipboard"])("reports a copy failure when %s fails", async (failure) => {
    const errorToast = vi.spyOn(toast, "error")
    const writeText = vi.fn(async () => { if (failure === "clipboard") throw new Error("Clipboard unavailable") })
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    mocks.messages = [message("mail-1")]
    if (failure === "read") mocks.request.mockRejectedValue(new Error("Read failed"))
    else mocks.request.mockResolvedValue({ ...mocks.messages[0], body: "正文", attachments: [] })
    try {
      render()
      const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("mail-1"))!
      act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
      await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "复制全文")?.click() })
      expect(errorToast).toHaveBeenCalledExactlyOnceWith("复制失败")
      if (failure === "read") expect(writeText).not.toHaveBeenCalled()
    } finally { errorToast.mockRestore() }
  })

  it("keeps selection across loaded pages and sends only selected IDs", async () => {
    mocks.request.mockResolvedValue({ deleted: 2, skippedIds: [] })
    mocks.messages = [message("first")]
    render()
    click("选择")
    click("first")
    mocks.messages = [message("first"), message("second")]
    render()
    click("second")
    click("删除选中")
    await act(async () => { click("删除"); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageDeleteBatch", messageIds: ["first", "second"], box: "inbox" })
  })

  it("clears the complete mailbox after a search and preserves selection on failure", async () => {
    mocks.request.mockRejectedValue(new Error("失败"))
    mocks.messages = [message("first")]
    render()
    const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索信件"]')!
    act(() => { input.value = "keyword"; input.dispatchEvent(new Event("input", { bubbles: true })) })
    click("搜索")
    click("清空收件箱")
    await act(async () => { click("删除"); await Promise.resolve() })
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageDeleteAll", box: "inbox" })
    click("选择")
    click("first")
    click("删除选中")
    await act(async () => { click("删除"); await Promise.resolve() })
    expect(document.body.textContent).toContain("删除选中（1）")
  })
})
