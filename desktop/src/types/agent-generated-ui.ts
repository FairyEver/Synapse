import { z } from "zod"

export const GENERATED_UI_LIBRARY_VERSION = "openui@0.18.1/lang@1.0.1"
export const GENERATED_UI_MAX_SOURCE_BYTES = 128 * 1024
export const GENERATED_UI_MAX_STATE_BYTES = 64 * 1024
export const generatedUiBlockSchema = z.object({
  id: z.string().uuid(), ordinal: z.number().int().nonnegative(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
})
export const generatedUiMetadataSchema = z.object({
  version: z.literal(1), libraryVersion: z.literal(GENERATED_UI_LIBRARY_VERSION),
  turnId: z.string().min(1), blocks: z.array(generatedUiBlockSchema).max(16),
})
export type GeneratedUiMetadata = z.infer<typeof generatedUiMetadataSchema>
export type GeneratedUiBlock = z.infer<typeof generatedUiBlockSchema>
export const generatedUiTargetSchema = z.object({ projectId: z.string().min(1), conversationId: z.string().min(1), blockId: z.string().uuid() }).strict()
export type GeneratedUiTarget = z.infer<typeof generatedUiTargetSchema>
export const generatedUiStateSchema = z.record(z.string().max(256), z.unknown()).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= GENERATED_UI_MAX_STATE_BYTES,
  "表单内容过大。",
)
export const generatedUiSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(), state: generatedUiStateSchema, readOnly: z.boolean(),
  submission: z.object({ submissionId: z.string().uuid(), status: z.enum(["accepted", "uncertain"]) }).optional(),
})
export type GeneratedUiSnapshot = z.infer<typeof generatedUiSnapshotSchema>
export const saveGeneratedUiStateSchema = generatedUiTargetSchema.extend({
  expectedRevision: z.number().int().nonnegative(), state: generatedUiStateSchema,
})
export type SaveGeneratedUiStateInput = z.infer<typeof saveGeneratedUiStateSchema>
export const submitGeneratedUiActionSchema = generatedUiTargetSchema.extend({
  submissionId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(4096), formState: generatedUiStateSchema,
  context: z.unknown().optional(),
}).refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= GENERATED_UI_MAX_STATE_BYTES + 8192, "提交内容过大。")
export type SubmitGeneratedUiActionInput = z.infer<typeof submitGeneratedUiActionSchema>
export const generatedUiSubmissionSchema = z.object({ submissionId: z.string().uuid(), status: z.enum(["accepted", "uncertain"]) })
export type GeneratedUiSubmission = z.infer<typeof generatedUiSubmissionSchema>
