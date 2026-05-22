import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"

const apiPort = process.env.SYNAPSE_SERVER_API_PORT ?? "3001"
const apiTarget = `http://localhost:${apiPort}`
const dashboardBasePath = "/dashboard"

export function createDashboardBaseRedirectPlugin(): Plugin {
  return {
    name: "synapse-dashboard-base-redirect",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === dashboardBasePath) {
          response.writeHead(302, { Location: `${dashboardBasePath}/` })
          response.end()
          return
        }

        next()
      })
    },
  }
}

export default defineConfig({
  root: __dirname,
  base: `${dashboardBasePath}/`,
  plugins: [createDashboardBaseRedirectPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "../admin-dist",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/v1": { target: apiTarget, changeOrigin: true },
    },
  },
})
