import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const redirectSource = readFileSync(new URL('../../public/share-reader-redirect.v1.js', import.meta.url), 'utf8')
const dashboardHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('legacy share reader redirect', () => {
  it('redirects a Chrome 91 capability profile before the dashboard app loads', () => {
    const replace = runRedirect({
      pathname: '/share/shr_public/items/file-1',
      search: '?password=secret',
      hash: '#section',
      missingCapability: 'registerProperty',
    })

    expect(replace).toHaveBeenCalledWith('/share/shr_public/items/file-1/reader?password=secret#section')
  })

  it('maps a share root to its reader route', () => {
    const replace = runRedirect({
      pathname: '/share/shr_public',
      search: '?password=secret',
      hash: '#section',
      missingCapability: 'registerProperty',
    })

    expect(replace).toHaveBeenCalledWith('/share/shr_public/reader?password=secret#section')
  })

  it.each([
    'Promise',
    'fetch',
    'AbortController',
    'ResizeObserver',
    'URL',
    'URLSearchParams',
    'crypto',
    'getRandomValues',
    'CSS',
    'supports',
    'registerProperty',
    'oklch',
    'color-mix',
  ] satisfies readonly MissingCapability[])('redirects when %s is unavailable', (missingCapability) => {
    const replace = runRedirect({ pathname: '/share/shr_public', missingCapability })

    expect(replace).toHaveBeenCalledWith('/share/shr_public/reader')
  })

  it('keeps capable browsers on the full share page', () => {
    const replace = runRedirect({ pathname: '/share/shr_public' })

    expect(replace).not.toHaveBeenCalled()
  })

  it.each([
    '/console/',
    '/share/shr_public/reader',
    '/share/shr_public/download',
    '/share/shr_public/render',
    '/share/shr_public/items/file-1/reader',
    '/share/shr_public/items/file-1/download',
    '/share/shr_public/items/file-1/render',
  ])('does not redirect non-canonical share path %s', (pathname) => {
    expect(runRedirect({ pathname, missingCapability: 'registerProperty' })).not.toHaveBeenCalled()
  })

  it('keeps the detector parseable as an ES5 classic script', () => {
    expect(redirectSource).not.toMatch(/\b(?:const|let)\b|=>|\?\.|`/u)
  })

  it('loads the detector before the dashboard module', () => {
    expect(dashboardHtml.indexOf('/console/share-reader-redirect.v1.js'))
      .toBeLessThan(dashboardHtml.indexOf('type="module"'))
  })
})

type MissingCapability =
  | 'Promise'
  | 'fetch'
  | 'AbortController'
  | 'ResizeObserver'
  | 'URL'
  | 'URLSearchParams'
  | 'crypto'
  | 'getRandomValues'
  | 'CSS'
  | 'supports'
  | 'registerProperty'
  | 'oklch'
  | 'color-mix'

function runRedirect(input: {
  readonly pathname: string
  readonly search?: string
  readonly hash?: string
  readonly missingCapability?: MissingCapability
}) {
  const replace = vi.fn()
  const isAvailable = (capability: MissingCapability) => input.missingCapability !== capability
  const window = {
    Promise: isAvailable('Promise') ? Promise : undefined,
    fetch: isAvailable('fetch') ? () => undefined : undefined,
    AbortController: isAvailable('AbortController') ? function AbortController() {} : undefined,
    ResizeObserver: isAvailable('ResizeObserver') ? function ResizeObserver() {} : undefined,
    URL: isAvailable('URL') ? URL : undefined,
    URLSearchParams: isAvailable('URLSearchParams') ? URLSearchParams : undefined,
    crypto: isAvailable('crypto') ? { getRandomValues: isAvailable('getRandomValues') ? () => undefined : undefined } : undefined,
    CSS: isAvailable('CSS') ? {
      registerProperty: isAvailable('registerProperty') ? () => undefined : undefined,
      supports: isAvailable('supports') ? (_property: string, value: string) => {
        if (value === 'oklch(50% 0 0)') return isAvailable('oklch')
        if (value === 'color-mix(in oklab, black, white)') return isAvailable('color-mix')
        return true
      } : undefined,
    } : undefined,
    location: {
      pathname: input.pathname,
      search: input.search ?? '',
      hash: input.hash ?? '',
      replace,
    },
  }

  runInNewContext(redirectSource, { window })
  return replace
}
