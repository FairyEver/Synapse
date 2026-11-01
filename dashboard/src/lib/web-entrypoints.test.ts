import { describe, expect, it } from 'vitest'
import { resolveWebEntrypoint } from './web-entrypoints'

describe('Dashboard web entrypoints', () => {
  it.each(['/console/drive', '/console/drive?view=files', '/console/drive/folders', '/admin/drive', '/drive'])('retires cloud management without exposing a listing: %s', (url) => {
    expect(resolveWebEntrypoint(url)).toEqual({ kind: 'not-found' })
  })
  describe.each(['console', 'dashboard'])('legacy %s reader links', (prefix) => {
    it.each(['items', 'folders'])('moves %s links to the independent reader and retains comment targets', (kind) => {
      expect(resolveWebEntrypoint(`/${prefix}/drive/${kind}/doc?surface=console&threadId=thread#comment`)).toEqual({ kind: 'redirect', location: '/drive/items/doc?surface=standalone&threadId=thread#comment' })
    })
    it.each(['items', 'folders'])('accepts a trailing slash and preserves the encoded %s identifier', (kind) => {
      expect(resolveWebEntrypoint(`/${prefix}/drive/${kind}/doc%2F%E4%B8%AD/?view=code&versions=1#discussion=annotation&threadId=thread`)).toEqual({ kind: 'redirect', location: '/drive/items/doc%2F%E4%B8%AD?view=code&versions=1&surface=standalone#discussion=annotation&threadId=thread' })
    })
    it.each(['items', 'folders'])('does not mistake deeper %s paths for reader links', (kind) => {
      expect(resolveWebEntrypoint(`/${prefix}/drive/${kind}/doc/download`)).toEqual({ kind: 'not-found' })
    })
  })
  it.each(['/drive/items/doc?surface=standalone', '/share/token', '/share/token/items/child', '/notifications/notice/open'])('retains independent readers and notification links: %s', (url) => {
    expect(resolveWebEntrypoint(url)).toEqual({ kind: 'html', filename: 'index.html' })
  })
  it('keeps admin and game documents separate from the user console', () => {
    expect(resolveWebEntrypoint('/admin/users')).toEqual({ kind: 'html', filename: 'admin.html' })
    expect(resolveWebEntrypoint('/game/poker/rooms')).toEqual({ kind: 'html', filename: 'game.html' })
    expect(resolveWebEntrypoint('/console/settings')).toEqual({ kind: 'html', filename: 'index.html' })
    expect(resolveWebEntrypoint('/desktop/update')).toEqual({ kind: 'html', filename: 'desktop-update.html' })
    expect(resolveWebEntrypoint('/desktop/update?token=x')).toEqual({ kind: 'not-found' })
  })
  it.each(['/console/assets/app.js', '/drive/items/doc/download', '/share/token/render', '/share/token/reader', '/api/console/session'])('leaves assets and API/reader requests to their own handlers: %s', (url) => {
    expect(resolveWebEntrypoint(url)).toEqual({ kind: 'pass' })
  })
})
