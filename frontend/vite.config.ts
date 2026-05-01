import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: process.env.VITE_DEV_HOST ?? '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        timeout: 0,
      },
      '/static': 'http://localhost:8000',
    },
  },
})
