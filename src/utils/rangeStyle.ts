import type { CSSProperties } from 'react'

/** 为原生 range 提供跨 Chromium/WebView 一致的已完成区间填充。 */
export function rangeProgressStyle(value: number, min: number, max: number, accent?: string): CSSProperties {
  const progress = max === min ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  return {
    '--range-progress': `${progress}%`,
    ...(accent ? { '--range-accent': accent } : {}),
  } as CSSProperties
}
