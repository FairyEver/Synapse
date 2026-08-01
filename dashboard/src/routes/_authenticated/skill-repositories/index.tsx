import { createFileRoute } from '@tanstack/react-router'
import { SkillRepositoryListPage } from '@/features/skill-repository/skill-repository-list-page'

export const Route = createFileRoute('/_authenticated/skill-repositories/')({
  component: SkillRepositoryListPage,
})
