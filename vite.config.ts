import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        modeConfig: 'mode-config.html',
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})
