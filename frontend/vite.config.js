
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const backendTarget =
  process.env.VITE_PROXY_TARGET || 'http://localhost:5000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },

      '/ws': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
