import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marker, Pane, Polygon, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import * as L from 'leaflet'
import type {
  ModeEditorSelection,
  ModeEditorSelectionItem,
  ModeEditorTool,
  ModeMapProp,
  ModeMapOverride,
  ModeObjectivePoint,
  ModeSpawnPoint,
  ModeVehicleRefreshPoint,
  ModeVehicleRefreshRule,
  ModeZone,
  Side,
} from '../types'
import { escapeHtml } from '../utils/geo'
import { POINT_ICON_BASE } from '../config/points'
import { platform } from '../platform'

interface ModeConfigLayerProps {
  config: ModeMapOverride
  stageId: string
  view: Side
  editing: boolean
  zonesVisible: boolean
  spawnsVisible: boolean
  objectivesVisible: boolean
  propsVisible: boolean
  vehicleRefreshVisible: boolean
  tool: ModeEditorTool
  selected: ModeEditorSelection
  selectedItems: ModeEditorSelectionItem[]
  zoneDraft: [number, number][]
  onSelect: (selection: ModeEditorSelection, options?: { additive?: boolean }) => void
  onZoneDraftChange: (points: [number, number][]) => void
  onAddSpawn: (point: [number, number]) => void
  onAddObjective: (point: [number, number]) => void
  onAddProp: (point: [number, number]) => void
  onPlaceVehicleRefreshPoint: (point: [number, number]) => void
  onBindVehicleRefreshPoint: (uid: string) => void
  onMoveSpawn: (uid: string, point: [number, number]) => void
  onMoveObjective: (uid: string, point: [number, number]) => void
  onMoveProp: (uid: string, point: [number, number]) => void
  onMoveVehicleRefreshPoint: (uid: string, point: [number, number]) => void
  onMoveZone: (uid: string, points: [number, number][]) => void
  onMoveZoneVertex: (uid: string, index: number, point: [number, number]) => void
  onInsertZoneVertex: (uid: string, index: number, point: [number, number]) => void
  onRemoveZoneVertex: (uid: string, index: number) => void
}

const verificationText = { draft: '草稿', confirmed: '确认' } as const
const SIDE_ZONE_COLORS = { own: '#01ff84', enemy: '#e0453a' } as const
const MODE_CONFIG_TOOL_CLASSES: `mode-config-tool-${ModeEditorTool}`[] = [
  'mode-config-tool-select',
  'mode-config-tool-zone',
  'mode-config-tool-spawn',
  'mode-config-tool-objective',
  'mode-config-tool-prop',
  'mode-config-tool-vehicle-refresh',
]

/** 活动区的数据颜色以进攻方视角保存；显示时按当前攻守视角换算本方/敌方。 */
function zoneDisplayColor(zone: ModeZone, view: Side): string {
  if (zone.role === 'attack-base') return view === 'attack' ? SIDE_ZONE_COLORS.own : SIDE_ZONE_COLORS.enemy
  if (zone.role === 'defense-base') return view === 'defense' ? SIDE_ZONE_COLORS.own : SIDE_ZONE_COLORS.enemy
  return zone.color
}

function spawnIcon(spawn: ModeSpawnPoint, selected: boolean, own: boolean): L.DivIcon {
  const color = own ? '#01ff84' : '#e0453a'
  const suffix = own ? 'g' : 'r'
  const icon = `${spawn.side === 'attack' ? 'g' : 'f'}_jdbsd_${suffix}`
  const vehicle = spawn.vehicleDeploy ? '<span class="spawn-vehicle-link" aria-hidden="true"><i><b></b></i></span>' : ''
  return L.divIcon({
    className: 'mode-config-spawn-wrap',
    html: `<div class="mode-config-spawn${selected ? ' selected' : ''}${spawn.vehicleDeploy ? ' vehicle-deploy' : ''}" style="--mode-spawn-color:${color}">
      <span class="mode-config-spawn-core"><img src="${POINT_ICON_BASE}/${icon}.png" draggable="false" /></span>
      ${vehicle}
      <span class="mode-config-spawn-name">${escapeHtml(spawn.name)}</span>
      <span class="mode-config-spawn-meta">${verificationText[spawn.verification]}</span>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function objectiveIcon(point: ModeObjectivePoint, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'mode-config-objective-wrap',
    html: `<div class="cap-marker active${selected ? ' selected' : ''}" style="--c:#f4cf67">
      <img src="${POINT_ICON_BASE}/${escapeHtml(point.icon)}.png" draggable="false" />
      <span class="cap-tag">${escapeHtml(point.name)}</span>
    </div>`,
    iconSize: [44, 52],
    iconAnchor: [22, 42],
  })
}

const PROP_THEME: Record<string, { color: string; size: number }> = {
  载具补给站: { color: '#2f6fed', size: 28 },
  固定防空炮: { color: '#e0453a', size: 28 },
  密集阵: { color: '#32b8c6', size: 28 },
  固定机枪: { color: '#f08c2a', size: 26 },
  岸防炮: { color: '#d63f3f', size: 28 },
  滑索: { color: '#2ec4b6', size: 24 },
  电梯: { color: '#8b98ab', size: 24 },
  固定弹药箱: { color: '#f4cf67', size: 24 },
}

function propIcon(prop: ModeMapProp, selected: boolean): L.DivIcon {
  const theme = PROP_THEME[prop.name] ?? { color: '#8b98ab', size: 26 }
  return L.divIcon({
    className: `mode-config-prop-wrap${selected ? ' selected' : ''}`,
    html: `<div class="prop-marker" style="--pc:${theme.color}">
      <span class="prop-bg"></span>
      <img src="${POINT_ICON_BASE}/${escapeHtml(prop.icon)}.png" draggable="false" />
    </div>`,
    iconSize: [theme.size, theme.size],
    iconAnchor: [theme.size / 2, theme.size / 2],
  })
}

function vehicleRefreshPointIcon(point: ModeVehicleRefreshPoint, rules: ModeVehicleRefreshRule[], selected: boolean): L.DivIcon {
  const firstRule = rules[0]
  const image = firstRule?.vehicle.iconUrl
    ? `<img src="${escapeHtml(firstRule.vehicle.iconUrl)}" draggable="false" />`
    : '<i class="fa-solid fa-truck-fast" aria-hidden="true"></i>'
  const count = rules.length > 1 ? `<b>${rules.length}</b>` : ''
  return L.divIcon({
    className: `mode-vehicle-refresh-point-wrap${selected ? ' selected' : ''}`,
    html: `<div class="mode-vehicle-refresh-point">${image}${count}<span>${escapeHtml(point.name)}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

const vertexIconCache = new Map<number, L.DivIcon>()

function vertexIcon(index: number): L.DivIcon {
  const cached = vertexIconCache.get(index)
  if (cached) return cached
  const icon = L.divIcon({
    className: 'mode-config-vertex-wrap',
    html: `<div class="mode-config-vertex">${index + 1}</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
  vertexIconCache.set(index, icon)
  return icon
}

const ZONE_EDGE_INSERT_TOLERANCE = 12
const ANDROID_DRAG_THRESHOLD_PX = 9

type AndroidModeTouchKind = ModeEditorSelectionItem['kind'] | 'vertex'

interface AndroidModeTouchTarget {
  kind: AndroidModeTouchKind
  uid: string
  index?: number
}

interface AndroidModeTouchSession {
  pointerId: number
  phase: 'pending' | 'map-native' | 'dragging'
  target: AndroidModeTouchTarget
  startClient: L.Point
  startLatLng: L.LatLng
  startCenter: L.LatLng
  startZoom: number
  startPoint?: [number, number]
  startPoints?: [number, number][]
  linkedZoneUid?: string
  linkedZonePoints?: [number, number][]
  latestLatLng: L.LatLng
  frame: number | null
  restoreMapDragging: boolean
  restoreTouchZoom: boolean
}

function setAndroidTouchTarget(element: Element | null | undefined, target: AndroidModeTouchTarget | null) {
  if (!element) return
  if (!target) {
    delete (element as HTMLElement).dataset.modeTouchKind
    delete (element as HTMLElement).dataset.modeTouchUid
    delete (element as HTMLElement).dataset.modeTouchIndex
    return
  }
  const dataset = (element as HTMLElement).dataset
  dataset.modeTouchKind = target.kind
  dataset.modeTouchUid = target.uid
  if (target.index == null) delete dataset.modeTouchIndex
  else dataset.modeTouchIndex = String(target.index)
}

function layerElement(layer: L.Layer): Element | null {
  return (layer as L.Layer & { getElement?: () => Element | null }).getElement?.() ?? null
}

function closestPointOnSegment(point: L.Point, start: L.Point, end: L.Point): L.Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return start
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return L.point(start.x + dx * ratio, start.y + dy * ratio)
}

interface ZoneVertexMarkerProps {
  zoneUid: string
  index: number
  point: [number, number]
  map: L.Map
  canRemove: boolean
  active: boolean
  onActivate: (index: number) => void
  onPreview: (uid: string, index: number, point: [number, number]) => void
  onMove: (uid: string, index: number, point: [number, number]) => void
  onRemove: (uid: string, index: number) => void
}

function ZoneVertexMarker({ zoneUid, index, point, map, canRemove, active, onActivate, onPreview, onMove, onRemove }: ZoneVertexMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null)
  const draggingRef = useRef(false)
  const dragPositionRef = useRef<[number, number]>(point)
  const restoreMapDragRef = useRef(false)

  useEffect(() => () => {
    if (restoreMapDragRef.current) map.dragging.enable()
  }, [map])

  useEffect(() => {
    const element = markerRef.current?.getElement()
    if (!element) return
    setAndroidTouchTarget(element, { kind: 'vertex', uid: zoneUid, index })
    element.classList.toggle('active', active)
    element.title = platform.kind === 'android'
      ? canRemove ? '轻触选中顶点，再使用删除按钮' : '区域至少需要保留 3 个顶点'
      : canRemove ? '右键删除顶点' : '区域至少需要保留 3 个顶点'
    const handleContextMenu = (event: MouseEvent) => {
      if (platform.kind === 'android') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (canRemove) onRemove(zoneUid, index)
    }
    element.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      setAndroidTouchTarget(element, null)
      element.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [active, canRemove, index, onRemove, zoneUid])

  const eventHandlers = useMemo<L.LeafletEventHandlerFnMap>(() => ({
    add(event) {
      const element = (event.target as L.Marker).getElement()
      if (element) L.DomEvent.disableClickPropagation(element)
    },
    dragstart(event) {
      const latlng = (event.target as L.Marker).getLatLng()
      draggingRef.current = true
      dragPositionRef.current = [latlng.lat, latlng.lng]
      restoreMapDragRef.current = map.dragging.enabled()
      if (restoreMapDragRef.current) map.dragging.disable()
    },
    drag(event) {
      const latlng = (event.target as L.Marker).getLatLng()
      const nextPoint: [number, number] = [latlng.lat, latlng.lng]
      dragPositionRef.current = nextPoint
      onPreview(zoneUid, index, nextPoint)
    },
    dragend(event) {
      const latlng = (event.target as L.Marker).getLatLng()
      const finalPoint: [number, number] = [latlng.lat, latlng.lng]
      dragPositionRef.current = finalPoint
      onPreview(zoneUid, index, finalPoint)
      onMove(zoneUid, index, finalPoint)
      draggingRef.current = false
      if (restoreMapDragRef.current) map.dragging.enable()
      restoreMapDragRef.current = false
    },
    click(event) {
      L.DomEvent.stopPropagation(event.originalEvent)
      if (platform.kind === 'android') onActivate(index)
    },
  }), [index, map, onActivate, onMove, onPreview, zoneUid])

  const markerPosition = draggingRef.current ? dragPositionRef.current : point
  return (
    <Marker
      ref={markerRef}
      position={markerPosition}
      icon={vertexIcon(index)}
      draggable={platform.kind !== 'android'}
      interactive
      bubblingMouseEvents={false}
      zIndexOffset={1200}
      eventHandlers={eventHandlers}
    />
  )
}

function DraftZoneVertexMarker({
  point,
  index,
  onRemove,
}: {
  point: [number, number]
  index: number
  onRemove: (index: number) => void
}) {
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    const element = markerRef.current?.getElement()
    if (!element) return
    element.title = '右键取消此顶点'
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      onRemove(index)
    }
    element.addEventListener('contextmenu', handleContextMenu, true)
    return () => element.removeEventListener('contextmenu', handleContextMenu, true)
  }, [index, onRemove])

  return (
    <Marker
      ref={markerRef}
      position={point}
      icon={vertexIcon(index)}
      interactive
      bubblingMouseEvents={false}
    />
  )
}

function ModeMapEvents({
  enabled,
  tool,
  zoneDraft,
  onSelect,
  onZoneDraftChange,
  onAddSpawn,
  onAddObjective,
  onAddProp,
  onPlaceVehicleRefreshPoint,
}: Pick<
  ModeConfigLayerProps,
  'tool' | 'zoneDraft' | 'onSelect' | 'onZoneDraftChange' | 'onAddSpawn' | 'onAddObjective' | 'onAddProp' | 'onPlaceVehicleRefreshPoint'
> & { enabled: boolean }) {
  useMapEvents({
    click(event) {
      if (!enabled) return
      const point: [number, number] = [event.latlng.lat, event.latlng.lng]
      if (tool === 'zone') onZoneDraftChange([...zoneDraft, point])
      else if (tool === 'spawn') onAddSpawn(point)
      else if (tool === 'objective') onAddObjective(point)
      else if (tool === 'prop') onAddProp(point)
      else if (tool === 'vehicle-refresh') onPlaceVehicleRefreshPoint(point)
      else onSelect(null)
    },
  })
  return null
}

/** 放置工具启用时关闭地图平移，让左键点击始终归编辑器处理。 */
function ModeInteractionControl({ editing, tool }: { editing: boolean; tool: ModeEditorTool }) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    // React-Leaflet treats MapContainer className and Pane options as creation-time
    // values. Keep the live DOM in sync explicitly so a newly selected placement
    // tool cannot leave the map and its panes in the old `select` hit-test state.
    container.classList.remove(...MODE_CONFIG_TOOL_CLASSES)
    container.classList.add(`mode-config-tool-${tool}`)
    container.classList.toggle('mode-config-vehicle-refresh-active', editing && tool === 'vehicle-refresh')
    const selecting = editing && tool === 'select'
    const panePointerEvents: Record<string, boolean> = {
      'mode-config': selecting,
      'mode-config-markers': selecting || (editing && tool === 'vehicle-refresh'),
      'mode-config-selected-zone': selecting,
      'mode-config-controls': selecting,
    }
    Object.entries(panePointerEvents).forEach(([name, interactive]) => {
      const pane = map.getPane(name)
      if (pane) pane.style.pointerEvents = interactive ? 'auto' : 'none'
    })
    return () => {
      container.classList.remove(`mode-config-tool-${tool}`, 'mode-config-vehicle-refresh-active')
    }
  }, [editing, map, tool])
  useEffect(() => {
    if (platform.kind === 'android') return
    if (!editing || tool === 'select') return
    const restoreDragging = map.dragging.enabled()
    map.dragging.disable()
    return () => {
      if (restoreDragging) map.dragging.enable()
    }
  }, [editing, map, tool])
  return null
}

export default function ModeConfigLayer({
  config,
  stageId,
  view,
  editing,
  zonesVisible,
  spawnsVisible,
  objectivesVisible,
  propsVisible,
  vehicleRefreshVisible,
  tool,
  selected,
  selectedItems,
  zoneDraft,
  onSelect,
  onZoneDraftChange,
  onAddSpawn,
  onAddObjective,
  onAddProp,
  onPlaceVehicleRefreshPoint,
  onBindVehicleRefreshPoint,
  onMoveSpawn,
  onMoveObjective,
  onMoveProp,
  onMoveVehicleRefreshPoint,
  onMoveZone,
  onMoveZoneVertex,
  onInsertZoneVertex,
  onRemoveZoneVertex,
}: ModeConfigLayerProps) {
  const map = useMap()
  const [activeVertexIndex, setActiveVertexIndex] = useState<number | null>(null)
  const [insertVertexMode, setInsertVertexMode] = useState(false)
  const zoneDragRef = useRef<{
    uid: string
    start: L.LatLng
    points: [number, number][]
    restoreMapDragging: boolean
  } | null>(null)
  const pointLayerRefs = useRef(new Map<string, L.Marker>())
  const androidTouchSessionRef = useRef<AndroidModeTouchSession | null>(null)
  const selectedKeys = useMemo(
    () => new Set((selectedItems.length > 0 ? selectedItems : selected ? [selected] : []).map((item) => `${item.kind}:${item.uid}`)),
    [selected, selectedItems],
  )
  const isSelected = useCallback((kind: ModeEditorSelectionItem['kind'], uid: string) => selectedKeys.has(`${kind}:${uid}`), [selectedKeys])
  const selectFromMouse = useCallback((selection: ModeEditorSelectionItem, event: L.LeafletMouseEvent) => {
    const source = event.originalEvent as MouseEvent
    onSelect(selection, { additive: source.ctrlKey || source.metaKey })
  }, [onSelect])
  const zoneLayerRefs = useRef(new Map<string, L.Polygon>())
  const spawnIcons = useMemo(
    () =>
      new Map(
        config.spawns.filter((spawn) => spawn.stageId === stageId).map((spawn) => [
          spawn.uid,
          spawnIcon(spawn, isSelected('spawn', spawn.uid), spawn.side === view),
        ]),
      ),
    [config.spawns, isSelected, stageId, view],
  )

  const selectedObjective = selected?.kind === 'objective'
    ? config.objectives.find((point) => point.uid === selected.uid) ?? null
    : null
  const selectedZone = selected?.kind === 'zone'
    ? config.zones.find((zone) => zone.uid === selected.uid && zone.stageId === stageId) ?? null
    : selectedObjective
      ? config.zones.find((zone) => zone.uid === selectedObjective.captureZoneUid) ?? null
      : null
  const stageZones = config.zones.filter((zone) => zone.stageId === stageId)
  const stageSpawns = config.spawns.filter((spawn) => spawn.stageId === stageId)
  const stageObjectives = config.objectives.filter((point) => point.stageId === stageId)
  const stageProps = config.props.filter((prop) => prop.stageId === '*' || prop.stageId === stageId)
  const selecting = editing && tool === 'select'
  const selectedEditableZone = selecting
    && selectedZone?.verification === 'draft'
    && selectedZone.points.length > 1
    ? selectedZone
    : null
  const captureZones = useMemo(() => new Map(config.zones.map((zone) => [zone.uid, zone])), [config.zones])

  useEffect(() => {
    setActiveVertexIndex(null)
    setInsertVertexMode(false)
  }, [selectedZone?.uid, tool])

  const registerPointLayer = useCallback((kind: ModeEditorSelectionItem['kind'], uid: string, layer: L.Marker | null) => {
    const key = `${kind}:${uid}`
    if (!layer) {
      pointLayerRefs.current.delete(key)
      return
    }
    pointLayerRefs.current.set(key, layer)
    setAndroidTouchTarget(layer.getElement(), { kind, uid })
  }, [])

  const registerZoneLayer = useCallback((uid: string, layer: L.Polygon | null) => {
    if (layer) {
      zoneLayerRefs.current.set(uid, layer)
      setAndroidTouchTarget(layer.getElement(), { kind: 'zone', uid })
    } else zoneLayerRefs.current.delete(uid)
  }, [])

  const beginZoneDrag = useCallback((zone: ModeZone, event: L.LeafletMouseEvent) => {
    if (platform.kind === 'android') return
    if (!selecting || zone.verification !== 'draft' || !isSelected('zone', zone.uid)) return
    L.DomEvent.stop(event.originalEvent)
    const restoreMapDragging = map.dragging.enabled()
    if (restoreMapDragging) map.dragging.disable()
    zoneDragRef.current = {
      uid: zone.uid,
      start: event.latlng,
      points: zone.points.map(([lat, lng]) => [lat, lng]),
      restoreMapDragging,
    }
  }, [isSelected, map, selecting])

  useEffect(() => {
    const preview = (event: L.LeafletMouseEvent) => {
      const drag = zoneDragRef.current
      if (!drag) return
      const dLat = event.latlng.lat - drag.start.lat
      const dLng = event.latlng.lng - drag.start.lng
      zoneLayerRefs.current.get(drag.uid)?.setLatLngs(drag.points.map(([lat, lng]) => [lat + dLat, lng + dLng]))
    }
    const finish = (event: L.LeafletMouseEvent) => {
      const drag = zoneDragRef.current
      if (!drag) return
      zoneDragRef.current = null
      const dLat = event.latlng.lat - drag.start.lat
      const dLng = event.latlng.lng - drag.start.lng
      if (drag.restoreMapDragging) map.dragging.enable()
      if (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) return
      onMoveZone(drag.uid, drag.points.map(([lat, lng]) => [lat + dLat, lng + dLng]))
    }
    map.on('mousemove', preview)
    map.on('mouseup', finish)
    return () => {
      map.off('mousemove', preview)
      map.off('mouseup', finish)
      if (zoneDragRef.current?.restoreMapDragging) map.dragging.enable()
      zoneDragRef.current = null
    }
  }, [map, onMoveZone])

  const previewZoneVertex = useCallback((uid: string, index: number, point: [number, number]) => {
    const zone = config.zones.find((item) => item.uid === uid)
    const layer = zoneLayerRefs.current.get(uid)
    if (!zone || !layer) return
    layer.setLatLngs(zone.points.map((vertex, vertexIndex) => vertexIndex === index ? point : vertex))
  }, [config.zones])

  const androidTouchContextRef = useRef({
    config,
    selectedKeys,
    tool,
    insertVertexMode,
    onMoveSpawn,
    onMoveObjective,
    onMoveProp,
    onMoveVehicleRefreshPoint,
    onMoveZone,
    onMoveZoneVertex,
  })
  androidTouchContextRef.current = {
    config,
    selectedKeys,
    tool,
    insertVertexMode,
    onMoveSpawn,
    onMoveObjective,
    onMoveProp,
    onMoveVehicleRefreshPoint,
    onMoveZone,
    onMoveZoneVertex,
  }

  useEffect(() => {
    if (platform.kind !== 'android') return
    const container = map.getContainer()
    const activePointers = new Set<number>()
    let suppressClickUntil = 0

    const clientToLatLng = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect()
      return map.containerPointToLatLng(L.point(clientX - rect.left, clientY - rect.top))
    }

    const resolveTarget = (event: PointerEvent): AndroidModeTouchTarget | null => {
      const source = event.target instanceof Element
        ? event.target.closest('[data-mode-touch-kind]') as HTMLElement | SVGElement | null
        : null
      if (!source) return null
      const { modeTouchKind, modeTouchUid, modeTouchIndex } = (source as HTMLElement).dataset
      if (!modeTouchKind || !modeTouchUid) return null
      return {
        kind: modeTouchKind as AndroidModeTouchKind,
        uid: modeTouchUid,
        index: modeTouchIndex == null ? undefined : Number(modeTouchIndex),
      }
    }

    const startTargetSession = (event: PointerEvent, target: AndroidModeTouchTarget): AndroidModeTouchSession | null => {
      const context = androidTouchContextRef.current
      if (context.tool !== 'select') return null
      if (context.insertVertexMode && target.kind === 'zone') return null
      const selected = target.kind === 'vertex' || context.selectedKeys.has(`${target.kind}:${target.uid}`)
      if (!selected) return null

      let startPoint: [number, number] | undefined
      let startPoints: [number, number][] | undefined
      let linkedZoneUid: string | undefined
      let linkedZonePoints: [number, number][] | undefined
      if (target.kind === 'zone' || target.kind === 'vertex') {
        const zone = context.config.zones.find((item) => item.uid === target.uid)
        if (!zone || zone.verification !== 'draft') return null
        startPoints = zone.points.map(([lat, lng]) => [lat, lng])
        if (target.kind === 'vertex') {
          const point = startPoints[target.index ?? -1]
          if (!point) return null
          startPoint = point
        }
      } else if (target.kind === 'spawn') {
        const point = context.config.spawns.find((item) => item.uid === target.uid)
        if (!point || point.verification !== 'draft') return null
        startPoint = [point.lat, point.lng]
      } else if (target.kind === 'objective') {
        const point = context.config.objectives.find((item) => item.uid === target.uid)
        const linkedZone = point ? context.config.zones.find((zone) => zone.uid === point.captureZoneUid) : null
        if (!point || point.verification !== 'draft' || linkedZone?.verification !== 'draft') return null
        startPoint = [point.lat, point.lng]
        linkedZoneUid = linkedZone.uid
        linkedZonePoints = linkedZone.points.map(([lat, lng]) => [lat, lng])
      } else if (target.kind === 'prop') {
        const point = context.config.props.find((item) => item.uid === target.uid)
        if (!point || point.verification !== 'draft') return null
        startPoint = [point.lat, point.lng]
      } else {
        const point = context.config.vehicleRefreshPoints.find((item) => item.uid === target.uid)
        if (!point || point.verification !== 'draft') return null
        startPoint = [point.lat, point.lng]
      }

      const startLatLng = clientToLatLng(event.clientX, event.clientY)
      return {
        pointerId: event.pointerId,
        phase: 'pending',
        target,
        startClient: L.point(event.clientX, event.clientY),
        startLatLng,
        startCenter: map.getCenter(),
        startZoom: map.getZoom(),
        startPoint,
        startPoints,
        linkedZoneUid,
        linkedZonePoints,
        latestLatLng: startLatLng,
        frame: null,
        restoreMapDragging: map.dragging.enabled(),
        restoreTouchZoom: map.touchZoom.enabled(),
      }
    }

    const translatedPoint = (session: AndroidModeTouchSession, latlng: L.LatLng): [number, number] => {
      const start = session.startPoint ?? [session.startLatLng.lat, session.startLatLng.lng]
      return [
        start[0] + latlng.lat - session.startLatLng.lat,
        start[1] + latlng.lng - session.startLatLng.lng,
      ]
    }

    const translatedZone = (session: AndroidModeTouchSession, latlng: L.LatLng): [number, number][] => {
      const dLat = latlng.lat - session.startLatLng.lat
      const dLng = latlng.lng - session.startLatLng.lng
      return (session.startPoints ?? []).map(([lat, lng]) => [lat + dLat, lng + dLng])
    }

    const renderPreview = (session: AndroidModeTouchSession) => {
      session.frame = null
      const latlng = session.latestLatLng
      if (session.target.kind === 'zone') {
        zoneLayerRefs.current.get(session.target.uid)?.setLatLngs(translatedZone(session, latlng))
        return
      }
      if (session.target.kind === 'vertex') {
        const points = (session.startPoints ?? []).map(([lat, lng]) => [lat, lng] as [number, number])
        const index = session.target.index ?? -1
        if (points[index]) points[index] = translatedPoint(session, latlng)
        zoneLayerRefs.current.get(session.target.uid)?.setLatLngs(points)
        return
      }
      const nextPoint = translatedPoint(session, latlng)
      pointLayerRefs.current.get(`${session.target.kind}:${session.target.uid}`)?.setLatLng(nextPoint)
      if (session.target.kind === 'objective' && session.linkedZoneUid && session.linkedZonePoints) {
        const dLat = nextPoint[0] - (session.startPoint?.[0] ?? nextPoint[0])
        const dLng = nextPoint[1] - (session.startPoint?.[1] ?? nextPoint[1])
        zoneLayerRefs.current.get(session.linkedZoneUid)?.setLatLngs(session.linkedZonePoints.map(([lat, lng]) => [lat + dLat, lng + dLng]))
      }
    }

    const queuePreview = (session: AndroidModeTouchSession) => {
      if (session.frame != null) return
      session.frame = window.requestAnimationFrame(() => renderPreview(session))
    }

    const restoreMapHandlers = (session: AndroidModeTouchSession) => {
      if (session.restoreMapDragging && !map.dragging.enabled()) map.dragging.enable()
      if (session.restoreTouchZoom && !map.touchZoom.enabled()) map.touchZoom.enable()
      container.classList.remove('mode-config-touch-dragging')
      if (container.hasPointerCapture(session.pointerId)) container.releasePointerCapture(session.pointerId)
    }

    const commitSession = (session: AndroidModeTouchSession) => {
      if (session.frame != null) {
        window.cancelAnimationFrame(session.frame)
        renderPreview(session)
      }
      const context = androidTouchContextRef.current
      if (session.target.kind === 'zone') context.onMoveZone(session.target.uid, translatedZone(session, session.latestLatLng))
      else if (session.target.kind === 'vertex') context.onMoveZoneVertex(session.target.uid, session.target.index ?? 0, translatedPoint(session, session.latestLatLng))
      else if (session.target.kind === 'spawn') context.onMoveSpawn(session.target.uid, translatedPoint(session, session.latestLatLng))
      else if (session.target.kind === 'objective') context.onMoveObjective(session.target.uid, translatedPoint(session, session.latestLatLng))
      else if (session.target.kind === 'prop') context.onMoveProp(session.target.uid, translatedPoint(session, session.latestLatLng))
      else context.onMoveVehicleRefreshPoint(session.target.uid, translatedPoint(session, session.latestLatLng))
    }

    const resetPreview = (session: AndroidModeTouchSession) => {
      if (session.frame != null) window.cancelAnimationFrame(session.frame)
      if (session.target.kind === 'zone' || session.target.kind === 'vertex') {
        if (session.startPoints) zoneLayerRefs.current.get(session.target.uid)?.setLatLngs(session.startPoints)
      } else if (session.startPoint) {
        pointLayerRefs.current.get(`${session.target.kind}:${session.target.uid}`)?.setLatLng(session.startPoint)
      }
      if (session.linkedZoneUid && session.linkedZonePoints) zoneLayerRefs.current.get(session.linkedZoneUid)?.setLatLngs(session.linkedZonePoints)
    }

    const beginDrag = (session: AndroidModeTouchSession, event: PointerEvent) => {
      session.phase = 'dragging'
      if (session.restoreMapDragging) map.dragging.disable()
      if (session.restoreTouchZoom) map.touchZoom.disable()
      map.setView(session.startCenter, session.startZoom, { animate: false })
      container.setPointerCapture(session.pointerId)
      container.classList.add('mode-config-touch-dragging')
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || event.button !== 0) return
      const current = androidTouchSessionRef.current
      if (current && current.pointerId !== event.pointerId) {
        if (current.phase === 'dragging') {
          event.preventDefault()
          event.stopImmediatePropagation()
          return
        }
        activePointers.add(event.pointerId)
        current.phase = 'map-native'
        return
      }
      activePointers.add(event.pointerId)
      const target = resolveTarget(event)
      if (!target) return
      androidTouchSessionRef.current = startTargetSession(event, target)
    }

    const onPointerMove = (event: PointerEvent) => {
      const session = androidTouchSessionRef.current
      if (!session || session.pointerId !== event.pointerId || session.phase === 'map-native') return
      if (activePointers.size > 1 && session.phase === 'pending') {
        session.phase = 'map-native'
        return
      }
      session.latestLatLng = clientToLatLng(event.clientX, event.clientY)
      if (session.phase === 'pending') {
        const distance = session.startClient.distanceTo(L.point(event.clientX, event.clientY))
        if (distance < ANDROID_DRAG_THRESHOLD_PX) return
        beginDrag(session, event)
      } else {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      queuePreview(session)
    }

    const finishPointer = (event: PointerEvent, cancelled: boolean) => {
      activePointers.delete(event.pointerId)
      const session = androidTouchSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      androidTouchSessionRef.current = null
      if (session.phase !== 'dragging') return
      session.latestLatLng = clientToLatLng(event.clientX, event.clientY)
      if (cancelled) resetPreview(session)
      else commitSession(session)
      restoreMapHandlers(session)
      suppressClickUntil = performance.now() + 450
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() >= suppressClickUntil) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    container.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false })
    container.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
    container.addEventListener('click', onClickCapture, true)
    const pointerUp = (event: PointerEvent) => finishPointer(event, false)
    const pointerCancel = (event: PointerEvent) => finishPointer(event, true)
    // Named handlers are also attached to window so a finger leaving the map cannot strand the editor lock.
    window.addEventListener('pointerup', pointerUp, { capture: true, passive: false })
    window.addEventListener('pointercancel', pointerCancel, { capture: true, passive: false })
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true)
      container.removeEventListener('pointermove', onPointerMove, true)
      container.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('pointerup', pointerUp, true)
      window.removeEventListener('pointercancel', pointerCancel, true)
      const session = androidTouchSessionRef.current
      if (session?.phase === 'dragging') {
        resetPreview(session)
        restoreMapHandlers(session)
      }
      androidTouchSessionRef.current = null
    }
  }, [map])

  const removeDraftZoneVertex = useCallback((index: number) => {
    onZoneDraftChange(zoneDraft.filter((_, vertexIndex) => vertexIndex !== index))
  }, [onZoneDraftChange, zoneDraft])

  const insertZoneVertexAtEdge = useCallback((zone: ModeZone, event: L.LeafletMouseEvent) => {
    if (!selecting || zone.verification !== 'draft' || zone.points.length < 2) return

    const pointer = map.latLngToLayerPoint(event.latlng)
    let closestPoint: L.Point | null = null
    let closestDistance = Number.POSITIVE_INFINITY
    let insertIndex = 0

    zone.points.forEach((point, index) => {
      const nextPoint = zone.points[(index + 1) % zone.points.length]
      const start = map.latLngToLayerPoint(L.latLng(point[0], point[1]))
      const end = map.latLngToLayerPoint(L.latLng(nextPoint[0], nextPoint[1]))
      const candidate = closestPointOnSegment(pointer, start, end)
      const distance = pointer.distanceTo(candidate)
      if (distance < closestDistance) {
        closestDistance = distance
        closestPoint = candidate
        insertIndex = index + 1
      }
    })

    if (!closestPoint || closestDistance > (platform.kind === 'android' ? 24 : ZONE_EDGE_INSERT_TOLERANCE)) return
    L.DomEvent.stop(event.originalEvent)
    const latlng = map.layerPointToLatLng(closestPoint)
    onSelect({ kind: 'zone', uid: zone.uid })
    onInsertZoneVertex(zone.uid, insertIndex, [latlng.lat, latlng.lng])
  }, [map, onInsertZoneVertex, onSelect, selecting])

  return (
    <>
    <Pane name="mode-config" className="mode-config-pane" style={{ zIndex: 465, pointerEvents: tool === 'select' ? 'auto' : 'none' }}>
      <ModeInteractionControl editing={editing} tool={tool} />
      <ModeMapEvents
        enabled={editing}
        tool={tool}
        zoneDraft={zoneDraft}
        onSelect={onSelect}
        onZoneDraftChange={onZoneDraftChange}
        onAddSpawn={onAddSpawn}
        onAddObjective={onAddObjective}
        onAddProp={onAddProp}
        onPlaceVehicleRefreshPoint={onPlaceVehicleRefreshPoint}
      />

      {zonesVisible && selecting ? stageZones
        .filter((zone) => zone.verification === 'draft' && zone.points.length > 1 && zone.uid !== selectedEditableZone?.uid)
        .map((zone) => (
          <Polyline
            key={`${zone.uid}:edge-hit-area`}
            positions={[...zone.points, zone.points[0]]}
            className="mode-config-zone-edge-hit-area"
            pathOptions={{ color: zone.color, opacity: 0, weight: (platform.kind === 'android' ? 24 : ZONE_EDGE_INSERT_TOLERANCE) * 2 }}
            interactive={tool === 'select'}
            bubblingMouseEvents={false}
            eventHandlers={{
              add(event) {
                setAndroidTouchTarget(layerElement(event.target), { kind: 'zone', uid: zone.uid })
              },
              mousedown(event) {
                beginZoneDrag(zone, event)
              },
              click(event) {
                L.DomEvent.stopPropagation(event.originalEvent)
                if (platform.kind === 'android' && insertVertexMode && isSelected('zone', zone.uid)) {
                  insertZoneVertexAtEdge(zone, event)
                  setInsertVertexMode(false)
                  return
                }
                selectFromMouse({ kind: 'zone', uid: zone.uid }, event)
              },
              dblclick(event) {
                if (platform.kind === 'android') return
                insertZoneVertexAtEdge(zone, event)
              },
            }}
          />
        )) : null}

      {zonesVisible ? stageZones.map((zone: ModeZone) => {
        const active = isSelected('zone', zone.uid)
          || selectedObjective?.captureZoneUid === zone.uid
        const editable = selecting && zone.verification === 'draft'
        const displayColor = zoneDisplayColor(zone, view)
        return (
          <Polygon
            key={zone.uid}
            ref={(layer) => registerZoneLayer(zone.uid, layer)}
            positions={zone.points}
            className={`mode-config-zone${active ? ' selected' : ''}${selecting ? ' selectable' : ''}${editable ? ' editable' : ''}`}
            pathOptions={{
              color: displayColor,
              weight: active ? 4 : 2,
              opacity: 1,
              fillColor: displayColor,
              fillOpacity: zone.role === 'attack-base' || zone.role === 'defense-base' || zone.role === 'frontline'
                ? 0
                : active ? 0.24 : 0.13,
              dashArray: zone.role === 'frontline' ? '10 7' : zone.verification === 'draft' ? '7 5' : undefined,
            }}
            interactive={selecting && tool === 'select'}
            bubblingMouseEvents={false}
            eventHandlers={{
              add(event) {
                setAndroidTouchTarget(layerElement(event.target), { kind: 'zone', uid: zone.uid })
              },
              mousedown(event) {
                beginZoneDrag(zone, event)
              },
              click(event) {
                if (!selecting) return
                L.DomEvent.stopPropagation(event.originalEvent)
                if (platform.kind === 'android' && insertVertexMode && active) {
                  insertZoneVertexAtEdge(zone, event)
                  setInsertVertexMode(false)
                  return
                }
                selectFromMouse({ kind: 'zone', uid: zone.uid }, event)
              },
              dblclick(event) {
                if (platform.kind === 'android') return
                insertZoneVertexAtEdge(zone, event)
              },
            }}
          >
            <Tooltip sticky={platform.kind !== 'android'}>
              {zone.name} · {verificationText[zone.verification]}
              {selecting && zone.verification === 'draft'
                ? platform.kind === 'android' ? ' · 选中后可移动、插入或删除顶点' : ' · 双击边界新增顶点 · 右键顶点删除'
                : ''}
            </Tooltip>
          </Polygon>
        )
      }) : null}

      {editing && tool === 'zone' && zoneDraft.length > 0 ? (
        <>
          <Polyline positions={zoneDraft} pathOptions={{ color: '#3f8cff', weight: 3, dashArray: '5 4' }} />
          {zoneDraft.map((point, index) => (
            <DraftZoneVertexMarker
              key={`${point[0]}:${point[1]}:${index}`}
              point={point}
              index={index}
              onRemove={removeDraftZoneVertex}
            />
          ))}
        </>
      ) : null}

    </Pane>
    <Pane name="mode-config-markers" className="mode-config-markers-pane" style={{ zIndex: 580, pointerEvents: tool === 'select' || tool === 'vehicle-refresh' ? 'auto' : 'none' }}>

      {spawnsVisible ? stageSpawns.map((spawn) => (
        <Marker
          key={spawn.uid}
          ref={(layer) => registerPointLayer('spawn', spawn.uid, layer)}
          position={[spawn.lat, spawn.lng]}
          icon={spawnIcons.get(spawn.uid)!}
          draggable={platform.kind !== 'android' && selecting && isSelected('spawn', spawn.uid) && spawn.verification === 'draft'}
            interactive={selecting && tool === 'select'}
          bubblingMouseEvents={false}
          eventHandlers={{
            add(event) {
              setAndroidTouchTarget(layerElement(event.target), { kind: 'spawn', uid: spawn.uid })
            },
            click(event) {
              if (!selecting) return
              L.DomEvent.stopPropagation(event.originalEvent)
              selectFromMouse({ kind: 'spawn', uid: spawn.uid }, event)
            },
            dragend(event) {
              const latlng = event.target.getLatLng() as L.LatLng
              onMoveSpawn(spawn.uid, [latlng.lat, latlng.lng])
            },
          }}
        />
      )) : null}

      {objectivesVisible ? stageObjectives.map((point) => (
        <Marker
          key={point.uid}
          ref={(layer) => registerPointLayer('objective', point.uid, layer)}
          position={[point.lat, point.lng]}
          icon={objectiveIcon(point, isSelected('objective', point.uid))}
          draggable={platform.kind !== 'android' && selecting && isSelected('objective', point.uid) && point.verification === 'draft' && captureZones.get(point.captureZoneUid)?.verification === 'draft'}
            interactive={selecting && tool === 'select'}
          bubblingMouseEvents={false}
          zIndexOffset={580}
          eventHandlers={{
            add(event) {
              setAndroidTouchTarget(layerElement(event.target), { kind: 'objective', uid: point.uid })
            },
            click(event) {
              if (!selecting) return
              L.DomEvent.stopPropagation(event.originalEvent)
              selectFromMouse({ kind: 'objective', uid: point.uid }, event)
            },
            dragend(event) {
              const latlng = event.target.getLatLng() as L.LatLng
              onMoveObjective(point.uid, [latlng.lat, latlng.lng])
            },
          }}
        />
      )) : null}

      {propsVisible ? stageProps.map((prop) => (
        <Marker
          key={prop.uid}
          ref={(layer) => registerPointLayer('prop', prop.uid, layer)}
          position={[prop.lat, prop.lng]}
          icon={propIcon(prop, isSelected('prop', prop.uid))}
          draggable={platform.kind !== 'android' && selecting && isSelected('prop', prop.uid) && prop.verification === 'draft'}
          interactive={selecting && tool === 'select'}
          bubblingMouseEvents={false}
          zIndexOffset={520}
          eventHandlers={{
            add(event) {
              setAndroidTouchTarget(layerElement(event.target), { kind: 'prop', uid: prop.uid })
            },
            click(event) {
              if (!selecting) return
              L.DomEvent.stopPropagation(event.originalEvent)
              selectFromMouse({ kind: 'prop', uid: prop.uid }, event)
            },
            dragend(event) {
              const latlng = event.target.getLatLng() as L.LatLng
              onMoveProp(prop.uid, [latlng.lat, latlng.lng])
            },
          }}
        >
          <Tooltip sticky>{prop.name} · {verificationText[prop.verification]}</Tooltip>
        </Marker>
      )) : null}

      {vehicleRefreshVisible ? config.vehicleRefreshPoints.map((point) => {
        const rules = config.vehicleRefreshRules.filter((rule) => rule.refreshPointUid === point.uid)
        return (
          <Marker
            key={point.uid}
            ref={(layer) => registerPointLayer('vehicle-refresh-point', point.uid, layer)}
            position={[point.lat, point.lng]}
            icon={vehicleRefreshPointIcon(point, rules, isSelected('vehicle-refresh-point', point.uid))}
            draggable={platform.kind !== 'android' && selecting && isSelected('vehicle-refresh-point', point.uid) && point.verification === 'draft'}
            interactive={selecting && (tool === 'select' || tool === 'vehicle-refresh')}
            bubblingMouseEvents={false}
            zIndexOffset={560}
            eventHandlers={{
              add(event) {
                setAndroidTouchTarget(layerElement(event.target), { kind: 'vehicle-refresh-point', uid: point.uid })
              },
              click(event) {
                L.DomEvent.stopPropagation(event.originalEvent)
                if (tool === 'vehicle-refresh') onBindVehicleRefreshPoint(point.uid)
                else if (selecting) selectFromMouse({ kind: 'vehicle-refresh-point', uid: point.uid }, event)
              },
              dragend(event) {
                const latlng = event.target.getLatLng() as L.LatLng
                onMoveVehicleRefreshPoint(point.uid, [latlng.lat, latlng.lng])
              },
            }}
          >
            <Tooltip sticky>{point.name} · {rules.length} 条刷新规则</Tooltip>
          </Marker>
        )
      }) : null}
    </Pane>
    <Pane name="mode-config-selected-zone" className="mode-config-selected-zone-pane" style={{ zIndex: 570, pointerEvents: tool === 'select' ? 'auto' : 'none' }}>
      {editing && zonesVisible && selectedEditableZone ? (
        <>
          <Polyline
            positions={[...selectedEditableZone.points, selectedEditableZone.points[0]]}
            pathOptions={{
              color: zoneDisplayColor(selectedEditableZone, view),
              opacity: 1,
              weight: 4,
              dashArray: selectedEditableZone.role === 'frontline' ? '10 7' : '7 5',
            }}
            interactive={false}
          />
          <Polyline
            positions={[...selectedEditableZone.points, selectedEditableZone.points[0]]}
            className="mode-config-zone-edge-hit-area selected"
            pathOptions={{ color: selectedEditableZone.color, opacity: 0, weight: (platform.kind === 'android' ? 24 : ZONE_EDGE_INSERT_TOLERANCE) * 2 }}
            interactive={tool === 'select'}
            bubblingMouseEvents={false}
            eventHandlers={{
              add(event) {
                setAndroidTouchTarget(layerElement(event.target), { kind: 'zone', uid: selectedEditableZone.uid })
              },
              mousedown(event) {
                beginZoneDrag(selectedEditableZone, event)
              },
              click(event) {
                L.DomEvent.stopPropagation(event.originalEvent)
                if (platform.kind === 'android' && insertVertexMode) {
                  insertZoneVertexAtEdge(selectedEditableZone, event)
                  setInsertVertexMode(false)
                  return
                }
                selectFromMouse({ kind: 'zone', uid: selectedEditableZone.uid }, event)
              },
              dblclick(event) {
                if (platform.kind === 'android') return
                insertZoneVertexAtEdge(selectedEditableZone, event)
              },
            }}
          />
        </>
      ) : null}
    </Pane>
    <Pane name="mode-config-controls" className="mode-config-controls-pane" style={{ zIndex: 590, pointerEvents: tool === 'select' ? 'auto' : 'none' }}>
      {editing && zonesVisible && selectedZone?.verification === 'draft'
        ? selectedZone.points.map((point, index) => (
            <ZoneVertexMarker
              key={`${selectedZone.uid}:${index}`}
              zoneUid={selectedZone.uid}
              index={index}
              point={point}
              map={map}
              canRemove={selectedZone.points.length > 3}
              active={activeVertexIndex === index}
              onActivate={(vertexIndex) => setActiveVertexIndex((current) => current === vertexIndex ? null : vertexIndex)}
              onPreview={previewZoneVertex}
              onMove={onMoveZoneVertex}
              onRemove={onRemoveZoneVertex}
            />
          ))
        : null}
    </Pane>
    {platform.kind === 'android' && editing && tool === 'select' && selectedZone?.verification === 'draft'
      ? createPortal(
          <div
            className="mode-config-mobile-zone-actions"
            role="toolbar"
            aria-label="区域顶点编辑"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={insertVertexMode ? 'active' : ''}
              onClick={() => {
                setActiveVertexIndex(null)
                setInsertVertexMode((activeMode) => !activeMode)
              }}
            >
              <i className="fa-solid fa-plus" />{insertVertexMode ? '轻触边界' : '插入顶点'}
            </button>
            <button
              type="button"
              className="danger"
              disabled={activeVertexIndex == null || selectedZone.points.length <= 3}
              onClick={() => {
                if (activeVertexIndex == null) return
                onRemoveZoneVertex(selectedZone.uid, activeVertexIndex)
                setActiveVertexIndex(null)
              }}
            >
              <i className="fa-solid fa-trash" />删除顶点
            </button>
          </div>,
          document.body,
        )
      : null}
    </>
  )
}
