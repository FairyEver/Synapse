import { createFileRoute } from '@tanstack/react-router'
import { SkillRepositoryExplorePage } from '@/features/skill-repository'

export const Route = createFileRoute('/_authenticated/skill-repositories/explore')({
  component: SkillRepositoryExplorePage,
})
