import type { OpenPathOptions, PlatformAdapter, PlatformKind } from './types'

interface CapacitorBridge {
  getPlatform?: () => string
  isNativePlatform?: () => boolean
}

function capacitorBridge(): CapacitorBridge | undefined {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorBridge }).Capacitor
}

function detectPlatformKind(): PlatformKind {
  const demoParams = new URLSearchParams(window.location.search)
  if (import.meta.env.DEV && demoParams.get('platformDemo') === 'android') return 'android'
  if (demoParams.get('cinematicDemoFrame') === '1' && demoParams.get('platformDemo') === 'android') return 'android'
  const capacitor = capacitorBridge()
  if (capacitor?.getPlatform?.() === 'android') return 'android'
  if (/Electron/i.test(navigator.userAgent)) return 'electron'
  return 'web'
}

const kind = detectPlatformKind()

function openPath(path: string, options: OpenPathOptions = {}): Window | null {
  if (options.replaceCurrent || kind === 'android') {
    window.location.assign(path)
    return window
  }
  return window.open(path, options.target, options.features)
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen?.()
    return
  }
  await document.documentElement.requestFullscreen?.()
}

async function downloadText(filename: string, text: string, mime?: string): Promise<void> {
  if (kind === 'android' && capacitorBridge()?.isNativePlatform?.() === true) {
    try {
      const [{ Directory, Encoding, Filesystem }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
      ])
      const result = await Filesystem.writeFile({
        path: `exports/${Date.now()}_${filename}`,
        data: text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true,
      })
      await Share.share({
        title: filename,
        url: result.uri,
        dialogTitle: '导出到',
      })
    } catch (error) {
      // 用户关闭系统分享面板属于正常操作。
      if (!/cancel/i.test(String(error))) console.error('Android 文件导出失败', error)
    }
    return
  }

  const contentType = mime ?? (filename.toLowerCase().endsWith('.json') ? 'application/json' : 'text/html')
  const blob = new Blob([text], { type: `${contentType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  window.setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 100)
}

export const platform: PlatformAdapter = {
  kind,
  isNative: kind === 'electron' || capacitorBridge()?.isNativePlatform?.() === true,
  openPath,
  focusParentOrOpen(path, options) {
    if (kind !== 'android' && window.opener && !window.opener.closed) {
      window.opener.focus()
      return window.opener
    }
    return openPath(path, options)
  },
  closeCurrentView() {
    if (kind === 'android' && window.history.length > 1) window.history.back()
    else window.close()
  },
  isFullscreen: () => Boolean(document.fullscreenElement),
  toggleFullscreen,
  downloadText,
}

export type { OpenPathOptions, PlatformAdapter, PlatformKind } from './types'
