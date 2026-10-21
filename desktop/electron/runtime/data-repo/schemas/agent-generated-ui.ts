import { z } from "zod"
import { generatedUiStateSchema } from "../../../../src/types/agent-generated-ui"
import type { NamespaceSchema } from "../types"

const entrySchema = z.object({
  id: z.string(), schemaVersion: z.literal(1), projectId: z.string(), conversationId: z.string(), blockId: z.string().uuid(),
  sourceHash: z.string(), revision: z.number().int().nonnegative(), state: generatedUiStateSchema,
  submissions: z.array(z.object({ submissionId: z.string().uuid(), payloadHash: z.string(), status: z.enum(["accepted", "uncertain"]) })).max(20),
})
export type GeneratedUiStateEntry = z.infer<typeof entrySchema>
export const agentGeneratedUiStateSchema: NamespaceSchema<GeneratedUiStateEntry> = {
  name: "agent.generated-ui-state", backend: "sqlite", currentVersion: 1, migrations: [],
  validate: (value): value is GeneratedUiStateEntry => entrySchema.safeParse(value).success,
}
