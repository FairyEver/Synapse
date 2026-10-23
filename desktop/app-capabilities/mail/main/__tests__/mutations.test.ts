import { randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailMutations } from "../mutations"
import { MailError } from "../../shared/types"
import { resolveMessage, type StoredFolder } from "../sync"
async function setup(provider: "aliyun" | "custom" = "aliyun") {
  const r = await syncRig(provider)
  vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
  const message = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items[0]
  const targetId = `mf_${randomUUID()}`
  await r.repo.save<StoredFolder>(r.ctx, "folders", targetId, r.account.id, { folder: { id: targetId, accountId: r.account.id, path: "Trash", name: "Trash", role: "trash", uidValidity: "1", serverCount: 0, metadataComplete: true, selectable: true }, delimiter: "/", flags: [] }, 0)
  vi.mocked(r.session.searchUids).mockImplementation(async (_path, query) => query.uid ? [] : [1])
  vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({ ...remoteHeader(uid), messageId: "<1@example.com>" })))
  vi.mocked(r.session.copy).mockResolvedValue({ uidValidity: "1", uids: new Map([[1, 99]]) })
  vi.mocked(r.session.move).mockResolvedValue({ uidValidity: "1", uids: new Map([[1, 99]]) })
  const mutations = new MailMutations(r.repo, r.accounts, r.changed)
  return { ...r, message, targetId, mutations, input: { accountId: r.account.id, messageIds: [message.id], targetFolderId: targetId, clientRequestId: randomUUID() } }
}
it("uses Alibaba COPY as a move, verifies the mapping, preserves em ID and never adds Deleted", async () => {
  const r = await setup()
  try {
    const result = await r.mutations.execute(r.ctx, "message.move", r.input)
    expect(result.items[0]).toMatchObject({ id: r.message.id, status: "succeeded" })
    expect(r.session.copy).toHaveBeenCalledTimes(1); expect(r.session.move).not.toHaveBeenCalled(); expect(r.session.storeFlags).not.toHaveBeenCalled(); expect(r.session.uidExpunge).not.toHaveBeenCalled()
    const message = await r.repo.get(r.ctx, "messages", r.message.id)
    expect(message.data.summary).toMatchObject({ id: r.message.id, locator: { folderId: r.targetId, uid: 99 } })
    await r.mutations.execute(r.ctx, "message.move", r.input); expect(r.session.copy).toHaveBeenCalledTimes(1)
    await expect(r.mutations.execute(r.ctx, "message.move", { ...r.input, targetFolderId: (r.message.data.summary as { locator: { folderId: string } }).locator.folderId })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
  } finally { await r.sync.dispose(); await r.close() }
})
it("uses native MOVE for custom providers and refuses unsafe permanent expunge before STORE", async () => {
  const r = await setup("custom")
  try {
    expect((await r.mutations.execute(r.ctx, "message.move", r.input)).items[0].status).toBe("succeeded")
    expect(r.session.move).toHaveBeenCalledTimes(1); expect(r.session.copy).not.toHaveBeenCalled()
    Object.defineProperty(r.session, "capabilities", { value: new Set(["MOVE"]) })
    const result = await r.mutations.execute(r.ctx, "message.delete", { accountId: r.account.id, messageIds: [r.message.id], permanent: true, clientRequestId: randomUUID() })
    expect(result.items[0]).toMatchObject({ status: "failed", code: "UNSUPPORTED" }); expect(r.session.storeFlags).not.toHaveBeenCalled()
  } finally { await r.sync.dispose(); await r.close() }
})
it("persists unknown moves and does not replay after a timeout or missing UID mapping", async () => {
  const r = await setup()
  try {
    vi.mocked(r.session.copy).mockRejectedValue(new MailError("NETWORK_TIMEOUT", "timeout"))
    expect((await r.mutations.execute(r.ctx, "message.move", r.input)).items[0].status).toBe("unknown")
    await r.mutations.execute(r.ctx, "message.move", r.input); expect(r.session.copy).toHaveBeenCalledTimes(1)
    vi.mocked(r.session.copy).mockResolvedValue(null)
    expect((await r.mutations.execute(r.ctx, "message.move", { ...r.input, clientRequestId: randomUUID() })).items[0].status).toBe("unknown")
    expect(r.session.storeFlags).not.toHaveBeenCalled()
  } finally { await r.sync.dispose(); await r.close() }
})
it("rejects stale UID generations, cross-account targets and oversized batches", async () => {
  const r = await setup()
  try {
    vi.mocked(r.session.select).mockResolvedValue({ uidValidity: "2", count: 1, uidNext: 2 })
    expect((await r.mutations.execute(r.ctx, "message.move", r.input)).items[0]).toMatchObject({ status: "failed", code: "STALE_TARGET" })
    expect(r.session.copy).not.toHaveBeenCalled()
    await expect(resolveMessage(r.repo, r.ctx, r.message.id)).rejects.toMatchObject({ code: "STALE_TARGET" })
    await expect(r.mutations.execute(r.ctx, "message.move", { ...r.input, accountId: `ma_${randomUUID()}`, clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "UNAVAILABLE" })
    await expect(r.mutations.execute(r.ctx, "message.move", { ...r.input, messageIds: Array.from({ length: 101 }, () => `em_${randomUUID()}`) })).rejects.toThrow()
  } finally { await r.sync.dispose(); await r.close() }
})
it("protects system and nonempty folders and retains folder IDs on rename", async () => {
  const r = await setup()
  try {
    const folders = await r.mutations.listFolders(r.ctx, { accountId: r.account.id, limit: 50 })
    const inbox = folders.items.find(f => f.role === "inbox")!
    await expect(r.mutations.execute(r.ctx, "folder.delete", { accountId: r.account.id, folderId: inbox.id })).rejects.toMatchObject({ code: "SYSTEM_FOLDER" })
    const custom = `mf_${randomUUID()}`
    await r.repo.save<StoredFolder>(r.ctx, "folders", custom, r.account.id, { folder: { ...inbox, id: custom, path: "Custom", name: "Custom", role: "none" }, delimiter: "/", flags: [] }, 0)
    await expect(r.mutations.execute(r.ctx, "folder.delete", { accountId: r.account.id, folderId: custom })).rejects.toMatchObject({ code: "FOLDER_NOT_EMPTY" })
    const renamed = await r.mutations.execute(r.ctx, "folder.rename", { accountId: r.account.id, folderId: custom, name: "Renamed" })
    expect(renamed).toMatchObject({ id: custom, path: "Renamed" }); expect(r.session.renameFolder).toHaveBeenCalledWith("Custom", "Renamed", r.ctx.signal)
  } finally { await r.sync.dispose(); await r.close() }
})
it("verifies Seen/Flagged writes and updates role mappings with the account revision", async () => {
  const r = await setup()
  try {
    vi.mocked(r.session.fetchFlags).mockResolvedValue([{ uid: 1, flags: ["\\Seen", "\\Flagged"] }])
    const result = await r.mutations.execute(r.ctx, "message.update", { accountId: r.account.id, messageIds: [r.message.id], patch: { read: true, star: true } })
    expect(result.items[0].status).toBe("succeeded")
    expect(r.session.fetchFlags).toHaveBeenCalled()
    const custom = `mf_${randomUUID()}`
    const target = await r.repo.get<StoredFolder>(r.ctx, "folders", r.targetId)
    await r.repo.save<StoredFolder>(r.ctx, "folders", custom, r.account.id, { ...target.data, folder: { ...target.data.folder, id: custom, path: "Other", role: "none" } }, 0)
    await r.mutations.execute(r.ctx, "folder.update", { accountId: r.account.id, folderId: custom, role: "trash", expectedAccountRevision: r.account.revision })
    expect((await r.repo.get<StoredFolder>(r.ctx, "folders", r.targetId)).data.folder.role).toBe("none")
    expect((await r.accounts.get(r.ctx, r.account.id)).revision).toBe(r.account.revision + 1)
    await expect(r.mutations.execute(r.ctx, "folder.update", { accountId: r.account.id, folderId: custom, role: "sent", expectedAccountRevision: r.account.revision })).rejects.toMatchObject({ code: "VERSION_CONFLICT" })
  } finally { await r.sync.dispose(); await r.close() }
})
it("recovers local folder updates after remote success without replaying the rename", async () => {
  const r = await setup()
  try {
    const custom = `mf_${randomUUID()}`, target = await r.repo.get<StoredFolder>(r.ctx, "folders", r.targetId)
    await r.repo.save<StoredFolder>(r.ctx, "folders", custom, r.account.id, { ...target.data, folder: { ...target.data.folder, id: custom, path: "Before", name: "Before", role: "none" } }, 0)
    const commit = r.storage.commitBatch!.bind(r.storage)
    let fail = true
    vi.spyOn(r.storage, "commitBatch").mockImplementation(async request => {
      if (fail && request.operations.some(op => op.namespace === "app.mail.folders" && op.kind === "patch" && JSON.stringify(op.patch).includes("After"))) { fail = false; throw new Error("storage interrupted") }
      return commit(request)
    })
    await expect(r.mutations.execute(r.ctx, "folder.rename", { accountId: r.account.id, folderId: custom, name: "After" })).rejects.toThrow("storage interrupted")
    await r.mutations.recover(r.ctx)
    expect((await r.repo.get<StoredFolder>(r.ctx, "folders", custom)).data.folder.path).toBe("After")
    expect(r.session.renameFolder).toHaveBeenCalledTimes(1)
  } finally { await r.sync.dispose(); await r.close() }
})
