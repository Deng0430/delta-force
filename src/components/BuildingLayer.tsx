import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Tooltip, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { BuildingUnit, OperatorTeam, Side } from '../types'
import { teamOf } from '../config/operators'
import { buildingUnitOf } from '../config/buildingUnits'
import { platform } from '../platform'

const OWN_COLOR = '#01ff84'
const ENEMY_COLOR = '#e0453a'
const ROTATE_STEP = 15

function buildingIcon(building: BuildingUnit, view: Side, expanded: boolean): L.DivIcon {
  const meta = buildingUnitOf(building.kind)
  const own = building.side === view
  const sideColor = own ? OWN_COLOR : ENEMY_COLOR
  const team = building.team ? teamOf(building.team) : null
  const sideButton = `<button class="building-side" title="切换本方/敌方" aria-label="切换建筑阵营" onclick="event.stopPropagation();event.preventDefault();window.__buildingSide('${building.uid}')"><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5 1 6l2.5 2.5M8.5 3.5 11 6l-2.5 2.5M1 6h10"/></svg></button><button class="building-route" title="创建建筑行动路线" aria-label="创建建筑行动路线" onclick="event.stopPropagation();event.preventDefault();window.__buildingRoute('${building.uid}')"><i class="fa-solid fa-route" aria-hidden="true"></i></button>`
  const mobileControls = platform.kind === 'android'
    ? `<button type="button" class="building-rotate-control unit-rotate-drag" aria-label="按住并拖动旋转建筑" onmousedown="event.stopPropagation();event.preventDefault()" ontouchstart="event.stopPropagation();event.preventDefault()" onpointerdown="window.__buildingRotateStart(event,'${building.uid}')"><i class="fa-solid fa-rotate"></i></button><button type="button" class="building-delete-control danger" aria-label="删除建筑" onclick="event.stopPropagation();event.preventDefault();window.__buildingDelete('${building.uid}')"><i class="fa-regular fa-trash-can"></i></button>`
    : ''
  return L.divIcon({
    className: 'building-unit-wrap',
    html: `<span class="building-unit ${own ? 'own' : 'enemy'} ${expanded ? 'expanded' : ''}" style="--building-side:${sideColor};--building-fill:${team?.color ?? sideColor}"><span class="building-side-ring"></span><span class="building-core"><img class="building-icon" src="${meta.iconUrl}" alt="" draggable="false" /></span>${sideButton}<button class="building-team-letter" title="${team ? `${team.name}（点击切换队伍）` : '无队伍（点击设置队伍）'}" aria-label="切换建筑所属队伍" onclick="event.stopPropagation();event.preventDefault();window.__buildingTeam('${building.uid}')">${team?.id ?? '–'}</button>${mobileControls}<span class="building-name">${meta.name}</span></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

function BuildingMarker({ building, view, interactive, onMove, onRotate, onToggleSide, onChangeTeam, onDelete, onStartRoute }: {
  building: BuildingUnit
  view: Side
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleSide: (uid: string) => void
  onChangeTeam: (uid: string, team?: OperatorTeam) => void
  onDelete: (uid: string) => void
  onStartRoute: (uid: string) => void
}) {
  const ref = useRef<L.Marker | null>(null)
  const [expanded, setExpanded] = useState(false)
  const map = useMap()

  useEffect(() => {
    if (platform.kind !== 'android') return
    const collapse = () => setExpanded(false)
    const selectOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== building.uid) collapse()
    }
    map.on('click', collapse)
    window.addEventListener('mobile-unit-selected', selectOther)
    return () => {
      map.off('click', collapse)
      window.removeEventListener('mobile-unit-selected', selectOther)
    }
  }, [map, building.uid])
  const rotationRef = useRef(building.rotation ?? 0)
  rotationRef.current = building.rotation ?? 0
  const icon = useMemo(() => buildingIcon(building, view, expanded), [building, view, expanded])

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
    if (platform.kind !== 'android') return
    const target = window as unknown as {
      __buildingRotateStart?: (event: PointerEvent, uid: string) => void
      __buildingRotateStartHandlers?: Record<string, (event: PointerEvent) => void>
      __buildingDelete?: (uid: string) => void
      __buildingDeleteHandlers?: Record<string, () => void>
    }
    if (!target.__buildingRotateStart) target.__buildingRotateStart = (event, uid) => target.__buildingRotateStartHandlers?.[uid]?.(event)
    if (!target.__buildingRotateStartHandlers) target.__buildingRotateStartHandlers = {}
    if (!target.__buildingDelete) target.__buildingDelete = (uid) => target.__buildingDeleteHandlers?.[uid]?.()
    if (!target.__buildingDeleteHandlers) target.__buildingDeleteHandlers = {}
    target.__buildingRotateStartHandlers[building.uid] = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const marker = ref.current?.getElement()
      if (!marker) return
      ref.current?.dragging?.disable()
      const rect = marker.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const startPointerAngle = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI
      const startRotation = rotationRef.current
      let finalRotation = startRotation
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return
        moveEvent.preventDefault()
        const pointerAngle = Math.atan2(moveEvent.clientY - cy, moveEvent.clientX - cx) * 180 / Math.PI
        finalRotation = (startRotation + pointerAngle - startPointerAngle + 360) % 360
        rotationRef.current = finalRotation
        const image = marker.querySelector<HTMLElement>('.building-icon')
        if (image) image.style.transform = `rotate(${finalRotation}deg)`
      }
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== event.pointerId) return
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
        if (interactive) ref.current?.dragging?.enable()
        onRotate(building.uid, Math.round(finalRotation))
      }
      document.addEventListener('pointermove', move, { passive: false })
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }
    target.__buildingDeleteHandlers[building.uid] = () => onDelete(building.uid)
    return () => {
      if (target.__buildingRotateStartHandlers) delete target.__buildingRotateStartHandlers[building.uid]
      if (target.__buildingDeleteHandlers) delete target.__buildingDeleteHandlers[building.uid]
    }
  }, [building.uid, interactive, onRotate, onDelete])

  useEffect(() => {
    if (platform.kind !== 'android' || !interactive) return
    let element: HTMLElement | null = null
    let disposed = false
    let bindTimer: number | undefined
    const bind = () => {
      if (disposed) return
      element = ref.current?.getElement() ?? null
      if (!element) {
        bindTimer = window.setTimeout(bind, 40)
        return
      }
      element.addEventListener('pointerdown', onPointerDown, { passive: false })
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || (event.target as HTMLElement).closest('button')) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const marker = ref.current
      if (!marker) return
      const mapDraggingWasEnabled = map.dragging.enabled()
      if (mapDraggingWasEnabled) map.dragging.disable()
      marker.dragging?.disable()
      const pointerId = event.pointerId
      const startPointer = L.point(event.clientX, event.clientY)
      const startLatLng = marker.getLatLng()
      let moved = false
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        moveEvent.preventDefault()
        const delta = L.point(moveEvent.clientX, moveEvent.clientY).subtract(startPointer)
        if (delta.distanceTo(L.point(0, 0)) > 4) moved = true
        const origin = map.latLngToContainerPoint(startLatLng)
        marker.setLatLng(map.containerPointToLatLng(origin.add(delta)))
        marker.getElement()?.classList.add('mobile-unit-dragging')
      }
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
        marker.getElement()?.classList.remove('mobile-unit-dragging')
        if (mapDraggingWasEnabled) map.dragging.enable()
        if (moved) {
          const point = marker.getLatLng()
          onMove(building.uid, point.lat, point.lng)
          setExpanded(true)
        }
      }
      document.addEventListener('pointermove', move, { passive: false })
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }
    bind()
    return () => {
      disposed = true
      if (bindTimer) window.clearTimeout(bindTimer)
      element?.removeEventListener('pointerdown', onPointerDown)
    }
  }, [building.uid, interactive, map, onMove])

  useEffect(() => {
    const target = window as unknown as {
      __buildingRoute?: (uid: string) => void
      __buildingRouteHandlers?: Record<string, () => void>
    }
    if (!target.__buildingRoute) target.__buildingRoute = (uid) => target.__buildingRouteHandlers?.[uid]?.()
    if (!target.__buildingRouteHandlers) target.__buildingRouteHandlers = {}
    target.__buildingRouteHandlers[building.uid] = () => onStartRoute(building.uid)
    return () => {
      if (target.__buildingRouteHandlers) delete target.__buildingRouteHandlers[building.uid]
    }
  }, [building.uid, onStartRoute])

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
      draggable={interactive && platform.kind !== 'android'}
      interactive={interactive}
      zIndexOffset={640}
      eventHandlers={{
        click: (event) => {
          if (platform.kind === 'android') {
            L.DomEvent.stopPropagation(event)
            window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: building.uid }))
            setExpanded((value) => !value)
          }
        },
        dragstart: () => ref.current?.getElement()?.classList.add('mobile-unit-dragging'),
        dragend: (event) => {
          ref.current?.getElement()?.classList.remove('mobile-unit-dragging')
          const point = event.target.getLatLng() as L.LatLng
          onMove(building.uid, point.lat, point.lng)
          if (platform.kind === 'android') setExpanded(true)
        },
        contextmenu: (event) => {
          L.DomEvent.stopPropagation(event)
          onDelete(building.uid)
        },
      }}
    >
      <Tooltip direction="top" offset={platform.kind === 'android' ? [0, -64] : [0, -16]}>
        {building.name} · {platform.kind === 'android'
          ? '拖动移动 · 手柄旋转'
          : `${building.team ? `${building.team}队` : '无队伍'} · ${building.side === view ? '本方' : '敌方'} · 滚轮旋转 · 右键删除`}
      </Tooltip>
    </Marker>
  )
}

export default function BuildingLayer({ buildings, view, interactive, onMove, onRotate, onToggleSide, onChangeTeam, onDelete, onStartRoute }: {
  buildings: BuildingUnit[]
  view: Side
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleSide: (uid: string) => void
  onChangeTeam: (uid: string, team?: OperatorTeam) => void
  onDelete: (uid: string) => void
  onStartRoute: (uid: string) => void
}) {
  return (
    <>
      {buildings.map((building) => (
        <BuildingMarker key={building.uid} building={building} view={view} interactive={interactive} onMove={onMove} onRotate={onRotate} onToggleSide={onToggleSide} onChangeTeam={onChangeTeam} onDelete={onDelete} onStartRoute={onStartRoute} />
      ))}
    </>
  )
}
