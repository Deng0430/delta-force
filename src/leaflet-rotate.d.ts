import 'leaflet'

declare module 'leaflet' {
  interface MapOptions {
    rotate?: boolean
    bearing?: number
    rotateControl?: boolean | { position?: ControlPosition; closeOnZeroBearing?: boolean }
    touchRotate?: boolean
  }

  interface Map {
    setBearing(bearing: number): void
    getBearing(): number
  }
}

declare module 'leaflet-rotate'
