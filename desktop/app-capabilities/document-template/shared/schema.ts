import { z } from "zod"

const inlineDataSchema = z.record(z.string(), z.unknown())

export const generateDocxInputSchema = z.object({
  templatePath: z.string().min(1),
  outputPath: z.string().min(1),
  dataPath: z.string().min(1).optional(),
  data: inlineDataSchema.optional(),
  overwrite: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasDataPath = typeof value.dataPath === "string" && value.dataPath.trim().length > 0
  const hasData = value.data !== undefined

  if (hasDataPath === hasData) {
    ctx.addIssue({
      code: "custom",
      path: ["data"],
      message: "Exactly one of dataPath or data is required.",
    })
  }
})

export const generateDocxResultSchema = z.object({
  outputPath: z.string(),
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  generatedAt: z.string(),
})

export type GenerateDocxInput = z.infer<typeof generateDocxInputSchema>
export type GenerateDocxResult = z.infer<typeof generateDocxResultSchema>
