/** @vitest-environment jsdom */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MailMessage, MailSummary } from "@/types/mail"

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), setSelectedId: vi.fn(), messages: [] as MailSummary[], detail: null as MailMessage | null, selectedId: null as string | null }))
vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "reader" } } } }) }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))
vi.mock("../use-mail", () => ({ useMail: () => ({ messages: mocks.messages, ready: true, loading: false, error: null, selectedId: mocks.selectedId, detail: mocks.detail, nextCursor: null, counts: { inboxTotal: 3, sentTotal: 0, unread: 2 }, refresh: mocks.refresh, setSelectedId: mocks.setSelectedId }) }))
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
function render() {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container) }
  act(() => root?.render(<MailModule />))
}
function click(label: string) {
  const buttons = [...document.querySelectorAll("button")]
  const button = buttons.find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label)
    ?? buttons.find((item) => item.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  act(() => button.click())
}

afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; mocks.request.mockReset(); mocks.refresh.mockReset(); mocks.setSelectedId.mockReset(); mocks.messages = []; mocks.detail = null; mocks.selectedId = null })

describe("mail bulk controls", () => {
  it("shows platform announcements without reply or forward actions", () => {
    mocks.messages = [{ ...message("broadcast-1"), kind: "platform_broadcast", sender: { userId: "platform", nickname: "Synapse", handle: null } }]
    mocks.selectedId = "broadcast-1"
    mocks.detail = {
      ...mocks.messages[0], viewerId: "reader", body: "更新正文", team: null, conversationId: "broadcast-1",
      replyToId: null, relation: null, quote: null, attachments: [],
    }
    render()
    expect(document.body.textContent).toContain("Synapse")
    const labels = [...document.querySelectorAll("button")].map((item) => item.textContent?.trim())
    expect(labels).not.toContain("回复")
    expect(labels).not.toContain("转发")
    expect(labels).toContain("设为已读")
    expect(labels).toContain("删除")
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
    expect(mocks.request).toHaveBeenCalledWith({ kind: "messageDeleteBatch", messageIds: ["first", "second"] })
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
