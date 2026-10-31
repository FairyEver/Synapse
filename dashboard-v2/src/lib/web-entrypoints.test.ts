import { describe, expect, it } from 'vitest'
import { resolveWebEntrypoint } from './web-entrypoints'

describe('V2 web entrypoints', () => {
  it.each(['/console/drive', '/console/drive?view=files', '/console/drive/folders/root', '/admin/drive', '/drive'])('retires cloud management without exposing a listing: %s', (url) => {
    expect(resolveWebEntrypoint(url)).toEqual({ kind: 'not-found' })
  })
  it('moves legacy embedded file links outside the console and retains comment targets', () => {
    expect(resolveWebEntrypoint('/console/drive/items/doc?surface=console&threadId=thread#comment')).toEqual({ kind: 'redirect', location: '/drive/items/doc?surface=standalone&threadId=thread#comment' })
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
