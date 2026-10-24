import { Readable } from "node:stream"
import { readFile, realpath, writeFile } from "node:fs/promises"
import { expect, it, vi } from "vitest"
import { MailContent } from "../mime"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import { syncRig } from "./sync-fixtures"
import { MailAssets, type StoredMailAsset } from "../assets"

vi.mock("../../../../config", async importOriginal => ({ ...await importOriginal<typeof import("../../../../config")>(), MAIL_CACHE_BYTES: 16 }))

async function fixture() {
  const r = await syncRig()
  vi.mocked(r.session.searchUids).mockResolvedValue([1, 2, 3])
  await r.sync.runOnce(r.ctx, r.account.id)
  vi.mocked(r.session.fetchBodyStructure).mockResolvedValue({ type: "multipart/mixed", childNodes: [{ type: "text/plain", part: "1" }, { type: "application/octet-stream", part: "2", size: 8, disposition: "attachment", dispositionParameters: { filename: "test.bin" } }] })
  vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([Buffer.from("12345678")]))
  const files = new ManagedAssetStore(`${r.root}/assets`), diagnostic = vi.fn()
  const assets = new MailAssets(r.repo, files, r.access, diagnostic)
  const content = new MailContent(r.repo, r.accounts, assets, r.access)
  const messages = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id, limit: 100 })).items
  const cacheBytes = async () => (await r.repo.page<StoredMailAsset>(r.ctx, "assets", { accountId: r.account.id, limit: 100 })).items
    .filter(row => row.data.cache && row.data.pins === 0 && row.data.asset.state === "ready").reduce((sum, row) => sum + row.data.asset.size, 0)
  const exportMessage = async (action: "attachment.download_file" | "message.extract_to_file", index: number) => {
    const messageId = messages[index].id, outputPath = `${r.root}/out-${index}.bin`
    if (action === "attachment.download_file") {
      const list = await content.executeAttachment(r.ctx, "attachment.list", { messageId, limit: 50 })
      return content.executeAttachment(r.ctx, action, { assetId: list.items[0].id, outputPath })
    }
    return content.executeAttachment(r.ctx, action, { messageId, outputPath })
  }
  return { ...r, assets, files, diagnostic, content, cacheBytes, exportMessage, messages }
}

it.each(["attachment.download_file", "message.extract_to_file"] as const)("keeps %s exports complete while trimming the shared cache budget", async action => {
  const r = await fixture()
  try {
    for (let index = 0; index < 3; index++) {
      const result = await r.exportMessage(action, index)
      expect(await readFile(result.outputPath, "utf8")).toBe("12345678")
      expect(await r.cacheBytes()).toBeLessThanOrEqual(16)
    }
    expect(await r.cacheBytes()).toBe(16)
  } finally { await r.sync.dispose(); await r.close() }
})

it.each(["attachment.download_file", "message.extract_to_file"] as const)("still enforces the budget when %s cannot overwrite an existing output", async action => {
  const r = await fixture()
  try {
    await r.exportMessage(action, 0); await r.exportMessage(action, 1)
    const path = `${r.root}/out-2.bin`
    await writeFile(path, "keep existing")
    await expect(r.exportMessage(action, 2)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" })
    expect(await readFile(path, "utf8")).toBe("keep existing")
    expect(await r.cacheBytes()).toBeLessThanOrEqual(16)
  } finally { await r.sync.dispose(); await r.close() }
})

it("protects the active export from concurrent eviction and releases its lease afterwards", async () => {
  const r = await fixture()
  try {
    const open = r.assets.open.bind(r.assets)
    vi.spyOn(r.assets, "open").mockImplementation(async (ctx, id) => {
      await r.assets.clearCache(ctx)
      return open(ctx, id)
    })
    const result = await r.exportMessage("message.extract_to_file", 0)
    expect(await readFile(result.outputPath, "utf8")).toBe("12345678")
    expect(await r.assets.clearCache(r.ctx)).toMatchObject({ removed: 1, bytes: 8 })
  } finally { await r.sync.dispose(); await r.close() }
})

it.each(["attachment.download_file", "message.extract_to_file"] as const)("preserves both concurrent %s results and enforces the shared budget", async action => {
  const r = await fixture()
  try {
    await r.exportMessage(action, 0)
    let arrivals = 0, release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), trim = r.assets.trim.bind(r.assets)
    vi.spyOn(r.assets, "trim").mockImplementation(async ctx => { if (++arrivals === 2) release(); await gate; return trim(ctx) })
    const results = await Promise.allSettled([r.exportMessage(action, 1), r.exportMessage(action, 2)])
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"])
    for (const index of [1, 2]) expect(await readFile(`${r.root}/out-${index}.bin`, "utf8")).toBe("12345678")
    expect(await r.cacheBytes()).toBeLessThanOrEqual(16)
    expect(r.diagnostic).not.toHaveBeenCalled()
  } finally { await r.sync.dispose(); await r.close() }
})

it.each([false, true])("records cleanup IO failure without replacing the export outcome (existing=%s)", async existing => {
  const r = await fixture()
  try {
    await r.exportMessage("message.extract_to_file", 0); await r.exportMessage("message.extract_to_file", 1)
    const output = `${r.root}/out-2.bin`, error = new Error("fixture cleanup IO failure")
    if (existing) await writeFile(output, "keep existing")
    vi.spyOn(r.files, "remove").mockRejectedValueOnce(error)
    if (existing) await expect(r.exportMessage("message.extract_to_file", 2)).rejects.toMatchObject({ code: "OUTPUT_EXISTS" })
    else {
      const result = await r.exportMessage("message.extract_to_file", 2)
      expect(result).toMatchObject({ outputPath: await realpath(output), size: 8 })
    }
    expect(await readFile(output, "utf8")).toBe(existing ? "keep existing" : "12345678")
    expect(r.diagnostic).toHaveBeenCalledExactlyOnceWith("MAIL_CACHE_CLEANUP_FAILED", "mail")
    vi.mocked(r.files.remove).mockRejectedValueOnce(error)
    await expect(r.assets.clearCache(r.ctx)).rejects.toThrow("fixture cleanup IO failure")
    await expect(r.assets.clearCache(r.ctx)).resolves.toHaveProperty("removed")
  } finally { await r.sync.dispose(); await r.close() }
})
