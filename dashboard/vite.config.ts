import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export function isDriveBrowserSpaPath(pathname: string) {
  if (/^\/drive\/items\/[^/]+$/u.test(pathname)) return true
  if (/^\/drive\/items\/[^/]+\/items\/[^/]+$/u.test(pathname)) return true
  if (/^\/files\/[^/]+$/u.test(pathname)) return true
  return /^\/files\/[^/]+\/items\/[^/]+$/u.test(pathname)
}

function driveBrowserHistoryFallback(): Plugin {
  return {
    name: 'synapse-drive-browser-history-fallback',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next()
          return
        }

        const parsedUrl = new URL(request.url ?? '/', 'http://localhost')
        if (isDriveBrowserSpaPath(parsedUrl.pathname)) {
          request.url = `/console/${parsedUrl.search}`
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
      '^/drive/items/[^/]+/(download|zip|render)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/drive/items/[^/]+/items/[^/]+/(download|zip|render)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/files/[^/]+/(download|zip)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/files/[^/]+/items/[^/]+/(download|zip)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/files/[^/]+/[^/]+/download$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/pages': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/sites': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
