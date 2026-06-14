import { describe, expect, it, vi } from 'vitest'
import type { AdminTeamRow } from '@/lib/api'
import { listInvitationCreateTeams } from './index'

describe('listInvitationCreateTeams', () => {
  it('loads every page of teams for invitation creation', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      teamRow(`team-${index + 1}`, `Team ${index + 1}`)
    )
    const listTeams = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, total: 102 })
      .mockResolvedValueOnce({
        data: [
          teamRow('team-100', 'Team 100'),
          teamRow('team-101', 'Team 101'),
          teamRow('team-102', 'Team 102'),
        ],
        total: 102,
      })

    const teams = await listInvitationCreateTeams(listTeams)

    expect(listTeams).toHaveBeenCalledTimes(2)
    expect(listTeams).toHaveBeenNthCalledWith(1, {
      page: 1,
      pageSize: 100,
      sortBy: 'name',
      sortOrder: 'asc',
    })
    expect(listTeams).toHaveBeenNthCalledWith(2, {
      page: 2,
      pageSize: 100,
      sortBy: 'name',
      sortOrder: 'asc',
    })
    expect(teams).toHaveLength(102)
    expect(teams.at(-1)?.id).toBe('team-102')
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
