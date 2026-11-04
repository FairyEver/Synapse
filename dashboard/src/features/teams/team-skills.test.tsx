import { describe, expect, it, vi } from 'vitest'
import { adminApi, type AdminTeamMemberRow } from '@/lib/api'
import { loadActiveTeamSkillCandidates } from './team-skill-maintainer-dialog'

const member = (id: string, status: AdminTeamMemberRow['status'] = 'active'): AdminTeamMemberRow => ({
  userId: id, email: `${id}@example.test`, handle: id, status, joinedAt: '2026-11-04T00:00:00.000Z',
})

describe('Skill Hub team governance', () => {
  it('loads active candidates across pages and excludes the current and disabled maintainers', async () => {
    const spy = vi.spyOn(adminApi, 'listTeamMembers')
      .mockResolvedValueOnce({ total: 101, data: [member('current'), member('disabled', 'disabled'), ...Array.from({ length: 98 }, (_, index) => member(`member_${index}`))] })
      .mockResolvedValueOnce({ total: 101, data: [member('second_page_member')] })
    try {
      const result = await loadActiveTeamSkillCandidates('team_1', 'current')
      expect(result.map((candidate) => candidate.handle)).toContain('second_page_member')
      expect(result.map((candidate) => candidate.handle)).not.toContain('disabled')
      expect(result.map((candidate) => candidate.handle)).not.toContain('current')
      expect(spy.mock.calls[1]?.[0]).toBe('team_1')
      expect(spy.mock.calls[1]?.[1]).toMatchObject({ page: 2 })
    } finally { spy.mockRestore() }
  })
})
