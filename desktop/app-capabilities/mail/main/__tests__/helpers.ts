import { Readable } from "node:stream"
import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { vi } from "vitest"
import { DataRepositoryImpl } from "../../../../electron/runtime/data-repo/repository"
import { SqliteNamespace } from "../../../../electron/runtime/data-repo/backends/sqlite"
import { EncryptedJsonNamespace } from "../../../../electron/runtime/data-repo/backends/encrypted-json"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import { mailSchemas } from "../../../../electron/runtime/data-repo/schemas/mail"
import { MailContextProvider } from "../context"
import { MailRepository } from "../repository"
import { MailAssets } from "../assets"
import { MailAccounts } from "../accounts"
import type { MailImapSession, MailProtocols } from "../protocol/types"

export async function createMailTestRig() {
  const root = await mkdtemp(path.join(tmpdir(), "synapse-mail-rig-"))
  const database = new DatabaseSync(":memory:")
  const storage = new DataRepositoryImpl()
  for (const schema of mailSchemas) {
    if (schema.backend === "sqlite") storage.register(schema, new SqliteNamespace({ name: schema.name, schemaVersion: 1, backend: "sqlite", database, validate: schema.validate, sqlite: schema.sqlite }))
    else storage.register(schema, new EncryptedJsonNamespace({ name: schema.name, schemaVersion: 1, filePath: path.join(root, "credentials.bin"), safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }, validate: schema.validate }))
  }
  let owner: string | null = "test-owner"
  const context = new MailContextProvider(() => owner)
  const ctx = context.current("ui")
  const repo = new MailRepository(storage, c => context.assertCurrent(c))
  const access = vi.fn(async () => undefined)
  const assets = new MailAssets(repo, new ManagedAssetStore(path.join(root, "assets")), access)
  const session: MailImapSession = {
    capabilities: new Set(["IDLE", "UIDPLUS", "MOVE"]),
    listFolders: vi.fn(async () => []), select: vi.fn(async () => ({ uidValidity: "1", count: 0, uidNext: 1 })),
    fetchHeaders: vi.fn(async () => []), fetchBodyStructure: vi.fn(async () => null), fetchPart: vi.fn(async () => Readable.from([Buffer.alloc(0)])),
    fetchFlags: vi.fn(async () => []), searchUids: vi.fn(async () => []), idle: vi.fn(async () => undefined),
    copy: vi.fn(async () => null), move: vi.fn(async () => null), append: vi.fn(async () => null), storeFlags: vi.fn(async () => undefined),
    uidExpunge: vi.fn(async () => undefined), createFolder: vi.fn(async () => undefined), renameFolder: vi.fn(async () => undefined), deleteFolder: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  const smtp = { verify: vi.fn(async () => undefined), submit: vi.fn(async () => ({ accepted: ["to@example.com"], rejected: [] as string[], messageId: "<sent@example.com>" })), close: vi.fn() }
  const protocols: MailProtocols = { imap: vi.fn(async () => session), smtp: vi.fn(async () => smtp) }
  const lifecycle = { start: vi.fn(async () => ({ jobId: "mj_e69940c0-4db1-4a0a-8f87-9027d116e194" })), stop: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
  const accounts = new MailAccounts(repo, context, protocols, access, lifecycle)
  return { root, database, storage, context, ctx, repo, access, assets, session, smtp, protocols, lifecycle, accounts,
    setOwner(next: string | null) { owner = next; context.refreshIdentity() },
    async close() { database.close(); await rm(root, { recursive: true, force: true }) },
  }
}
