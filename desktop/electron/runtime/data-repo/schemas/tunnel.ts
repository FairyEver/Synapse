import { z } from "zod"
import type { NamespaceSchema } from "../types"
const scope = { ownerId: z.string().min(1).max(128), apiOrigin: z.string().url().max(512), clientInstanceId: z.string().min(1).max(128) }
const binding = z.object({ id: z.string().min(1).max(200), schemaVersion: z.literal(1), ...scope,
  kind: z.enum(["binding", "pending-create"]), mappingId: z.string().max(128), requestId: z.string().max(36),
  port: z.number().int().min(1).max(65535), revision: z.number().int().nonnegative(), createdAt: z.iso.datetime(),
}).strict()
const credential = z.object({ id: z.string().min(1).max(200), schemaVersion: z.literal(1), ...scope, key: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict()
export type TunnelBindingRecord = z.infer<typeof binding>
export type TunnelCredentialRecord = z.infer<typeof credential>
export const tunnelBindingSchema: NamespaceSchema<TunnelBindingRecord> = {
  name: "app.tunnel.bindings", backend: "sqlite", currentVersion: 1, migrations: [], transferPolicy: "local-only",
  validate: (value): value is TunnelBindingRecord => binding.safeParse(value).success,
  sqlite: { fields: Object.keys(binding.shape) as (keyof TunnelBindingRecord)[], atomic: true, maxRecordBytes: 4096,
    indexes: [{ name: "scope_kind", fields: ["ownerId", "apiOrigin", "clientInstanceId", "kind", "id"] }] },
}
export const tunnelCredentialSchema: NamespaceSchema<TunnelCredentialRecord> = {
  name: "app.tunnel.credentials", backend: "encrypted-json", encrypted: true, currentVersion: 1, migrations: [], transferPolicy: "local-only",
  validate: (value): value is TunnelCredentialRecord => credential.safeParse(value).success,
}
export const tunnelSchemas = [tunnelBindingSchema, tunnelCredentialSchema] as const
