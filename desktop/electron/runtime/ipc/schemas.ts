import { z } from "zod"

export const projectRequestSchema = z.object({
  projectId: z.string().min(1),
})

export const paginationSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
})

export const repositoryUuidSchema = z.object({
  repositoryUuid: z.string().min(1),
})
