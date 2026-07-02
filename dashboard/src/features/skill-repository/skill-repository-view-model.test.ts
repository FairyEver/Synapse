import type { SkillRepositoryDetailDto } from '@synapse/shared'
import { describe, expect, it } from 'vitest'
import {
  buildSkillRepositoryBrowser,
  getSkillRepositoryDisplayOwner,
  isProtectedSkillRepositoryPath,
} from './skill-repository-view-model'

describe('skill repository view model', () => {
  it('adapts repository files into browser rows with SKILL.md priority', () => {
    const browser = buildSkillRepositoryBrowser(repository(), '')

    expect(browser.tree.rows.map((row) => row.type === 'file' ? row.file.path : row.path)).toEqual([
      'SKILL.md',
      'docs',
      'README.md',
    ])
  })

  it('uses handle, display name, then id for owner display', () => {
    expect(getSkillRepositoryDisplayOwner(repository({ owner: { id: 'u1', handle: 'alice', displayName: 'Alice' } }))).toBe('alice')
    expect(getSkillRepositoryDisplayOwner(repository({ owner: { id: 'u1', handle: null, displayName: 'Alice' } }))).toBe('Alice')
    expect(getSkillRepositoryDisplayOwner(repository({ owner: { id: 'u1', handle: null, displayName: null } }))).toBe('u1')
  })

  it('protects root SKILL.md only', () => {
    expect(isProtectedSkillRepositoryPath('SKILL.md')).toBe(true)
    expect(isProtectedSkillRepositoryPath('skill.md')).toBe(true)
    expect(isProtectedSkillRepositoryPath('docs/SKILL.md')).toBe(false)
  })
})

function repository(overrides: Partial<SkillRepositoryDetailDto> = {}): SkillRepositoryDetailDto {
  return {
    id: 'repo-1',
    name: 'demo-skill',
    title: 'Demo Skill',
    description: null,
    visibility: 'private',
    status: 'active',
    owner: { id: 'user-1', handle: 'alice', displayName: 'Alice' },
    forkedFromRepositoryId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    lastSyncedAt: '2026-07-02T00:00:00.000Z',
    files: [
      file('skill', 'SKILL.md'),
      file('readme', 'README.md'),
      file('usage', 'docs/usage.md'),
    ],
    ...overrides,
  }
}

function file(id: string, path: string) {
  return {
    id,
    path,
    size: 10,
    sha256: id,
    kind: 'text' as const,
    mimeType: 'text/markdown',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
  }
}
