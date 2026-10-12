import { createFileRoute } from '@tanstack/react-router'
import { requireDashboardSession } from '@/lib/require-dashboard-session'
import { DriveDiscussionNotificationPage } from '@/features/drive-browser/drive-discussion-notification-page'

export const Route = createFileRoute('/notifications/$notificationId/open')({
  beforeLoad: () => requireDashboardSession(window.location),
  component: Page,
})
function Page() {
  const { notificationId } = Route.useParams()
  return <DriveDiscussionNotificationPage notificationId={notificationId} />
}
