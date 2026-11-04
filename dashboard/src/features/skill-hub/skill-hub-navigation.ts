import { skillHubIdSchema } from '@synapse/shared/skill-hub-contracts'

export type SkillHubSearch = { q?: string; team?: string; mine?: true }

export function parseSkillHubSearch(input: Record<string, unknown>): SkillHubSearch {
  const q = typeof input.q === 'string' ? input.q.trim().slice(0, 200) : ''
  const team = skillHubIdSchema.safeParse(input.team)
  return { ...(q ? { q } : {}), ...(team.success ? { team: team.data } : {}), ...(input.mine === true ? { mine: true } : {}) }
}

export function openSkillInSnap(id: string, open: (url: string) => void = (url) => window.location.assign(url)) {
  open(`synapse://skill-hub/install?skillId=${encodeURIComponent(skillHubIdSchema.parse(id))}`)
  return '已尝试打开 Snap'
}
