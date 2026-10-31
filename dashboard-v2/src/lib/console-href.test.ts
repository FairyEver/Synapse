import { describe, expect, it } from 'vitest'
import { consoleHref } from './console-href'
describe('canonical console links', () => {
  it('encodes path parameters and preserves filters without undefined query values', () => {
    expect(consoleHref('/webhooks/$webhookId', { params: { webhookId: 'hook/one' }, search: { page: 2, status: undefined } })).toBe('/console/webhooks/hook%2Fone?page=2')
    expect(consoleHref('/sign-in', { search: { redirect: '/drive/items/doc#thread' } })).toBe('/console/sign-in?redirect=%2Fdrive%2Fitems%2Fdoc%23thread')
  })
  it('rejects external navigation and incomplete paths', () => {
    expect(() => consoleHref('//other.example')).toThrow()
    expect(() => consoleHref('/webhooks/$webhookId')).toThrow('webhookId')
  })
})
