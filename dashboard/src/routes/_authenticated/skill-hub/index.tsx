import { createFileRoute } from '@tanstack/react-router'
import { SkillHubCatalog } from '@/features/skill-hub/skill-catalog'
import { parseSkillHubSearch } from '@/features/skill-hub/skill-hub-navigation'

export const Route = createFileRoute('/_authenticated/skill-hub/')({
  validateSearch: parseSkillHubSearch,
  component: CatalogRoute,
})

function CatalogRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return <SkillHubCatalog search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />
}
