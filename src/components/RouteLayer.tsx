import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleMarker, Marker, Polyline, Rectangle, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import * as L from 'leaflet'
import type { BuildingUnit, OperatorTeam, OperatorUnit, Side, TacticalRoute, TacticalRouteTarget, TeamMarker, VehicleItem } from '../types'
import { ORDER_STATUS_OPTIONS, orderStatusLabel, orderTypeOf, routeVisual } from '../config/routes'
import { teamOf } from '../config/operators'
import { genUid } from '../utils/geo'
import { platform } from '../platform'

export interface RouteSnapTarget extends TacticalRouteTarget {
  lat: number
  lng: number
  routeAnchor?: { routeUid: string; waypointIndex: number }
  binding?: {
    side: Side
    team: OperatorTeam
    operatorIds: string[]
    vehicleIds: string[]
  }
}

export type RouteDraftSource =
  | { kind: 'team'; teamUid: string }
  | { kind: 'operator'; operatorUid: string }
  | { kind: 'vehicle'; vehicleUid: string }
  | { kind: 'building'; buildingUid: string }
  | { kind: 'branch'; routeUid: string; waypointIndex: number }
  | null

interface RouteLayerProps {
  routes: TacticalRoute[]
  view: Side
  teams: TeamMarker[]
  operators: OperatorUnit[]
  vehicles: VehicleItem[]
  buildings: BuildingUnit[]
  snapTargets: RouteSnapTarget[]
  draftSource: RouteDraftSource
  selectedUid: string | null
  branchPicking: boolean
  interactive: boolean
  showRouteLabels: boolean
  onSelect: (uid: string | null) => void
  onBranchPoint: (waypointIndex: number) => void
  onDraftEnd: () => void
  onCreate: (route: TacticalRoute) => void
  onPatch: (uid: string, patch: Partial<TacticalRoute>) => void
  onDelete: (uid: string) => void
  onMoveAnchor: (route: TacticalRoute, lat: number, lng: number) => void
}

const waypointIconCache = new Map<string, L.DivIcon>()
const passiveWaypointIconCache = new Map<string, L.DivIcon>()
const routeMoveIconCache = new Map<string, L.DivIcon>()

const DESKTOP_ROUTE_DOUBLE_CLICK_MS = 420
const DESKTOP_ROUTE_CLICK_MOVE_TOLERANCE = 4
const DESKTOP_ROUTE_DOUBLE_CLICK_POSITION_TOLERANCE = 14
const DESKTOP_ROUTE_HIT_TOLERANCE = 14

const DESKTOP_ROUTE_HARD_CONTROL_SELECTOR = [
  '.route-editor-trigger-wrap',
  '.route-editor-panel',
  '.route-mobile-actions',
  '.leaflet-control',
  'button',
  'input',
  'select',
  'textarea',
].join(',')

const DESKTOP_ROUTE_HANDLE_SELECTOR = [
  '.route-waypoint-wrap',
  '.route-passive-node-wrap',
  '.route-move-wrap',
  '.route-order-label-wrap',
  '.route-label-toggle-marker-wrap',
  '.leaflet-marker-icon',
].join(',')

function routeLabelToggleIcon(visible: boolean): L.DivIcon {
  return L.divIcon({
    className: 'route-label-toggle-marker-wrap',
    html: `<button type="button" class="route-label-toggle-marker ${visible ? 'visible' : 'hidden'}" title="${visible ? '隐藏此路线标签' : '显示此路线标签'}" aria-label="${visible ? '隐藏此路线标签' : '显示此路线标签'}"><i class="fa-solid ${visible ? 'fa-eye' : 'fa-eye-slash'}" aria-hidden="true"></i></button>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function routeSideColor(side: TacticalRoute['side'], view: Side): string {
  return side === view ? '#01ff84' : '#e0453a'
}

function waypointIcon(index: number, total: number, color: string, teamColor: string, anchorMode: TacticalRoute['anchorMode']): L.DivIcon {
  const origin = index === 0
  const end = index === total - 1
  const label = origin ? (anchorMode === 'free' ? '起' : '⌁') : end ? '终' : String(index)
  const key = `${index}|${total}|${color}|${teamColor}|${anchorMode}`
  const cached = waypointIconCache.get(key)
  if (cached) return cached
  const icon = L.divIcon({
    className: `route-waypoint-wrap${origin ? ' origin' : ''}${end ? ' end' : ''}`,
    html: `<span class="route-waypoint" style="--route-node-color:${teamColor};--route-action-color:${color}">${label}</span>`,
    iconSize: origin || end ? [18, 18] : [16, 16],
    iconAnchor: origin || end ? [9, 9] : [8, 8],
  })
  waypointIconCache.set(key, icon)
  return icon
}

function passiveWaypointIcon(index: number, color: string, teamColor: string): L.DivIcon {
  const key = `${index}|${color}|${teamColor}`
  const cached = passiveWaypointIconCache.get(key)
  if (cached) return cached
  const icon = L.divIcon({
    className: 'route-passive-node-wrap',
    html: `<span class="route-passive-node" style="--route-node-color:${teamColor};--route-action-color:${color}">${index}</span>`,
    // The visible dot remains small, while the icon itself supplies a forgiving
    // hit area for hover, drag and context-menu actions.
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
  passiveWaypointIconCache.set(key, icon)
  return icon
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function routeLabelIcon(route: TacticalRoute, color: string, view: Side, operators: OperatorUnit[]): L.DivIcon {
  const type = orderTypeOf(route.orderType)
  const status = orderStatusLabel(route.status)
  const statusIcon = ORDER_STATUS_OPTIONS.find((item) => item.id === route.status)?.icon ?? 'fa-clipboard-list'
  const teamColor = teamOf(route.team).color
  const sideColor = routeSideColor(route.side, view)
  const teamOperators = operators.filter((operator) => operator.side === route.side && operator.team === route.team)
  const selectedOperators = teamOperators.filter((operator) => route.operatorIds.includes(operator.uid))
  const wholeTeam = teamOperators.length > 0 && teamOperators.every((operator) => route.operatorIds.includes(operator.uid))
  const executorText = wholeTeam
    ? route.team
    : selectedOperators.length === 1
      ? selectedOperators[0].name
      : selectedOperators.length > 1
        ? `${selectedOperators[0].name}+${selectedOperators.length - 1}`
        : route.vehicleIds.length > 0
          ? `载${route.vehicleIds.length}`
          : '—'
  const executorTitle = wholeTeam
    ? `${route.team}队全队`
    : selectedOperators.length > 0
      ? selectedOperators.map((operator) => operator.name).join('、')
      : route.vehicleIds.length > 0
        ? `${route.vehicleIds.length}辆载具`
        : '未指定执行单位'
  const affiliation = route.side === view ? '己方' : '敌方'
  const title = `${affiliation} · ${route.team}队 · ${executorTitle} · ${type.label} · ${status}`
  return L.divIcon({
      className: 'route-order-label-wrap',
      html: `<span class="route-order-label status-${route.status}" title="${escapeHtml(title)}" style="--route-label-color:${color};--route-team-color:${teamColor};--route-side-color:${sideColor}"><span class="route-executor-badge" title="${escapeHtml(executorTitle)}">${escapeHtml(executorText)}</span><span class="route-type-text" title="${escapeHtml(type.label)}">${route.orderType === 'hold' ? '<i class="fa-solid fa-shield" aria-hidden="true"></i>' : ''}${escapeHtml(type.label)}</span><em class="route-status-icon" title="${escapeHtml(status)}"><i class="fa-solid ${statusIcon}" aria-hidden="true"></i></em><button class="route-label-toggle" type="button" title="${route.showLabel === false ? '显示此路线标签' : '隐藏此路线标签'}" aria-label="${route.showLabel === false ? '显示此路线标签' : '隐藏此路线标签'}"><i class="fa-solid ${route.showLabel === false ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i></button></span>`,
    iconSize: [76, 20],
    iconAnchor: [38, 10],
  })
}

function routeLabelPosition(points: [number, number][]): [number, number] {
  const a = points[0]
  const b = points[1] ?? a
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function routeMoveIcon(color: string, teamColor: string): L.DivIcon {
  const key = `${color}|${teamColor}`
  const cached = routeMoveIconCache.get(key)
  if (cached) return cached
  const icon = L.divIcon({
    className: 'route-move-wrap',
    html: `<span class="route-move" style="--route-node-color:${teamColor};--route-action-color:${color}"><i class="fa-solid fa-up-down-left-right" aria-hidden="true"></i></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
  routeMoveIconCache.set(key, icon)
  return icon
}

function routeArrowIcon(route: TacticalRoute, color: string, bearing = 0): L.DivIcon {
  const end = route.waypoints.at(-1) ?? [0, 0]
  const prev = route.waypoints.at(-2) ?? end
  const angle = Math.atan2(-(end[0] - prev[0]), end[1] - prev[1]) * 180 / Math.PI + bearing
  return L.divIcon({
    className: 'route-arrow-wrap',
    html: `<span class="route-arrow type-${route.orderType}" style="--route-color:${color};transform:rotate(${angle}deg)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function routeCenter(points: [number, number][]): [number, number] {
  let lat = 0
  let lng = 0
  for (const point of points) {
    lat += point[0]
    lng += point[1]
  }
  return [lat / points.length, lng / points.length]
}

function smoothRoute(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points
  const result: [number, number][] = [points[0]]
  const steps = 12
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)]
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps, t2 = t * t, t3 = t2 * t
      result.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)])
    }
  }
  return result
}

function routeRenderPoints(route: TacticalRoute, points = route.waypoints): [number, number][] {
  return route.geometryType === 'curve' ? smoothRoute(points) : points
}

function snapPoint(map: L.Map, point: [number, number], targets: RouteSnapTarget[], threshold = 18) {
  const cp = map.latLngToContainerPoint(point)
  let best: RouteSnapTarget | undefined
  let bestDistance = threshold
  for (const target of targets) {
    if (target.routeAnchor) continue
    const distance = cp.distanceTo(map.latLngToContainerPoint([target.lat, target.lng]))
    if (distance <= bestDistance) {
      bestDistance = distance
      best = target
    }
  }
  return best
    ? { point: [best.lat, best.lng] as [number, number], target: { kind: best.kind, uid: best.uid, label: best.label } as TacticalRouteTarget, source: best }
    : { point, target: undefined, source: undefined }
}

function snapOriginPoint(map: L.Map, point: [number, number], targets: RouteSnapTarget[], routeUid: string, threshold = 20) {
  const cp = map.latLngToContainerPoint(point)
  let best: RouteSnapTarget | undefined
  let bestDistance = threshold
  let bestPriority = -1
  for (const target of targets) {
    if (target.routeAnchor?.routeUid === routeUid) continue
    const distance = cp.distanceTo(map.latLngToContainerPoint([target.lat, target.lng]))
    const priority = target.routeAnchor ? 2 : target.kind === 'point' ? 1 : 3
    if (distance < bestDistance - 2 || (Math.abs(distance - bestDistance) <= 2 && priority > bestPriority)) {
      bestDistance = distance
      bestPriority = priority
      best = target
    }
  }
  return best ? { point: [best.lat, best.lng] as [number, number], source: best } : { point, source: undefined }
}

function nearestSegmentIndex(map: L.Map, points: [number, number][], click: L.LatLng): number {
  const p = map.latLngToLayerPoint(click)
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length - 1; index++) {
    const a = map.latLngToLayerPoint(points[index])
    const b = map.latLngToLayerPoint(points[index + 1])
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
    const x = a.x + t * dx
    const y = a.y + t * dy
    const distance = (p.x - x) ** 2 + (p.y - y) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

function pointToSegmentDistanceSq(point: L.Point, start: L.Point, end: L.Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq))
  const x = start.x + ratio * dx
  const y = start.y + ratio * dy
  return (point.x - x) ** 2 + (point.y - y) ** 2
}

function RouteInput({ active, onPoint, onFinish, onCancel, onClearSelection, onHover }: {
  active: boolean
  onPoint: (point: [number, number]) => void
  onFinish: () => void
  onCancel: () => void
  onClearSelection: () => void
  /** 鼠标移动：路线绘制中的跟随预览（最后一个节点 → 当前光标） */
  onHover: (point: [number, number] | null) => void
}) {
  useMapEvents({
    click(e) {
      if (!active) {
        onClearSelection()
        return
      }
      if ((e.originalEvent as MouseEvent).detail > 1) return
      onPoint([e.latlng.lat, e.latlng.lng])
    },
    mousemove(e) {
      if (!active) return
      onHover([e.latlng.lat, e.latlng.lng])
    },
    dblclick(e) {
      if (!active) return
      L.DomEvent.stop(e.originalEvent)
      onFinish()
    },
    contextmenu(e) {
      if (!active) return
      L.DomEvent.stop(e.originalEvent)
      onFinish()
    },
  })

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onFinish()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onFinish, onCancel])
  return null
}

/** 选中路线的节点和整线拖动器；拖动预览直接更新 Leaflet 引用，dragend 才提交。 */
function SelectedRouteEditor({ route, interactive, showRouteLabels, view, operators, snapTargets, branchPicking, onBranchPoint, onPatch, onRestoreRouteFocus, onMoveAnchor }: {
  route: TacticalRoute
  interactive: boolean
  showRouteLabels: boolean
  view: Side
  operators: OperatorUnit[]
  snapTargets: RouteSnapTarget[]
  branchPicking: boolean
  onBranchPoint: (waypointIndex: number) => void
  onPatch: (uid: string, patch: Partial<TacticalRoute>) => void
  onRestoreRouteFocus: (uid: string) => void
  onMoveAnchor: (route: TacticalRoute, lat: number, lng: number) => void
}) {
  const map = useMap()
  const [mapBearing, setMapBearing] = useState(() => map.getBearing?.() ?? 0)
  useEffect(() => {
    const updateBearing = () => setMapBearing(map.getBearing?.() ?? 0)
    map.on('rotate', updateBearing)
    return () => { map.off('rotate', updateBearing) }
  }, [map])
  const visual = routeVisual(route, true)
  const teamColor = teamOf(route.team).color
  const [dragPreview, setDragPreview] = useState<[number, number][] | null>(null)
  const [dragLabelPreview, setDragLabelPreview] = useState<[number, number] | null>(null)
  const moveSession = useRef<{ center: L.LatLng; points: [number, number][] } | null>(null)
  const labelToggleMarkerRef = useRef<L.Marker | null>(null)
  const rawRenderedWaypoints = dragPreview ?? route.waypoints
  const renderedWaypoints = routeRenderPoints(route, rawRenderedWaypoints)
  const renderedLabelPosition = dragLabelPreview ?? route.labelPosition ?? routeLabelPosition(renderedWaypoints)
  // 使用绘制图形相同的自定义选中框，避免浏览器对 SVG 路径绘制原生焦点矩形。
  const selectionBounds = useMemo(() => {
    const bounds = L.latLngBounds(renderedWaypoints)
    const pad = 14
    const sw = map.latLngToContainerPoint(bounds.getSouthWest())
    const ne = map.latLngToContainerPoint(bounds.getNorthEast())
    return L.latLngBounds(
      map.containerPointToLatLng(L.point(sw.x - pad, sw.y + pad)),
      map.containerPointToLatLng(L.point(ne.x + pad, ne.y - pad)),
    )
  }, [map, renderedWaypoints])
  const offsetLabelTogglePosition = useCallback((position: L.LatLngExpression) => {
    const point = map.latLngToContainerPoint(position)
    return map.containerPointToLatLng(point.subtract([42, 0]))
  }, [map])
  const labelTogglePosition = useMemo(
    () => offsetLabelTogglePosition(renderedLabelPosition),
    [offsetLabelTogglePosition, renderedLabelPosition],
  )

  const updateWaypoint = useCallback((index: number, point: [number, number]) => {
    if (index === 0 && route.anchorMode !== 'free') return
    if (index === 0) {
      const snapped = snapOriginPoint(map, point, snapTargets, route.uid)
      const waypoints = route.waypoints.map((value, i) => (i === 0 ? snapped.point : value))
      const base: Partial<TacticalRoute> = {
        waypoints,
        anchorMode: 'free',
        anchorOperatorUid: undefined,
        anchorVehicleUid: undefined,
        anchorBuildingUid: undefined,
        teamMarkerUid: '',
        branchFromRouteUid: undefined,
        branchFromWaypointIndex: undefined,
      }
      const source = snapped.source
      if (source?.binding) {
        base.side = source.binding.side
        base.team = source.binding.team
        base.operatorIds = [...source.binding.operatorIds]
        base.vehicleIds = [...source.binding.vehicleIds]
      }
      if (source?.routeAnchor) {
        base.anchorMode = 'branch'
        base.branchFromRouteUid = source.routeAnchor.routeUid
        base.branchFromWaypointIndex = source.routeAnchor.waypointIndex
      } else if (source?.kind === 'team') {
        base.anchorMode = 'team'
        base.teamMarkerUid = source.uid
      } else if (source?.kind === 'operator') {
        base.anchorMode = 'operator'
        base.anchorOperatorUid = source.uid
      } else if (source?.kind === 'vehicle') {
        base.anchorMode = 'vehicle'
        base.anchorVehicleUid = source.uid
      } else if (source?.kind === 'building') {
        base.anchorMode = 'building'
        base.anchorBuildingUid = source.uid
      }
      onPatch(route.uid, base)
      return
    }
    const snapped = index === route.waypoints.length - 1 ? snapPoint(map, point, snapTargets) : { point, target: route.target }
    const waypoints = route.waypoints.map((value, i) => (i === index ? snapped.point : value))
    onPatch(route.uid, { waypoints, target: index === route.waypoints.length - 1 ? snapped.target : route.target })
  }, [map, route, snapTargets, onPatch])

  const deleteWaypoint = useCallback((index: number) => {
    if (index === 0 || route.waypoints.length <= 2) return
    const waypoints = route.waypoints.filter((_, i) => i !== index)
    onPatch(route.uid, { waypoints, target: index === route.waypoints.length - 1 ? undefined : route.target })
  }, [route, onPatch])

  const previewTranslate = useCallback((center: L.LatLng) => {
    const session = moveSession.current
    if (!session) return
    const dLat = center.lat - session.center.lat
    const dLng = center.lng - session.center.lng
    const points = session.points.map((point) => [point[0] + dLat, point[1] + dLng] as [number, number])
    setDragPreview(points)
    setDragLabelPreview(route.labelPosition ? [route.labelPosition[0] + dLat, route.labelPosition[1] + dLng] : null)
    onMoveAnchor(route, points[0][0], points[0][1])
    const anchor = route.anchorMode === 'operator' ? { kind: 'operator' as const, uid: route.anchorOperatorUid } : route.anchorMode === 'vehicle' ? { kind: 'vehicle' as const, uid: route.anchorVehicleUid } : route.anchorMode === 'building' ? { kind: 'building' as const, uid: route.anchorBuildingUid } : route.anchorMode === 'team' ? { kind: 'team' as const, uid: route.teamMarkerUid } : null
    if (anchor?.uid) window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', { detail: { phase: 'move', kind: anchor.kind, uid: anchor.uid, lat: points[0][0], lng: points[0][1] } }))
  }, [route, onMoveAnchor])

  const insertWaypoint = useCallback((event: L.LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(event)
    const index = nearestSegmentIndex(map, route.waypoints, event.latlng)
    const waypoints = [...route.waypoints]
    waypoints.splice(index + 1, 0, [event.latlng.lat, event.latlng.lng])
    onPatch(route.uid, { waypoints })
  }, [map, route, onPatch])

  return (
    <>
      <Rectangle
        bounds={selectionBounds}
        pathOptions={{ color: '#3f8cff', weight: 1.5, dashArray: '6 4', fillColor: '#3f8cff', fillOpacity: 0.04, opacity: 0.9, interactive: false, className: 'edit-selection-box' }}
      />
      {interactive && (
        <Marker
          ref={labelToggleMarkerRef}
          position={labelTogglePosition}
          icon={routeLabelToggleIcon(route.showLabel !== false)}
          interactive
          zIndexOffset={1300}
          eventHandlers={{
            click: (event) => {
              L.DomEvent.stopPropagation(event)
              onPatch(route.uid, { showLabel: route.showLabel === false })
            },
          }}
        />
      )}
      {showRouteLabels && route.showLabel !== false && (
        <Marker
          position={renderedLabelPosition}
          icon={routeLabelIcon(route, route.color, view, operators)}
          interactive={interactive}
          draggable={interactive}
          zIndexOffset={1250}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e)
            },
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng()
              onPatch(route.uid, { labelPosition: [ll.lat, ll.lng] })
              onRestoreRouteFocus(route.uid)
            },
            drag: (e) => {
              const ll = (e.target as L.Marker).getLatLng()
              labelToggleMarkerRef.current?.setLatLng(offsetLabelTogglePosition(ll))
            },
          }}
        />
      )}
      <Polyline positions={renderedWaypoints} pathOptions={{ ...visual, interactive: false, className: 'route-selected-line' }} />
      {platform.kind === 'android' && (
        <Polyline
          positions={renderedWaypoints}
          pathOptions={{ color: teamColor, weight: 24, opacity: 0, interactive, bubblingMouseEvents: false, className: 'route-hit-area route-selected-hit-area' }}
          pane="routeSelectedHitPane"
          eventHandlers={{ click: insertWaypoint } as unknown as L.LeafletEventHandlerFnMap}
        />
      )}
      <Marker position={renderedWaypoints.at(-1)!} icon={routeArrowIcon({ ...route, waypoints: renderedWaypoints }, visual.color, mapBearing)} interactive={false} zIndexOffset={950} />
      {rawRenderedWaypoints.map((point, index) => (
        <Marker
          key={`${route.uid}-${index}`}
          position={point}
          icon={waypointIcon(index, route.waypoints.length, visual.color, teamColor, route.anchorMode)}
          draggable={interactive && !branchPicking && (index > 0 || route.anchorMode === 'free')}
          bubblingMouseEvents={false}
          zIndexOffset={1100}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e)
              if (branchPicking) onBranchPoint(index)
              else if (platform.kind === 'android') deleteWaypoint(index)
            },
            contextmenu: (e) => {
              L.DomEvent.stop(e.originalEvent)
              deleteWaypoint(index)
            },
            dragstart: () => {
              setDragPreview(route.waypoints.map((waypoint) => [...waypoint] as [number, number]))
            },
            drag: (e) => {
              const ll = (e.target as L.Marker).getLatLng()
              setDragPreview(route.waypoints.map((waypoint, waypointIndex) => (
                waypointIndex === index ? [ll.lat, ll.lng] as [number, number] : waypoint
              )))
            },
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng()
              setDragPreview(null)
              updateWaypoint(index, [ll.lat, ll.lng])
              onRestoreRouteFocus(route.uid)
            },
          }}
        >
        </Marker>
      ))}
      {route.anchorMode !== 'branch' && (
        <Marker
          position={routeCenter(renderedWaypoints)}
          icon={routeMoveIcon(visual.color, teamColor)}
          draggable={interactive}
          bubblingMouseEvents={false}
          zIndexOffset={1200}
          eventHandlers={{
            click: (e) => L.DomEvent.stopPropagation(e),
            dragstart: (e) => {
              L.DomEvent.stopPropagation(e as L.LeafletEvent)
              moveSession.current = { center: (e.target as L.Marker).getLatLng(), points: route.waypoints.map((point) => [...point] as [number, number]) }
              setDragPreview(route.waypoints.map((point) => [...point] as [number, number]))
              setDragLabelPreview(route.labelPosition ? [...route.labelPosition] as [number, number] : null)
            },
            drag: (e) => previewTranslate((e.target as L.Marker).getLatLng()),
            dragend: (e) => {
              const center = (e.target as L.Marker).getLatLng()
              const session = moveSession.current
              moveSession.current = null
              setDragPreview(null)
              setDragLabelPreview(null)
              if (!session) return
              const dLat = center.lat - session.center.lat
              const dLng = center.lng - session.center.lng
              onPatch(route.uid, {
                waypoints: session.points.map((point) => [point[0] + dLat, point[1] + dLng] as [number, number]),
                labelPosition: route.labelPosition
                  ? [route.labelPosition[0] + dLat, route.labelPosition[1] + dLng]
                  : undefined,
                target: undefined,
              })
              const anchor = route.anchorMode === 'operator' ? { kind: 'operator' as const, uid: route.anchorOperatorUid } : route.anchorMode === 'vehicle' ? { kind: 'vehicle' as const, uid: route.anchorVehicleUid } : route.anchorMode === 'building' ? { kind: 'building' as const, uid: route.anchorBuildingUid } : route.anchorMode === 'team' ? { kind: 'team' as const, uid: route.teamMarkerUid } : null
              if (anchor?.uid) window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', { detail: { phase: 'end', kind: anchor.kind, uid: anchor.uid, lat: center.lat, lng: center.lng } }))
              onRestoreRouteFocus(route.uid)
            },
          }}
        >
        </Marker>
      )}
    </>
  )
}

export default function RouteLayer({ routes, view, teams, operators, vehicles, buildings, snapTargets, draftSource, selectedUid, branchPicking, interactive, showRouteLabels, onSelect, onBranchPoint, onDraftEnd, onCreate, onPatch, onDelete, onMoveAnchor }: RouteLayerProps) {
  const map = useMap()
  useEffect(() => {
    if (!map.getPane('routeSelectedHitPane')) {
      const pane = map.createPane('routeSelectedHitPane', map.getPane('overlayPane') ?? undefined)
      pane.style.zIndex = '550'
    }
  }, [map])
  const [mapBearing, setMapBearing] = useState(() => map.getBearing?.() ?? 0)
  useEffect(() => {
    const updateBearing = () => setMapBearing(map.getBearing?.() ?? 0)
    map.on('rotate', updateBearing)
    return () => { map.off('rotate', updateBearing) }
  }, [map])
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([])
  // 鼠标跟随预览：路线绘制中光标位置（最后一个节点到此点画虚线预览）
  const [draftHover, setDraftHover] = useState<[number, number] | null>(null)
  const [passiveDragPreview, setPassiveDragPreview] = useState<{ uid: string; waypoints: [number, number][] } | null>(null)
  const [hoveredRouteUid, setHoveredRouteUid] = useState<string | null>(null)
  const [anchorDragPreview, setAnchorDragPreview] = useState<{ kind: 'operator' | 'team' | 'vehicle' | 'building'; uid: string; point: [number, number] } | null>(null)
  const anchorDragFrameRef = useRef<number | null>(null)
  const pendingAnchorDragRef = useRef<{ kind: 'operator' | 'team' | 'vehicle' | 'building'; uid: string; point: [number, number] } | null>(null)
  const draftPointsRef = useRef<[number, number][]>([])
  const mobileActionsRef = useRef<HTMLDivElement | null>(null)
  const routeHitAreasRef = useRef(new Map<string, L.Polyline>())
  const restoreRouteFocus = useCallback((uid: string) => {
    window.requestAnimationFrame(() => {
      const element = routeHitAreasRef.current.get(uid)?.getElement() as HTMLElement | null | undefined
      element?.focus()
    })
  }, [])

  // 兵棋拖动只在 RouteLayer 内生成轻量预览，并按动画帧节流；最终数据仍在 dragend 提交。
  useEffect(() => {
    const eventName = 'mobile-route-anchor-drag'
    const onAnchorDrag = (event: Event) => {
      const detail = (event as CustomEvent<{
        phase: 'move' | 'end'
        kind: 'operator' | 'team' | 'vehicle' | 'building'
        uid: string
        lat: number
        lng: number
      }>).detail
      if (!detail) return
      if (detail.phase === 'end') {
        pendingAnchorDragRef.current = null
        if (anchorDragFrameRef.current != null) window.cancelAnimationFrame(anchorDragFrameRef.current)
        anchorDragFrameRef.current = null
        setAnchorDragPreview(null)
        return
      }
      pendingAnchorDragRef.current = { kind: detail.kind, uid: detail.uid, point: [detail.lat, detail.lng] }
      if (anchorDragFrameRef.current != null) return
      anchorDragFrameRef.current = window.requestAnimationFrame(() => {
        anchorDragFrameRef.current = null
        setAnchorDragPreview(pendingAnchorDragRef.current)
      })
    }
    window.addEventListener(eventName, onAnchorDrag)
    return () => {
      window.removeEventListener(eventName, onAnchorDrag)
      if (anchorDragFrameRef.current != null) window.cancelAnimationFrame(anchorDragFrameRef.current)
    }
  }, [])

  const previewWaypoints = useCallback((route: TacticalRoute): [number, number][] => {
    if (!anchorDragPreview) return route.waypoints
    const matches = anchorDragPreview.kind === 'operator'
      ? route.anchorMode === 'operator' && route.anchorOperatorUid === anchorDragPreview.uid
      : anchorDragPreview.kind === 'vehicle'
        ? route.anchorMode === 'vehicle' && route.anchorVehicleUid === anchorDragPreview.uid
      : anchorDragPreview.kind === 'building'
        ? route.anchorMode === 'building' && route.anchorBuildingUid === anchorDragPreview.uid
        : route.anchorMode === 'team' && route.teamMarkerUid === anchorDragPreview.uid
    return matches ? [anchorDragPreview.point, ...route.waypoints.slice(1)] : route.waypoints
  }, [anchorDragPreview])

  const draftContext = useMemo(() => {
    if (!draftSource) return null
    if (draftSource.kind === 'team') {
      const team = teams.find((item) => item.uid === draftSource.teamUid && item.lat != null && item.lng != null)
      if (!team || team.lat == null || team.lng == null) return null
      return { point: [team.lat, team.lng] as [number, number], side: team.side, team: team.team, teamMarkerUid: team.uid, name: `${team.name || `${team.team}队`}进攻指令`, parent: undefined as TacticalRoute | undefined }
    }
    if (draftSource.kind === 'operator') {
      const operator = operators.find((item) => item.uid === draftSource.operatorUid && item.lat != null && item.lng != null)
      if (!operator || operator.lat == null || operator.lng == null) return null
      return { point: [operator.lat, operator.lng] as [number, number], side: operator.side, team: operator.team, teamMarkerUid: '', name: `${operator.name}任务`, parent: undefined as TacticalRoute | undefined, operator }
    }
    if (draftSource.kind === 'vehicle') {
      const vehicle = vehicles.find((item) => item.uid === draftSource.vehicleUid)
      if (!vehicle) return null
      return { point: [vehicle.lat, vehicle.lng] as [number, number], side: vehicle.side, team: vehicle.team ?? 'A', teamMarkerUid: '', name: `${vehicle.name}任务`, parent: undefined as TacticalRoute | undefined, vehicle }
    }
    if (draftSource.kind === 'building') {
      const building = buildings.find((item) => item.uid === draftSource.buildingUid)
      if (!building) return null
      return { point: [building.lat, building.lng] as [number, number], side: building.side, team: building.team ?? 'A', teamMarkerUid: '', name: `${building.name}行动`, parent: undefined as TacticalRoute | undefined, building }
    }
    const parent = routes.find((route) => route.uid === draftSource.routeUid)
    const point = parent?.waypoints[draftSource.waypointIndex]
    if (!parent || !point) return null
    return { point, side: parent.side, team: parent.team, teamMarkerUid: parent.teamMarkerUid, name: `${parent.name} · 分支`, parent }
  }, [draftSource, teams, operators, vehicles, buildings, routes])

  const desktopRouteClickRef = useRef<{ routeUid: string; at: number; point: L.Point } | null>(null)
  const desktopPointerDownRef = useRef<{
    pointerId: number
    point: L.Point
    hardControl: boolean
    routeHandle: boolean
  } | null>(null)
  const desktopRouteSuppressRef = useRef<{
    until: number
    point: L.Point
    clickPending: boolean
    doubleClickPending: boolean
  } | null>(null)
  const desktopRouteInteractionRef = useRef({
    routes,
    selectedUid,
    passiveDragPreview,
    interactive,
    branchPicking,
    draftActive: Boolean(draftContext),
    previewWaypoints,
    onPatch,
    onSelect,
  })
  desktopRouteInteractionRef.current = {
    routes,
    selectedUid,
    passiveDragPreview,
    interactive,
    branchPicking,
    draftActive: Boolean(draftContext),
    previewWaypoints,
    onPatch,
    onSelect,
  }

  // PC 端不再依赖同一个 SVG path 连续收到两次点击。路线选中后即使新挂载的
  // 顶点/移动手柄接住第二次点击，也可通过地图坐标命中同一路线并插入途经点。
  useEffect(() => {
    if (platform.kind === 'android') return
    const container = map.getContainer()

    const clearPendingClick = () => {
      desktopPointerDownRef.current = null
      desktopRouteClickRef.current = null
    }

    const eventPoint = (event: MouseEvent | PointerEvent) => map.mouseEventToContainerPoint(event as MouseEvent)

    const routeDistanceSq = (route: TacticalRoute, point: L.Point) => {
      const state = desktopRouteInteractionRef.current
      const rawPoints = state.passiveDragPreview?.uid === route.uid
        ? state.passiveDragPreview.waypoints
        : state.previewWaypoints(route)
      const renderedPoints = routeRenderPoints(route, rawPoints)
      if (renderedPoints.length < 2) return Number.POSITIVE_INFINITY
      let bestDistance = Number.POSITIVE_INFINITY
      let previous = map.latLngToContainerPoint(renderedPoints[0])
      for (let index = 1; index < renderedPoints.length; index += 1) {
        const next = map.latLngToContainerPoint(renderedPoints[index])
        bestDistance = Math.min(bestDistance, pointToSegmentDistanceSq(point, previous, next))
        previous = next
      }
      return bestDistance
    }

    const hitRoute = (point: L.Point, preferredUid?: string) => {
      const state = desktopRouteInteractionRef.current
      const thresholdSq = DESKTOP_ROUTE_HIT_TOLERANCE ** 2
      if (preferredUid) {
        const preferred = state.routes.find((route) => route.uid === preferredUid)
        if (preferred && routeDistanceSq(preferred, point) <= thresholdSq) return preferred
      }

      let bestRoute: TacticalRoute | null = null
      let bestDistance = Number.POSITIVE_INFINITY
      let selectedRoute: TacticalRoute | null = null
      let selectedDistance = Number.POSITIVE_INFINITY
      for (const route of state.routes) {
        const distance = routeDistanceSq(route, point)
        if (route.uid === state.selectedUid) {
          selectedRoute = route
          selectedDistance = distance
        }
        if (distance < bestDistance) {
          bestDistance = distance
          bestRoute = route
        }
      }
      if (selectedRoute && selectedDistance <= thresholdSq && selectedDistance <= bestDistance + 4) return selectedRoute
      return bestRoute && bestDistance <= thresholdSq ? bestRoute : null
    }

    const suppressEvent = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const onPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) {
        desktopPointerDownRef.current = null
        return
      }
      const target = event.target instanceof Element ? event.target : null
      desktopPointerDownRef.current = {
        pointerId: event.pointerId,
        point: eventPoint(event),
        hardControl: Boolean(target?.closest(DESKTOP_ROUTE_HARD_CONTROL_SELECTOR)),
        routeHandle: Boolean(target?.closest(DESKTOP_ROUTE_HANDLE_SELECTOR)),
      }
    }

    const onPointerUpCapture = (event: PointerEvent) => {
      const down = desktopPointerDownRef.current
      desktopPointerDownRef.current = null
      if (!down || event.pointerId !== down.pointerId || event.button !== 0 || !event.isPrimary) return

      const state = desktopRouteInteractionRef.current
      if (!state.interactive || state.branchPicking || state.draftActive || state.passiveDragPreview) {
        desktopRouteClickRef.current = null
        return
      }
      const point = eventPoint(event)
      if (down.point.distanceTo(point) > DESKTOP_ROUTE_CLICK_MOVE_TOLERANCE || down.hardControl) {
        desktopRouteClickRef.current = null
        return
      }

      const now = performance.now()
      const pending = desktopRouteClickRef.current
      // 已经存在第一次路线点击时，允许第二次落在选中后才出现的路线手柄上。
      if (!pending && down.routeHandle) return
      const route = hitRoute(point, pending?.routeUid)
      if (!route) {
        desktopRouteClickRef.current = null
        return
      }

      if (
        pending
        && pending.routeUid === route.uid
        && now - pending.at <= DESKTOP_ROUTE_DOUBLE_CLICK_MS
        && pending.point.distanceTo(point) <= DESKTOP_ROUTE_DOUBLE_CLICK_POSITION_TOLERANCE
      ) {
        desktopRouteClickRef.current = null
        const latlng = map.containerPointToLatLng(point)
        const index = nearestSegmentIndex(map, route.waypoints, latlng)
        const waypoints = [...route.waypoints]
        waypoints.splice(index + 1, 0, [latlng.lat, latlng.lng])
        desktopRouteSuppressRef.current = {
          until: now + 500,
          point,
          clickPending: true,
          doubleClickPending: true,
        }
        state.onPatch(route.uid, { waypoints })
        state.onSelect(route.uid)
        return
      }

      desktopRouteClickRef.current = { routeUid: route.uid, at: now, point }
    }

    const onClickCapture = (event: MouseEvent) => {
      const suppress = desktopRouteSuppressRef.current
      if (!suppress || performance.now() > suppress.until) {
        desktopRouteSuppressRef.current = null
        return
      }
      if (suppress.clickPending && suppress.point.distanceTo(eventPoint(event)) <= DESKTOP_ROUTE_DOUBLE_CLICK_POSITION_TOLERANCE + 4) {
        suppress.clickPending = false
        suppressEvent(event)
      }
    }

    const onDoubleClickCapture = (event: MouseEvent) => {
      const suppress = desktopRouteSuppressRef.current
      if (!suppress || performance.now() > suppress.until) {
        desktopRouteSuppressRef.current = null
        return
      }
      if (suppress.doubleClickPending && suppress.point.distanceTo(eventPoint(event)) <= DESKTOP_ROUTE_DOUBLE_CLICK_POSITION_TOLERANCE + 4) {
        suppress.doubleClickPending = false
        suppressEvent(event)
        desktopRouteSuppressRef.current = null
      }
    }

    container.addEventListener('pointerdown', onPointerDownCapture, true)
    container.addEventListener('pointerup', onPointerUpCapture, true)
    container.addEventListener('pointercancel', clearPendingClick, true)
    container.addEventListener('click', onClickCapture, true)
    container.addEventListener('dblclick', onDoubleClickCapture, true)
    window.addEventListener('blur', clearPendingClick)
    map.on('dragstart zoomstart rotatestart', clearPendingClick)
    return () => {
      container.removeEventListener('pointerdown', onPointerDownCapture, true)
      container.removeEventListener('pointerup', onPointerUpCapture, true)
      container.removeEventListener('pointercancel', clearPendingClick, true)
      container.removeEventListener('click', onClickCapture, true)
      container.removeEventListener('dblclick', onDoubleClickCapture, true)
      window.removeEventListener('blur', clearPendingClick)
      map.off('dragstart zoomstart rotatestart', clearPendingClick)
    }
  }, [map])

  useEffect(() => {
    if (!draftContext) {
      draftPointsRef.current = []
      setDraftPoints([])
      setDraftHover(null)
      return
    }
    const initial = [[...draftContext.point] as [number, number]]
    draftPointsRef.current = initial
    setDraftPoints(initial)
    setDraftHover(null)
    onSelect(null)
  }, [draftSource, draftContext?.point[0], draftContext?.point[1], onSelect])

  useEffect(() => {
    if (!draftContext) return
    const wasEnabled = map.doubleClickZoom.enabled()
    const wasDraggingEnabled = map.dragging.enabled()
    map.doubleClickZoom.disable()
    map.dragging.disable()
    return () => {
      if (wasEnabled) map.doubleClickZoom.enable()
      if (wasDraggingEnabled) map.dragging.enable()
    }
  }, [map, draftContext])

  useEffect(() => {
    const element = mobileActionsRef.current
    if (!draftContext || !element) return
    L.DomEvent.disableClickPropagation(element)
    L.DomEvent.disableScrollPropagation(element)
  }, [draftContext])

  const addPoint = useCallback((point: [number, number]) => {
    const next = [...draftPointsRef.current, point]
    draftPointsRef.current = next
    setDraftPoints(next)
  }, [])

  const cancelDraft = useCallback(() => {
    draftPointsRef.current = []
    setDraftPoints([])
    setDraftHover(null)
    onDraftEnd()
  }, [onDraftEnd])

  const undoDraftPoint = useCallback(() => {
    if (draftPointsRef.current.length <= 1) return
    const next = draftPointsRef.current.slice(0, -1)
    draftPointsRef.current = next
    setDraftPoints(next)
  }, [])

  const finishDraft = useCallback(() => {
    if (!draftContext || draftPointsRef.current.length < 2) {
      cancelDraft()
      return
    }
    const points = [...draftPointsRef.current]
    const snapped = snapPoint(map, points.at(-1)!, snapTargets)
    points[points.length - 1] = snapped.point
    const parent = draftContext.parent
    const operator = 'operator' in draftContext ? draftContext.operator : undefined
    const vehicle = 'vehicle' in draftContext ? draftContext.vehicle : undefined
    const building = 'building' in draftContext ? draftContext.building : undefined
    const defaultType = operator || vehicle ? 'move' : 'attack'
    const meta = parent ? orderTypeOf(parent.orderType) : orderTypeOf(defaultType)
    const route: TacticalRoute = {
      uid: genUid('route'),
      side: draftContext.side,
      team: draftContext.team,
      teamMarkerUid: draftContext.teamMarkerUid,
      anchorMode: parent ? 'branch' : operator ? 'operator' : vehicle ? 'vehicle' : building ? 'building' : 'team',
      anchorOperatorUid: operator?.uid,
      anchorVehicleUid: vehicle?.uid,
      anchorBuildingUid: building?.uid,
      name: draftContext.name,
      orderType: parent?.orderType ?? defaultType,
      status: 'planned',
      color: teamOf(draftContext.team).color,
      lineStyle: parent?.lineStyle ?? meta.lineStyle,
      geometryType: parent?.geometryType ?? 'straight',
      opacity: parent?.opacity ?? 0.92,
      strokeWidth: parent?.strokeWidth ?? 3.5,
      waypoints: points,
      operatorIds: operator ? [operator.uid] : [],
      vehicleIds: vehicle ? [vehicle.uid] : [],
      target: snapped.target,
      branchFromRouteUid: parent?.uid,
      branchFromWaypointIndex: draftSource?.kind === 'branch' ? draftSource.waypointIndex : undefined,
      createdAt: Date.now(),
    }
    onCreate(route)
    onSelect(route.uid)
    cancelDraft()
  }, [draftContext, draftSource, map, snapTargets, onCreate, onSelect, cancelDraft])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedUid || e.key !== 'Delete') return
      const target = e.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      onDelete(selectedUid)
      onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedUid, onDelete, onSelect])

  const selectedRouteBase = routes.find((route) => route.uid === selectedUid) ?? null
  const selectedRoute = selectedRouteBase
    ? { ...selectedRouteBase, waypoints: previewWaypoints(selectedRouteBase) }
    : null

  return (
    <>
      <RouteInput active={Boolean(draftContext)} onPoint={addPoint} onFinish={finishDraft} onCancel={cancelDraft} onClearSelection={() => onSelect(null)} onHover={setDraftHover} />
      {routes.map((route) => {
        const selected = route.uid === selectedUid
        const visual = routeVisual(route, selected)
        const type = orderTypeOf(route.orderType)
        const assignedOperatorNames = operators.filter((operator) => route.operatorIds.includes(operator.uid)).map((operator) => operator.name)
        const executorTooltip = assignedOperatorNames.length > 0
          ? assignedOperatorNames.join('、')
          : route.vehicleIds.length > 0
            ? `${route.vehicleIds.length}辆载具`
            : '未指定执行单位'
        const teamColor = teamOf(route.team).color
        const rawRenderedWaypoints = passiveDragPreview?.uid === route.uid ? passiveDragPreview.waypoints : previewWaypoints(route)
        const renderedWaypoints = routeRenderPoints(route, rawRenderedWaypoints)
        const selectedTooltipPosition = selected
          ? map.containerPointToLatLng(
              map.latLngToContainerPoint(L.latLngBounds(renderedWaypoints).getNorthEast()).add([10, -10]),
            )
          : undefined
        return (
          <Fragment key={route.uid}>
            <Polyline
              ref={(layer) => {
                if (layer) routeHitAreasRef.current.set(route.uid, layer)
                else routeHitAreasRef.current.delete(route.uid)
              }}
              positions={renderedWaypoints}
              pathOptions={{ color: teamColor, weight: platform.kind === 'android' ? 24 : 18, opacity: 0, interactive, bubblingMouseEvents: false, className: 'route-hit-area' }}
              eventHandlers={{
                mouseover: () => setHoveredRouteUid(route.uid),
                mouseout: () => setHoveredRouteUid((uid) => uid === route.uid ? null : uid),
                click: (e: L.LeafletMouseEvent) => {
                  L.DomEvent.stopPropagation(e)
                  onSelect(route.uid)
                },
                dblclick: (e: L.LeafletMouseEvent) => {
                  // Android 保留原有的双击隔离；PC 由地图容器的坐标级识别器处理，
                  // 避免路线选中后 DOM 命中目标变化造成原生 dblclick 丢失。
                  if (platform.kind === 'android') L.DomEvent.stop(e.originalEvent)
                },
              } as unknown as L.LeafletEventHandlerFnMap}
            >
              {platform.kind !== 'android' && !selected && (
                <Tooltip sticky direction="top" opacity={0.96}>
                  {type.label} · {orderStatusLabel(route.status)} · {route.name}<br />
                  {route.operatorIds.length} 干员 · {route.vehicleIds.length} 载具 · 双击线段插入途经点
                </Tooltip>
              )}
            </Polyline>
            {platform.kind !== 'android' && selected && hoveredRouteUid === route.uid && selectedTooltipPosition && (
              <Marker
                position={selectedTooltipPosition}
                icon={L.divIcon({ className: 'route-tooltip-anchor', iconSize: [1, 1], iconAnchor: [0, 0] })}
                interactive={false}
              >
                <Tooltip permanent direction="right" opacity={0.96}>
                  {type.label} · {orderStatusLabel(route.status)} · {route.name}<br />
                  {route.operatorIds.length} 干员 · {route.vehicleIds.length} 载具 · 双击线段插入途经点
                </Tooltip>
              </Marker>
            )}
            {!selected && (
              <Polyline positions={renderedWaypoints} pathOptions={{ ...visual, interactive: false }} />
            )}
            {!selected && <Marker position={renderedWaypoints.at(-1)!} icon={routeArrowIcon({ ...route, waypoints: renderedWaypoints }, visual.color, mapBearing)} interactive={false} zIndexOffset={700} />}
            {!selected && route.waypoints.slice(1, -1).map((point, offset) => {
              const index = offset + 1
              return (
              <Marker
                key={`${route.uid}-passive-${index}`}
                position={rawRenderedWaypoints[index] ?? point}
                icon={passiveWaypointIcon(index, visual.color, teamColor)}
                interactive={interactive}
                draggable={interactive}
                zIndexOffset={720}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e)
                    onSelect(route.uid)
                  },
                  contextmenu: (e) => {
                    L.DomEvent.stop(e.originalEvent)
                    if (route.waypoints.length <= 2) return
                    onPatch(route.uid, {
                      waypoints: route.waypoints.filter((_, waypointIndex) => waypointIndex !== index),
                      target: route.target,
                    })
                  },
                  dragstart: () => {
                    setPassiveDragPreview({ uid: route.uid, waypoints: route.waypoints.map((waypoint) => [...waypoint] as [number, number]) })
                  },
                  drag: (e) => {
                    const ll = (e.target as L.Marker).getLatLng()
                    setPassiveDragPreview({
                      uid: route.uid,
                      waypoints: route.waypoints.map((waypoint, waypointIndex) => (
                        waypointIndex === index ? [ll.lat, ll.lng] as [number, number] : waypoint
                      )),
                    })
                  },
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng()
                    const snapped = { point: [ll.lat, ll.lng] as [number, number], target: route.target }
                    const waypoints = route.waypoints.map((waypoint, waypointIndex) => (
                      waypointIndex === index ? snapped.point : waypoint
                    ))
                    onPatch(route.uid, { waypoints, target: route.target })
                    setPassiveDragPreview(null)
                    onSelect(route.uid)
                  },
                }}
              >
                {platform.kind !== 'android' && (
                  <Tooltip direction="top" offset={[0, -9]} opacity={0.94}>
                    {`途经点 ${index} · 拖动调整 · 右键删除`}
                  </Tooltip>
                )}
              </Marker>
              )
            })}
            {!selected && showRouteLabels && route.showLabel !== false && <Marker
              position={route.labelPosition ?? routeLabelPosition(renderedWaypoints)}
              icon={routeLabelIcon(route, route.color, view, operators)}
              interactive={interactive}
              draggable={interactive}
              zIndexOffset={760}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  const target = e.originalEvent.target as HTMLElement | null
                  if (target?.closest('.route-label-toggle')) {
                    onPatch(route.uid, { showLabel: route.showLabel === false })
                    return
                  }
                  onSelect(route.uid)
                },
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng()
                  onPatch(route.uid, { labelPosition: [ll.lat, ll.lng] })
                  onSelect(route.uid)
                  restoreRouteFocus(route.uid)
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -11]} opacity={0.94}>
                {`${route.side === view ? '己方' : '敌方'} · ${route.team}队 · ${executorTooltip} · ${type.label} · ${orderStatusLabel(route.status)}`}<br />
                拖动调整指令标签位置
              </Tooltip>
            </Marker>}
          </Fragment>
        )
      })}

      {selectedRoute && <SelectedRouteEditor route={selectedRoute} interactive={interactive} showRouteLabels={showRouteLabels} view={view} operators={operators} snapTargets={snapTargets} branchPicking={branchPicking} onBranchPoint={onBranchPoint} onPatch={onPatch} onRestoreRouteFocus={restoreRouteFocus} onMoveAnchor={onMoveAnchor} />}

      {draftContext && draftPoints.length > 0 && (
        <>
          <Polyline positions={draftPoints} pathOptions={{ color: teamOf(draftContext.team).color, weight: 4, dashArray: '8 6', opacity: 0.95 }} />
          {/* 鼠标跟随预览：最后一个节点 → 当前光标（浅色虚线，与已确立路径区分） */}
          {draftHover && (
            <Polyline
              positions={[draftPoints[draftPoints.length - 1], draftHover]}
              pathOptions={{ color: teamOf(draftContext.team).color, weight: 3, dashArray: '3 7', opacity: 0.5 }}
              interactive={false}
            />
          )}
          {draftPoints.map((point, index) => (
            <CircleMarker key={`draft-${index}`} center={point} radius={index === 0 ? 6 : 4} pathOptions={{ color: teamOf(draftContext.team).color, fillColor: '#111719', fillOpacity: 1, weight: 2 }} />
          ))}
          <Marker
            position={draftPoints[0]}
            icon={waypointIcon(
              0,
              draftPoints.length,
              draftContext.parent?.color ?? orderTypeOf('attack').color,
              teamOf(draftContext.team).color,
              draftContext.parent ? 'branch' : 'team',
            )}
            interactive={false}
          >
            <Tooltip permanent direction="top" offset={[0, -9]}>{platform.kind === 'android' ? '轻触地图添加途经点 · 使用下方按钮撤销、完成或取消' : '单击添加途经点 · 右键/双击/Enter 完成 · Esc 取消'}</Tooltip>
          </Marker>
        </>
      )}
      {draftContext && createPortal(
        <div ref={mobileActionsRef} className="route-mobile-actions" role="toolbar" aria-label="路线绘制控制" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={undoDraftPoint} disabled={draftPoints.length <= 1}>
            <i className="fa-solid fa-rotate-left" aria-hidden="true" /> 撤销节点
          </button>
          <button type="button" className="primary" onClick={(event) => { event.stopPropagation(); finishDraft() }} disabled={draftPoints.length < 2}>
            <i className="fa-solid fa-check" aria-hidden="true" /> 完成路线
          </button>
          <button type="button" className="danger" onClick={cancelDraft}>
            <i className="fa-solid fa-xmark" aria-hidden="true" /> 取消
          </button>
        </div>,
        map.getContainer(),
      )}
    </>
  )
}
