import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { DataRepositoryImpl } from "../../../runtime/data-repo/repository"
import { SqliteNamespace } from "../../../runtime/data-repo/backends/sqlite"
import { JsonNamespace } from "../../../runtime/data-repo/backends/json"
import { automationMailSchemas } from "../../../runtime/data-repo/schemas/automation-mail-triggers"
import { AutomationItemRepository } from "../../automation/item-repository"
import { AutomationTriggerRegistry } from "../../automation/trigger-registry"
import { MailTriggerRepository } from "../repository"
import type { MailReceiptSource, MailTriggerContext } from "../types"
import type { AutomationItem } from "../../automation/types"

export async function mailTriggerRig() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mail-trigger-")), db = new DatabaseSync(":memory:"), storage = new DataRepositoryImpl()
  for (const schema of automationMailSchemas) storage.register(schema, new SqliteNamespace({ name: schema.name, schemaVersion: 1, backend: "sqlite", database: db, validate: schema.validate, sqlite: schema.sqlite }))
  const itemStore = new JsonNamespace<AutomationItem>({ name: "automation.items", schemaVersion: 1, backend: "json", filePath: path.join(root, "items.json") })
  const triggers = new AutomationTriggerRegistry()
  triggers.register({ manifest: { id: "test.mail", title: "test", kind: "event", configSchema: z.record(z.string(), z.unknown()), defaultConfig: {} }, activationRequired: true, summarize: () => "test", runtime: {} })
  const items = new AutomationItemRepository({ items: itemStore, triggers })
  const ctx: MailTriggerContext = { identity: { ownerId: "owner", apiOrigin: "https://synapse.test" }, generation: 1, signal: new AbortController().signal }
  let context = ctx
  const source: MailReceiptSource = {
    prepare: async () => [{ kind: "mail-internal", sourceKey: "inbox", receiptSequence: "20", serverTime: "2026-11-05T00:00:00Z" }],
    scan: async () => ({ receipts: [], nextCursor: "20", complete: true }),
    hydrate: async (_ctx, receipt) => ({ messageId: receipt.messageId!, subject: "subject", body: "body", sender: "sender", to: "owner", cc: "", receivedAt: receipt.receivedAt!, attachments: "[]", attachmentCount: 0, url: `synapse://mail-internal/${receipt.messageId}` }),
  }
  return { root, db, storage, itemStore, items, triggers, ctx, source, repo: new MailTriggerRepository(storage),
    context: () => context, setContext(next: MailTriggerContext) { context = next },
    input: { name: "new mail", enabled: false, scope: { type: "global" as const }, trigger: { type: "test.mail", config: {} }, executor: { type: "test.executor", config: {} } },
    async close() { db.close(); await rm(root, { recursive: true, force: true }) },
  }
}
