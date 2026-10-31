import { describe, expect, it } from 'vitest'
import { resolveWebEntrypoint } from '@/lib/web-entrypoints'

// Exercise the actual SPA-selection policy, not deleted console component source.
describe('independent Drive browser entrypoints', () => {
  it.each([
    '/drive/items/document?surface=standalone',
    '/drive/items/folder',
    '/share/public-share',
    '/share/public-share/items/child',
  ])('serves the independent user/share reader for %s', (href) => {
    expect(resolveWebEntrypoint(href)).toEqual({ kind: 'html', filename: 'index.html' })
  })

  it.each(['console', 'dashboard'])('moves the %s embedded item link outside the console without losing discussion targets', (prefix) => {
    const result = resolveWebEntrypoint(`/${prefix}/drive/items/document?surface=console&threadId=discussion#comment`)
    expect(result).toEqual({
      kind: 'redirect',
      location: '/drive/items/document?surface=standalone&threadId=discussion#comment',
    })
  })

  it.each([
    '/console/drive?view=files',
    '/console/drive/folders/folder',
    '/dashboard/drive',
    '/admin/drive',
    '/admin/drive/storage',
    '/drive',
  ])('rejects the retired management/listing surface %s', (href) => {
    expect(resolveWebEntrypoint(href)).toEqual({ kind: 'not-found' })
  })

  it.each([
    '/drive/items/document/download',
    '/drive/items/document/render',
    '/share/public-share/reader',
    '/share/public-share/items/child/reader',
    '/share/public-share/items/child/download',
  ])('keeps server-rendered/download endpoint %s outside SPA fallback', (href) => {
    expect(resolveWebEntrypoint(href)).toEqual({ kind: 'pass' })
  })
})
