import { DATA_REPO_ATOMIC_MAX_BYTES } from "../../../../config"
import {
  skillHubIdSchema, skillHubManifestSchema, skillHubTeamSchema, skillHubWriteActionSchema,
} from "@synapse/shared/skill-hub-contracts"
import { z } from "zod"
import type { NamespaceSchema } from "../types"

const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const prepared = z.strictObject({
  id: z.uuid(), assetKey: z.uuid(), schemaVersion: z.literal(1), bootId: z.uuid(),
  accountId: skillHubIdSchema, authRevision: z.int().nonnegative(), callerKey: sha256,
  state: z.enum(["staged", "ready"]), team: skillHubTeamSchema,
  expiresAt: z.int().positive(), archiveSha256: sha256.nullable(),
  manifest: skillHubManifestSchema, contentFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})
const intent = z.strictObject({
  id: sha256, schemaVersion: z.literal(1), accountId: skillHubIdSchema, callerKey: sha256,
  action: skillHubWriteActionSchema, requestId: skillHubIdSchema, inputDigest: sha256,
  targetId: skillHubIdSchema, createdAt: z.int().positive(),
})

export type HubPreparedRecord = z.infer<typeof prepared>
export type HubWriteIntent = z.infer<typeof intent>
export const skillHubPreparedSourcesSchema: NamespaceSchema<HubPreparedRecord> = {
  name: "app.skill-hub.prepared-sources", backend: "sqlite", currentVersion: 1, migrations: [], transferPolicy: "local-only",
  sqlite: {
    fields: ["id", "schemaVersion", "assetKey", "bootId", "accountId", "authRevision", "callerKey", "state", "team", "expiresAt", "archiveSha256", "manifest", "contentFingerprint"],
    maxRecordBytes: DATA_REPO_ATOMIC_MAX_BYTES, atomic: false,
    indexes: [{ name: "expiry", fields: ["expiresAt", "id"] }],
  },
  validate: (value): value is HubPreparedRecord => prepared.safeParse(value).success,
}
export const skillHubWriteIntentsSchema: NamespaceSchema<HubWriteIntent> = {
  name: "app.skill-hub.write-intents", backend: "sqlite", currentVersion: 1, migrations: [], transferPolicy: "local-only",
  sqlite: {
    fields: ["id", "schemaVersion", "accountId", "callerKey", "action", "requestId", "inputDigest", "targetId", "createdAt"],
    maxRecordBytes: 2048, atomic: true, indexes: [{ name: "created", fields: ["createdAt", "id"] }],
  },
  validate: (value): value is HubWriteIntent => intent.safeParse(value).success,
}
