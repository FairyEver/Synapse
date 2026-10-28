/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseNotification } from "@/types/notification-center"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const openExternal = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => ({ openExternal }) }))
vi.mock("@/components/mail-quick-reply-dialog", () => ({ MailQuickReplyDialog: () => null }))

const mockCenter = vi.hoisted(() => ({
  authenticated: true, open: true, filter: "all", source: "all", items: [] as SynapseNotification[], cursor: null, unread: 0,
  selected: {
    id: "n1", source: "mail-internal", title: "新站内信", body: "来自 Synapse。", group: "mail-internal", url: null,
    level: "active", targetId: "broadcast-1", deviceId: null, readAt: "2026-09-29T10:00:00.000Z",
    resolvedAt: null, createdAt: "2026-09-29T10:00:00.000Z",
  } as SynapseNotification,
  mail: {
    messageId: "broadcast-1", kind: "platform_broadcast", subject: "版本公告", body: "管理员发送的完整正文",
    sender: { userId: "synapse", nickname: "Synapse", handle: null },
    toAddresses: [{ kind: "audience", name: "所有用户" }], toRecipients: [],
    sentAt: "2026-09-29T10:00:00.000Z", attachments: [],
  },
  mailLoading: false, mailError: null, loading: false, error: null,
  changeOpen: vi.fn(), changeFilter: vi.fn(), changeSource: vi.fn(), openItem: vi.fn(), navigate: vi.fn(),
  openApiGuide: vi.fn(), remove: vi.fn(), markAllRead: vi.fn(), setRead: vi.fn(),
  deleteAll: vi.fn(), loadMore: vi.fn(), refresh: vi.fn(), retryMail: vi.fn(), closeDetail: vi.fn(),
  loadMailForReply: vi.fn(), refreshAfterQuickReply: vi.fn(), accountId: "reader",
  imagePreview: null as string | null, imageViewerOpen: false,
  openNotificationImage: vi.fn(), ensureNotificationImage: vi.fn(async () => true),
}))

const initialSelected = mockCenter.selected

vi.mock("@/app-shell/hooks/use-message-center", () => ({ useMessageCenter: () => mockCenter }))

import { MessageCenter } from "../message-center"

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView ??= vi.fn()
  globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  document.body.innerHTML = ""
  openExternal.mockClear()
  mockCenter.mail.body = "管理员发送的完整正文"
  mockCenter.mail.kind = "platform_broadcast"
  mockCenter.items = []
  mockCenter.setRead.mockClear()
  mockCenter.remove.mockClear()
  mockCenter.changeSource.mockClear()
  mockCenter.loadMailForReply.mockReset()
  mockCenter.refreshAfterQuickReply.mockReset()
  mockCenter.accountId = "reader"
  mockCenter.selected = initialSelected
  mockCenter.openNotificationImage.mockClear()
  mockCenter.ensureNotificationImage.mockClear()
  mockCenter.imagePreview = null
  mockCenter.imageViewerOpen = false
})

describe("MessageCenter", () => {
  it("shows mail subjects in the list before opening them and keeps the source fallback", async () => {
    const subject = "【需求变更留档】" + "很长的站内信标题".repeat(12)
    mockCenter.items = [
      { ...mockCenter.selected, id: "unopened-mail", targetId: "mail-2", mailSubject: subject } as SynapseNotification,
      { ...mockCenter.selected, id: "deleted-mail", targetId: "mail-3" } as SynapseNotification,
      { ...mockCenter.selected, id: "terminal", source: "terminal-complete", title: "Claude Code" } as SynapseNotification,
    ]
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<MessageCenter />))
      const list = document.querySelector('[aria-label="通知列表"]')!
      expect(list.textContent).toContain(subject)
      expect(list.textContent).toContain("站内信")
      expect(list.textContent).toContain("终端")
      expect(mockCenter.loadMailForReply).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it("shows a quick reply action for user mail and withholds it from platform announcements", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "快速回复")).toBe(false)

    mockCenter.mail = {
      ...mockCenter.mail,
      kind: "user",
      messageId: "broadcast-1",
    } as never
    await act(async () => { root.render(<MessageCenter />) })
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "快速回复")).toBe(true)
    await act(async () => { root.unmount() })
    mockCenter.mail.kind = "platform_broadcast"
  })

  it("shows quick reply in the detail menu for user mail only", async () => {
    mockCenter.mail = { ...mockCenter.mail, kind: "user" } as never
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="通知操作"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    await act(async () => { await Promise.resolve() })
    expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some((item) => item.textContent === "快速回复")).toBe(true)

    mockCenter.mail = { ...mockCenter.mail, kind: "platform_broadcast" } as never
    await act(async () => { root.render(<MessageCenter />) })
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="通知操作"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    await act(async () => { await Promise.resolve() })
    expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some((item) => item.textContent === "快速回复")).toBe(false)
    await act(async () => { root.unmount() })
  })

  it("keeps the reading body mounted while the notification list refreshes", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<MessageCenter />))
      const body = document.querySelector('[aria-label="通知内容"] .markdown-viewer p')!
      expect(body.textContent).toBe("管理员发送的完整正文")

      mockCenter.loading = true
      await act(async () => root.render(<MessageCenter />))
      expect(document.querySelector('[aria-label="通知内容"] .markdown-viewer p')).toBe(body)

      mockCenter.loading = false
      mockCenter.items = [{ ...mockCenter.selected } as SynapseNotification]
      await act(async () => root.render(<MessageCenter />))
      expect(document.querySelector('[aria-label="通知内容"] .markdown-viewer p')).toBe(body)
    } finally {
      await act(async () => root.unmount())
      mockCenter.loading = false
    }
  })

  it("shows the full discussion title, quoted original and reply target before the new content", async () => {
    const previous = mockCenter.selected
    mockCenter.selected = { ...previous, source: "drive-discussion", targetId: "discussion-target", title: "截短标题", body: "简短摘要", driveDiscussion: {
      kind: "annotation", action: "replied", snapshot: {
        detailTitle: "张三回复了《完整文档名称》中的评论", content: "本次回复的较长内容",
        original: { kind: "text", text: "[原文](https://outside.example)" },
        replyTo: { authorName: "李四", content: "被回复的评论" },
      },
    } } as never
    mockCenter.items = [mockCenter.selected as SynapseNotification]
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<MessageCenter />))
      expect(document.querySelector('article h3')?.textContent).toBe("张三回复了《完整文档名称》中的评论")
      const detail = document.querySelector('article')!.textContent!
      expect(detail).toContain("评论原文")
      expect(detail).toContain("回复对象")
      expect(detail).toContain("李四")
      expect(detail).toContain("被回复的评论")
      expect(detail).toContain("本次回复的较长内容")
      expect(detail).not.toContain("简短摘要")
      expect(document.querySelector('a[href="https://outside.example"]')).toBeNull()
    } finally { await act(async () => root.unmount()); mockCenter.selected = previous }
  })
  it("renders a discussion excerpt as literal text rather than new Markdown links", async () => {
    const previous = mockCenter.selected
    mockCenter.selected = { ...previous, source: "drive-discussion", targetId: null, body: "[下载](https://outside.example)" } as never
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<MessageCenter />))
      expect(document.body.textContent).toContain("[下载](https://outside.example)")
      expect(document.querySelector('a[href="https://outside.example"]')).toBeNull()
    } finally { await act(async () => root.unmount()); mockCenter.selected = previous }
  })
  it.each([
    ["annotation", "created", "查看评论"], ["message", "created", "查看留言"],
    ["message", "replied", "查看回复"], [undefined, undefined, "查看文档"],
  ])("shows the discussion action for %s/%s", async (kind, action, label) => {
    const previous = mockCenter.selected
    mockCenter.selected = { ...previous, source: "drive-discussion", url: null, driveDiscussion: kind ? { kind, action } : undefined } as never
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host)
    try {
      await act(async () => root.render(<MessageCenter />))
      expect(document.body.textContent).toContain("云盘")
      const button = [...document.querySelectorAll("button")].find((button) => button.textContent === label)
      expect(button).toBeDefined()
      await act(async () => button?.click())
      expect(mockCenter.navigate).toHaveBeenCalledWith(mockCenter.selected)
    } finally { await act(async () => root.unmount()); mockCenter.selected = previous }
  })
  it("defaults to all sources and offers each existing notification category", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="通知分类"]')!
    expect(trigger.textContent).toBe("全部")

    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })) })
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map((option) => option.textContent)).toEqual([
      "全部", "系统通知", "Agent 待回复", "Agent 回复完成", "站内信", "录音转写", "待办提醒", "外部通知", "文档互动",
    ])
    await act(async () => { options.find((option) => option.textContent === "Agent 待回复")?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })) })
    expect(mockCenter.changeSource).toHaveBeenCalledWith("terminal-attention")
    await act(async () => { root.unmount() })
  })

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

  it("requests the row's mail for quick reply without opening it", async () => {
    const other = { ...mockCenter.selected, id: "n2", targetId: "mail-2", readAt: null } as SynapseNotification
    mockCenter.items = [mockCenter.selected as SynapseNotification, other]
    mockCenter.loadMailForReply.mockResolvedValue({ ...mockCenter.mail, messageId: "mail-2", kind: "user" })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("来自 Synapse") && item.getAttribute("aria-current") !== "true")!
    act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
    await act(async () => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "快速回复")?.click(); await Promise.resolve() })
    expect(mockCenter.loadMailForReply).toHaveBeenCalledWith(other)
    expect(mockCenter.openItem).not.toHaveBeenCalled()
    await act(async () => { root.unmount() })
  })

  it("ignores a quick reply mail response after the account changes", async () => {
    const other = { ...mockCenter.selected, id: "n2", targetId: "mail-2", readAt: null } as SynapseNotification
    mockCenter.items = [other]
    let resolveSource!: (value: unknown) => void
    mockCenter.loadMailForReply.mockReturnValue(new Promise((resolve) => { resolveSource = resolve }))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<MessageCenter />) })
    const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("来自 Synapse"))!
    act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
    act(() => { [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "快速回复")?.click() })
    mockCenter.accountId = "other"
    await act(async () => { root.render(<MessageCenter />) })
    await act(async () => { resolveSource({ ...mockCenter.mail, kind: "user" }); await Promise.resolve() })
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
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

  it("shows the image entry in the detail and opens it on demand", async () => {
    mockCenter.selected = {
      ...mockCenter.selected,
      source: "system-notifier",
      title: "图片通知",
      body: "看图",
      targetId: null,
      image: { id: "img-1", mimeType: "image/png", byteSize: 8 },
    } as SynapseNotification
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(<MessageCenter />) })
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "查看图片")
      expect(button).toBeTruthy()
      act(() => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })))
      expect(mockCenter.openNotificationImage).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }))
    } finally {
      await act(async () => { root.unmount() })
    }
  })

  it("shows the image itself as a detail thumbnail next to the view action", async () => {
    mockCenter.selected = {
      ...mockCenter.selected,
      source: "system-notifier",
      title: "图片通知",
      body: "看图",
      targetId: null,
      image: { id: "img-1", mimeType: "image/png", byteSize: 8 },
    } as SynapseNotification
    mockCenter.imagePreview = "blob:preview"
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(<MessageCenter />) })
      expect(document.querySelector('img[src="blob:preview"]')).toBeTruthy()
      expect([...document.querySelectorAll("button")].some((item) => item.textContent === "查看图片")).toBe(true)
      expect(mockCenter.ensureNotificationImage).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }))
    } finally {
      await act(async () => { root.unmount() })
    }
  })
})
