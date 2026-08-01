import { createFileRoute } from '@tanstack/react-router'
import { SkillRepositoryDetailPage } from '@/features/skill-repository/skill-repository-detail-page'

export const Route = createFileRoute('/_authenticated/skill-repositories/$repositoryId')({
  component: () => {
    const { repositoryId } = Route.useParams()
    return <SkillRepositoryDetailPage repositoryId={repositoryId} />
  },
})
