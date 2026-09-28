/** @vitest-environment jsdom */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MailSummary } from "@/types/mail"

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), setSelectedId: vi.fn(), messages: [] as MailSummary[] }))
vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "reader" } } } }) }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.request }))
vi.mock("../use-mail", () => ({ useMail: () => ({ messages: mocks.messages, ready: true, loading: false, error: null, selectedId: null, detail: null, nextCursor: null, counts: { inboxTotal: 3, sentTotal: 0, unread: 2 }, refresh: mocks.refresh, setSelectedId: mocks.setSelectedId }) }))
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

afterEach(() => { if (root) act(() => root?.unmount()); root = null; container?.remove(); container = null; mocks.request.mockReset(); mocks.refresh.mockReset(); mocks.setSelectedId.mockReset(); mocks.messages = [] })

describe("mail bulk controls", () => {
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
