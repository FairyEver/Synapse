import { createFileRoute } from '@tanstack/react-router'
import { SkillRepositoryPublicPage } from '@/features/skill-repository'

export const Route = createFileRoute('/_authenticated/skills/$ownerHandle/$repositoryName')({
  component: RouteComponent,
})

function RouteComponent() {
  const { ownerHandle, repositoryName } = Route.useParams()
  return <SkillRepositoryPublicPage ownerHandle={ownerHandle} repositoryName={repositoryName} />
}
