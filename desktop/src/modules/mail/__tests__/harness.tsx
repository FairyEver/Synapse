import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, vi } from "vitest"
import type { MailBridge } from "../../../../app-capabilities/mail/shared/bridge"
const mocks = vi.hoisted(() => ({ owner: "user", api: {} as Record<string, ReturnType<typeof vi.fn>>, changed: (_event: unknown) => undefined }))
export { mocks }
vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: mocks.owner } } } }) }))
vi.mock("../api", () => ({ mailApi: () => mocks.api as unknown as MailBridge, mailError: (error: unknown) => error instanceof Error ? error.message : "邮箱操作失败" }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
export const summary = { id: "em_one", accountId: "ma_one", subject: "测试主题", from: [{ address: "a@example.com" }], to: [], cc: [], date: null, snippet: "", read: false, star: false, stale: false, attachmentCount: 0, revision: 1, bodyState: "remote" as const, locator: { accountId: "ma_one", folderId: "mf_one", uid: 1, uidValidity: "1" } }
export const detail = { ...summary, attachments: [], headers: { replyTo: [], references: [], messageId: null }, bodyRef: null }
export const coverage = { metadataComplete: true, serverHistoryComplete: null, indexedCount: 1, bodyScannedCount: 0, bodyPendingCount: null, reason: "server_visible_history_only" }
export const account = { id: "ma_one", name: "工作", email: "me@example.com", state: "connected", paused: false, revision: 1 }
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
let root: Root | null = null
export function mount(node: React.ReactNode) { if (!root) { const div = document.createElement("div"); document.body.append(div); root = createRoot(div) }; act(() => root!.render(node)) }
export async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }) }
beforeEach(() => {
  mocks.owner = "user"; mocks.api = {}
  for (const name of ["accountList", "folderList", "messageList", "messageGet", "messageUpdate", "messageDelete", "messageRestore", "messageMove", "bodyReadChunk", "searchStart", "searchGet", "searchResume", "syncStart", "uiScope", "onChanged", "draftList"]) mocks.api[name] = vi.fn()
  mocks.api.uiScope.mockResolvedValue({ ownerId: "user", generation: 1, notificationsSupported: true, notificationError: null })
  mocks.api.accountList.mockResolvedValue({ items: [account, { ...account, id: "ma_two", name: "个人" }], nextCursor: null })
  mocks.api.folderList.mockResolvedValue({ items: [{ id: "mf_one", accountId: "ma_one", role: "inbox", name: "收件箱", selectable: true }], nextCursor: null })
  mocks.api.messageList.mockResolvedValue({ items: [summary], nextCursor: null, coverage })
  mocks.api.messageGet.mockResolvedValue(detail)
  mocks.api.messageUpdate.mockResolvedValue({ items: [{ id: summary.id, status: "succeeded", newRevision: 2 }] })
  mocks.api.bodyReadChunk.mockResolvedValue({ bodyRef: "mas_body", html: "<p>正文</p>", text: "正文", complete: true, nextCursor: null, truncated: false })
  mocks.api.onChanged.mockImplementation(listener => { mocks.changed = listener; return () => undefined })
  mocks.api.draftList.mockResolvedValue({ items: [], nextCursor: null })
})
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = "" })
