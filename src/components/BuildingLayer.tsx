import { useEffect, useMemo, useRef } from 'react'
import { Marker, Tooltip } from 'react-leaflet'
import * as L from 'leaflet'
import type { BuildingUnit, OperatorTeam, Side } from '../types'
import { teamOf } from '../config/operators'
import { buildingUnitOf } from '../config/buildingUnits'

const OWN_COLOR = '#01ff84'
const ENEMY_COLOR = '#e0453a'
const ROTATE_STEP = 15

function buildingIcon(building: BuildingUnit, view: Side): L.DivIcon {
  const meta = buildingUnitOf(building.kind)
  const own = building.side === view
  const sideColor = own ? OWN_COLOR : ENEMY_COLOR
  const team = building.team ? teamOf(building.team) : null
  const sideButton = `<button class="building-side" title="切换本方/敌方" aria-label="切换建筑阵营" onclick="event.stopPropagation();event.preventDefault();window.__buildingSide('${building.uid}')"><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5 1 6l2.5 2.5M8.5 3.5 11 6l-2.5 2.5M1 6h10"/></svg></button>`
  return L.divIcon({
    className: 'building-unit-wrap',
    html: `<span class="building-unit ${own ? 'own' : 'enemy'}" style="--building-side:${sideColor};--building-fill:${team?.color ?? sideColor}"><span class="building-side-ring"></span><span class="building-core"><img class="building-icon" src="${meta.iconUrl}" alt="" draggable="false" /></span>${sideButton}<button class="building-team-letter" title="${team ? `${team.name}（点击切换队伍）` : '无队伍（点击设置队伍）'}" aria-label="切换建筑所属队伍" onclick="event.stopPropagation();event.preventDefault();window.__buildingTeam('${building.uid}')">${team?.id ?? '–'}</button><span class="building-name">${meta.name}</span></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

function BuildingMarker({ building, view, interactive, onMove, onRotate, onToggleSide, onChangeTeam, onDelete }: {
  building: BuildingUnit
  view: Side
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleSide: (uid: string) => void
  onChangeTeam: (uid: string, team?: OperatorTeam) => void
  onDelete: (uid: string) => void
}) {
  const ref = useRef<L.Marker | null>(null)
  const rotationRef = useRef(building.rotation ?? 0)
  rotationRef.current = building.rotation ?? 0
  const icon = useMemo(() => buildingIcon(building, view), [building, view])

  useEffect(() => {
    const image = (ref.current?.getElement() as HTMLElement | null)?.querySelector<HTMLElement>('.building-icon')
    if (image) image.style.transform = `rotate(${building.rotation ?? 0}deg)`
  }, [building.rotation, icon])

  useEffect(() => {
    let element: HTMLElement | null = null
    let timer: number | undefined
    let disposed = false
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaY > 0 ? ROTATE_STEP : -ROTATE_STEP
      const next = (Math.round(rotationRef.current + delta) % 360 + 360) % 360
      rotationRef.current = next
      const image = element?.querySelector<HTMLElement>('.building-icon')
      if (image) image.style.transform = `rotate(${next}deg)`
      onRotate(building.uid, next)
    }
    const bind = () => {
      if (disposed) return
      element = (ref.current?.getElement() as HTMLElement | null) ?? null
      if (!element) {
        timer = window.setTimeout(bind, 40)
        return
      }
      element.addEventListener('wheel', handleWheel, { passive: false })
    }
    bind()
    return () => {
      disposed = true
      if (timer) window.clearTimeout(timer)
      element?.removeEventListener('wheel', handleWheel)
    }
  }, [building.uid, icon, onRotate])

  useEffect(() => {
    const target = window as unknown as {
      __buildingSide?: (uid: string) => void
      __buildingSideHandlers?: Record<string, () => void>
    }
    if (!target.__buildingSide) target.__buildingSide = (uid: string) => target.__buildingSideHandlers?.[uid]?.()
    if (!target.__buildingSideHandlers) target.__buildingSideHandlers = {}
    target.__buildingSideHandlers[building.uid] = () => onToggleSide(building.uid)
    return () => { if (target.__buildingSideHandlers) delete target.__buildingSideHandlers[building.uid] }
  }, [building.uid, onToggleSide])

  useEffect(() => {
    const target = window as unknown as {
      __buildingTeam?: (uid: string) => void
      __buildingTeamHandlers?: Record<string, () => void>
    }
    if (!target.__buildingTeam) target.__buildingTeam = (uid: string) => target.__buildingTeamHandlers?.[uid]?.()
    if (!target.__buildingTeamHandlers) target.__buildingTeamHandlers = {}
    target.__buildingTeamHandlers[building.uid] = () => {
      const order: Array<OperatorTeam | undefined> = [undefined, 'A', 'B', 'C', 'D', 'E']
      const index = order.indexOf(building.team)
      onChangeTeam(building.uid, order[(index + 1) % order.length])
    }
    return () => { if (target.__buildingTeamHandlers) delete target.__buildingTeamHandlers[building.uid] }
  }, [building.uid, building.team, onChangeTeam])

  return (
    <Marker
      ref={ref}
      position={[building.lat, building.lng]}
      icon={icon}
      draggable={interactive}
      interactive={interactive}
      zIndexOffset={640}
      eventHandlers={{
        dragend: (event) => {
          const point = event.target.getLatLng() as L.LatLng
          onMove(building.uid, point.lat, point.lng)
        },
        contextmenu: (event) => {
          L.DomEvent.stopPropagation(event)
          onDelete(building.uid)
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -16]}>{building.name} · {building.team ? `${building.team}队` : '无队伍'} · {building.side === view ? '本方' : '敌方'} · 滚轮旋转 · 右键删除</Tooltip>
    </Marker>
  )
}

export default function BuildingLayer({ buildings, view, interactive, onMove, onRotate, onToggleSide, onChangeTeam, onDelete }: {
  buildings: BuildingUnit[]
  view: Side
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleSide: (uid: string) => void
  onChangeTeam: (uid: string, team?: OperatorTeam) => void
  onDelete: (uid: string) => void
}) {
  return (
    <>
      {buildings.map((building) => (
        <BuildingMarker key={building.uid} building={building} view={view} interactive={interactive} onMove={onMove} onRotate={onRotate} onToggleSide={onToggleSide} onChangeTeam={onChangeTeam} onDelete={onDelete} />
      ))}
    </>
  )
}
