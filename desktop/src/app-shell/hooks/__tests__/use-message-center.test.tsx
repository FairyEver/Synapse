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
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

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
  it("defaults to all categories without sending a source restriction", () => {
    expect(current.source).toBe("all")
    expect(mocks.list).toHaveBeenCalledWith({ filter: "all" })
    expect(mocks.count).toHaveBeenCalledWith()
  })

  it("combines the category and status filters and resets to all categories", async () => {
    await act(async () => { current.changeFilter("unread"); current.changeSource("terminal-attention"); await flush() })
    expect(current.filter).toBe("unread")
    expect(current.source).toBe("terminal-attention")
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "unread", source: "terminal-attention" })

    await act(async () => { current.changeFilter("pending"); await flush() })
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "pending", source: "terminal-attention" })
    await act(async () => { current.changeSource("system-notifier"); await flush() })
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "pending", source: "system-notifier" })
    await act(async () => { current.changeSource("all"); await flush() })
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "pending" })
  })

  it("clears the previous selection, list, and cursor while loading another category", async () => {
    mocks.list.mockResolvedValueOnce({ items: [notice], nextCursor: "old-next" })
    await act(async () => { await current.openItem(notice); await flush() })
    expect(current.selected?.id).toBe(notice.id)
    expect(current.cursor).toBe("old-next")
    const nextPage = deferred<{ items: SynapseNotification[]; nextCursor: string | null }>()
    mocks.list.mockReturnValueOnce(nextPage.promise)
    await act(async () => { current.changeSource("system-notifier"); await flush() })
    expect(current.selected).toBeNull()
    expect(current.items).toEqual([])
    expect(current.cursor).toBeNull()
    expect(current.loading).toBe(true)
    await act(async () => { nextPage.resolve({ items: [], nextCursor: null }); await flush() })
  })

  it("retains the category and status restrictions when loading another page", async () => {
    const attention: SynapseNotification = { ...notice, id: "attention-1", source: "terminal-attention" }
    const nextAttention: SynapseNotification = { ...attention, id: "attention-2" }
    mocks.list.mockResolvedValueOnce({ items: [attention], nextCursor: "attention-next" })
    await act(async () => { current.changeFilter("unread"); current.changeSource("terminal-attention"); await flush() })
    mocks.list.mockResolvedValueOnce({ items: [attention, nextAttention], nextCursor: "attention-last" })
    await act(async () => { await current.loadMore(); await flush() })
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "unread", source: "terminal-attention", cursor: "attention-next" })
    expect(current.items).toEqual([attention, nextAttention])
    expect(current.cursor).toBe("attention-last")
  })

  it("ignores an old page that arrives after the category changes", async () => {
    const systemNotice: SynapseNotification = { ...notice, id: "system-1", source: "system-notifier" }
    const oldPage = deferred<{ items: SynapseNotification[]; nextCursor: string | null }>()
    mocks.list.mockResolvedValueOnce({ items: [notice], nextCursor: "mail-next" })
    await act(async () => { current.changeSource("mail"); await flush() })
    mocks.list.mockReturnValueOnce(oldPage.promise)
    let loadingOldPage!: Promise<void>
    await act(async () => { loadingOldPage = current.loadMore(); await flush() })
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "all", source: "mail", cursor: "mail-next" })

    mocks.list.mockResolvedValueOnce({ items: [systemNotice], nextCursor: "system-next" })
    await act(async () => { current.changeSource("system-notifier"); await flush() })
    await act(async () => {
      oldPage.resolve({ items: [{ ...notice, id: "old-mail-page" }], nextCursor: "old-mail-last" })
      await loadingOldPage
      await flush()
    })
    expect(current.items).toEqual([systemNotice])
    expect(current.cursor).toBe("system-next")
  })

  it("keeps bulk read and deletion operations scoped to the account across category filters", async () => {
    await act(async () => { current.changeFilter("unread"); current.changeSource("mail"); await flush() })
    await act(async () => { await current.markAllRead(); await current.deleteAll("all"); await current.deleteAll("pending"); await flush() })
    expect(mocks.readAll).toHaveBeenCalledWith()
    expect(mocks.deleteAll.mock.calls).toEqual([[{ filter: "all" }], [{ filter: "pending" }]])
    expect(mocks.list).toHaveBeenLastCalledWith({ filter: "unread", source: "mail" })
  })

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

  it("refreshes the current category when a deletion timer finishes after a category change", async () => {
    vi.useFakeTimers()
    await act(async () => { current.remove(notice) })
    await act(async () => { current.changeSource("mail"); await flush() })
    mocks.list.mockClear()

    await act(async () => { vi.advanceTimersByTime(5_500); await flush() })
    expect(mocks.delete).toHaveBeenCalledWith({ id: "n1" })
    expect(current.source).toBe("mail")
    expect(mocks.list.mock.calls).toEqual([[{ filter: "all", source: "mail" }]])
  })
})
