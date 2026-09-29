/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockCenter = vi.hoisted(() => ({
  authenticated: true, open: true, filter: "all", items: [], cursor: null, unread: 0,
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

afterEach(() => { document.body.innerHTML = "" })

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
})
