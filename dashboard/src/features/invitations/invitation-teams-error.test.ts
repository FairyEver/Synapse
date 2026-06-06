import { describe, expect, it } from 'vitest'

import { getInvitationTeamsErrorMessage } from './invitation-teams-error'

describe('getInvitationTeamsErrorMessage', () => {
  it('uses readable error messages', () => {
    expect(getInvitationTeamsErrorMessage(new Error('团队查询失败'))).toBe(
      '团队查询失败'
    )
    expect(getInvitationTeamsErrorMessage('网络异常')).toBe('网络异常')
  })

  it('falls back for unreadable errors', () => {
    expect(getInvitationTeamsErrorMessage(new Error(''))).toBe(
      '团队列表加载失败'
    )
    expect(getInvitationTeamsErrorMessage(null)).toBe('团队列表加载失败')
  })
})
