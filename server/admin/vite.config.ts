import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { defineConfig, type Plugin } from "vite"

const apiPort = process.env.SYNAPSE_SERVER_API_PORT ?? "3001"
const apiTarget = `http://localhost:${apiPort}`

export function createAdminBaseRedirectPlugin(): Plugin {
  return {
    name: "synapse-admin-base-redirect",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === "/admin") {
          response.writeHead(302, { Location: "/admin/" })
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
  base: "/admin/",
  plugins: [createAdminBaseRedirectPlugin(), react(), tailwindcss()],
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
      "/admin/api": { target: apiTarget, changeOrigin: true },
      "/admin/session": { target: apiTarget, changeOrigin: true },
      "/admin/login": { target: apiTarget, changeOrigin: true },
      "/admin/logout": { target: apiTarget, changeOrigin: true },
      "/v1": { target: apiTarget, changeOrigin: true },
    },
  },
})
