import { expect, it, vi } from 'vitest'
import { resolveHubUploadTeam, submitHubWrite } from './use-skill-publish'
import { skillHubApi } from './skill-hub-api'

it('requires an explicit selection when one page contains only one of multiple teams', () => {
  const items = [{ id: 'team_1', name: 'First' }]
  expect(resolveHubUploadTeam({ items, selectionState: 'multiple', defaultTeamId: null })).toBeUndefined()
  expect(resolveHubUploadTeam({ items, selectionState: 'multiple', defaultTeamId: null }, 'team_1')).toBe('team_1')
  expect(resolveHubUploadTeam({ items, selectionState: 'single', defaultTeamId: 'team_1' })).toBe('team_1')
  expect(resolveHubUploadTeam({ items: [], selectionState: 'none', defaultTeamId: null }, 'team_1')).toBeUndefined()
})

it('retains the original publish key after an unknown result and only queries its receipt', async () => {
  const key = { action: 'app.skill_hub.version.create', requestId: 'existing-request' } as const
  const publish = vi.fn().mockRejectedValue(new TypeError('connection lost'))
  const receipt = vi.spyOn(skillHubApi, 'receipt').mockResolvedValue({ ...key, status: 'not_found', resultAccessible: false })
  const remember = vi.fn(), clear = vi.fn()
  const result = await submitHubWrite('session', key, () => publish(key.requestId), { remember, clear })
  expect(result).toMatchObject({ state: 'unknown', request: key })
  expect(new Set(publish.mock.calls.map(([id]) => id)).size).toBe(1)
  expect(receipt).toHaveBeenCalledWith('session', key)
  expect(remember).toHaveBeenCalledWith(key)
  expect(clear).not.toHaveBeenCalled()
  receipt.mockRestore()
})
