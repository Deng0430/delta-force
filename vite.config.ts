import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// demo/ 目录为本地录屏素材（.gitignore 忽略），存在时才加入构建入口
const demoEntries = {
  cinematicDemoV001: 'demo/v0.0.1/app/cinematic-demo.html',
  cinematicDemoV010: 'demo/v0.1.0/app/cinematic-demo.html',
  videoCoverV010: 'demo/v0.1.0/app/video-cover.html',
  videoCover4x3V010: 'demo/v0.1.0/app/video-cover-4x3.html',
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        modeConfig: 'mode-config.html',
        ...Object.fromEntries(Object.entries(demoEntries).filter(([, entry]) => existsSync(entry))),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})
