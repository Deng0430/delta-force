/**
 * Electron 主进程（打包壳）
 * - 内置微型静态服务器加载 dist/ 产物：无需修改 vite base，绝对路径 /assets 资源可用
 * - 数据持久化沿用页面内 localStorage（userData 目录）
 */
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const PORT = 37421
let server = null

/** 启动静态服务器，托管 dist 目录 */
function startServer(distDir) {
  return new Promise((resolve, reject) => {
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
    }
    server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
        if (urlPath === '/') urlPath = '/index.html'
        // 防目录穿越
        const filePath = path.normalize(path.join(distDir, urlPath))
        if (!filePath.startsWith(distDir)) {
          res.writeHead(403).end('Forbidden')
          return
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404).end('Not Found')
            return
          }
          const ext = path.extname(filePath).toLowerCase()
          res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' })
          res.end(data)
        })
      } catch (e) {
        res.writeHead(500).end('Server Error')
      }
    })
    server.on('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

app.whenReady().then(async () => {
  // 开发模式：加载本地 Vite dev server；打包模式：内置服务器加载 dist
  const isDev = !app.isPackaged
  let url
  if (isDev) {
    // 与 start-server.bat 保持同一来源，避免 localhost / 127.0.0.1
    // 各自拥有独立 localStorage，导致编辑器配置无法同步到正式版。
    url = 'http://127.0.0.1:5173'
  } else {
    // 打包模式：dist 在 resources/dist（extraResources 输出到 asar 外）
    const distDir = path.join(process.resourcesPath, 'dist')
    await startServer(distDir)
    url = `http://127.0.0.1:${PORT}`
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '三角洲行动 · 全面战场攻防战术地图',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.loadURL(url)
})

app.on('window-all-closed', () => {
  if (server) server.close()
  app.quit()
})
