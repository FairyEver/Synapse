import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { afterEach, expect, it, vi } from "vitest"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { createMailTestRig } from "./helpers"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { aliyunConfig } from "../protocol/aliyun-policy"
import { MailService } from "../service"
import { createMailCapabilityDispatcher } from "../dispatcher"
import type { MailServiceDeps } from "../service"
import type { SmtpSnapshot } from "../protocol/types"
import type { SendReceipt } from "../../shared/types"
function deps(r: Awaited<ReturnType<typeof createMailTestRig>>) {
  const show = vi.fn(), dispose = vi.fn(), events = vi.fn(), open = vi.fn(), diagnostic = vi.fn()
  const permissionGuard = { registerPolicy: vi.fn(() => () => undefined), check: vi.fn(async () => ({ allowed: true as const })) }
  const options: MailServiceDeps = { storage: r.storage, files: new ManagedAssetStore(`${r.root}/assets`), permissionGuard, auditSink: new InMemoryAuditSink(), resolveOwner: () => "test-owner", events, open, notifications: { show, dispose }, diagnostic, protocols: r.protocols }
  return { ...options, show, events, notificationDispose: dispose }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it("runs background receiving through shared UI/MCP drafts, MIME send, Sent reconciliation and receipt recovery without cloud requests", async () => {
  const r = await createMailTestRig(), account = await r.accounts.configure(r.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "test-only" }), ports = deps(r)
  const cloud = vi.fn().mockRejectedValue(new Error("No cloud calls allowed")); vi.stubGlobal("fetch", cloud)
  let service = new MailService(ports), newUid = 1, hint: (() => void) | undefined, sent: SmtpSnapshot | undefined
  const paths = ["INBOX", "Sent", "Drafts"]
  const uids = (path: string) => path === "INBOX" ? Array.from({ length: newUid }, (_, i) => i + 1) : path === "Sent" && sent ? [20] : []
  vi.mocked(r.session.listFolders).mockImplementation(async () => paths.map(path => ({ path, name: path, delimiter: "/", flags: [], specialUse: path === "Sent" ? "\\Sent" : path === "Drafts" ? "\\Drafts" : null, count: uids(path).length })))
  vi.mocked(r.session.select).mockImplementation(async path => ({ uidValidity: "1", count: uids(path).length, uidNext: (uids(path).at(-1) ?? 0) + 1 }))
  vi.mocked(r.session.searchUids).mockImplementation(async (path, query) => query.uid ? uids(path).filter(uid => query.uid === String(uid)) : uids(path))
  vi.mocked(r.session.fetchHeaders).mockImplementation(async (path, values) => values.map(uid => path === "Sent" && sent ? { ...remoteHeader(uid), subject: "Re: Mail 2", messageId: sent.messageId, from: [{ address: "me@example.com" }], date: new Date().toISOString(), size: sent.raw.length, structure: null } : { ...remoteHeader(uid), structure: { type: "text/plain", part: "1" } }))
  vi.mocked(r.session.fetchBodyStructure).mockResolvedValue({ type: "text/plain", part: "1" })
  vi.mocked(r.session.fetchPart).mockImplementation(async path => Readable.from([path === "Sent" && sent ? sent.raw : Buffer.from("正文内容")]))
  vi.mocked(r.session.fetchFlags).mockImplementation(async (_path, values) => values.map(uid => ({ uid, flags: [] })))
  vi.mocked(r.session.idle).mockImplementation(async (_path, signal, listener) => { hint = listener; await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }) }) })
  vi.mocked(r.smtp.submit).mockImplementation(async snapshot => { sent = snapshot; return { accepted: snapshot.to, rejected: [], messageId: snapshot.messageId } })
  vi.useFakeTimers()
  try {
    service.scope({ id: 42, isDestroyed: () => false, onDestroyed: () => () => undefined }); service.startBackground()
    await vi.waitFor(async () => expect((await service.execute(service.context("ui"), "message.list", { accountId: account.id, limit: 50 })).items).toHaveLength(1))
    expect(ports.show).not.toHaveBeenCalled()
    newUid = 2; hint?.(); await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(async () => expect((await service.execute(service.context("ui"), "message.list", { accountId: account.id, limit: 50 })).items).toHaveLength(2))
    await vi.advanceTimersByTimeAsync(5000); expect(ports.show).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    const list = await service.execute(service.context("ui"), "message.list", { accountId: account.id, limit: 50 }), message = list.items.find(item => item.locator.uid === 2)!
    const job = await service.execute(service.context("ui"), "search.start", { accountId: account.id, query: "Mail 2", fields: "metadata" })
    await vi.waitFor(async () => expect((await service.execute(service.context("ui"), "search.get", { ...job, limit: 50 })).items).toHaveLength(1))
    await vi.waitFor(() => expect(ports.events.mock.calls.some(([event]) => event.ids.includes(job.jobId))).toBe(true))
    const draft = await service.execute(service.context("ui"), "draft.create", { accountId: account.id, sourceMessageId: message.id, mode: "reply", forwardMode: "inline" })
    const dispatcher = createMailCapabilityDispatcher({ service, permissionGuard: ports.permissionGuard, auditSink: ports.auditSink })
    const edits = await Promise.allSettled([service.execute(service.context("ui"), "draft.update", { draftId: draft.id, expectedRevision: draft.revision, patch: { subject: "Re: Mail 2" } }), dispatcher.dispatch("app.mail.draft.update", { draftId: draft.id, expectedRevision: draft.revision, patch: { subject: "Re: Mail 2" } }, { source: "mcp-http" }).then(result => { if (!result.ok) throw new Error(result.code); return result })])
    expect(edits.filter(result => result.status === "fulfilled")).toHaveLength(1)
    const current = await service.execute(service.context("ui"), "draft.get", { draftId: draft.id }), preview = await service.execute(service.context("ui"), "send.preview", { draftId: draft.id, expectedRevision: current.revision }), requestId = randomUUID()
    const receipt = await service.execute(service.context("ui"), "message.send", { previewId: preview.previewId, clientRequestId: requestId, confirmed: true })
    expect(receipt.state).toBe("accepted"); expect(r.smtp.submit).toHaveBeenCalledTimes(1)
    expect(sent!.raw.toString()).toContain("In-Reply-To:"); expect(sent!.raw.toString()).not.toMatch(/^Bcc:/imu)
    const checked = await service.execute(service.context("ui"), "operation.get", { operationId: receipt.operationId }); expect(checked.sentCopyState).toBe("saved")
    expect(vi.mocked(r.session.append).mock.calls.every(call => call[0] !== "Sent")).toBe(true)
    await service.dispose(); service = new MailService(ports)
    expect(await service.execute(service.context("ui"), "operation.get", { operationId: receipt.operationId })).toMatchObject({ state: "accepted", sentCopyState: "saved" } satisfies Partial<SendReceipt>)
    expect(r.smtp.submit).toHaveBeenCalledTimes(1); expect(cloud).not.toHaveBeenCalled()
    expect((await r.storage.exportAll({ includeSecrets: true })).namespaces).toEqual([])
    for (const action of ["app.mail.message.send", "app.mail.draft.create"]) expect(await createMailCapabilityDispatcher({ service, permissionGuard: ports.permissionGuard, auditSink: ports.auditSink }).dispatch(action, { formatVersion: 3, toIds: ["internal"], body: "internal" }, {})).toMatchObject({ ok: false, code: "INVALID_INPUT" })
  } finally { await service.dispose(); await r.close() }
})
it("rejects a different message's image before downloading any bytes", async () => {
  const r = await syncRig(), ports = deps(r), service = new MailService(ports)
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); vi.mocked(r.session.fetchBodyStructure).mockResolvedValue({ type: "image/png", part: "1", id: "<owned>", size: 8 })
    await r.sync.runOnce(r.ctx, r.account.id)
    const page = await service.execute(service.context("ui"), "message.list", { accountId: r.account.id, limit: 50 })
    const second = await service.execute(service.context("ui"), "message.get", { messageId: page.items[1].id }), asset = second.attachments[0]
    vi.mocked(r.session.fetchPart).mockClear()
    await expect(service.imageGrant(page.items[0].id, asset.id)).rejects.toMatchObject({ code: "UNAVAILABLE" })
    expect(r.session.fetchPart).not.toHaveBeenCalled()
  } finally { await service.dispose(); await r.sync.dispose(); await r.close() }
})
it("closes existing native notifications when identity changes", async () => {
  const r = await createMailTestRig(), ports = deps(r), service = new MailService(ports)
  try { await service.beforeIdentityChange(); expect(ports.notificationDispose).toHaveBeenCalledTimes(1) }
  finally { await service.dispose(); await r.close() }
})
it("invalidates an in-flight image read when its account is paused", async () => {
  const r = await syncRig(), ports = deps(r), service = new MailService(ports)
  const png = Buffer.from("89504e470d0a1a0a", "hex")
  let finish!: (bytes: Buffer) => void
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const page = await service.execute(service.context("ui"), "message.list", { accountId: r.account.id, limit: 50 }), messageId = page.items[0].id
    const asset = await r.assets.put(r.ctx, Readable.from([png]), { accountId: r.account.id, messageId, mime: "image/png", name: "image.png", cache: true })
    const { token } = await service.imageGrant(messageId, asset.id)
    const reading = vi.spyOn(ports.files, "read").mockImplementationOnce(() => new Promise<Buffer>(resolve => { finish = resolve }))
    const result = service.imageRead(messageId, token).then(() => "returned", () => "cancelled")
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1))
    await service.execute(service.context("ui"), "account.pause", { accountId: r.account.id }); finish(png)
    expect(await result).toBe("cancelled")
  } finally { finish?.(png); await service.dispose(); await r.sync.dispose(); await r.close() }
})
it("releases expired preview pins while the desktop stays running", async () => {
  const r = await createMailTestRig(), account = await r.accounts.configure(r.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "test-only" }), ports = deps(r), service = new MailService(ports)
  try {
    const draft = await service.execute(service.context("ui"), "draft.create", { accountId: account.id, to: [{ address: "to@example.com" }], cc: [], bcc: [], subject: "test", html: "<p>test</p>", text: "test", assetIds: [], inlineImages: [] })
    const preview = await service.execute(service.context("ui"), "send.preview", { draftId: draft.id, expectedRevision: draft.revision })
    vi.useFakeTimers(); const interval = vi.spyOn(globalThis, "setInterval")
    service.startBackground()
    await vi.waitFor(() => expect(interval).toHaveBeenCalledWith(expect.any(Function), 60_000))
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    await vi.waitFor(async () => expect((await r.repo.get(r.ctx, "previews", preview.previewId)).data.expired).toBe(true))
    const stored = await r.repo.get(r.ctx, "previews", preview.previewId)
    expect(stored.data.pinnedAssetIds).toEqual([])
  } finally { await service.dispose(); vi.restoreAllMocks(); await r.close() }
})
