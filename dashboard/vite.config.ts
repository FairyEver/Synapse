import path from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { resolveWebEntrypoint } from './src/lib/web-entrypoints'

function webEntrypoints(): Plugin {
  const install = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      const result = resolveWebEntrypoint(req.url ?? '/')
      if (result.kind === 'not-found') { res.statusCode = 404; res.end('页面不存在'); return }
      if (result.kind === 'redirect') { res.statusCode = 302; res.setHeader('Location', result.location); res.end(); return }
      if (result.kind === 'html') req.url = `/console/${result.filename}`
      next()
    })
  }
  return { name: 'synapse-dashboard-web-entrypoints', configureServer: install, configurePreviewServer: install }
}

const target = `http://localhost:${process.env.SYNAPSE_SERVER_API_PORT || '19701'}`
const dashboardPort = Number(process.env.SYNAPSE_DASHBOARD_PORT || 19700)
export default defineConfig({
  ...(dashboardPort !== 19700 ? { cacheDir: `node_modules/.vite-${dashboardPort}` } : {}),
  base: '/console/',
  plugins: [webEntrypoints(), tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    host: '::', port: dashboardPort, strictPort: true,
    open: process.env.SYNAPSE_DASHBOARD_OPEN === 'false' ? false : `http://localhost:${dashboardPort}/console/`,
    proxy: {
      '/api': { target, changeOrigin: true, ws: true },
      '/files': { target, changeOrigin: true },
      '/object': { target, changeOrigin: true },
      '/sites': { target, changeOrigin: true },
      '/webhooks': { target, changeOrigin: true },
      '^/drive/items/[^/]+/(download|render)(?:\\?.*)?$': { target, changeOrigin: true },
      '^/share/[^/]+(?:/items/[^/]+)?/(download|render|reader)(?:\\?.*)?$': { target, changeOrigin: true },
    },
  },
  preview: { host: '::', port: 19700, strictPort: true },
  build: { target: 'chrome80', rollupOptions: { input: {
    dashboard: path.resolve(__dirname, 'index.html'), admin: path.resolve(__dirname, 'admin.html'),
    desktopUpdate: path.resolve(__dirname, 'desktop-update.html'),
  } } },
})
