import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import * as L from 'leaflet'
import type { OperatorTeam, OperatorUnit, Side, TacticalRoute, TacticalRouteTarget, TeamMarker, VehicleItem } from '../types'
import { ORDER_STATUS_OPTIONS, orderStatusLabel, orderTypeOf, routeVisual } from '../config/routes'
import { teamOf } from '../config/operators'
import { genUid } from '../utils/geo'

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
  | { kind: 'branch'; routeUid: string; waypointIndex: number }
  | null

interface RouteLayerProps {
  routes: TacticalRoute[]
  view: Side
  teams: TeamMarker[]
  operators: OperatorUnit[]
  vehicles: VehicleItem[]
  snapTargets: RouteSnapTarget[]
  draftSource: RouteDraftSource
  selectedUid: string | null
  branchPicking: boolean
  interactive: boolean
  onSelect: (uid: string | null) => void
  onBranchPoint: (waypointIndex: number) => void
  onDraftEnd: () => void
  onCreate: (route: TacticalRoute) => void
  onPatch: (uid: string, patch: Partial<TacticalRoute>) => void
  onDelete: (uid: string) => void
}

const waypointIconCache = new Map<string, L.DivIcon>()
const passiveWaypointIconCache = new Map<string, L.DivIcon>()
const routeMoveIconCache = new Map<string, L.DivIcon>()

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

function passiveWaypointIcon(index: number, color: string, teamColor: string, terminal: boolean): L.DivIcon {
  const key = `${index}|${color}|${teamColor}|${terminal}`
  const cached = passiveWaypointIconCache.get(key)
  if (cached) return cached
  const icon = L.divIcon({
    className: `route-passive-node-wrap${terminal ? ' end' : ''}`,
    html: `<span class="route-passive-node" style="--route-node-color:${teamColor};--route-action-color:${color}">${terminal ? '终' : index}</span>`,
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
  const executorClass = wholeTeam ? 'team' : selectedOperators.length === 1 ? 'single' : selectedOperators.length > 1 ? 'group' : route.vehicleIds.length > 0 ? 'vehicle' : 'none'
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
    html: `<span class="route-order-label status-${route.status}" title="${escapeHtml(title)}" style="--route-label-color:${color};--route-team-color:${teamColor};--route-side-color:${sideColor}"><span class="route-executor-badge ${executorClass}" title="${escapeHtml(executorTitle)}">${escapeHtml(executorText)}</span><span class="route-type-text" title="${escapeHtml(type.label)}">${escapeHtml(type.label)}</span><em class="route-status-icon" title="${escapeHtml(status)}"><i class="fa-solid ${statusIcon}" aria-hidden="true"></i></em></span>`,
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

function routeArrowIcon(route: TacticalRoute, teamColor: string): L.DivIcon {
  const end = route.waypoints.at(-1) ?? [0, 0]
  const prev = route.waypoints.at(-2) ?? end
  const angle = Math.atan2(-(end[0] - prev[0]), end[1] - prev[1]) * 180 / Math.PI
  const fixedHeading = route.orderType === 'hold'
  return L.divIcon({
    className: 'route-arrow-wrap',
    html: `<span class="route-arrow type-${route.orderType}" style="--route-color:${teamColor};transform:rotate(${fixedHeading ? 0 : angle}deg)">${route.orderType === 'hold' ? '<i class="fa-solid fa-shield" aria-hidden="true"></i>' : ''}</span>`,
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

function RouteInput({ active, onPoint, onFinish, onCancel, onClearSelection }: {
  active: boolean
  onPoint: (point: [number, number]) => void
  onFinish: () => void
  onCancel: () => void
  onClearSelection: () => void
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
function SelectedRouteEditor({ route, interactive, snapTargets, branchPicking, onBranchPoint, onPatch }: {
  route: TacticalRoute
  interactive: boolean
  snapTargets: RouteSnapTarget[]
  branchPicking: boolean
  onBranchPoint: (waypointIndex: number) => void
  onPatch: (uid: string, patch: Partial<TacticalRoute>) => void
}) {
  const map = useMap()
  const visual = routeVisual(route, true)
  const teamColor = teamOf(route.team).color
  const [dragPreview, setDragPreview] = useState<[number, number][] | null>(null)
  const moveSession = useRef<{ center: L.LatLng; points: [number, number][] } | null>(null)
  const renderedWaypoints = dragPreview ?? route.waypoints

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
  }, [])

  return (
    <>
      <Polyline positions={renderedWaypoints} pathOptions={{ ...visual, color: teamColor, interactive: false }} />
      <Marker position={renderedWaypoints.at(-1)!} icon={routeArrowIcon({ ...route, waypoints: renderedWaypoints }, teamColor)} interactive={false} zIndexOffset={950} />
      {renderedWaypoints.map((point, index) => (
        <Marker
          key={`${route.uid}-${index}`}
          position={point}
          icon={waypointIcon(index, route.waypoints.length, visual.color, teamColor, route.anchorMode)}
          draggable={interactive && !branchPicking && (index > 0 || route.anchorMode === 'free')}
          zIndexOffset={1100}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e)
              if (branchPicking) onBranchPoint(index)
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
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={0.94}>
            {branchPicking
              ? `节点 ${index} · 点击从此处创建分支`
              : index === 0
              ? route.anchorMode === 'team'
                ? `${route.team}队兵棋锚点`
                : route.anchorMode === 'operator'
                  ? '干员兵棋锚点'
                  : route.anchorMode === 'vehicle'
                    ? '载具兵棋锚点'
                    : route.anchorMode === 'branch'
                      ? '路线节点锚点'
                      : '自由起点 · 拖到兵棋或其他路线节点可吸附绑定'
              : route.waypoints.length > 2
                ? `${index === route.waypoints.length - 1 ? '终点' : `途经点 ${index}`} · 拖动调整 · 右键删除`
                : '终点 · 拖动调整 · 路线至少保留一个终点'}
          </Tooltip>
        </Marker>
      ))}
      {route.anchorMode !== 'branch' && (
        <Marker
          position={routeCenter(renderedWaypoints)}
          icon={routeMoveIcon(visual.color, teamColor)}
          draggable={interactive}
          zIndexOffset={1200}
          eventHandlers={{
            click: (e) => L.DomEvent.stopPropagation(e),
            dragstart: (e) => {
              moveSession.current = { center: (e.target as L.Marker).getLatLng(), points: route.waypoints.map((point) => [...point] as [number, number]) }
              setDragPreview(route.waypoints.map((point) => [...point] as [number, number]))
            },
            drag: (e) => previewTranslate((e.target as L.Marker).getLatLng()),
            dragend: (e) => {
              const center = (e.target as L.Marker).getLatLng()
              const session = moveSession.current
              moveSession.current = null
              setDragPreview(null)
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
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -11]}>拖动整条路线</Tooltip>
        </Marker>
      )}
    </>
  )
}

export default function RouteLayer({ routes, view, teams, operators, vehicles, snapTargets, draftSource, selectedUid, branchPicking, interactive, onSelect, onBranchPoint, onDraftEnd, onCreate, onPatch, onDelete }: RouteLayerProps) {
  const map = useMap()
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([])
  const [passiveDragPreview, setPassiveDragPreview] = useState<{ uid: string; waypoints: [number, number][] } | null>(null)
  const draftPointsRef = useRef<[number, number][]>([])

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
    const parent = routes.find((route) => route.uid === draftSource.routeUid)
    const point = parent?.waypoints[draftSource.waypointIndex]
    if (!parent || !point) return null
    return { point, side: parent.side, team: parent.team, teamMarkerUid: parent.teamMarkerUid, name: `${parent.name} · 分支`, parent }
  }, [draftSource, teams, operators, vehicles, routes])

  useEffect(() => {
    if (!draftContext) {
      draftPointsRef.current = []
      setDraftPoints([])
      return
    }
    const initial = [[...draftContext.point] as [number, number]]
    draftPointsRef.current = initial
    setDraftPoints(initial)
    onSelect(null)
  }, [draftSource, draftContext?.point[0], draftContext?.point[1], onSelect])

  useEffect(() => {
    if (!draftContext) return
    const wasEnabled = map.doubleClickZoom.enabled()
    map.doubleClickZoom.disable()
    return () => { if (wasEnabled) map.doubleClickZoom.enable() }
  }, [map, draftContext])

  const addPoint = useCallback((point: [number, number]) => {
    const next = [...draftPointsRef.current, point]
    draftPointsRef.current = next
    setDraftPoints(next)
  }, [])

  const cancelDraft = useCallback(() => {
    draftPointsRef.current = []
    setDraftPoints([])
    onDraftEnd()
  }, [onDraftEnd])

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
    const defaultType = operator || vehicle ? 'move' : 'attack'
    const meta = parent ? orderTypeOf(parent.orderType) : orderTypeOf(defaultType)
    const route: TacticalRoute = {
      uid: genUid('route'),
      side: draftContext.side,
      team: draftContext.team,
      teamMarkerUid: draftContext.teamMarkerUid,
      anchorMode: parent ? 'branch' : operator ? 'operator' : vehicle ? 'vehicle' : 'team',
      anchorOperatorUid: operator?.uid,
      anchorVehicleUid: vehicle?.uid,
      name: draftContext.name,
      orderType: parent?.orderType ?? defaultType,
      status: 'planned',
      color: parent?.color ?? meta.color,
      lineStyle: parent?.lineStyle ?? meta.lineStyle,
      opacity: parent?.opacity ?? 0.92,
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

  const selectedRoute = routes.find((route) => route.uid === selectedUid) ?? null

  return (
    <>
      <RouteInput active={Boolean(draftContext)} onPoint={addPoint} onFinish={finishDraft} onCancel={cancelDraft} onClearSelection={() => onSelect(null)} />
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
        const renderedWaypoints = passiveDragPreview?.uid === route.uid ? passiveDragPreview.waypoints : route.waypoints
        return (
          <Fragment key={route.uid}>
            <Polyline
              positions={renderedWaypoints}
              pathOptions={{ color: teamColor, weight: 18, opacity: 0, interactive, bubblingMouseEvents: false }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  onSelect(route.uid)
                },
                dblclick: (e) => {
                  L.DomEvent.stop(e.originalEvent)
                  const index = nearestSegmentIndex(map, route.waypoints, e.latlng)
                  const waypoints = [...route.waypoints]
                  waypoints.splice(index + 1, 0, [e.latlng.lat, e.latlng.lng])
                  onPatch(route.uid, { waypoints })
                  onSelect(route.uid)
                },
              }}
            >
              <Tooltip sticky direction="top" opacity={0.96}>
                {type.label} · {orderStatusLabel(route.status)} · {route.name}<br />
                {route.operatorIds.length} 干员 · {route.vehicleIds.length} 载具 · 双击线段插入途经点
              </Tooltip>
            </Polyline>
            {!selected && (
              <Polyline positions={renderedWaypoints} pathOptions={{ ...visual, color: teamColor, interactive: false }} />
            )}
            {!selected && <Marker position={renderedWaypoints.at(-1)!} icon={routeArrowIcon({ ...route, waypoints: renderedWaypoints }, teamColor)} interactive={false} zIndexOffset={700} />}
            {!selected && route.waypoints.slice(1).map((point, offset) => {
              const index = offset + 1
              const terminal = index === route.waypoints.length - 1
              return (
              <Marker
                key={`${route.uid}-passive-${index}`}
                position={renderedWaypoints[index] ?? point}
                icon={passiveWaypointIcon(index, visual.color, teamColor, terminal)}
                interactive={interactive}
                draggable={interactive}
                zIndexOffset={terminal ? 740 : 720}
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
                      target: terminal ? undefined : route.target,
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
                    const snapped = terminal ? snapPoint(map, [ll.lat, ll.lng], snapTargets) : { point: [ll.lat, ll.lng] as [number, number], target: route.target }
                    const waypoints = route.waypoints.map((waypoint, waypointIndex) => (
                      waypointIndex === index ? snapped.point : waypoint
                    ))
                    onPatch(route.uid, { waypoints, target: terminal ? snapped.target : route.target })
                    setPassiveDragPreview(null)
                    onSelect(route.uid)
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -9]} opacity={0.94}>
                  {`${terminal ? '终点' : `途经点 ${index}`} · 拖动调整${route.waypoints.length > 2 ? ' · 右键删除' : ''}`}
                </Tooltip>
              </Marker>
              )
            })}
            <Marker
              position={route.labelPosition ?? routeLabelPosition(renderedWaypoints)}
              icon={routeLabelIcon(route, route.color, view, operators)}
              interactive={interactive}
              draggable={interactive}
              zIndexOffset={760}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  onSelect(route.uid)
                },
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng()
                  onPatch(route.uid, { labelPosition: [ll.lat, ll.lng] })
                  onSelect(route.uid)
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -11]} opacity={0.94}>
                {`${route.side === view ? '己方' : '敌方'} · ${route.team}队 · ${executorTooltip} · ${type.label} · ${orderStatusLabel(route.status)}`}<br />
                拖动调整指令标签位置
              </Tooltip>
            </Marker>
          </Fragment>
        )
      })}

      {selectedRoute && <SelectedRouteEditor route={selectedRoute} interactive={interactive} snapTargets={snapTargets} branchPicking={branchPicking} onBranchPoint={onBranchPoint} onPatch={onPatch} />}

      {draftContext && draftPoints.length > 0 && (
        <>
          <Polyline positions={draftPoints} pathOptions={{ color: teamOf(draftContext.team).color, weight: 4, dashArray: '8 6', opacity: 0.95 }} />
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
            <Tooltip permanent direction="top" offset={[0, -9]}>单击添加途经点 · 右键/双击/Enter 完成 · Esc 取消</Tooltip>
          </Marker>
        </>
      )}
    </>
  )
}
