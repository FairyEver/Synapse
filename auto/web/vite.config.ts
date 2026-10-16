import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 19761,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:19760',
      '/events': {
        target: 'http://127.0.0.1:19760',
        ws: false,
      },
    },
  },
})
