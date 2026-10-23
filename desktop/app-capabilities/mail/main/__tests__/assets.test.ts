import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DataRepositoryImpl } from "../../../../electron/runtime/data-repo/repository"
import { SqliteNamespace } from "../../../../electron/runtime/data-repo/backends/sqlite"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import { mailSchemas } from "../../../../electron/runtime/data-repo/schemas/mail"
import { MailRepository } from "../repository"
import { MailAssets } from "../assets"
import { MAIL_CACHE_BYTES } from "../../shared/limits"
import type { MailContext } from "../../shared/types"

describe("owned email asset cache", () => {
  it("evicts only unpinned re-fetchable bytes at the exact budget boundary", async () => {
    const database = new DatabaseSync(":memory:")
    const root = await mkdtemp(path.join(tmpdir(), "synapse-owned-assets-"))
    try {
      const storage = new DataRepositoryImpl()
      for (const schema of mailSchemas.filter(s => s.backend === "sqlite")) storage.register(schema, new SqliteNamespace({ name: schema.name, schemaVersion: 1, backend: "sqlite", database, sqlite: schema.sqlite, validate: schema.validate }))
      const repo = new MailRepository(storage, () => undefined)
      const ctx: MailContext = { ownerId: "owner", actor: "ui", generation: 1, signal: new AbortController().signal }
      const accountId = "ma_e69940c0-4db1-4a0a-8f87-9027d116e194"
      await repo.save(ctx, "accounts", accountId, accountId, { name: "account" }, 0)
      const access = vi.fn(async () => undefined)
      const assets = new MailAssets(repo, new ManagedAssetStore(root), access)
      const a = await assets.put(ctx, Readable.from(["1234"]), { accountId, name: "a", mime: "text/plain", cache: true })
      const b = await assets.put(ctx, Readable.from(["5678"]), { accountId, name: "b", mime: "text/plain", cache: true, pinned: true })
      expect(MAIL_CACHE_BYTES).toBe(1024 ** 3)
      expect(await assets.clearCache(ctx, accountId, 8)).toEqual({ removed: 0, bytes: 0 })
      expect(await assets.clearCache(ctx, accountId, 4)).toEqual({ removed: 0, bytes: 0 })
      expect(await assets.clearCache(ctx, accountId, 3)).toEqual({ removed: 1, bytes: 4 })
      await expect(assets.info(ctx, a.id)).rejects.toThrow()
      expect((await assets.read(ctx, b.id)).toString()).toBe("5678")
      await expect(assets.read({ ...ctx, ownerId: "other" }, b.id)).rejects.toThrow()
      await expect(assets.remove(ctx, b.id)).rejects.toThrow("使用")
      expect(access).toHaveBeenCalled()
    } finally { database.close(); await rm(root, { recursive: true, force: true }) }
  })
})
