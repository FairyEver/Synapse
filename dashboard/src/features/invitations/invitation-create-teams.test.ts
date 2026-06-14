import { describe, expect, it, vi } from 'vitest'
import type { AdminTeamRow } from '@/lib/api'
import { listInvitationCreateTeams } from './index'

describe('listInvitationCreateTeams', () => {
  it('loads only the first page of teams for invitation creation', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      teamRow(`team-${index + 1}`, `Team ${index + 1}`)
    )
    const listTeams = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, total: 102 })

    const teams = await listInvitationCreateTeams(listTeams)

    expect(listTeams).toHaveBeenCalledTimes(1)
    expect(listTeams).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    })
    expect(teams).toHaveLength(100)
    expect(teams.at(-1)?.id).toBe('team-100')
  })

  it('passes a trimmed team search query', async () => {
    const listTeams = vi
      .fn()
      .mockResolvedValueOnce({
        data: [teamRow('team-102', 'Team 102')],
        total: 1,
      })

    const teams = await listInvitationCreateTeams(listTeams, '  Team 102  ')

    expect(listTeams).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      search: 'Team 102',
    })
    expect(teams).toEqual([expect.objectContaining({ id: 'team-102' })])
  })
})

function teamRow(id: string, name: string): AdminTeamRow {
  return {
    id,
    name,
    createdByUser: { email: 'admin@example.test' },
    memberCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
