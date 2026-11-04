import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { loadHubTeams, skillHubApi } from './skill-hub-api'
import { openSkillInSnap, parseSkillHubSearch } from './skill-hub-navigation'

const user = (sessionId: string) => ({ email: 'user@example.test', handle: null, sessionId })
const teamPage = (id: string, nextCursor: string | null) => ({
  items: [{ id, name: id }], nextCursor, selectionState: 'multiple', defaultTeamId: null,
})
afterEach(() => { useAuthStore.getState().auth.reset(); vi.unstubAllGlobals() })

describe('Skill Hub catalog scope', () => {
  it('uses the server classification across team pages instead of the first page length', async () => {
    useAuthStore.getState().auth.setUser(user('session-a'))
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(teamPage('team_1', 'next')))
      .mockResolvedValueOnce(Response.json(teamPage('team_2', null)))
    vi.stubGlobal('fetch', fetch)
    expect(await loadHubTeams('session-a')).toEqual({
      selectionState: 'multiple', defaultTeamId: null, items: [{ id: 'team_1', name: 'team_1' }, { id: 'team_2', name: 'team_2' }],
    })
    expect(fetch.mock.calls[1][0]).toContain('cursor=next')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'X-Skill-Hub-Session': 'session-a' })
  })
  it('rejects a previous-session response after the account changes', async () => {
    useAuthStore.getState().auth.setUser(user('session-a'))
    let complete!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { complete = resolve })))
    const page = skillHubApi.teams('session-a')
    useAuthStore.getState().auth.setUser(user('session-b'))
    complete(Response.json(teamPage('private_team', null)))
    await expect(page).rejects.toMatchObject({ code: 'HUB_ACCOUNT_CHANGED' })
  })
  it('keeps allowed return filters and only reports the protocol attempt', () => {
    expect(parseSkillHubSearch({ q: ' query ', team: 'team_1', mine: true, version: 4 })).toEqual({ q: 'query', team: 'team_1', mine: true })
    const open = vi.fn()
    expect(openSkillInSnap('skill_1', open)).toBe('已尝试打开 Snap')
    expect(open).toHaveBeenCalledWith('synapse://skill-hub/install?skillId=skill_1')
    expect(() => openSkillInSnap('skill_1&version=2', open)).toThrow()
  })
})
