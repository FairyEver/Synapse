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

it("keeps a completed job quiet while periodic flag batches still reconcile remote changes", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  let release!: () => void, releaseNext!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const nextGate = new Promise<void>(resolve => { releaseNext = resolve })
  let batches = 0
  try {
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed" })
    vi.mocked(r.session.fetchFlags).mockImplementation(async (_path, uids) => { await (batches++ === 0 ? gate : nextGate); return uids.map(uid => ({ uid, flags: ["\\Seen", "\\Flagged"] })) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed" })
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed" })
    releaseNext()
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed", coverage: { metadataComplete: true, indexedCount: 251 } })
    let cursor: string | undefined, checked = 0
    do {
      const rows = await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id, cursor, limit: 100 })
      expect(rows.items.every(row => row.data.summary.read && row.data.summary.star)).toBe(true)
      checked += rows.items.length; cursor = rows.nextCursor ?? undefined
    } while (cursor)
    expect(checked).toBe(251)
  } finally { release(); releaseNext(); await r.sync.dispose(); await r.close() }
})

it("shows a manual refresh requested during a quiet background turn until its own work finishes", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  let releaseBackground!: () => void, releaseManual!: () => void
  const background = new Promise<void>(resolve => { releaseBackground = resolve })
  const manual = new Promise<void>(resolve => { releaseManual = resolve })
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1])
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed" })
    vi.mocked(r.session.searchUids).mockImplementationOnce(async () => { await background; return [1] })
      .mockImplementationOnce(async () => { await manual; return [1] })
    await vi.advanceTimersByTimeAsync(60_000)
    await r.sync.start(r.ctx, { accountId: r.account.id })
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "running" })
    releaseBackground()
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "running" })
    releaseManual()
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed" })
  } finally { releaseBackground(); releaseManual(); await r.sync.dispose(); await r.close() }
})

it("reports a real background failure and its retry instead of hiding it with completed status", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1])
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(10)
    vi.mocked(r.session.searchUids).mockRejectedValueOnce(new MailError("NETWORK_ERROR", "连接失败"))
      .mockImplementationOnce(async () => { await gate; return [1] })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "failed", errorCode: "NETWORK_ERROR" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "running", errorCode: null })
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed" })
  } finally { release(); await r.sync.dispose(); await r.close() }
})

it("reports real indexing and flag reconciliation progress, including an in-flight batch", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  let releaseHeaders!: () => void, releaseFlags!: () => void
  const headers = new Promise<void>(resolve => { releaseHeaders = resolve })
  const flags = new Promise<void>(resolve => { releaseFlags = resolve })
  vi.mocked(r.session.fetchHeaders).mockImplementationOnce(async (_path, uids) => uids.map(remoteHeader))
    .mockImplementationOnce(async (_path, uids) => { await headers; return uids.map(remoteHeader) })
  vi.mocked(r.session.fetchFlags).mockImplementationOnce(async (_path, uids) => uids.map(uid => ({ uid, flags: [] })))
    .mockImplementationOnce(async (_path, uids) => { await flags; return uids.map(uid => ({ uid, flags: [] })) })
  try {
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(20)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "running", syncProgress: { phase: "indexing", completed: 50, total: 251 } })
    releaseHeaders()
    await vi.advanceTimersByTimeAsync(20)
    expect(await r.sync.get(r.ctx, { accountId: r.account.id })).toMatchObject({ state: "running", syncProgress: { phase: "reconciling", completed: 100, total: 251 } })
    releaseFlags()
    await vi.advanceTimersByTimeAsync(20)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed", syncProgress: { phase: "reconciling", completed: 251, total: 251 } })
  } finally { releaseHeaders(); releaseFlags(); await r.sync.dispose(); await r.close() }
})

it("preserves confirmed flag progress when the next batch fails", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  vi.mocked(r.session.fetchFlags).mockImplementationOnce(async (_path, uids) => uids.map(uid => ({ uid, flags: [] })))
    .mockRejectedValueOnce(new MailError("NETWORK_ERROR", "连接失败"))
  try {
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(20)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "failed", syncProgress: { phase: "reconciling", completed: 100, total: 251 } })
  } finally { await r.sync.dispose(); await r.close() }
})

it("returns to indexing when a new UID is discovered before its header fetch finishes", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1])
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(20)
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2])
    vi.mocked(r.session.fetchHeaders).mockImplementationOnce(async (_path, uids) => { await gate; return uids.map(remoteHeader) })
    await r.sync.start(r.ctx, { accountId: r.account.id })
    await vi.advanceTimersByTimeAsync(1100)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "running", syncProgress: { phase: "indexing", completed: 1, total: 2 } })
  } finally { release(); await r.sync.dispose(); await r.close() }
})

it("keeps indexing while another folder still has headers pending", async () => {
  vi.useFakeTimers()
  const r = await syncRig()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.mocked(r.session.listFolders).mockResolvedValue([
    { path: "INBOX", name: "INBOX", delimiter: "/", flags: [], specialUse: null, count: 1 },
    { path: "Sent", name: "Sent", delimiter: "/", flags: [], specialUse: "\\Sent", count: 1 },
  ])
  vi.mocked(r.session.searchUids).mockResolvedValue([1])
  vi.mocked(r.session.fetchHeaders).mockImplementation(async (path, uids) => { if (path === "Sent") await gate; return uids.map(remoteHeader) })
  try {
    const { jobId } = await r.sync.startAccount(r.ctx, r.account.id)
    await vi.advanceTimersByTimeAsync(20)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "running", syncProgress: { phase: "indexing", completed: 1, total: 2 } })
    release()
    await vi.advanceTimersByTimeAsync(20)
    expect(await r.sync.get(r.ctx, { jobId })).toMatchObject({ state: "completed", syncProgress: { phase: "reconciling", completed: 2, total: 2 } })
  } finally { release(); await r.sync.dispose(); await r.close() }
})
