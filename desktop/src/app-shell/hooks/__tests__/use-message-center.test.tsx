/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseNotification } from "@/types/notification-center"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  list: vi.fn(), count: vi.fn(), read: vi.fn(), delete: vi.fn(), deleteAll: vi.fn(), readAll: vi.fn(),
  mailRequest: vi.fn(), info: vi.fn(), warn: vi.fn(),
}))

vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "reader" } } } }) }))
vi.mock("@/app-shell/notifications", () => ({ useAppNotifications: () => ({ info: mocks.info }) }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: mocks.warn }) }))
vi.mock("@/app-shell/terminal-navigation", () => ({ requestOpenTerminalSession: vi.fn() }))
vi.mock("@/lib/mail-api", () => ({ mailRequest: mocks.mailRequest }))
vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => null,
  requireBridgeDomain: (domain: string) => {
    if (domain !== "account") throw new Error(`Unexpected domain: ${domain}`)
    return { notifications: { list: mocks.list, count: mocks.count, read: mocks.read, delete: mocks.delete, deleteAll: mocks.deleteAll, readAll: mocks.readAll } }
  },
}))

import { useMessageCenter } from "../use-message-center"

const notice: SynapseNotification = {
  id: "n1", source: "mail", title: "新站内信", body: "来自 Synapse。", group: "mail", url: null,
  level: "active", targetId: "broadcast-1", deviceId: null, readAt: null, resolvedAt: null,
  createdAt: "2026-09-29T10:00:00.000Z",
}

let root: Root | null = null
let current: ReturnType<typeof useMessageCenter>

function Harness() { current = useMessageCenter(); return null }
async function flush() { await Promise.resolve(); await Promise.resolve() }

beforeEach(async () => {
  mocks.list.mockReset().mockResolvedValue({ items: [notice], nextCursor: null })
  mocks.count.mockReset().mockResolvedValue({ unread: 1 })
  mocks.read.mockReset().mockResolvedValue({ ok: true })
  mocks.delete.mockReset().mockResolvedValue({ ok: true })
  mocks.deleteAll.mockReset().mockResolvedValue({ ok: true })
  mocks.readAll.mockReset().mockResolvedValue({ ok: true })
  mocks.info.mockReset()
  mocks.warn.mockReset()
  mocks.mailRequest.mockReset().mockImplementation(async (request: { kind: string }) => request.kind === "messageGet" ? {
    messageId: "broadcast-1", kind: "platform_broadcast", subject: "版本公告", body: "管理员发送的完整正文",
    sender: { userId: "synapse", nickname: "Synapse", handle: null }, viewerId: "reader", readAt: null,
    toAddresses: [{ kind: "audience", name: "所有用户" }], toRecipients: [], attachments: [],
  } : { read: true })
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root?.render(<Harness />); await flush() })
})

afterEach(async () => {
  await act(async () => { root?.unmount(); await flush() })
  root = null
  document.body.innerHTML = ""
  vi.useRealTimers()
})

describe("useMessageCenter", () => {
  it("loads the full platform announcement only after opening its notification", async () => {
    expect(mocks.mailRequest).not.toHaveBeenCalled()
    await act(async () => { current.changeOpen(true); await flush() })
    await act(async () => { await current.openItem(notice); await flush() })
    expect(mocks.mailRequest).toHaveBeenCalledWith({ kind: "messageGet", messageId: "broadcast-1" })
    expect(mocks.mailRequest).toHaveBeenCalledWith({ kind: "messageSetRead", messageId: "broadcast-1", read: true })
    expect(current.mail?.body).toBe("管理员发送的完整正文")
    expect(mocks.read).toHaveBeenCalledWith({ id: "n1" })
  })

  it("lets a single deletion be undone before it reaches the server", async () => {
    vi.useFakeTimers()
    await act(async () => { current.remove(notice) })
    expect(current.items).toEqual([])
    const options = mocks.info.mock.calls[0]?.[1] as { action: { onClick: () => void } }
    await act(async () => { options.action.onClick(); vi.advanceTimersByTime(5_500) })
    expect(current.items).toEqual([notice])
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it("commits an unrevoked deletion after the undo window", async () => {
    vi.useFakeTimers()
    await act(async () => { current.remove(notice) })
    await act(async () => { vi.advanceTimersByTime(5_500); await flush() })
    expect(mocks.delete).toHaveBeenCalledWith({ id: "n1" })
  })
})
