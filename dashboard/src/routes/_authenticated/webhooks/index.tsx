import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import WebhooksPage from '@/features/webhooks';
export const Route = createFileRoute('/_authenticated/webhooks/')({
    validateSearch: z.object({ action: z.literal('create').optional().catch(undefined) }),
    component: () => <WebhooksPage createOnOpen={Route.useSearch().action === 'create'} />,
});
