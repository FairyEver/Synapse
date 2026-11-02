import { z } from 'zod'

export const webhookHistorySearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().catch(undefined),
  webhookId: z.string().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  user: z.string().optional(),
  userId: z.string().optional(),
})

export const webhookWorkspaceSearchSchema = webhookHistorySearchSchema.extend({
  tab: z.enum(['configuration', 'deliveries']).optional().catch(undefined),
  action: z.literal('create').optional().catch(undefined),
})

export type WebhookWorkspaceSearch = z.infer<typeof webhookWorkspaceSearchSchema>
