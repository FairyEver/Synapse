import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const screenshotNodeConfigSchema = z.object({
  mode: z.enum(["fullscreen", "region"]),
  x: z.string().optional(),
  y: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  outputPath: z.string().refine((value) => value.trim().length > 0, "输出文件必填"),
  overwrite: z.boolean(),
  hideCurrentWindow: z.boolean(),
  variables: z.array(variableBindingSchema),
}).superRefine((value, ctx) => {
  if (value.mode !== "region") return
  for (const key of ["x", "y", "width", "height"] as const) {
    if (!value[key]?.trim()) {
      ctx.addIssue({ code: "custom", path: [key], message: "区域坐标必填" })
    }
  }
})

export type ScreenshotNodeConfig = z.infer<typeof screenshotNodeConfigSchema>
