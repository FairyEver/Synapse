import { createFileRoute } from '@tanstack/react-router';
import WebhookDetailPage from '@/features/webhooks/detail';
import { z } from 'zod';
export const Route = createFileRoute('/_authenticated/webhooks/$webhookId')({
    component: WebhookDetailPage,
    validateSearch: z.object({
        tab: z.enum(['configuration', 'deliveries']).optional().catch(undefined),
        page: z.coerce.number().int().min(1).optional().catch(undefined),
        pageSize: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
        sortBy: z.string().optional(),
        sortOrder: z.enum(['asc', 'desc']).optional().catch(undefined),
        status: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
    }),
});
