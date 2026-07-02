import { createFileRoute } from '@tanstack/react-router'
import { SkillRepositoryListPage } from '@/features/skill-repository/skill-repository-list-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/skill-repositories/')({
  beforeLoad: requireDashboardUser,
  component: SkillRepositoryListPage,
})
