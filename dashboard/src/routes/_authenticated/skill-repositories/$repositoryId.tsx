import { createFileRoute } from '@tanstack/react-router'
import { SkillRepositoryDetailPage } from '@/features/skill-repository/skill-repository-detail-page'
import { requireDashboardUser } from '@/lib/dashboard-route-guards'

export const Route = createFileRoute('/_authenticated/skill-repositories/$repositoryId')({
  beforeLoad: requireDashboardUser,
  component: () => {
    const { repositoryId } = Route.useParams()
    return <SkillRepositoryDetailPage repositoryId={repositoryId} />
  },
})
