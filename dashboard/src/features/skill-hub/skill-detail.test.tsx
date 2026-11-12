// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SkillDetail } from './skill-detail'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { skillHubApi } from './skill-hub-api'
import type { SkillHubDetail } from '@synapse/shared/skill-hub-contracts'

const person = { id: 'user_a', displayName: '成员 A' }
const detail: SkillHubDetail = {
  id: 'skill_a', team: { id: 'team_a', name: '团队 A' }, displayName: '商店资料', displayDescription: '商店介绍',
  iconUrl: null, package: { name: 'package-name', description: 'Package description' },
  currentVersion: { id: 'version_a', number: 5, contentFingerprint: `sha256:${'0'.repeat(64)}`, archiveSha256: '0'.repeat(64) },
  revision: 2, createdBy: person, maintainer: { ...person, isActiveMember: true }, publishedAt: '2026-11-04T00:00:00.000Z',
  permissions: { canEditMetadata: false, canPublishVersion: false, canDelete: false },
  files: [
    { path: 'SKILL.md', size: 42, sha256: '0'.repeat(64) },
    { path: 'references/说明.md', size: 35, sha256: '0'.repeat(64) },
    { path: 'scripts/run.py', size: 18, sha256: '0'.repeat(64) },
  ],
}

it('keeps only the two latest-package tabs and distinguishes display data from the package', () => {
  const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>
    <SkillDetail skill={detail} session="test" reload={() => undefined} />
  </QueryClientProvider>)
  expect(html).toContain('商店资料')
  expect(html).toContain('包内名称')
  expect(html).toContain('package-name')
  expect(html).toContain('v5')
  expect(html).not.toContain('历史版本')
  expect(html).not.toContain('恢复')
})

it('loads the main file through the rendered Markdown endpoint', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const main = vi.spyOn(skillHubApi, 'mainMarkdown').mockResolvedValue({
    versionId: 'version_a', html: '<h1>说明</h1><p><strong>重点</strong></p>',
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient()
  try {
    await act(async () => root.render(<QueryClientProvider client={client}>
      <SkillDetail skill={detail} session="test" reload={vi.fn()} />
    </QueryClientProvider>))
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(host.querySelector('[data-testid="skill-markdown-body"]')?.innerHTML).toContain('<h1>说明</h1>')
    })
    expect(main).toHaveBeenCalledWith('test', 'skill_a', 'version_a', expect.any(AbortSignal))
  } finally {
    act(() => root.unmount())
    client.clear()
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('renders Markdown files in the preview dialog and keeps other files as source', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const markdownHtml = '<h1>说明</h1><p><strong>重点</strong></p>'
  vi.spyOn(skillHubApi, 'mainMarkdown').mockResolvedValue({ versionId: 'version_a', html: '<h1>Main</h1>' })
  const rendered = vi.spyOn(skillHubApi, 'previewMarkdown').mockResolvedValue({ versionId: 'version_a', html: markdownHtml })
  const preview = vi.spyOn(skillHubApi, 'preview').mockResolvedValue({ versionId: 'version_a', content: 'print("ok")\n' })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const client = new QueryClient()
  try {
    await act(async () => root.render(<QueryClientProvider client={client}>
      <SkillDetail skill={detail} session="test" reload={vi.fn()} />
    </QueryClientProvider>))
    const filesTab = host.querySelectorAll<HTMLElement>('[role="tab"]')[1]
    await act(async () => filesTab.click())
    const markdownFile = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('references/说明.md'))
    expect(markdownFile).toBeDefined()
    await act(async () => markdownFile?.click())
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(document.querySelector('[role="dialog"] [data-testid="skill-markdown-body"]')?.innerHTML).toBe(markdownHtml)
    })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.querySelector('h2')?.textContent).toBe('references/说明.md')
    expect(preview).not.toHaveBeenCalled()
    expect(rendered).toHaveBeenCalledWith('test', 'skill_a', 'version_a', 'references/说明.md', expect.any(AbortSignal))
    const close = dialog?.querySelector('button')
    expect(close).toBeDefined()
    await act(async () => close?.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    const sourceFile = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('scripts/run.py'))
    expect(sourceFile).toBeDefined()
    await act(async () => sourceFile?.click())
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe('print("ok")\n')
    })
    expect(preview).toHaveBeenCalledWith('test', 'skill_a', 'version_a', 'scripts/run.py', expect.any(AbortSignal))
  } finally {
    act(() => root.unmount())
    client.clear()
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
