import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"
import { defineConfig } from "vite"

const apiPort = process.env.SYNAPSE_SERVER_API_PORT ?? "3001"
const apiTarget = `http://localhost:${apiPort}`

export default defineConfig({
  root: __dirname,
  base: "/admin/",
  plugins: [react(), tailwindcss()],
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
    open: "/admin/",
    proxy: {
      "/admin/api": { target: apiTarget, changeOrigin: true },
      "/admin/session": { target: apiTarget, changeOrigin: true },
      "/admin/login": { target: apiTarget, changeOrigin: true },
      "/admin/logout": { target: apiTarget, changeOrigin: true },
      "/v1": { target: apiTarget, changeOrigin: true },
    },
  },
})
