import { z } from "zod"

export const screenshotRegionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
})

export const screenshotCaptureInputSchema = z.object({
  mode: z.enum(["fullscreen", "region"]),
  region: screenshotRegionSchema.optional(),
  hideCurrentWindow: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.mode === "region" && !value.region) {
    ctx.addIssue({
      code: "custom",
      path: ["region"],
      message: "Region is required when mode is region.",
    })
  }
})

export const screenshotCaptureMetadataSchema = z.object({
  mode: z.enum(["fullscreen", "region"]),
  region: screenshotRegionSchema.optional(),
  coordinateSpace: z.literal("screen"),
  displayId: z.string().optional(),
  scaleFactor: z.number().finite().positive().optional(),
  capturedAt: z.string(),
  hiddenWindowIds: z.array(z.string()).optional(),
})

const bytesSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array)

export const screenshotArtifactSchema = z.object({
  id: z.string().min(1),
  mimeType: z.literal("image/png"),
  bytes: bytesSchema,
  size: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tempPath: z.string().min(1),
  capture: screenshotCaptureMetadataSchema,
})

export const screenshotPublicArtifactSchema = screenshotArtifactSchema.omit({ bytes: true })

export const screenshotCaptureToFileInputSchema = z.object({
  capture: screenshotCaptureInputSchema,
  outputPath: z.string().min(1),
  overwrite: z.boolean().optional(),
})

export const screenshotSaveArtifactInputSchema = z.object({
  artifact: screenshotArtifactSchema,
  outputPath: z.string().min(1),
  overwrite: z.boolean().optional(),
})

export const screenshotInteractiveCaptureInputSchema = z.object({
  hideCurrentWindow: z.boolean().optional(),
})

export const screenshotSaveResultSchema = z.object({
  outputPath: z.string(),
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  artifact: screenshotPublicArtifactSchema,
})

export const screenshotClipboardResultSchema = z.object({
  copied: z.literal(true),
  artifact: screenshotPublicArtifactSchema,
})

export type ScreenshotRegion = z.infer<typeof screenshotRegionSchema>
export type ScreenshotCaptureInput = z.infer<typeof screenshotCaptureInputSchema>
export type ScreenshotArtifact = z.infer<typeof screenshotArtifactSchema>
export type ScreenshotPublicArtifact = z.infer<typeof screenshotPublicArtifactSchema>
export type ScreenshotCaptureToFileInput = z.infer<typeof screenshotCaptureToFileInputSchema>
export type ScreenshotSaveArtifactInput = z.infer<typeof screenshotSaveArtifactInputSchema>
export type ScreenshotInteractiveCaptureInput = z.infer<typeof screenshotInteractiveCaptureInputSchema>
export type ScreenshotSaveResult = z.infer<typeof screenshotSaveResultSchema>
export type ScreenshotClipboardResult = z.infer<typeof screenshotClipboardResultSchema>
