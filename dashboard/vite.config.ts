import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

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
  if (normalized === '/team-invite') return true
  if (/^\/(?:console|dashboard)\/team-invite$/u.test(normalized)) return true
  return /^\/(?:admin|console|dashboard)\/(?:teams|invitations)(?:\/.*)?$/u.test(normalized)
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
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return '/admin.html'
  if (pathname === '/console' || pathname.startsWith('/console/')) return '/index.html'
  if (isDriveBrowserSpaPath(pathname)) return '/console/'
  return null
}

export function resolveDesktopUpdateDevHtmlPath(pathname: string, search = '') {
  if (pathname !== '/desktop/update') return null
  return search === '' ? '/desktop-update.html' : 'reject'
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
    port: 3000,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/webhooks': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/files': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/sites': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/drive/items/[^/]+/(download|render)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/share/[^/]+/(download|render)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/share/[^/]+/items/[^/]+/(download|render)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
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
