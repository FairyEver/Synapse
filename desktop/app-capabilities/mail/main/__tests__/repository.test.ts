import { afterEach, describe, expect, it } from "vitest"
import { MailRepository } from "../repository"
import { DataRepositoryImpl } from "../../../../electron/runtime/data-repo/repository"
import { mailSchemas } from "../../../../electron/runtime/data-repo/schemas/mail"
import { DatabaseSync } from "node:sqlite"
import { SqliteNamespace } from "../../../../electron/runtime/data-repo/backends/sqlite"
import type { MailContext } from "../../shared/types"

const dbs: DatabaseSync[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close() })
function createMemoryNamespace(name: string) {
  const schema = mailSchemas.find(s => s.name === name)!
  const database = new DatabaseSync(":memory:"); dbs.push(database)
  return new SqliteNamespace({ name, schemaVersion: 1, backend: "sqlite", database, sqlite: schema.sqlite, validate: schema.validate })
}

describe("mail scoped repository", () => {
  it("isolates owner reads and prevents concurrent revision overwrites", async () => {
    const storage = new DataRepositoryImpl()
    for (const schema of mailSchemas.filter(s => s.backend === "sqlite")) storage.register(schema, createMemoryNamespace(schema.name))
    const repo = new MailRepository(storage, () => undefined)
    const ctx: MailContext = { ownerId: "owner", generation: 1, actor: "ui", signal: new AbortController().signal }
    const item = await repo.save(ctx, "accounts", "id", "id", { name: "first" }, 0)
    expect(item.revision).toBe(1)
    await expect(repo.get({ ...ctx, ownerId: "other" }, "accounts", "id")).rejects.toThrow("无法访问")
    const edits = await Promise.allSettled([repo.save(ctx, "accounts", "id", "id", { name: "one" }, 1), repo.save(ctx, "accounts", "id", "id", { name: "two" }, 1)])
    expect(edits.filter(r => r.status === "fulfilled")).toHaveLength(1)
    expect(edits.filter(r => r.status === "rejected")).toHaveLength(1)
    await repo.save(ctx, "messages", "a", "id", { subject: "one" }, 0, "same-date")
    await repo.save(ctx, "messages", "b", "id", { subject: "two" }, 0, "same-date")
    const first = await repo.page(ctx, "messages", { accountId: "id", limit: 1 })
    const second = await repo.page(ctx, "messages", { accountId: "id", limit: 1, cursor: first.nextCursor! })
    expect([first.items[0].id, second.items[0]?.id]).toEqual(["a", "b"])
  })
})
