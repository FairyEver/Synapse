import { Readable } from "node:stream"
import { readFile, writeFile } from "node:fs/promises"
import { expect, it, vi } from "vitest"
import { MailContent } from "../mime"
import { syncRig } from "./sync-fixtures"
import type { StoredMailAsset } from "../assets"

vi.mock("../../../../config", async importOriginal => ({ ...await importOriginal<typeof import("../../../../config")>(), MAIL_CACHE_BYTES: 16 }))

async function fixture() {
  const r = await syncRig()
  vi.mocked(r.session.searchUids).mockResolvedValue([1, 2, 3])
  await r.sync.runOnce(r.ctx, r.account.id)
  vi.mocked(r.session.fetchBodyStructure).mockResolvedValue({ type: "multipart/mixed", childNodes: [{ type: "text/plain", part: "1" }, { type: "application/octet-stream", part: "2", size: 8, disposition: "attachment", dispositionParameters: { filename: "test.bin" } }] })
  vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([Buffer.from("12345678")]))
  const content = new MailContent(r.repo, r.accounts, r.assets, r.access)
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
  return { ...r, content, cacheBytes, exportMessage, messages }
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
