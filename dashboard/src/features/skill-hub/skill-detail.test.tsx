import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkillMainView } from './skill-main-view'

describe('Skill Hub read-only package rendering', () => {
  it('renders safe Markdown structure without fetching or enabling package content', () => {
    const html = renderToStaticMarkup(<SkillMainView content={'---\nname: test\ndescription: package\n---\n# Instructions\n\n![pixel](https://evil.test/pixel)\n\n<iframe src="https://evil.test"></iframe>\n\n[click](javascript:alert(1))'} />)
    expect(html).toContain('<h2')
    expect(html).toContain('Instructions')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('description: package')
  })
})

it('keeps only the two latest-package tabs and distinguishes display data from the package', async () => {
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { SkillDetail } = await import('./skill-detail')
  const person = { id: 'user_a', displayName: '成员 A' }
  const detail = {
    id: 'skill_a', team: { id: 'team_a', name: '团队 A' }, displayName: '商店资料', displayDescription: '商店介绍',
    iconUrl: null, package: { name: 'package-name', description: 'Package description' },
    currentVersion: { id: 'version_a', number: 5, contentFingerprint: `sha256:${'0'.repeat(64)}`, archiveSha256: '0'.repeat(64) },
    revision: 2, createdBy: person, maintainer: { ...person, isActiveMember: true }, publishedAt: '2026-11-04T00:00:00.000Z',
    permissions: { canEditMetadata: false, canPublishVersion: false, canDelete: false },
    files: [{ path: 'SKILL.md', size: 42, sha256: '0'.repeat(64) }],
  }
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
