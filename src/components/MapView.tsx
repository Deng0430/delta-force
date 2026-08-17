import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type {
  ActiveTextEdit,
  BuildingUnit,
  CapturePoint,
  DrawSettings,
  MapConfig,
  MapProp,
  MapState,
  OperatorConnection,
  OperatorUnit,
  PointStatus,
  Side,
  StageConfig,
  TacticalRoute,
  TeamMarker,
  ToolMode,
  VehicleItem,
  WargameState,
} from '../types'
import { genUid, mapBounds } from '../utils/geo'
import LayerManager from './LayerManager'
import VehicleLayer from './VehicleLayer'
import BuildingLayer from './BuildingLayer'
import OperatorLayer from './OperatorLayer'
import TeamLayer from './TeamLayer'
import RouteLayer from './RouteLayer'
import type { RouteDraftSource, RouteSnapTarget } from './RouteLayer'
import RouteEditorPanel from './RouteEditorPanel'
import ConnectionLayer from './ConnectionLayer'
import OpBubble from './OpBubble'
import OpRenameBar from './OpRenameBar'
import PointMarkers from './PointMarkers'
import SpawnMarkers from './SpawnMarkers'
import ActivityZones from './ActivityZones'
import MapPropsLayer from './MapPropsLayer'
import type { LayerVisibility, PropVisibility } from '../types'
import { platform } from '../platform'

interface OfficialModeMapData {
  stages: StageConfig[]
  props: MapProp[]
}

interface MapViewProps {
  config: MapConfig
  mobileLayout: boolean
  modeData: OfficialModeMapData | null
  propsOverride?: MapProp[]
  modeStageId: string | null
  view: Side
  tool: ToolMode
  state: MapState
  stages: StageConfig[]
  capturedStageIndex: number
  selectedPoint: { stageId: string; point: CapturePoint } | null
  /** 图层显示开关（问题1） */
  layers: LayerVisibility
  /** 道具按类型显示开关（问题2） */
  propVis: PropVisibility
  /** 画笔设置（问题4：颜色/线宽/线型） */
  draw: DrawSettings
  /** 左侧工具栏是否展开（浮层"共进退"：图例/缩放控件让位） */
  leftOpen: boolean
  /** 右侧工具栏是否展开（浮层"共进退"：据点说明让位） */
  rightOpen: boolean
  /** 左下角区域图例是否展开。 */
  legendOpen: boolean
  onToggleLegend: () => void
  /** 绘制操作提交（LayerManager 上报 before/after GeoJSON，App 统一入历史栈） */
  onCommitDraw: (before: string, after: string) => void
  /** 删除选中信号（第十二轮） */
  deleteSelectedTick: number
  /** 清空本层绘制信号（锁定图形保留，只清未锁定图形） */
  clearDrawTick: number
  /** 是否有选中图形上报（第十二轮） */
  onDeleteSelCount: (n: number) => void
  onMapReady: (map: L.Map) => void
  onMoveVehicle: (uid: string, lat: number, lng: number) => void
  onRotateVehicle: (uid: string, rotation: number) => void
  onDeleteVehicle: (uid: string) => void
  /** 快捷切换载具阵营（攻↔守） */
  onToggleVehicleSide: (uid: string) => void
  onChangeVehicleTeam: (uid: string, team?: import('../types').OperatorTeam) => void
  buildings: BuildingUnit[]
  onMoveBuilding: (uid: string, lat: number, lng: number) => void
  onRotateBuilding: (uid: string, rotation: number) => void
  onToggleBuildingSide: (uid: string) => void
  onChangeBuildingTeam: (uid: string, team?: import('../types').OperatorTeam) => void
  onDeleteBuilding: (uid: string) => void
  onDrawSaved: (side: Side, geoJson: string) => void
  onSelectPoint: (point: CapturePoint, stageId: string) => void
  onCloseDetail: () => void
  /** 点击出生点（弹出底部载具部署栏） */
  onSpawnSelect: (spawn: { stageId: string; side: Side; pos: [number, number]; baseName: string | null }) => void
  /** 工具切换回调（右键自动切回查看工具） */
  onTool: (t: ToolMode) => void
  // ---- 套索支持载具（第十四轮） ----
  /** 批量移动载具（套索整体移动） */
  onMoveVehicles: (updates: Record<string, [number, number]>) => void
  /** 批量删除载具（套索删除） */
  onDeleteVehicles: (uids: string[]) => void
  // ---- 套索支持兵棋干员（第十七轮） ----
  /** 批量移动干员（套索整体移动） */
  onMoveOperators: (updates: Record<string, [number, number]>) => void
  /** 批量删除干员（套索删除） */
  onDeleteOperators: (uids: string[]) => void
  // ---- 兵棋推演（干员 + 联线；视角桶内含双方 40 人，绿=我方/红=敌方） ----
  operators: OperatorUnit[]
  connections: OperatorConnection[]
  wargame: WargameState
  /** 协同关系第一名待选干员 uid（高亮） */
  pendingConnect: string | null
  /** 干员实时坐标注册表（联线端点跟随） */
  operatorPosRef: MutableRefObject<Record<string, [number, number]>>
  onMoveOperator: (uid: string, lat: number, lng: number) => void
  onClearOperatorDeploy: (uid: string) => void
  onConnectClick: (uid: string) => void
  onRemoveConnection: (id: string) => void
  /** 关系编辑模式右键取消：清空待选对象 */
  onCancelConnect: () => void
  /** 气泡选择具体干员（三级菜单第三级：职业→干员，职业自动跟随） */
  onOperatorChange: (uid: string, operatorId: string) => void
  /** 气泡切换状态（存活/重伤/阵亡） */
  onOperatorStatusChange: (uid: string, status: OperatorUnit['status']) => void
  /** 双击代号快捷编辑昵称 */
  onOperatorRename: (uid: string, name: string) => void
  // ---- 兵棋队标（第二十三轮：简化部署单位） ----
  teams: TeamMarker[]
  /** 队标实时坐标注册表（套索框选/整体移动） */
  teamPosRef: MutableRefObject<Record<string, [number, number]>>
  onMoveTeamMarker: (uid: string, lat: number, lng: number) => void
  onDeleteTeamMarker: (uid: string) => void
  /** 批量移动队标（套索整体移动） */
  onMoveTeamMarkers: (updates: Record<string, [number, number]>) => void
  /** 批量删除队标（套索删除） */
  onDeleteTeamMarkers: (uids: string[]) => void
  routes: TacticalRoute[]
  onCreateRoute: (route: TacticalRoute) => void
  onUpdateRoute: (uid: string, patch: Partial<TacticalRoute>) => void
  onDeleteRoute: (uid: string) => void
  cinematicInitialView?: { center: [number, number]; zoom: number } | null
  cinematicBattleCompare?: string | null
}

function CinematicBattleHighlights({ stage }: { stage: string }) {
  const map = useMap()
  const points = stage === 'S4'
    ? [
        { kind: 'attack', pos: [-153.407, 208.457] as [number, number], label: '洞穴出口' },
        { kind: 'objective', pos: [-173.957, 190.895] as [number, number], label: '据点 D' },
        { kind: 'defense', pos: [-182.931, 189.536] as [number, number], label: '守方复活点 1' },
      ]
    : [
        { kind: 'attack', pos: [-161.74964700298045, 205.31205528170955] as [number, number], label: '进攻复活点' },
        { kind: 'objective', pos: [-173.957, 190.895] as [number, number], label: '据点 D2' },
        { kind: 'defense canceled', pos: [-182.931, 189.536] as [number, number], label: '守方复活点取消' },
      ]
  useEffect(() => {
    const report = () => {
      const size = map.getSize()
      const positions = points.map(({ kind, pos }) => {
        const pixel = map.latLngToContainerPoint(pos)
        return { kind: kind.split(' ')[0], x: pixel.x / size.x, y: pixel.y / size.y }
      })
      window.parent.postMessage({ type: 'cinematic-battle-positions', stage, positions }, '*')
    }
    report()
    map.on('move zoom resize', report)
    return () => { map.off('move zoom resize', report) }
  }, [map, points, stage])
  return <>{points.map(({ kind, pos, label }) => <Marker key={kind} position={pos} interactive={false} zIndexOffset={1800} icon={L.divIcon({ className: 'cinematic-battle-marker-wrap', html: `<div class="cinematic-battle-marker ${kind}"><i></i><span>${label}</span></div>`, iconSize: [1, 1], iconAnchor: [0, 0] })} />)}</>
}

/** 地图实例就绪 / 视角切换后的同步（视口、边界） */
function MapSync({
  config,
  onReady,
  initialView,
  minZoom,
  defaultZoom,
}: {
  config: MapConfig
  onReady: (map: L.Map) => void
  initialView?: { center: [number, number]; zoom: number } | null
  minZoom: number
  defaultZoom: number
}) {
  const map = useMap()
  const appliedViewRef = useRef('')
  useEffect(() => {
    const center = initialView?.center ?? config.initCenter
    const zoom = initialView?.zoom ?? defaultZoom
    const signature = `${config.id}:${center[0]}:${center[1]}:${zoom}`
    let firstFrame = 0
    let secondFrame = 0
    if (appliedViewRef.current !== signature) {
      appliedViewRef.current = signature
      map.setView(center, zoom, { animate: false })
      // Android 横屏侧栏与安全区会在首帧后完成尺寸计算。待布局稳定后只校正一次，
      // 避免初始中心按旧容器尺寸计算；后续兵棋状态更新不会再次进入此分支。
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          map.invalidateSize({ animate: false })
          map.setView(center, zoom, { animate: false })
        })
      })
    }
    map.setMaxBounds(mapBounds(config))
    map.options.minZoom = minZoom
    onReady(map)
    return () => {
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [map, config, onReady, initialView, minZoom, defaultZoom])
  return null
}

/**
 * 尺寸同步：监听地图容器尺寸变化并调用 invalidateSize。
 * 布局为地图全屏 + 侧栏浮动，面板开合不会触发 window resize，
 * 若无此监听，Leaflet 会停留在初始测量尺寸，右侧出现未加载的空白区域。
 */
function MapResizeSync() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    const ro = new ResizeObserver(() => {
      map.invalidateSize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [map])
  return null
}

function RouteEditorTrigger({ route, onOpen, onDelete }: { route: TacticalRoute; onOpen: () => void; onDelete: () => void }) {
  const map = useMap()
  const markerRef = useRef<L.Marker | null>(null)
  const onOpenRef = useRef(onOpen)
  const onDeleteRef = useRef(onDelete)
  onOpenRef.current = onOpen
  onDeleteRef.current = onDelete
  const routeNorthEast = useMemo(() => {
    const bounds = L.latLngBounds(route.waypoints.map(([lat, lng]) => L.latLng(lat, lng)))
    return bounds.getNorthEast()
  }, [route.waypoints])
  const [position, setPosition] = useState(routeNorthEast)
  const buttonSize = platform.kind === 'android' ? 36 : 30
  const controlWidth = buttonSize * 2 + 6
  const controlHeight = buttonSize + 24
  const icon = useMemo(() => L.divIcon({
    className: 'route-editor-trigger-wrap',
    html: '<div class="route-selection-controls"><span class="route-selection-hint"></span><div class="route-selection-actions"><button type="button" class="route-editor-trigger" title="编辑行动指令" aria-label="编辑行动指令"><i class="fa-solid fa-route" aria-hidden="true"></i></button><button type="button" class="route-delete-trigger" title="删除路线" aria-label="删除路线"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div></div>',
    iconSize: [controlWidth, controlHeight],
    iconAnchor: [0, controlHeight],
  }), [buttonSize, controlWidth, controlHeight])

  useEffect(() => {
    const updatePosition = () => {
      const size = map.getSize()
      const desired = map.latLngToContainerPoint(routeNorthEast).add([8, -8])
      const clamped = L.point(
        Math.max(4, Math.min(size.x - controlWidth - 4, desired.x)),
        Math.max(controlHeight + 4, Math.min(size.y - 4, desired.y)),
      )
      setPosition(map.containerPointToLatLng(clamped))
    }
    updatePosition()
    map.on('move zoom resize', updatePosition)
    return () => { map.off('move zoom resize', updatePosition) }
  }, [map, routeNorthEast, controlWidth, controlHeight])

  useEffect(() => {
    const element = markerRef.current?.getElement()
    const openButton = element?.querySelector<HTMLElement>('.route-editor-trigger')
    const deleteButton = element?.querySelector<HTMLElement>('.route-delete-trigger')
    const hint = element?.querySelector<HTMLElement>('.route-selection-hint')
    if (!element || !openButton || !deleteButton || !hint) return
    hint.textContent = route.name || '已选路线'
    const stopPointer = (event: Event) => L.DomEvent.stop(event)
    const openOnPointerUp = (event: Event) => {
      L.DomEvent.stop(event)
      // 等本次触摸产生的合成 click 完整结束后再卸载 Marker、打开面板，
      // 避免 click 落到下方路线并再次执行“选中路线 = 收起面板”。
      window.setTimeout(() => onOpenRef.current(), 0)
    }
    const deleteOnPointerUp = (event: Event) => {
      L.DomEvent.stop(event)
      window.setTimeout(() => onDeleteRef.current(), 0)
    }
    L.DomEvent.on(element, 'pointerdown', stopPointer)
    L.DomEvent.on(openButton, 'pointerup', openOnPointerUp)
    L.DomEvent.on(deleteButton, 'pointerup', deleteOnPointerUp)
    return () => {
      L.DomEvent.off(element, 'pointerdown', stopPointer)
      L.DomEvent.off(openButton, 'pointerup', openOnPointerUp)
      L.DomEvent.off(deleteButton, 'pointerup', deleteOnPointerUp)
    }
  }, [icon, route.name])

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      zIndexOffset={1250}
      keyboard={false}
      eventHandlers={{
        mousedown: (event) => {
          L.DomEvent.stop(event.originalEvent)
          L.DomEvent.stopPropagation(event)
        },
        click: (event) => {
          L.DomEvent.stop(event.originalEvent)
          L.DomEvent.stopPropagation(event)
          // pointerup 已统一负责打开；此处仅隔离 Leaflet/地图的合成 click。
        },
      }}
    />
  )
}

const STATUS_TEXT: Record<PointStatus, string> = {
  active: '争夺中',
  captured: '已攻下',
  locked: '未激活',
}

export default function MapView({
  config,
  mobileLayout,
  modeData,
  propsOverride,
  modeStageId,
  view,
  tool,
  state,
  stages,
  capturedStageIndex,
  selectedPoint,
  layers,
  propVis,
  draw,
  onCommitDraw,
  deleteSelectedTick,
  clearDrawTick,
  onDeleteSelCount,
  onMapReady,
  onMoveVehicle,
  onRotateVehicle,
  onDeleteVehicle,
  onToggleVehicleSide,
  onChangeVehicleTeam,
  buildings,
  onMoveBuilding,
  onRotateBuilding,
  onToggleBuildingSide,
  onChangeBuildingTeam,
  onDeleteBuilding,
  onDrawSaved,
  onSelectPoint,
  onCloseDetail,
  onSpawnSelect,
  onTool,
  leftOpen,
  rightOpen,
  legendOpen,
  onToggleLegend,
  onMoveVehicles,
  onDeleteVehicles,
  onMoveOperators,
  onDeleteOperators,
  operators,
  connections,
  wargame,
  pendingConnect,
  operatorPosRef,
  onMoveOperator,
  onClearOperatorDeploy,
  onConnectClick,
  onRemoveConnection,
  onCancelConnect,
  onOperatorChange,
  onOperatorStatusChange,
  onOperatorRename,
  teams,
  teamPosRef,
  onMoveTeamMarker,
  onDeleteTeamMarker,
  onMoveTeamMarkers,
  onDeleteTeamMarkers,
  routes,
  onCreateRoute,
  onUpdateRoute,
  onDeleteRoute,
  cinematicInitialView,
  cinematicBattleCompare,
}: MapViewProps) {
  const bounds = useMemo(() => mapBounds(config), [config])
  // A phone viewport needs one extra zoom level to show roughly twice as much
  // of the map. Keep desktop map tuning and explicit cinematic views unchanged.
  const minZoom = mobileLayout ? Math.max(1, config.minZoom - 1) : config.minZoom
  const defaultZoom = mobileLayout ? Math.max(minZoom, config.initZoom - 1) : config.initZoom
  const runtimeStages = modeData?.stages ?? stages
  const selectedModeStageIndex = modeData
    ? runtimeStages.findIndex((stage) => stage.id === modeStageId)
    : -1
  const runtimeStageIndex = modeData ? Math.max(0, selectedModeStageIndex) : capturedStageIndex
  const [editing, setEditing] = useState<ActiveTextEdit | null>(null)
  const [draft, setDraft] = useState('')
  const mapWrapRef = useRef<HTMLDivElement | null>(null)
  const textEditorRef = useRef<HTMLDivElement | null>(null)
  const [textEditorPosition, setTextEditorPosition] = useState<{ left: number; top: number } | null>(null)
  const [routeDraftSource, setRouteDraftSource] = useState<RouteDraftSource>(null)
  const [selectedRouteUid, setSelectedRouteUid] = useState<string | null>(null)
  const [routeEditorOpen, setRouteEditorOpen] = useState(false)
  const [branchPickRouteUid, setBranchPickRouteUid] = useState<string | null>(null)

  useEffect(() => {
    setRouteDraftSource(null)
    setSelectedRouteUid(null)
    setRouteEditorOpen(false)
    setBranchPickRouteUid(null)
  }, [view])
  useEffect(() => {
    if (tool !== 'pan') {
      setRouteDraftSource(null)
      setBranchPickRouteUid(null)
    }
  }, [tool])
  // 载具位置注册表（第十四轮：套索框选/整体移动的实时位置来源，由 VehicleLayer 维护）
  const vehiclePosRef = useRef<Record<string, [number, number]>>({})

  // 浮层"共进退"：侧栏展开宽度作为 CSS 变量传给地图浮层（图例/缩放/据点说明）。
  // 窄屏（<=640px）下侧栏压缩为 200px，偏移量同步跟随。
  const [vw, setVw] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const rightPanelWidth = platform.kind === 'android' ? '200px' : vw <= 640 ? '200px' : '250px'
  const leftPanelWidth = platform.kind === 'android' ? 'min(58vw, 260px)' : 'var(--left-panel-width, 300px)'

  const panelInsetVars = useMemo(
    () =>
      ({
        '--left-panel-w': leftOpen ? leftPanelWidth : '0px',
        '--right-panel-w': rightOpen ? rightPanelWidth : '0px',
      }) as CSSProperties,
    [leftOpen, leftPanelWidth, rightOpen, rightPanelWidth],
  )

  const handleStartEdit = useCallback((edit: ActiveTextEdit) => {
    setDraft(edit.initialText)
    setTextEditorPosition(null)
    setEditing(edit)
  }, [])

  useEffect(() => {
    if (!editing) return
    const placeEditor = () => {
      const wrap = mapWrapRef.current
      const editor = textEditorRef.current
      if (!wrap || !editor) return

      const wrapRect = wrap.getBoundingClientRect()
      const viewport = window.visualViewport
      const visibleLeft = Math.max(wrapRect.left, viewport?.offsetLeft ?? 0)
      const visibleTop = Math.max(wrapRect.top, viewport?.offsetTop ?? 0)
      const visibleRight = Math.min(wrapRect.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth))
      const visibleBottom = Math.min(wrapRect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight))
      const margin = 8
      const anchorX = wrapRect.left + (editing.containerPoint?.x ?? wrapRect.width / 2)
      const anchorY = wrapRect.top + (editing.containerPoint?.y ?? 0) + 10
      const maxLeft = Math.max(visibleLeft + margin, visibleRight - editor.offsetWidth - margin)
      const maxTop = Math.max(visibleTop + margin, visibleBottom - editor.offsetHeight - margin)

      setTextEditorPosition({
        left: Math.min(Math.max(anchorX + 12, visibleLeft + margin), maxLeft) - wrapRect.left,
        top: Math.min(Math.max(anchorY, visibleTop + margin), maxTop) - wrapRect.top,
      })
    }

    const frame = window.requestAnimationFrame(placeEditor)
    window.addEventListener('resize', placeEditor)
    window.visualViewport?.addEventListener('resize', placeEditor)
    window.visualViewport?.addEventListener('scroll', placeEditor)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', placeEditor)
      window.visualViewport?.removeEventListener('resize', placeEditor)
      window.visualViewport?.removeEventListener('scroll', placeEditor)
    }
  }, [editing])

  // ---- 干员更换气泡（问题3：点击干员 → 就近气泡 → 选职业） ----
  const [opBubble, setOpBubble] = useState<{ uid: string; x: number; y: number } | null>(null)
  const bubbleOp = opBubble ? operators.find((o) => o.uid === opBubble.uid) ?? null : null

  const handleOpBubbleEdit = useCallback((uid: string, cp: { x: number; y: number }) => {
    // 点击棋子打开三级菜单：同时关闭可能残留的改名浮层（互斥）
    setRenameOp(null)
    setOpBubble({ uid, x: cp.x, y: cp.y })
  }, [])
  const handleCloseOpBubble = useCallback(() => setOpBubble(null), [])

  // ---- 干员昵称快捷编辑（单击棋子顶部代号） ----
  const [renameOp, setRenameOp] = useState<{ uid: string; x: number; y: number } | null>(null)
  const renameTarget = renameOp ? operators.find((o) => o.uid === renameOp.uid) ?? null : null

  const handleOpRenameClick = useCallback((uid: string, cp: { x: number; y: number }) => {
    // 代号单击已独立于棋子（不触发三级菜单）；防御性关闭可能残留的气泡
    setOpBubble(null)
    setRenameOp({ uid, x: cp.x, y: cp.y })
  }, [])
  const handleCloseRename = useCallback(() => setRenameOp(null), [])

  const commitEdit = () => {
    editing?.commit(draft)
    setEditing(null)
  }
  const cancelEdit = () => {
    editing?.cancel()
    setEditing(null)
  }

  // 只显示当前视角的载具（与画笔绘制对称：攻/守方分桶存储，切换视角互不影响）
  const vehicles = useMemo(() => {
    const bucket = state.vehicles as Record<string, unknown> | undefined
    const list = bucket && typeof bucket === 'object' && !Array.isArray(bucket) ? (bucket[view] as never[]) : []
    return Array.isArray(list) ? (list as VehicleItem[]) : []
  }, [state.vehicles, view])

  const routeSnapTargets = useMemo<RouteSnapTarget[]>(() => {
    const targets: RouteSnapTarget[] = []
    for (const team of teams) {
      if (team.lat != null && team.lng != null) targets.push({
        kind: 'team',
        uid: team.uid,
        label: team.name || `${team.team}队`,
        lat: team.lat,
        lng: team.lng,
        binding: {
          side: team.side,
          team: team.team,
          operatorIds: operators.filter((operator) => operator.side === team.side && operator.team === team.team).map((operator) => operator.uid),
          vehicleIds: vehicles.filter((vehicle) => vehicle.side === team.side && vehicle.team === team.team).map((vehicle) => vehicle.uid),
        },
      })
    }
    for (const op of operators) {
      if (op.lat != null && op.lng != null) targets.push({
        kind: 'operator',
        uid: op.uid,
        label: op.name,
        lat: op.lat,
        lng: op.lng,
        binding: { side: op.side, team: op.team, operatorIds: [op.uid], vehicleIds: [] },
      })
    }
    for (const vehicle of vehicles) targets.push({
      kind: 'vehicle',
      uid: vehicle.uid,
      label: vehicle.name,
      lat: vehicle.lat,
      lng: vehicle.lng,
      binding: { side: vehicle.side, team: vehicle.team ?? 'A', operatorIds: [], vehicleIds: [vehicle.uid] },
    })
    for (const stage of runtimeStages) {
      for (const point of stage.points) targets.push({ kind: 'point', uid: `${stage.id}:${point.name}`, label: point.name, lat: point.lat, lng: point.lng })
    }
    for (const route of routes) {
      route.waypoints.forEach((point, waypointIndex) => targets.push({
        kind: 'point',
        uid: `route-node:${route.uid}:${waypointIndex}`,
        label: `${route.name} · ${waypointIndex === 0 ? '起点' : waypointIndex === route.waypoints.length - 1 ? '终点' : `途经点 ${waypointIndex}`}`,
        lat: point[0],
        lng: point[1],
        routeAnchor: { routeUid: route.uid, waypointIndex },
        binding: {
          side: route.side,
          team: route.team,
          operatorIds: [...route.operatorIds],
          vehicleIds: [...route.vehicleIds],
        },
      }))
    }
    return targets
  }, [teams, operators, vehicles, runtimeStages, routes])

  const selectedRoute = useMemo(
    () => routes.find((route) => route.uid === selectedRouteUid) ?? null,
    [routes, selectedRouteUid],
  )
  const handleSelectRoute = useCallback((uid: string | null) => {
    setSelectedRouteUid(uid)
    // 路线与普通图形一致：选中只显示紧凑入口，完整属性面板由用户主动打开。
    setRouteEditorOpen(false)
    setBranchPickRouteUid((current) => current === uid ? current : null)
    if (uid) onCloseDetail()
  }, [onCloseDetail])

  const geoJson = state.drawings[view] ?? '{"type":"FeatureCollection","features":[]}'
  // 路线落点期间也进入绘制穿透态：鼠标经过/点击已有图形不会抢走事件或取消路线。
  const routeDrawing = routeDraftSource != null
  const drawing = tool !== 'pan' || routeDrawing
  // 仅"查看"工具时允许点击属性（据点详情/复活点聚焦/载具展开/道具悬停提示等），
  // 绘制工具激活时全部禁用，避免像普通鼠标一样触发图层交互
  const interactive = tool === 'pan' && !routeDrawing
  // 第十一轮：套索作为绘制工具时，与其他绘制工具一样保持激活（不做其他特殊处理）

  // 选中点位的状态与阶段信息
  const selectedStage = useMemo(() => {
    if (!selectedPoint) return null
    return runtimeStages.find((s) => s.id === selectedPoint.stageId) ?? null
  }, [runtimeStages, selectedPoint])

  const selectedStatus: PointStatus | null = useMemo(() => {
    if (!selectedStage) return null
    const idx = runtimeStages.findIndex((s) => s.id === selectedStage.id)
    if (idx < 0) return null
    if (idx < runtimeStageIndex) return 'captured'
    if (idx === runtimeStageIndex) return 'active'
    return 'locked'
  }, [runtimeStageIndex, runtimeStages, selectedStage])

  // 右键切回查看工具：延后一轮执行，让 LayerManager 先把待确认的曲线草稿提交落盘。
  const handleMapContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (tool !== 'pan') {
        window.setTimeout(() => onTool('pan'), 0)
      }
      e.preventDefault()
    },
    [tool, onTool],
  )

  // 右键按下先阻止 Leaflet 启动新的绘制；真正的工具切换交给 contextmenu，
  // 这样已进入 adjusting 的曲线仍有机会在右键时确认保存。
  // Leaflet 的 map 'mousedown' 事件不区分左右键，右键按下会触发绘制起点。
  // 在 React 捕获阶段拦截右键 mousedown（先于 Leaflet 容器监听），stopPropagation
  // 阻断事件到达 Leaflet → 绘制永不开始；同时 onTool('pan') 立即切回。
  // 同时：点击地图空白区域（非气泡/非干员标记）关闭更换干员气泡（问题3）。
  // 连线模式：右键取消待选端点（保持连线模式开启）。
  const handleMapMouseDownCapture = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement
      // 点击气泡内部或干员标记：不关闭气泡（气泡内容点击走自己的处理）
      if (t.closest('.op-bubble') || t.closest('.op-marker-wrap') || t.closest('.op-rename')) {
        return
      }
      setOpBubble(null)
      setRenameOp(null)
      if (e.button !== 2) return
      e.preventDefault()
      e.stopPropagation()
      // 连线模式：右键取消待选并退出连线模式（左侧开关同步关闭）
      if (wargame.enabled && wargame.connectMode) {
        onCancelConnect()
      }
    },
    [wargame.enabled, wargame.connectMode, onCancelConnect],
  )

  return (
    <div
      ref={mapWrapRef}
      className="map-wrap"
      style={panelInsetVars}
      onContextMenuCapture={handleMapContextMenu}
      onMouseDownCapture={handleMapMouseDownCapture}
    >
      <MapContainer
        key={config.id}
        crs={L.CRS.Simple}
        bounds={bounds}
        minZoom={minZoom}
        maxZoom={config.maxZoom}
        zoomDelta={mobileLayout ? 0.5 : 1}
        zoomSnap={mobileLayout ? 0.5 : 1}
        zoomControl={true}
        touchZoom={true}
        attributionControl={false}
        // 绘制工具激活时进入绘制模式：CSS 物理屏蔽非绘制图层鼠标事件
        className={`tactical-map${drawing ? ' drawing-mode' : ''}`}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          url={config.tileUrl}
          bounds={bounds}
          minZoom={minZoom}
          maxZoom={config.maxZoom}
          maxNativeZoom={config.maxNativeZoom}
          tileSize={256}
        />
        <MapSync
          config={config}
          onReady={onMapReady}
          initialView={cinematicInitialView}
          minZoom={minZoom}
          defaultZoom={defaultZoom}
        />
        <MapResizeSync />
        {cinematicBattleCompare ? <CinematicBattleHighlights stage={cinematicBattleCompare} /> : null}
        <MapPropsLayer
          mapId={config.id}
          visible={layers.props}
          propVis={propVis}
          interactive={interactive}
          propsOverride={modeData?.props ?? propsOverride}
        />
        <PointMarkers
          stages={runtimeStages}
          capturedStageIndex={runtimeStageIndex}
          view={view}
          selectedName={selectedPoint?.point.name ?? null}
          visible={layers.points}
          labelsVisible={layers.pointsLabels}
          captureVisible={layers.pointsCapture}
          frontlineVisible={layers.pointsFrontline}
          interactive={interactive}
          onSelect={onSelectPoint}
        />
        <SpawnMarkers
          stages={runtimeStages}
          capturedStageIndex={runtimeStageIndex}
          view={view}
          visible={layers.spawns}
          interactive={interactive}
          onSelect={onSpawnSelect}
        />
        <ActivityZones
          stages={runtimeStages}
          capturedStageIndex={runtimeStageIndex}
          view={view}
          visible={layers.zones}
        />
        <VehicleLayer
          vehicles={vehicles}
          view={view}
          canDrag={interactive}
          interactive={interactive}
          onMove={onMoveVehicle}
          onRotate={onRotateVehicle}
          onDelete={onDeleteVehicle}
          onToggleSide={onToggleVehicleSide}
          onChangeTeam={onChangeVehicleTeam}
          onStartRoute={(uid) => {
            onTool('pan')
            onCloseDetail()
            setSelectedRouteUid(null)
            setBranchPickRouteUid(null)
            setRouteDraftSource({ kind: 'vehicle', vehicleUid: uid })
          }}
          posRef={vehiclePosRef}
        />
        {wargame.enabled && (
          <BuildingLayer
            buildings={buildings}
            view={view}
            interactive={interactive}
            onMove={onMoveBuilding}
            onRotate={onRotateBuilding}
            onToggleSide={onToggleBuildingSide}
            onChangeTeam={onChangeBuildingTeam}
            onDelete={onDeleteBuilding}
            onStartRoute={(uid) => {
              onTool('pan')
              onCloseDetail()
              setSelectedRouteUid(null)
              setBranchPickRouteUid(null)
              setRouteDraftSource({ kind: 'building', buildingUid: uid })
            }}
          />
        )}
        {/* 兵棋推演：干员标记层（视角桶内含双方 40 人；我方绿圈可交互，敌方红圈亦可部署/连线对抗） */}
        {wargame.enabled && (
          <OperatorLayer
            view={view}
            operators={operators}
            posRef={operatorPosRef}
            canDrag={interactive}
            connectMode={wargame.connectMode}
            pendingConnect={pendingConnect}
            interactive={interactive}
            onMove={onMoveOperator}
            onClearDeploy={onClearOperatorDeploy}
            onStartRoute={(uid) => {
              onTool('pan')
              onCloseDetail()
              setSelectedRouteUid(null)
              setBranchPickRouteUid(null)
              setRouteDraftSource({ kind: 'operator', operatorUid: uid })
            }}
            onConnectClick={onConnectClick}
            onEditClick={handleOpBubbleEdit}
            onRenameClick={handleOpRenameClick}
          />
        )}
        {/* 兵棋推演：通用队标层，只表达队伍字母与归属；右键删除。 */}
        {wargame.enabled && (
          <RouteLayer
            routes={routes}
            view={view}
            teams={teams}
            operators={operators}
            vehicles={vehicles}
            buildings={buildings}
            snapTargets={routeSnapTargets}
            draftSource={routeDraftSource}
            selectedUid={selectedRouteUid}
            branchPicking={branchPickRouteUid === selectedRouteUid && selectedRouteUid != null}
            interactive={interactive}
            onSelect={handleSelectRoute}
            onBranchPoint={(waypointIndex) => {
              if (!selectedRouteUid) return
              setBranchPickRouteUid(null)
              setRouteDraftSource({ kind: 'branch', routeUid: selectedRouteUid, waypointIndex })
            }}
            onDraftEnd={() => setRouteDraftSource(null)}
            onCreate={onCreateRoute}
            onPatch={onUpdateRoute}
            onDelete={onDeleteRoute}
          />
        )}
        {selectedRoute && !routeDrawing && !routeEditorOpen && (
          <RouteEditorTrigger
            route={selectedRoute}
            onOpen={() => setRouteEditorOpen(true)}
            onDelete={() => {
              onDeleteRoute(selectedRoute.uid)
              setSelectedRouteUid(null)
              setRouteEditorOpen(false)
              setBranchPickRouteUid(null)
            }}
          />
        )}
        {wargame.enabled && (
          <TeamLayer
            view={view}
            teams={teams}
            teamNames={wargame.teamRoles ?? {}}
            posRef={teamPosRef}
            canDrag={interactive}
            interactive={interactive}
            onMove={onMoveTeamMarker}
            onDelete={onDeleteTeamMarker}
            onStartRoute={(uid) => {
              onTool('pan')
              onCloseDetail()
              setSelectedRouteUid(null)
              setBranchPickRouteUid(null)
              setRouteDraftSource({ kind: 'team', teamUid: uid })
            }}
          />
        )}
        {/* 兵棋推演：无方向协同关系层；只表示谁与谁协同。 */}
        {wargame.enabled && (
          <ConnectionLayer
            connections={connections}
            operators={operators}
            visible={wargame.showConnections}
            connectMode={wargame.connectMode}
            interactive={interactive}
            view={view}
            onRemoveConnection={onRemoveConnection}
          />
        )}
        <LayerManager
          view={view}
          tool={tool}
          geoJson={geoJson}
          draw={draw}
          onCommitDraw={onCommitDraw}
          deleteSelectedTick={deleteSelectedTick}
          clearDrawTick={clearDrawTick}
          onDeleteSelCount={onDeleteSelCount}
          onDrawSaved={onDrawSaved}
          onStartEdit={handleStartEdit}
          vehicles={vehicles}
          vehiclePosRef={vehiclePosRef}
          onMoveVehicles={onMoveVehicles}
          onDeleteVehicles={onDeleteVehicles}
          operators={operators}
          operatorPosRef={operatorPosRef}
          onMoveOperators={onMoveOperators}
          onDeleteOperators={onDeleteOperators}
          teams={teams}
          teamPosRef={teamPosRef}
          onMoveTeams={onMoveTeamMarkers}
          onDeleteTeams={onDeleteTeamMarkers}
        />
      </MapContainer>

      {selectedRoute && !routeDrawing && routeEditorOpen && (
        <RouteEditorPanel
          key={selectedRoute.uid}
          route={selectedRoute}
          view={view}
          availableOperators={operators.filter((operator) => operator.side === selectedRoute.side && operator.team === selectedRoute.team)}
          branchPicking={branchPickRouteUid === selectedRoute.uid}
          onPatch={(patch) => onUpdateRoute(selectedRoute.uid, patch)}
          onCopy={() => {
            const copy: TacticalRoute = {
              ...selectedRoute,
              uid: genUid('route'),
              name: `${selectedRoute.name} · 副本`,
              anchorMode: 'free',
              anchorOperatorUid: undefined,
              anchorVehicleUid: undefined,
              teamMarkerUid: '',
              branchFromRouteUid: undefined,
              branchFromWaypointIndex: undefined,
              waypoints: selectedRoute.waypoints.map((point) => [...point] as [number, number]),
              operatorIds: [...selectedRoute.operatorIds],
              vehicleIds: [...selectedRoute.vehicleIds],
              createdAt: Date.now(),
            }
            onCreateRoute(copy)
            setSelectedRouteUid(copy.uid)
            setRouteEditorOpen(false)
          }}
          onReverse={() => onUpdateRoute(selectedRoute.uid, {
            waypoints: [...selectedRoute.waypoints].reverse(),
            labelPosition: undefined,
            anchorMode: 'free',
            anchorOperatorUid: undefined,
            anchorVehicleUid: undefined,
            teamMarkerUid: '',
            branchFromRouteUid: undefined,
            branchFromWaypointIndex: undefined,
            target: undefined,
          })}
          onBranch={() => setBranchPickRouteUid((uid) => uid === selectedRoute.uid ? null : selectedRoute.uid)}
          onDelete={() => {
            onDeleteRoute(selectedRoute.uid)
            setSelectedRouteUid(null)
            setRouteEditorOpen(false)
            setBranchPickRouteUid(null)
          }}
          onClose={() => {
            setRouteEditorOpen(false)
            setBranchPickRouteUid(null)
          }}
        />
      )}

      {/* 干员更换气泡（问题3：点击干员就近弹出，仅文字；选职业后关闭） */}
      {bubbleOp && opBubble && (
        <OpBubble
          op={bubbleOp}
          position={opBubble}
          onOperatorChange={onOperatorChange}
          onStatusChange={onOperatorStatusChange}
          onClose={handleCloseOpBubble}
        />
      )}

      {/* 干员昵称快捷编辑（单击代号弹出） */}
      {renameTarget && renameOp && (
        <OpRenameBar
          uid={renameTarget.uid}
          initial={renameTarget.name}
          position={renameOp}
          onSubmit={onOperatorRename}
          onClose={handleCloseRename}
        />
      )}

      {/* 区域图例（问题3 三色规则：仅当前争夺阶段显示） */}
      {runtimeStageIndex < runtimeStages.length && (
        <div className={`zone-legend${legendOpen ? '' : ' collapsed'}`}>
          {legendOpen ? (
            <>
              <div className="zone-legend-title">
                <span>区域 · {runtimeStages[runtimeStageIndex].id}</span>
                <button type="button" className="zone-legend-toggle" onClick={onToggleLegend} title="收起图例" aria-label="收起区域图例" aria-expanded="true">
                  <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                </button>
              </div>
              <div className="zone-legend-item">
                <span className="swatch own" />
                己方区域（绿）
              </div>
              <div className="zone-legend-item">
                <span className="swatch neutral" />
                中立 / 待争夺（金）
              </div>
              <div className="zone-legend-item">
                <span className="swatch deny" />
                敌方区域（红）
              </div>
            </>
          ) : (
            <button type="button" className="zone-legend-toggle compact" onClick={onToggleLegend} title="展开图例" aria-label="展开区域图例" aria-expanded="false">
              <i className="fa-solid fa-map" aria-hidden="true" />
              <span>图例</span>
              <i className="fa-solid fa-chevron-up" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* 选中点位详情卡 */}
      {selectedPoint && selectedStage && (
        <div className="point-detail">
          <div className="point-detail-head">
            <span className="point-detail-name">{selectedPoint.point.name}</span>
            <span
              className={`point-detail-status ${selectedStatus ?? 'locked'}`}
            >
              {selectedStatus ? STATUS_TEXT[selectedStatus] : ''}
            </span>
          </div>
          <div className="point-detail-row">
            <span className="dim">阶段</span>
            <span>{selectedStage.id} · {selectedStage.label}</span>
          </div>
          <div className="point-detail-row">
            <span className="dim">当前状态</span>
            <span>
              {selectedStatus === 'active'
                ? view === 'attack'
                  ? '进攻方目标：占领此区域'
                  : '防守方目标：坚守此区域'
                : selectedStatus === 'captured'
                  ? '已被进攻方占领'
                  : '尚未开放，需先攻下前序区域'}
            </span>
          </div>
          {selectedPoint.point.note && (
            <div className="point-detail-row">
              <span className="dim">备注</span>
              <span>{selectedPoint.point.note}</span>
            </div>
          )}
          <button className="btn point-detail-close" onClick={onCloseDetail}>
            关闭
          </button>
        </div>
      )}

      {editing && (
        <div
          ref={textEditorRef}
          className="text-editor"
          // 第十三轮：编辑器跟随文字标注位置显示（容器坐标），不再固定在顶部被横幅遮挡。
          // 地图容器尺寸取窗口估算，向右/向下超出边缘时向内收，避免溢出视口。
          style={textEditorPosition
            ? { top: textEditorPosition.top, left: textEditorPosition.left, transform: 'none' }
            : { visibility: 'hidden' }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') cancelEdit()
            }}
            placeholder="输入标注文字，回车确认"
          />
          <button className="btn primary" onClick={commitEdit}>
            确定
          </button>
          <button className="btn" onClick={cancelEdit}>
            取消
          </button>
        </div>
      )}
    </div>
  )
}
