import { useEffect, useState } from 'react'
import { platform } from '../platform'

export interface DeviceType {
  platform: typeof platform.kind
  mobileLayout: boolean
  coarsePointer: boolean
}

function readDeviceType(): DeviceType {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const narrowScreen = window.matchMedia('(max-width: 900px)').matches
  return {
    platform: platform.kind,
    mobileLayout: platform.kind === 'android' || (coarsePointer && narrowScreen),
    coarsePointer,
  }
}

export function useDeviceType(): DeviceType {
  const [device, setDevice] = useState(readDeviceType)

  useEffect(() => {
    const queries = [window.matchMedia('(pointer: coarse)'), window.matchMedia('(max-width: 900px)')]
    const update = () => setDevice(readDeviceType())
    queries.forEach((query) => query.addEventListener('change', update))
    window.addEventListener('orientationchange', update)
    return () => {
      queries.forEach((query) => query.removeEventListener('change', update))
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return device
}
