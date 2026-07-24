import { createFileRoute } from '@tanstack/react-router'
import ProblemFeedbackPage from '@/features/problem-feedback'
import { requireDashboardAdmin } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/problem-feedback/')({
  beforeLoad: requireDashboardAdmin,
  component: ProblemFeedbackPage,
})
