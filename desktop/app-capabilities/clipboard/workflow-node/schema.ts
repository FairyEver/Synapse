import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"
import { validateClipboardWriteText } from "../shared/schema"

const clipboardWriteTextSchema = z.string().superRefine((value, context) => {
  const validation = validateClipboardWriteText(value)
  if (!validation.ok) {
    context.addIssue({
      code: "custom",
      message: validation.error.message,
    })
  }
})

export const clipboardTextWriteNodeConfigSchema = z.object({
  text: clipboardWriteTextSchema,
  variables: z.array(variableBindingSchema),
}).strict()

export const clipboardTextReadNodeConfigSchema = z.object({}).strict()

export type ClipboardTextWriteNodeConfig = z.infer<
  typeof clipboardTextWriteNodeConfigSchema
>
export type ClipboardTextReadNodeConfig = z.infer<
  typeof clipboardTextReadNodeConfigSchema
>
