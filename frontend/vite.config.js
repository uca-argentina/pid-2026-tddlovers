/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Redirige /api/* al backend de Fastify, así el browser solo habla con
    // :5173: no hace falta configurar CORS y la cookie de sesión queda
    // same-origin en dev, igual que detrás de nginx en producción.
    proxy: {
      // VITE_BACKEND_URL permite que docker-compose apunte esto al servicio
      // `backend` en lugar de 127.0.0.1 cuando corre dentro de la red.
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
})
