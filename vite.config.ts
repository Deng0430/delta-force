import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// demo/ 目录为本地录屏素材（.gitignore 忽略），存在时才加入构建入口
const demoEntry = 'demo/v0.0.1/app/cinematic-demo.html'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        modeConfig: 'mode-config.html',
        ...(existsSync(demoEntry) ? { cinematicDemo: demoEntry } : {}),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})
