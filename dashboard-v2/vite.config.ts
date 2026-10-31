import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '::',
    port: 19703,
    strictPort: true,
  },
  preview: {
    host: '::',
    port: 19703,
    strictPort: true,
  },
})
