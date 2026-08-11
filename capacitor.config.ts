import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.d4820.deltaforce.tacticalmap',
  appName: '三角洲战术地图',
  webDir: 'dist',
  backgroundColor: '#0e1112',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0e1112',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
}

export default config
