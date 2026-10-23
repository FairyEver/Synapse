import { afterEach, describe, expect, it } from "vitest"
import { DataRepositoryImpl } from "../repository"
import { mailSchemas } from "../schemas/mail"
import { DatabaseSync } from "node:sqlite"
import { SqliteNamespace } from "../backends/sqlite"

const dbs: DatabaseSync[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close() })
function createMemoryNamespace(name: string) {
  const schema = mailSchemas.find(s => s.name === name)!
  const database = new DatabaseSync(":memory:"); dbs.push(database)
  return new SqliteNamespace({ name, schemaVersion: 1, backend: "sqlite", database, sqlite: schema.sqlite, validate: schema.validate })
}

describe("mail local-only namespaces", () => {
  it("declares 11 namespaces that cannot enter backups, even with secrets enabled", async () => {
    const repo = new DataRepositoryImpl()
    for (const schema of mailSchemas.filter(s => s.backend === "sqlite")) repo.register(schema, createMemoryNamespace(schema.name))
    expect(mailSchemas).toHaveLength(11)
    expect(mailSchemas.every(s => s.transferPolicy === "local-only")).toBe(true)
    expect((await repo.exportAll({ includeSecrets: true })).namespaces).toEqual([])
  })
  it("rejects an imported local-only namespace before any write", async () => {
    const repo = new DataRepositoryImpl()
    const schema = mailSchemas[0]
    const namespace = createMemoryNamespace(schema.name)
    repo.register(schema, namespace)
    await expect(repo.importAll({ format: "synapse-backup-v1", exportedAt: new Date().toISOString(), namespaces: [{ name: schema.name, schemaVersion: 1, encrypted: false, data: { items: [{ id: "fake" }] } }] })).rejects.toThrow("local-only")
    expect(await namespace.list()).toEqual([])
  })
})
