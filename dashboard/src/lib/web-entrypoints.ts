type WebEntrypoint =
  | { kind: 'not-found' }
  | { kind: 'pass' }
  | { kind: 'redirect'; location: string }
  | { kind: 'html'; filename: 'index.html' | 'admin.html' | 'desktop-update.html' }

/** Keep API downloads and zero-script readers outside the SPA fallback. */
export function resolveWebEntrypoint(href: string): WebEntrypoint {
  const url = new URL(href, 'http://synapse.local')
  const path = url.pathname.replace(/\/$/u, '') || '/'
  const legacyReader = /^\/(?:console|dashboard)\/drive\/(?:items|folders)\/([^/]+)$/u.exec(path)
  if (legacyReader) {
    url.searchParams.set('surface', 'standalone')
    return { kind: 'redirect', location: `/drive/items/${legacyReader[1]}${url.search}${url.hash}` }
  }
  if (/^\/(?:console|dashboard)\/drive(?:\/.*)?$/u.test(path) || path === '/drive' || /^\/admin\/drive(?:\/.*)?$/u.test(path)) return { kind: 'not-found' }
  if (/^(?:\/(?:admin|console|dashboard))?\/(?:team-invite|invitations)(?:\/.*)?$/u.test(path) || /^\/(?:console|dashboard)\/teams(?:\/.*)?$/u.test(path)) return { kind: 'not-found' }
  if (path === '/desktop/update') return url.search ? { kind: 'not-found' } : { kind: 'html', filename: 'desktop-update.html' }
  if (path === '/admin' || path.startsWith('/admin/')) return { kind: 'html', filename: 'admin.html' }
  if (path === '/dashboard' || path.startsWith('/dashboard/')) return { kind: 'redirect', location: `/console${path.slice('/dashboard'.length) || '/'}${url.search}` }
  if (/^\/drive\/items\/[^/]+$/u.test(path) || /^\/share\/[^/]+(?:\/items\/[^/]+)?$/u.test(path) || /^\/notifications\/[^/]+\/open$/u.test(path)) return { kind: 'html', filename: 'index.html' }
  if (path === '/' || path === '/console') return { kind: 'html', filename: 'index.html' }
  if (path.startsWith('/console/') && !path.split('/').some((part) => part.startsWith('@') || part.includes('.')) && !path.startsWith('/console/src/')) return { kind: 'html', filename: 'index.html' }
  return { kind: 'pass' }
}
