import { afterEach, expect, it, vi } from "vitest"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailError } from "../../shared/types"
import type { StoredFolder } from "../sync"

afterEach(() => vi.useRealTimers())

it("finds the current account job without starting or resuming synchronization", async () => {
  const r = await syncRig()
  try {
    expect(await r.sync.get(r.ctx, { accountId: r.account.id })).toBeNull()
    expect(r.session.fetchHeaders).not.toHaveBeenCalled()
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    expect(await r.sync.get(r.ctx, { accountId: r.account.id })).toMatchObject({ jobId, accountId: r.account.id })
  } finally { await r.sync.dispose(); await r.close() }
})

it("keeps completed progress on failure and reports running when a retry actually starts", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.mocked(r.session.fetchHeaders).mockImplementationOnce(async (_path, uids) => uids.map(remoteHeader))
    .mockRejectedValueOnce(new MailError("NETWORK_ERROR", "连接失败"))
    .mockImplementationOnce(async (_path, uids) => { await gate; return uids.map(remoteHeader) })
  try {
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "failed", errorCode: "NETWORK_ERROR", coverage: { indexedCount: 50 } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "running", errorCode: null, coverage: { indexedCount: 50 } })
  } finally { release(); await r.sync.dispose(); await r.close() }
})

it("does not report a stopped runner as running, even when its stored job was unfinished", async () => {
  const r = await syncRig()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.mocked(r.session.fetchHeaders).mockImplementationOnce(async (_path, uids) => { await gate; return uids.map(remoteHeader) })
  try {
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.waitFor(() => expect(r.session.fetchHeaders).toHaveBeenCalled())
    await r.sync.stopAccount(r.account.id)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "paused" })
    expect(await r.sync.get(r.ctx, { accountId: r.account.id })).toBeNull()
  } finally { release(); await r.sync.dispose(); await r.close() }
})

it("keeps account coverage incomplete when only a prioritized folder has finished", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.listFolders).mockResolvedValue([
      { path: "INBOX", name: "INBOX", delimiter: "/", flags: [], specialUse: null, count: 251 },
      { path: "Sent", name: "Sent", delimiter: "/", flags: [], specialUse: "\\Sent", count: 1 },
    ])
    vi.mocked(r.session.searchUids).mockImplementation(async path => path === "Sent" ? [1] : Array.from({ length: 251 }, (_, i) => i + 1))
    await r.sync.runOnce(r.ctx, r.account.id)
    const folders = await r.repo.page<StoredFolder>(r.ctx, "folders", { accountId: r.account.id })
    const sent = folders.items.find(folder => folder.data.folder.role === "sent")!
    expect(await r.sync.runOnce(r.ctx, r.account.id, sent.id, false)).toMatchObject({ metadataComplete: false, indexedCount: 51 })
    expect((await r.repo.get<StoredFolder>(r.ctx, "folders", sent.id)).data.folder).toMatchObject({ metadataComplete: true, serverCount: 1 })
  } finally { await r.sync.dispose(); await r.close() }
})
