import { describe, expect, it } from 'vitest'

import {
  buildDashboardRedirectPath,
  buildDashboardSignInUrl,
  isRootPublicDashboardRedirect,
  normalizeDashboardRedirect,
} from './dashboard-redirect'

describe('buildDashboardRedirectPath', () => {
  it('keeps search and hash from the current location', () => {
    expect(buildDashboardRedirectPath({
      pathname: '/console/skill-repositories/repo-1',
      search: '?tab=files',
      hash: '#retry',
    })).toBe('/console/skill-repositories/repo-1?tab=files#retry')
  })
})

describe('buildDashboardSignInUrl', () => {
  it('uses the console auth route and preserves the current public path', () => {
    expect(buildDashboardSignInUrl({
      pathname: '/share/shr_public',
      search: '?view=code',
      hash: '#line-1',
    })).toBe('/console/sign-in?redirect=%2Fshare%2Fshr_public%3Fview%3Dcode%23line-1')
  })

  it('removes share passwords before encoding the login redirect', () => {
    expect(buildDashboardSignInUrl({
      pathname: '/share/shr_public/items/file-1',
      search: '?password=secret&view=code',
      hash: '#line-1',
    })).toBe('/console/sign-in?redirect=%2Fshare%2Fshr_public%2Fitems%2Ffile-1%3Fview%3Dcode%23line-1')
  })

  it('removes share passwords from console share login redirects', () => {
    expect(buildDashboardSignInUrl({
      pathname: '/console/share/shr_public/items/file-1',
      search: '?password=secret&view=code',
      hash: '#line-1',
    })).toBe('/console/sign-in?redirect=%2Fconsole%2Fshare%2Fshr_public%2Fitems%2Ffile-1%3Fview%3Dcode%23line-1')
  })
})

describe('normalizeDashboardRedirect', () => {
  it('strips the console basepath from redirects', () => {
    expect(normalizeDashboardRedirect('/console/users?page=2')).toBe(
      '/users?page=2'
    )
    expect(normalizeDashboardRedirect('/console')).toBe('/')
  })

  it('keeps legacy dashboard redirects normalized', () => {
    expect(normalizeDashboardRedirect('/dashboard/users?page=2')).toBe(
      '/users?page=2'
    )
    expect(normalizeDashboardRedirect('/dashboard')).toBe('/')
  })

  it('keeps router-relative redirects unchanged', () => {
    expect(normalizeDashboardRedirect('/settings')).toBe('/settings')
  })

  it('rejects external redirects', () => {
    expect(normalizeDashboardRedirect('https://example.com/dashboard/users')).toBeUndefined()
  })
})

describe('isRootPublicDashboardRedirect', () => {
  it('recognizes share redirects that must leave the console router', () => {
    expect(isRootPublicDashboardRedirect('/share/shr_public')).toBe(true)
    expect(isRootPublicDashboardRedirect('/share/shr_public/items/file')).toBe(true)
    expect(isRootPublicDashboardRedirect('/console/share/shr_public')).toBe(true)
  })

  it('keeps console-owned routes inside the router', () => {
    expect(isRootPublicDashboardRedirect('/settings')).toBe(false)
    expect(isRootPublicDashboardRedirect('/console/settings')).toBe(false)
  })
})
