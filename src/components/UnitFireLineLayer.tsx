import { useCallback, useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { Marker, Polyline, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import type { BuildingUnit, OperatorUnit, Side, TeamMarker, VehicleItem } from '../types'
import { teamOf } from '../config/operators'

const FIRE_LINE_LENGTH = 56
// 箭头及其与兵棋中心的距离使用屏幕像素，避免地图缩放改变视觉尺寸。
const ARROW_TIP_DISTANCE_PX = 38
const ARROW_LENGTH_PX = 12
const ARROW_HALF_WIDTH_PX = 6

type FireLineUnit = {
  uid: string
  lat: number
  lng: number
  side: Side
  team?: import('../types').OperatorTeam
  rotation?: number
  fireLineEnabled?: boolean
  fireLineLength?: number
}

function pointAt(unit: FireLineUnit, distance: number): [number, number] {
  const angle = (unit.rotation ?? 0) * Math.PI / 180
  return [
    unit.lat + Math.cos(angle) * distance,
    unit.lng + Math.sin(angle) * distance,
  ]
}

function colorOf(unit: FireLineUnit, view: Side): string {
  return unit.team ? teamOf(unit.team).color : unit.side === view ? '#01ff84' : '#e0453a'
}

function UnitFireLineGraphic({ unit, color }: { unit: FireLineUnit; color: string }) {
  const map = useMap()
  const [previewPosition, setPreviewPosition] = useState<[number, number] | null>(null)
  const [previewRotation, setPreviewRotation] = useState<number | null>(null)
  const displayUnit = {
    ...unit,
    ...(previewPosition ? { lat: previewPosition[0], lng: previewPosition[1] } : {}),
    ...(previewRotation != null ? { rotation: previewRotation } : {}),
  }
  useEffect(() => {
    const onAnchorDrag = (event: Event) => {
      const detail = (event as CustomEvent<{ phase?: string; uid?: string; lat?: number; lng?: number }>).detail
      if (detail?.uid !== unit.uid) return
      if (detail.phase === 'move' && Number.isFinite(detail.lat) && Number.isFinite(detail.lng)) setPreviewPosition([detail.lat as number, detail.lng as number])
      if (detail.phase === 'end') setPreviewPosition(null)
    }
    window.addEventListener('desktop-unit-anchor-drag', onAnchorDrag)
    window.addEventListener('mobile-route-anchor-drag', onAnchorDrag)
    return () => {
      window.removeEventListener('desktop-unit-anchor-drag', onAnchorDrag)
      window.removeEventListener('mobile-route-anchor-drag', onAnchorDrag)
    }
  }, [unit.uid])
  useEffect(() => {
    const onRotationPreview = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; rotation?: number | null }>).detail
      if (detail?.uid !== unit.uid) return
      if (detail.rotation == null) setPreviewRotation(null)
      else if (Number.isFinite(detail.rotation)) setPreviewRotation(detail.rotation)
    }
    window.addEventListener('unit-rotation-preview', onRotationPreview)
    return () => window.removeEventListener('unit-rotation-preview', onRotationPreview)
  }, [unit.uid])
  const calculateTip = useCallback((): LatLngExpression => {
    const center = map.latLngToContainerPoint([displayUnit.lat, displayUnit.lng])
    const angle = ((displayUnit.rotation ?? 0) + map.getBearing()) * Math.PI / 180
    const forwardX = Math.sin(angle)
    const forwardY = -Math.cos(angle)
    const tip = center.add([forwardX * ARROW_TIP_DISTANCE_PX, forwardY * ARROW_TIP_DISTANCE_PX])
    return map.containerPointToLatLng(tip)
  }, [map, displayUnit.lat, displayUnit.lng, displayUnit.rotation])
  const [tip, setTip] = useState(calculateTip)
  const [bearing, setBearing] = useState(() => map.getBearing())
  const arrowIcon = useMemo(() => {
    const angle = (displayUnit.rotation ?? 0) + bearing
    const centerOffset = ARROW_TIP_DISTANCE_PX - ARROW_LENGTH_PX / 2
    return L.divIcon({
      className: 'unit-fire-line-arrow-icon',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
      html: `<span style="position:absolute;left:0;top:0;width:${ARROW_HALF_WIDTH_PX * 2}px;height:${ARROW_LENGTH_PX}px;background:${color};clip-path:polygon(50% 0,0 100%,100% 100%);transform:translate(-50%,-50%) rotate(${angle}deg) translateY(-${centerOffset}px);transform-origin:50% 50%;pointer-events:none"></span>`,
    })
  }, [bearing, color, displayUnit.rotation])

  useEffect(() => {
    const update = () => {
      setTip(calculateTip())
      setBearing(map.getBearing())
    }
    update()
    map.on('zoom zoomanim rotate resize viewreset', update)
    return () => {
      map.off('zoom zoomanim rotate resize viewreset', update)
    }
  }, [calculateTip, map])

  return <>
    <Marker position={[displayUnit.lat, displayUnit.lng]} icon={arrowIcon} interactive={false} keyboard={false} />
    <Polyline positions={[tip, pointAt(displayUnit, displayUnit.fireLineLength ?? FIRE_LINE_LENGTH)]} pathOptions={{ color, opacity: .92, weight: 2, dashArray: '7 6', interactive: false, className: 'unit-fire-line-path' }} />
  </>
}

export default function UnitFireLineLayer({ view, visible, operators, teams, vehicles, buildings }: {
  view: Side
  visible: boolean
  operators: OperatorUnit[]
  teams: TeamMarker[]
  vehicles: VehicleItem[]
  buildings: BuildingUnit[]
}) {
  if (!visible) return null
  const units: FireLineUnit[] = [
    ...operators.filter((unit) => unit.lat != null && unit.lng != null).map((unit) => ({ ...unit, lat: unit.lat!, lng: unit.lng! })),
    ...teams.filter((unit) => unit.lat != null && unit.lng != null).map((unit) => ({ ...unit, lat: unit.lat!, lng: unit.lng! })),
    ...vehicles,
    ...buildings,
  ].filter((unit) => unit.fireLineEnabled)

  return <>{units.map((unit) => <UnitFireLineGraphic key={unit.uid} unit={unit} color={colorOf(unit, view)} />)}</>
}
