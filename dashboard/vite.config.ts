import path from 'path'
import { isDriveDiscussionNotificationOpenPath } from '@synapse/shared'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const localApiTarget = `http://localhost:${process.env.SYNAPSE_SERVER_API_PORT || '19701'}`

export function isDriveBrowserSpaPath(pathname: string) {
  if (pathname === '/drive' || pathname === '/drive/') return true
  if (pathname === '/console/drive') return true
  if (/^\/console\/drive\/folders\/[^/]+$/u.test(pathname)) return true
  if (/^\/drive\/items\/[^/]+$/u.test(pathname)) return true
  if (/^\/share\/[^/]+$/u.test(pathname)) return true
  return /^\/share\/[^/]+\/items\/[^/]+$/u.test(pathname)
}

export function isRetiredTeamRoutePath(pathname: string) {
  const normalized = pathname.replace(/\/$/u, '') || '/'
  // 邀请域永久下线
  if (/^(?:\/(?:admin|console|dashboard))?\/(?:team-invite|invitations)(?:\/.*)?$/u.test(normalized)) return true
  // 团队页只存在于管理后台；旧的控制台路径继续兜 404
  return /^\/(?:console|dashboard)\/teams(?:\/.*)?$/u.test(normalized)
}

export function resolveLegacyDashboardDevRedirect(pathname: string) {
  const normalized = pathname.replace(/\/$/u, '') || '/'
  const adminPaths = new Set([
    'system', 'users', 'devices', 'audit-logs',
    'problem-feedback', 'backup', 'admin-drive', 'logs', 'webhook-deliveries',
  ])
  if (normalized === '/dashboard') return '/console/'
  const dashboardPath = normalized.startsWith('/dashboard/') ? normalized.slice('/dashboard/'.length) : null
  const consolePath = normalized.startsWith('/console/') ? normalized.slice('/console/'.length) : null
  const legacyPath = dashboardPath ?? consolePath
  if (!legacyPath || !adminPaths.has(legacyPath)) return null
  return `/admin/${legacyPath === 'admin-drive' ? 'drive' : legacyPath}`
}

export function resolveDashboardDevSpaFallback(pathname: string) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return '/console/admin.html'
  if (pathname === '/console' || pathname.startsWith('/console/')) {
    const relativePath = pathname.slice('/console/'.length)
    const leafName = relativePath.split('/').at(-1) ?? ''
    if (relativePath.startsWith('@') || relativePath.startsWith('src/') || leafName.includes('.')) return null
    return '/console/index.html'
  }
  if (isDriveBrowserSpaPath(pathname) || isDriveDiscussionNotificationOpenPath(pathname)) return '/console/'
  return null
}

export function resolveDesktopUpdateDevHtmlPath(pathname: string, search = '') {
  if (pathname !== '/desktop/update') return null
  return search === '' ? '/console/desktop-update.html' : 'reject'
}

function driveBrowserHistoryFallback(): Plugin {
  return {
    name: 'synapse-drive-browser-history-fallback',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next()
          return
        }

        const parsedUrl = new URL(request.url ?? '/', 'http://localhost')
        if (isRetiredTeamRoutePath(parsedUrl.pathname)) {
          response.statusCode = 404
          response.end()
          return
        }
        const desktopUpdateHtmlPath = resolveDesktopUpdateDevHtmlPath(parsedUrl.pathname, parsedUrl.search)
        if (desktopUpdateHtmlPath === 'reject') {
          response.statusCode = 404
          response.end()
          return
        }
        if (desktopUpdateHtmlPath) {
          request.url = desktopUpdateHtmlPath
          next()
          return
        }

        const redirectPath = resolveLegacyDashboardDevRedirect(parsedUrl.pathname)
        if (redirectPath) {
          response.statusCode = 302
          response.setHeader('Location', `${redirectPath}${parsedUrl.search}`)
          response.end()
          return
        }

        const fallbackPath = resolveDashboardDevSpaFallback(parsedUrl.pathname)
        if (fallbackPath) {
          request.url = `${fallbackPath}${parsedUrl.search}`
        }
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/console/',
  plugins: [
    driveBrowserHistoryFallback(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 19700,
    strictPort: true,
    host: '::',
    proxy: {
      '/api': {
        target: localApiTarget,
        changeOrigin: true,
        ws: true,
      },
      '/webhooks': {
        target: localApiTarget,
        changeOrigin: true,
      },
      '/files': {
        target: localApiTarget,
        changeOrigin: true,
      },
      '/object': {
        target: localApiTarget,
        changeOrigin: true,
      },
      '/sites': {
        target: localApiTarget,
        changeOrigin: true,
      },
      '^/drive/items/[^/]+/(download|render)(?:\\?.*)?$': {
        target: localApiTarget,
        changeOrigin: true,
      },
      '^/share/[^/]+/(download|render)(?:\\?.*)?$': {
        target: localApiTarget,
        changeOrigin: true,
      },
      '^/share/[^/]+/items/[^/]+/(download|render)(?:\\?.*)?$': {
        target: localApiTarget,
        changeOrigin: true,
      },
      '^/share/[^/]+(?:/items/[^/]+)?/reader(?:\\?.*)?$': {
        target: localApiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'chrome80',
    rollupOptions: {
      input: {
        dashboard: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
        desktopUpdate: path.resolve(__dirname, 'desktop-update.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
