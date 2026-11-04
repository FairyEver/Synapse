// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { SkillHubSummary } from '@synapse/shared/skill-hub-contracts'
import { useAuthStore } from '@/stores/auth-store'
import { skillHubApi } from './skill-hub-api'
import { SkillHubCatalog } from './skill-catalog'

vi.mock('./skill-catalog-item', () => ({
  SkillCatalogItem: ({ skill }: { skill: SkillHubSummary }) => <li>{skill.displayName}</li>,
}))

const team = { id: 'team_1', name: '开发组' }
const author = { id: 'user_1', displayName: '贡献者' }

function waitForQueryUpdate(assertion: () => void) {
  return vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assertion()
  })
}

function summary(id: string, displayName: string): SkillHubSummary {
  return {
    id, displayName, displayDescription: 'Skill 简介', team, iconUrl: null,
    package: { name: id },
    currentVersion: { id: 'ver_1', number: 1, contentFingerprint: 'sha256:test', archiveSha256: 'test' },
    createdBy: author, maintainer: { ...author, isActiveMember: true },
    publishedAt: '2026-11-04T00:00:00.000Z', revision: 1,
    permissions: { canEditMetadata: false, canPublishVersion: false, canDelete: false },
  }
}

it('loads the next page near the bottom and preserves loaded results when retrying', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let reportIntersection: (isIntersecting: boolean) => void = () => { throw new Error('目录尚未监听底部') }
  const observe = vi.fn()
  const observer = vi.fn(function (callback: IntersectionObserverCallback, _options: IntersectionObserverInit) {
    reportIntersection = (isIntersecting) => callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
    return { observe, disconnect: vi.fn() }
  })
  vi.stubGlobal('IntersectionObserver', observer)
  const auth = useAuthStore.getState().auth
  auth.setUser({ sessionId: 'session_1', userId: 'user_1', email: 'fixture@example.test', handle: 'fixture' })
  vi.spyOn(skillHubApi, 'teams').mockResolvedValue({
    items: [team], selectionState: 'single', defaultTeamId: team.id, nextCursor: null,
  })
  const list = vi.spyOn(skillHubApi, 'list')
    .mockResolvedValueOnce({ items: [summary('skill_1', '第一页 Skill')], nextCursor: 'next' })
    .mockRejectedValueOnce(new Error('暂时无法加载'))
    .mockResolvedValueOnce({ items: [summary('skill_2', '第二页 Skill')], nextCursor: null })
  const host = document.createElement('div')
  host.id = 'main-content'
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient()
  const results = () => host.querySelector('ul[aria-label="团队 Skill"]')?.textContent
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}><SkillHubCatalog search={{}} onSearch={vi.fn()} /></QueryClientProvider>,
    ))
    await waitForQueryUpdate(() => expect(results()).toContain('第一页 Skill'))
    expect(host.textContent).not.toContain('加载更多')
    const options = observer.mock.calls.at(-1)?.[1]
    expect(options?.root === host).toBe(true)
    expect(options?.rootMargin).toBe('0px 0px 320px 0px')
    expect(observe).toHaveBeenCalledOnce()
    act(() => reportIntersection(false))
    expect(list).toHaveBeenCalledTimes(1)
    await act(async () => {
      reportIntersection(true)
      reportIntersection(true)
    })
    await waitForQueryUpdate(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('暂时无法加载'))
    expect(results()).toContain('第一页 Skill')
    expect(list).toHaveBeenCalledTimes(2)
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === '重试')
    expect(retry).toBeDefined()
    await act(async () => retry?.click())
    await waitForQueryUpdate(() => expect(results()).toBe('第一页 Skill第二页 Skill'))
    expect(list.mock.calls.map(([, input]) => input.cursor)).toEqual([undefined, 'next', 'next'])
    expect(host.querySelector('[role="alert"]')).toBeNull()
  } finally {
    act(() => root.unmount())
    client.clear()
    host.remove()
    auth.reset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
