import { describe, expect, it } from 'vitest'
import type { ContentStoreItemDto } from '@synapse/shared'
import {
  canChangeMyContentVisibility,
  canCopyContent,
  canCopyPromptText,
  canDeleteMyContent,
  canInstallContent,
  canSetContentPublic,
} from './content-store-actions'

function item(overrides: Partial<ContentStoreItemDto> = {}): ContentStoreItemDto {
  return {
    id: 'content-1',
    type: 'skill',
    title: 'Deploy',
    description: 'Deploy helper',
    visibility: 'public',
    moderationStatus: 'normal',
    featured: false,
    owner: { id: 'owner-1', displayName: 'Ada' },
    latestVersionId: 'version-1',
    latestVersionNumber: 1,
    installCount: 0,
    copiedFromContentId: null,
    copiedFromVersionId: null,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('content store action helpers', () => {
  it('allows install for published Skill and Rule content', () => {
    expect(canInstallContent(item({ type: 'skill' }))).toBe(true)
    expect(canInstallContent(item({ type: 'rule' }))).toBe(true)
  })

  it('does not install Prompt, removed, or unpublished content', () => {
    expect(canInstallContent(item({ type: 'prompt' }))).toBe(false)
    expect(canInstallContent(item({ moderationStatus: 'removed' }))).toBe(false)
    expect(canInstallContent(item({ latestVersionId: null }))).toBe(false)
  })

  it('allows owner install for private Skill and Rule content', () => {
    expect(
      canInstallContent(
        item({ type: 'rule', visibility: 'private', owner: { id: 'user-1', displayName: null } }),
        'user-1'
      )
    ).toBe(true)
    expect(
      canInstallContent(
        item({ type: 'rule', visibility: 'private', owner: { id: 'user-1', displayName: null } }),
        'user-2'
      )
    ).toBe(false)
  })

  it('allows copy for all normal versioned content including Prompt', () => {
    expect(canCopyContent(item({ type: 'skill' }))).toBe(true)
    expect(canCopyContent(item({ type: 'rule' }))).toBe(true)
    expect(canCopyContent(item({ type: 'prompt' }))).toBe(true)
    expect(canCopyPromptText(item({ type: 'prompt' }))).toBe(true)
  })

  it('disables copy for removed or versionless content', () => {
    expect(canCopyContent(item({ moderationStatus: 'removed' }))).toBe(false)
    expect(canCopyContent(item({ latestVersionId: null }))).toBe(false)
  })

  it('only allows deleting private owned content from the shell', () => {
    expect(canDeleteMyContent(item({ visibility: 'private' }))).toBe(true)
    expect(canDeleteMyContent(item({ visibility: 'public' }))).toBe(false)
    expect(
      canDeleteMyContent(item({ visibility: 'private', moderationStatus: 'removed' }))
    ).toBe(false)
  })

  it('only allows changing visibility for normal content', () => {
    expect(canChangeMyContentVisibility(item({ moderationStatus: 'normal' }))).toBe(true)
    expect(canChangeMyContentVisibility(item({ moderationStatus: 'removed' }))).toBe(false)
  })

  it('only allows public visibility after a published version exists', () => {
    expect(canSetContentPublic(item({ latestVersionId: 'version-1' }))).toBe(true)
    expect(canSetContentPublic(item({ latestVersionId: null }))).toBe(false)
    expect(canSetContentPublic(item({ moderationStatus: 'removed' }))).toBe(false)
  })
})
