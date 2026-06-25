import { z } from "zod"

export const quickInputItemSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  content: z.string().min(1),
  sortOrder: z.number(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const quickInputCreateInputSchema = z.object({
  content: z.string(),
})

export const quickInputUpdateInputSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
})

export const quickInputIdInputSchema = z.object({
  id: z.string().min(1),
})

export const quickInputChangedEventSchema = z.object({
  items: z.array(quickInputItemSchema),
})

export type QuickInputItem = z.infer<typeof quickInputItemSchema>
export type QuickInputCreateInput = z.infer<typeof quickInputCreateInputSchema>
export type QuickInputUpdateInput = z.infer<typeof quickInputUpdateInputSchema>
export type QuickInputIdInput = z.infer<typeof quickInputIdInputSchema>
export type QuickInputChangedEvent = z.infer<typeof quickInputChangedEventSchema>
