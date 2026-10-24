import { Readable } from "node:stream"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { expect, it, vi } from "vitest"
import { parseMailStream, MailContent } from "../mime"
import { syncRig } from "./sync-fixtures"
it("preserves named group members and standalone addresses in every recipient header", async () => {
  const raw = [
    "From: Sender <sender@example.com>",
    "To: Team: Alice <alice@example.com>, Bob <bob@example.com>; , Solo <solo@example.com>",
    "Cc: Reviewers: Carol <carol@example.com>;",
    "Bcc: Hidden: Dana <dana@example.com>; , undisclosed-recipients:;",
    "Subject: Group recipients", "", "Text",
  ].join("\r\n")
  const parsed = await parseMailStream(Readable.from([raw]), { signal: new AbortController().signal })
  expect(parsed.to).toEqual([{ address: "alice@example.com", name: "Alice" }, { address: "bob@example.com", name: "Bob" }, { address: "solo@example.com", name: "Solo" }])
  expect(parsed.cc).toEqual([{ address: "carol@example.com", name: "Carol" }])
  expect(parsed.bcc).toEqual([{ address: "dana@example.com", name: "Dana" }])
})
it("streams nested MIME, encoded words and GB18030 without conflating repeated Message-IDs or CIDs", async () => {
  const bytes = await readFile(new URL("./fixtures/nested.eml", import.meta.url))
  const attachments: Buffer[] = []
  const parse = () => parseMailStream(Readable.from([bytes]), { signal: new AbortController().signal, attachment: async (_metadata, stream) => {
    const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk); attachments.push(Buffer.concat(chunks))
  } })
  const a = await parse(), b = await parse()
  expect(a.subject).toBe("中文测试"); expect(a.text).toContain("中文")
  expect(a.messageId).toBe(b.messageId); expect(a.attachments).toHaveLength(2)
  expect(a.attachments[0].sha256).toBe(createHash("sha256").update(attachments[0]).digest("hex"))
  expect(a.ambiguousCids).toEqual(["same"])
  const missing = await parseMailStream(Readable.from(["From: sender@example.com\r\n\r\nText"]), { signal: new AbortController().signal })
  expect(missing.subject).toBe(""); expect(missing.date).toBeNull()
  await expect(parseMailStream(Readable.from([bytes]), { signal: new AbortController().signal, maxBytes: 10 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" })
})
it("fetches only text MIME parts, returns bounded chunks and preserves downloaded attachment bytes", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const message = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items[0]
    vi.mocked(r.session.fetchBodyStructure).mockResolvedValue({ type: "multipart/mixed", childNodes: [{ type: "text/html", part: "1" }, { type: "application/octet-stream", part: "2", size: 4, disposition: "attachment", dispositionParameters: { filename: "test.bin" } }] })
    vi.mocked(r.session.fetchPart).mockImplementation(async (_path, _uid, part) => Readable.from([part === "2" ? Buffer.from([0, 1, 254, 255]) : Buffer.from("<p>" + "中文".repeat(20_000) + "</p>")]))
    const content = new MailContent(r.repo, r.accounts, r.assets, r.access)
    const first = await content.readChunk(r.ctx, { messageId: message.id })
    expect(Buffer.byteLength(first.html) + Buffer.byteLength(first.text)).toBeLessThanOrEqual(65_536)
    expect(first.complete).toBe(false); expect(first.nextCursor).toBeTruthy()
    expect(vi.mocked(r.session.fetchPart).mock.calls.every(c => c[2] !== "2" && c[2] !== undefined)).toBe(true)
    const list = await content.executeAttachment(r.ctx, "attachment.list", { messageId: message.id, limit: 50 })
    expect(list.items).toHaveLength(1)
    const outputPath = `${r.root}/out.bin`
    const result = await content.executeAttachment(r.ctx, "attachment.download_file", { assetId: list.items[0].id, outputPath })
    expect(await readFile(outputPath)).toEqual(Buffer.from([0, 1, 254, 255])); expect(result.size).toBe(4)
    await expect(content.executeAttachment(r.ctx, "attachment.download_file", { assetId: list.items[0].id, outputPath })).rejects.toMatchObject({ code: "OUTPUT_EXISTS" })
  } finally { await r.sync.dispose(); await r.close() }
})
it("contains corrupt source streams without leaking raw error contents", async () => {
  const source = Readable.from((async function* () { yield "From: sender@example.com\r\n\r\n"; throw new Error("secret protocol failure") })())
  await expect(parseMailStream(source, { signal: new AbortController().signal })).rejects.toMatchObject({ code: "MIME_INVALID", message: "邮件格式无法解析" })
})

it("rejects a cached attachment export after UIDVALIDITY invalidates its source", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const message = (await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id })).items[0]
    const content = new MailContent(r.repo, r.accounts, r.assets, r.access)
    const asset = await r.assets.put(r.ctx, Readable.from([Buffer.from("saved attachment")]), { accountId: r.account.id, messageId: message.id, attachmentId: "2", name: "a.txt", mime: "text/plain", cache: true })
    await content.executeAttachment(r.ctx, "attachment.download_file", { assetId: asset.id, outputPath: `${r.root}/before.txt` })
    const { assertRemoteGeneration } = await import("../sync")
    await expect(assertRemoteGeneration(r.repo, r.ctx, message.data.summary.locator.folderId, "1", "2")).rejects.toMatchObject({ code: "STALE_TARGET" })
    await expect(content.executeAttachment(r.ctx, "attachment.download_file", { assetId: asset.id, outputPath: `${r.root}/after.txt` })).rejects.toMatchObject({ code: "STALE_TARGET" })
    expect((await r.assets.read(r.ctx, asset.id)).toString()).toBe("saved attachment")
  } finally { await r.sync.dispose(); await r.close() }
})

it("copies shared PNG bytes into account-owned mail assets independently of the source", async () => {
  const r = await syncRig()
  try {
    const bytes = Buffer.from("shared PNG bytes")
    const resolveShareImage = vi.fn(async () => ({ bytes, fileName: "share.png", mimeType: "image/png" as const }))
    const content = new MailContent(r.repo, r.accounts, r.assets, r.access, undefined, resolveShareImage)
    const shareImageRef = "ca8ce19e-ec42-4d08-90c9-19a887a89805"
    const asset = await content.executeAttachment(r.ctx, "attachment.import_local", { accountId: r.account.id, shareImageRef })
    resolveShareImage.mockRejectedValue(new Error("source deleted"))
    expect(await r.assets.read(r.ctx, asset.id)).toEqual(bytes)
    await expect(content.executeAttachment(r.ctx, "attachment.import_local", { accountId: r.account.id, shareImageRef, filePath: "/tmp/x" })).rejects.toThrow()
    expect(resolveShareImage).toHaveBeenCalledTimes(1)
  } finally { await r.sync.dispose(); await r.close() }
})
