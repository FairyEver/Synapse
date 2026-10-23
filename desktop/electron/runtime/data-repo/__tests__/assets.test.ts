import { mkdtemp, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import { ManagedAssetStore } from "../assets"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "synapse-mail-assets-")); roots.push(root)
  return { root, store: new ManagedAssetStore(root) }
}
describe("managed asset bytes", () => {
  it("round-trips bytes/hash and refuses traversal or symlink reads", async () => {
    const { root, store } = await setup()
    const item = await store.put(Readable.from([Buffer.from("hello")]), 10)
    expect(item.size).toBe(5)
    expect(item.sha256).toHaveLength(64)
    expect((await store.read(item.key, 10)).toString()).toBe("hello")
    await expect(store.put(Readable.from(["new"]), 10, undefined, item.key)).rejects.toThrow()
    expect((await store.read(item.key, 10)).toString()).toBe("hello")
    await expect(store.read("../outside", 10)).rejects.toThrow()
    const link = "9e9d3be0-0ede-451a-a20c-9fd4e243c4d7"
    await symlink(path.join(root, item.key), path.join(root, link))
    await expect(store.read(link, 10)).rejects.toThrow()
  })
  it("cleans partial writes on overflow or a broken input stream", async () => {
    const { root, store } = await setup()
    const original = await store.put(Readable.from(["saved"]), 10)
    await expect(store.put(Readable.from(["too large"]), 2)).rejects.toThrow()
    async function* broken() { yield "partial"; throw new Error("broken") }
    await expect(store.put(Readable.from(broken()), 100)).rejects.toThrow("broken")
    expect(await readdir(root)).toEqual([original.key])
    expect((await store.read(original.key, 10)).toString()).toBe("saved")
  })
})
