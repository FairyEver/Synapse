/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseNotification } from "@/types/notification-center"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const openExternal = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => ({ openExternal }) }))

const mockCenter = vi.hoisted(() => ({
  authenticated: true, open: true, filter: "all", items: [] as SynapseNotification[], cursor: null, unread: 0,
  selected: {
    id: "n1", source: "mail", title: "新站内信", body: "来自 Synapse。", group: "mail", url: null,
    level: "active", targetId: "broadcast-1", deviceId: null, readAt: "2026-09-29T10:00:00.000Z",
    resolvedAt: null, createdAt: "2026-09-29T10:00:00.000Z",
  },
  mail: {
    messageId: "broadcast-1", kind: "platform_broadcast", subject: "版本公告", body: "管理员发送的完整正文",
    sender: { userId: "synapse", nickname: "Synapse", handle: null },
    toAddresses: [{ kind: "audience", name: "所有用户" }], toRecipients: [],
    sentAt: "2026-09-29T10:00:00.000Z", attachments: [],
  },
  mailLoading: false, mailError: null, loading: false, error: null,
  changeOpen: vi.fn(), changeFilter: vi.fn(), openItem: vi.fn(), navigate: vi.fn(),
  openApiGuide: vi.fn(), remove: vi.fn(), markAllRead: vi.fn(), setRead: vi.fn(),
  deleteAll: vi.fn(), loadMore: vi.fn(), refresh: vi.fn(), retryMail: vi.fn(), closeDetail: vi.fn(),
}))

vi.mock("@/app-shell/hooks/use-message-center", () => ({ useMessageCenter: () => mockCenter }))

import { MessageCenter } from "../message-center"

afterEach(() => { document.body.innerHTML = ""; openExternal.mockClear(); mockCenter.mail.body = "管理员发送的完整正文"; mockCenter.items = []; mockCenter.setRead.mockClear(); mockCenter.remove.mockClear() })

describe("MessageCenter", () => {
  it("shows the actual broadcast subject, audience, and full body instead of its safe notification preview", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    expect(document.body.textContent).toContain("版本公告")
    expect(document.body.textContent).toContain("所有用户")
    expect(document.body.textContent).toContain("管理员发送的完整正文")
    await act(async () => { root.unmount() })
  })

  it("opens a bare URL in the full mail body with the system browser", async () => {
    mockCenter.mail.body = "更新地址：https://synapse.d2.pub/desktop/update"
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    const link = document.querySelector<HTMLAnchorElement>('a[href="https://synapse.d2.pub/desktop/update"]')
    expect(link).not.toBeNull()
    await act(async () => { link?.click() })
    expect(openExternal).toHaveBeenCalledWith("https://synapse.d2.pub/desktop/update")
    await act(async () => { root.unmount() })
  })

  it("applies context actions to the row and detail actions to the open notification", async () => {
    const other = { ...mockCenter.selected, id: "n2", readAt: null } as SynapseNotification
    mockCenter.items = [mockCenter.selected as SynapseNotification, other]
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("来自 Synapse") && item.getAttribute("aria-current") !== "true")!
    act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "标记为已读")?.click() })
    expect(mockCenter.setRead).toHaveBeenCalledWith(other, true)

    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="通知操作"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "删除通知")?.click() })
    expect(mockCenter.remove).toHaveBeenCalledWith(mockCenter.selected)
    await act(async () => { root.unmount() })
  })

  it("copies row and detail notification IDs with their type", async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const other = { ...mockCenter.selected, id: "n2", readAt: null } as SynapseNotification
    mockCenter.items = [mockCenter.selected as SynapseNotification, other]
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("来自 Synapse") && item.getAttribute("aria-current") !== "true")!
    act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "复制 ID")?.click() })
    expect(writeText).toHaveBeenCalledWith("synapse:notification:n2")

    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="通知操作"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "复制 ID")?.click() })
    expect(writeText).toHaveBeenCalledWith("synapse:notification:n1")
    await act(async () => { root.unmount() })
  })
})
