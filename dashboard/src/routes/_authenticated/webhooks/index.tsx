import { createFileRoute } from '@tanstack/react-router';
import { WebhookWorkspace } from '@/features/webhooks/webhook-workspace';
import { webhookWorkspaceSearchSchema } from '@/features/webhooks/webhook-workspace-search';
export const Route = createFileRoute('/_authenticated/webhooks/')({
    validateSearch: webhookWorkspaceSearchSchema,
    component: WebhookWorkspaceRoute,
});
function WebhookWorkspaceRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <WebhookWorkspace search={search} onSearchChange={(update) => void navigate({ search: update })}/>;
}
