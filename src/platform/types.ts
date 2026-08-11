export type PlatformKind = 'web' | 'electron' | 'android'

export interface OpenPathOptions {
  target?: string
  features?: string
  replaceCurrent?: boolean
}

export interface PlatformAdapter {
  kind: PlatformKind
  isNative: boolean
  openPath(path: string, options?: OpenPathOptions): Window | null
  focusParentOrOpen(path: string, options?: OpenPathOptions): Window | null
  closeCurrentView(): void
  isFullscreen(): boolean
  toggleFullscreen(): Promise<void>
  downloadText(filename: string, text: string, mime?: string): Promise<void>
}
