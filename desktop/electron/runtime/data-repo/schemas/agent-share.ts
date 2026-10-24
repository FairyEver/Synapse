import { z } from "zod"
import type { NamespaceSchema } from "../types"
import { shareSettingsSchema } from "../../../../src/types/agent-share"

const schema = z.object({
  id: z.string().uuid(), schemaVersion: z.literal(1), projectId: z.string(), conversationId: z.string(),
  turnId: z.string(), sourceTimestamp: z.string(), sourceHistoryIndex: z.number().int().nonnegative(), rendererId: z.number().int(),
  state: z.enum(["staged", "ready", "delete-pending"]), assetKey: z.string().uuid(),
  fileName: z.string(), width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(), sha256: z.string(), createdAt: z.string(),
  messageRefs: z.array(z.string()).max(10_000), settings: shareSettingsSchema,
  requestKey: z.string(), requestHash: z.string(),
})
export type ShareImageRecord = z.infer<typeof schema>
export const agentShareImagesSchema: NamespaceSchema<ShareImageRecord> = {
  name: "app.agent.share-images", backend: "sqlite", currentVersion: 1, migrations: [], transferPolicy: "local-only",
  validate: (value): value is ShareImageRecord => schema.safeParse(value).success,
}
