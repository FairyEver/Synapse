import { createFileRoute, notFound } from '@tanstack/react-router'
import { skillHubIdSchema } from '@synapse/shared/skill-hub-contracts'
import { SkillHubDetailPage } from '@/features/skill-hub/skill-detail'
import { parseSkillHubSearch } from '@/features/skill-hub/skill-hub-navigation'

export const Route = createFileRoute('/_authenticated/skill-hub/$skillId')({
  validateSearch: parseSkillHubSearch,
  beforeLoad: ({ params }) => { if (!skillHubIdSchema.safeParse(params.skillId).success) throw notFound() },
  component: DetailRoute,
})

function DetailRoute() {
  return <SkillHubDetailPage skillId={Route.useParams().skillId} search={Route.useSearch()} />
}
