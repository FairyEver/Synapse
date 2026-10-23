import type { NamespaceSchema } from "../types"

/** Mail content bytes live in managed files; these rows contain metadata/references only. */
export interface MailRecord<T = Record<string, unknown>> extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  ownerId: string
  accountId: string
  sortKey: string
  revision: number
  data: T
}
export const MAIL_ENTITIES = ["accounts", "credentials", "folders", "messages", "drafts", "operations", "sync-state", "assets", "search-tasks", "search-results", "previews"] as const
export type MailEntity = typeof MAIL_ENTITIES[number]
export const mailSchemas: readonly NamespaceSchema<MailRecord>[] = MAIL_ENTITIES.map((entity) => ({
  name: `app.mail.${entity}`, backend: entity === "credentials" ? "encrypted-json" : "sqlite",
  currentVersion: 1, migrations: [], transferPolicy: "local-only", encrypted: entity === "credentials",
  ...(entity === "credentials" ? {} : { sqlite: {
    fields: ["id", "schemaVersion", "ownerId", "accountId", "sortKey", "revision", "data"] as const,
    maxRecordBytes: 64 * 1024, atomic: true,
    indexes: [{ name: "owner_sort", fields: ["ownerId", "sortKey"] as const }, { name: "owner_account_sort", fields: ["ownerId", "accountId", "sortKey"] as const }],
  } }),
  validate(value): value is MailRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const row = value as MailRecord
    return row.schemaVersion === 1 && [row.id, row.ownerId, row.accountId, row.sortKey].every(s => typeof s === "string" && s.length > 0)
      && Number.isSafeInteger(row.revision) && row.revision > 0
      && !!row.data && typeof row.data === "object" && !Array.isArray(row.data)
      && Buffer.byteLength(JSON.stringify(value)) <= 64 * 1024
  },
}))
