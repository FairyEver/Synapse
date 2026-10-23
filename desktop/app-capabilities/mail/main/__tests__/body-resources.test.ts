import { Readable } from "node:stream"
import { expect, it, vi } from "vitest"
import { MailBodyResources, fetchRemoteImage } from "../body-resources"
import { syncRig } from "./sync-fixtures"
it("does no network IO without explicit image consent and rejects private redirects", async () => {
  const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }])
  await expect(fetchRemoteImage("http://localhost/image.png", { signal: new AbortController().signal, allowed: false, authorize: vi.fn(), lookup })).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  expect(lookup).not.toHaveBeenCalled()
  await expect(fetchRemoteImage("https://images.example/test", { signal: new AbortController().signal, allowed: true, authorize: vi.fn(), lookup })).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
  await expect(fetchRemoteImage("file:///etc/passwd", { signal: new AbortController().signal, allowed: true, authorize: vi.fn(), lookup })).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
})
it("binds image tokens to owner, generation and exact message, rejecting ambiguous CIDs", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); await r.sync.runOnce(r.ctx, r.account.id)
    const rows = await r.repo.page(r.ctx, "messages", { accountId: r.account.id })
    const image = await r.assets.put(r.ctx, Readable.from([Buffer.from("89504e470d0a1a0a", "hex")]), { accountId: r.account.id, messageId: rows.items[0].id, mime: "image/png", name: "image.png", cid: "same" })
    const resources = new MailBodyResources(r.repo, r.assets, r.access)
    const token = await resources.issue(r.ctx, rows.items[0].id, image.id)
    expect((await resources.read(r.ctx, rows.items[0].id, token)).mime).toBe("image/png")
    await expect(resources.read(r.ctx, rows.items[1].id, token)).rejects.toMatchObject({ code: "UNAVAILABLE" })
    await r.assets.put(r.ctx, Readable.from([Buffer.from("89504e470d0a1a0a", "hex")]), { accountId: r.account.id, messageId: rows.items[0].id, mime: "image/png", name: "other.png", cid: "same" })
    await expect(resources.issue(r.ctx, rows.items[0].id, image.id)).rejects.toMatchObject({ code: "AMBIGUOUS_CID" })
    r.setOwner("other"); await expect(resources.read(r.context.current("ui"), rows.items[0].id, token)).rejects.toMatchObject({ code: "UNAVAILABLE" })
  } finally { await r.sync.dispose(); await r.close() }
})
it("pins the resolved address and validates redirected private URLs before a second connection", async () => {
  const { default: https } = await import("node:https")
  const { EventEmitter } = await import("node:events")
  const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }])
  const request = vi.spyOn(https, "request").mockImplementation(((options: unknown, callback: (message: unknown) => void) => {
    const req = Object.assign(new EventEmitter(), { end() {
      queueMicrotask(() => callback(Object.assign(Readable.from([]), { statusCode: 302, headers: { location: "http://127.0.0.1/private" } })))
    }, destroy() { return req } })
    expect(options).toMatchObject({ hostname: "93.184.216.34", servername: "images.example", headers: { Host: "images.example" }, agent: false })
    return req
  }) as typeof https.request)
  try {
    await expect(fetchRemoteImage("https://images.example/a", { allowed: true, signal: new AbortController().signal, authorize: vi.fn(), lookup })).rejects.toMatchObject({ code: "IMAGE_BLOCKED" })
    expect(lookup).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1)
  } finally { request.mockRestore() }
})
