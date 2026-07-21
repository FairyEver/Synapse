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

export function resolveLegacyDashboardDevRedirect(pathname: string) {
  if (pathname === '/dashboard') return '/console/'
  if (pathname === '/dashboard/') return '/console/'
  if (pathname.startsWith('/dashboard/')) return `/console/${pathname.slice('/dashboard/'.length)}`
  return null
}

export function resolveDashboardDevSpaFallback(pathname: string) {
  if (isDriveBrowserSpaPath(pathname)) return '/console/'
  return null
}

export function resolveDesktopUpdateDevHtmlPath(pathname: string) {
  return pathname === '/desktop/update' ? '/desktop-update.html' : null
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
        const desktopUpdateHtmlPath = resolveDesktopUpdateDevHtmlPath(parsedUrl.pathname)
        if (desktopUpdateHtmlPath) {
          request.url = `${desktopUpdateHtmlPath}${parsedUrl.search}`
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
