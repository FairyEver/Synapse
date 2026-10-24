import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { setImmediate as nextTurn } from "node:timers/promises"
import { expect, it, vi } from "vitest"
import type { MailAccess } from "../assets"
import { syncRig } from "./sync-fixtures"

it.each(["lease", "pin"] as const)("never deletes a successfully acquired %s while cache deletion waits for permission", async protection => {
  const r = await syncRig()
  try {
    const asset = await r.assets.put(r.ctx, Readable.from(["contents"]), { accountId: r.account.id, messageId: `em_${randomUUID()}`, name: "a.bin", mime: "application/octet-stream", cache: true })
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
    vi.mocked<MailAccess>(r.access).mockImplementation(async (_ctx, action, id) => { if (action === "fs.write" && id === asset.id) { entered(); await gate } })
    const clearing = r.assets.clearCache(r.ctx)
    await started
    let protectedNow = false
    const protecting = (protection === "lease" ? r.assets.hold(r.ctx, "editing", r.account.id, [asset.id]) : r.assets.pin(r.ctx, asset.id, 1))
      .then(() => { protectedNow = true }, () => undefined)
    await nextTurn()
    release()
    const result = await clearing
    await protecting
    if (protectedNow) {
      expect(result.removed).toBe(0)
      expect((await r.assets.read(r.ctx, asset.id)).toString()).toBe("contents")
    } else {
      expect(result.removed).toBe(1)
      expect((await r.assets.info(r.ctx, asset.id)).state).toBe("remote")
    }
  } finally { r.assets.release("editing"); await r.sync.dispose(); await r.close() }
})

it.each(["lease", "pin"] as const)("honors an existing %s before cache clearing starts", async protection => {
  const r = await syncRig()
  try {
    const asset = await r.assets.put(r.ctx, Readable.from(["contents"]), { accountId: r.account.id, name: "a.bin", mime: "application/octet-stream", cache: true })
    if (protection === "lease") await r.assets.hold(r.ctx, "editing", r.account.id, [asset.id])
    else await r.assets.pin(r.ctx, asset.id, 1)
    expect(await r.assets.clearCache(r.ctx)).toMatchObject({ removed: 0 })
    expect((await r.assets.read(r.ctx, asset.id)).toString()).toBe("contents")
    if (protection === "lease") r.assets.release("editing")
    else await r.assets.pin(r.ctx, asset.id, -1)
    expect(await r.assets.clearCache(r.ctx)).toMatchObject({ removed: 1 })
  } finally { r.assets.release("editing"); await r.sync.dispose(); await r.close() }
})

it("does not grant an export lease while explicit asset deletion is in progress", async () => {
  const r = await syncRig()
  try {
    const asset = await r.assets.put(r.ctx, Readable.from(["contents"]), { accountId: r.account.id, name: "a.bin", mime: "application/octet-stream" })
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
    vi.mocked<MailAccess>(r.access).mockImplementation(async (_ctx, action, id) => { if (action === "fs.write" && id === asset.id) { entered(); await gate } })
    const removing = r.assets.remove(r.ctx, asset.id)
    await started
    let accepted = false
    const holding = r.assets.hold(r.ctx, "export", r.account.id, [asset.id]).then(() => { accepted = true }, () => undefined)
    await nextTurn(); release(); await removing; await holding
    expect(accepted).toBe(false)
  } finally { r.assets.release("export"); await r.sync.dispose(); await r.close() }
})
