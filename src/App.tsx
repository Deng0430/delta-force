import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as L from 'leaflet'
import type {
  CapturePoint,
  BuildingUnit,
  BuildingUnitKind,
  HistoryEntry,
  HistoryKey,
  LayerVisibility,
  MapsData,
  MapState,
  MapStateSnapshot,
  ModeConfigStore,
  ModeVehicleRefreshPoint,
  ModeVehicleRefreshRule,
  PropVisibility,
  Side,
  TacticalBucket,
  TacticalPlan,
  TacticalRoute,
  TacticalObjectiveState,
  TeamMarker,
  ToolMode,
  VehicleItem,
  WargameState,
} from './types'
import { MAP_BY_ID } from './config/maps'
import { applyTacticalBucket, buildingsBucketOf, createEmptyMapState, createTacticalRound, fieldSupportsBucketOf, loadState, normalizeDrawingGeoJson, normalizeTacticalBucket, saveState, snapshotTacticalBucket, syncActiveTacticalBucket, tacticalBucketKey, vehiclesBucketOf, operatorsBucketOf, connectionsBucketOf, teamsBucketOf, routesBucketOf, wargameOf } from './utils/storage'
import { emptyGeoJson, genUid } from './utils/geo'
import { buildTacticalHtml, downloadText } from './utils/exportTactical'
import type { CustomVehicleTemplate } from './config/customVehicles'
import type { DeployVehicleEntry } from './config/deployVehicles'
import { buildDefaultOperators } from './config/operators'
import { buildingUnitOf } from './config/buildingUnits'
import { defaultProfileForTeam, profileOf } from './config/operatorProfiles'
const SHARED_SMOKE_WIDTH_RATIO = 0.04
const SHARED_SMOKE_RADIUS_RATIO = 0.004
import { operatorSkillsOf, type OperatorSkillDefinition } from './config/operatorSkills'
import type { OperatorConnection, OperatorTeam, OperatorUnit } from './types'
import type { DeployTarget } from './components/DeployBar'
import DeployBar from './components/DeployBar'
import Toolbar from './components/Toolbar'
import LeftPanel from './components/LeftPanel'
import MapView from './components/MapView'
import PointPanel from './components/PointPanel'
import TacticalBoardModal from './components/TacticalBoardModal'
import {
  MODE_CONFIG_STORAGE_KEY,
  MODE_CONFIG_SYNC_CHANNEL,
  MODE_CONFIG_SYNC_MESSAGE,
  buildOfficialModeData,
  emptyModeMapOverride,
  loadModeConfigStore,
  normalizeModeConfigStore,
  saveModeConfigStore,
} from './utils/modeConfigStorage'
import { platform } from './platform'
import { useDeviceType } from './hooks/useDeviceType'
import { propsForPlatform, stagesForPlatform, type GameDataPlatform } from './config/gameDataPlatform'
import { evaluateVehicleRefreshRule } from './utils/vehicleRefreshRuntime'

const DEFAULT_MAP_IDS = ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock']
const DEFAULT_PROP_VIS: PropVisibility = {
  载具补给站: true,
  固定防空炮: true,
  密集阵: true,
  固定机枪: true,
  岸防炮: true,
  滑索: true,
  电梯: true,
  固定弹药箱: true,
}

/**
 * 切换阶段时统一归属：推进所完成的阶段归攻方；每次进入的目标阶段
 * 都重置为中立；目标阶段之后所有未激活据点归守方。
 */
function normalizeObjectivesForStageChange(
  state: MapState,
  stageList: Array<{ points: CapturePoint[] }>,
  fromIndex: number,
  toIndex: number,
): MapState {
  const currentWargame = wargameOf(state)
  const objectiveStates = { ...currentWargame.battleContext.objectiveStates }
  if (toIndex > fromIndex) {
    for (let stageIndex = Math.max(0, fromIndex); stageIndex < toIndex; stageIndex += 1) {
      for (const point of stageList[stageIndex]?.points ?? []) {
        objectiveStates[point.name] = { owner: 'attack', capturingSide: null, progress: 100 }
      }
    }
  }
  for (const point of stageList[toIndex]?.points ?? []) {
    objectiveStates[point.name] = { owner: 'neutral', capturingSide: null, progress: 0 }
  }
  for (let stageIndex = toIndex + 1; stageIndex < stageList.length; stageIndex += 1) {
    for (const point of stageList[stageIndex]?.points ?? []) {
      objectiveStates[point.name] = { owner: 'defense', capturingSide: null, progress: 100 }
    }
  }
  return {
    ...state,
    wargame: {
      ...currentWargame,
      battleContext: { ...currentWargame.battleContext, objectiveStates },
    },
  }
}

/** 将分支路线首点递归吸附到父路线节点；父节点删除时自动夹取到仍存在的最近节点。 */
function syncBranchRouteOrigins(routes: TacticalRoute[]): TacticalRoute[] {
  let next = routes
  for (let pass = 0; pass < routes.length; pass++) {
    let changed = false
    const byUid = new Map(next.map((route) => [route.uid, route]))
    next = next.map((route) => {
      if (route.anchorMode !== 'branch' || !route.branchFromRouteUid) return route
      const parent = byUid.get(route.branchFromRouteUid)
      if (!parent) return { ...route, anchorMode: 'free', branchFromRouteUid: undefined, branchFromWaypointIndex: undefined }
      const index = Math.max(0, Math.min(route.branchFromWaypointIndex ?? parent.waypoints.length - 1, parent.waypoints.length - 1))
      const origin = parent.waypoints[index]
      const current = route.waypoints[0]
      if (current?.[0] === origin[0] && current?.[1] === origin[1] && index === route.branchFromWaypointIndex) return route
      changed = true
      return { ...route, branchFromWaypointIndex: index, waypoints: [[...origin] as [number, number], ...route.waypoints.slice(1)] }
    })
    if (!changed) break
  }
  return next
}

function routeAndDescendantIds(routes: TacticalRoute[], uid: string): Set<string> {
  const ids = new Set([uid])
  let changed = true
  while (changed) {
    changed = false
    for (const route of routes) {
      if (route.branchFromRouteUid && ids.has(route.branchFromRouteUid) && !ids.has(route.uid)) {
        ids.add(route.uid)
        changed = true
      }
    }
  }
  return ids
}

function syncRouteTargetPosition(
  routes: TacticalRoute[],
  kind: NonNullable<TacticalRoute['target']>['kind'],
  uid: string,
  point: [number, number],
): TacticalRoute[] {
  return syncBranchRouteOrigins(routes.map((route) => {
    if (route.target?.kind !== kind || route.target.uid !== uid) return route
    return { ...route, waypoints: [...route.waypoints.slice(0, -1), point] }
  }))
}

export default function App() {
  const device = useDeviceType()
  const cinematicDemoParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const isCinematicDemoFrame = cinematicDemoParams.get('cinematicDemoFrame') === '1'
  const isCinematicMobileFrame = isCinematicDemoFrame && cinematicDemoParams.get('platformDemo') === 'android'
  const isCinematicMapOnly = isCinematicDemoFrame && cinematicDemoParams.get('mapOnly') === '1'
  const isCinematicLayerTour = isCinematicDemoFrame && cinematicDemoParams.get('layerTour') === '1'
  const isCinematicModeSwitch = isCinematicDemoFrame && cinematicDemoParams.get('modeSwitch') === '1'
  const isCinematicBattleCompare = isCinematicDemoFrame && cinematicDemoParams.get('battleCompare') === '1'
  const isCinematicC1Highlight = isCinematicDemoFrame && cinematicDemoParams.get('c1Highlight') === '1'
  const isCinematicTouchPrinciples = isCinematicDemoFrame && cinematicDemoParams.get('touchPrinciples') === '1'
  const isCinematicPawnMotion = isCinematicDemoFrame && cinematicDemoParams.get('pawnMotion') === '1'
  const isCinematicUnitCards = isCinematicDemoFrame && cinematicDemoParams.get('unitCards') === '1'
  const isCinematicRouteGrow = isCinematicDemoFrame && cinematicDemoParams.get('routeGrow') === '1'
  const cinematicDefenseDemo = cinematicDemoParams.get('defenseDemo') as 'straight' | 'smooth' | 'freehand' | null
  const isCinematicStylePanelDemo = isCinematicDemoFrame && cinematicDemoParams.get('stylePanelDemo') === '1'
  const cinematicLayoutPreset = cinematicDemoParams.get('layoutPreset') as 'winnerA' | 'platformCompare' | 'backdrop' | null
  const cinematicDemoMap = cinematicDemoParams.get('map')
  const cinematicDemoStage = cinematicDemoParams.get('stage')
  const cinematicFocusLat = Number(cinematicDemoParams.get('focusLat'))
  const cinematicFocusLng = Number(cinematicDemoParams.get('focusLng'))
  const cinematicFocusZoom = Number(cinematicDemoParams.get('focusZoom'))
  const persisted = useMemo(loadState, [])
  const initialModeStore = useMemo(() => {
    const store = loadModeConfigStore()
    if (!isCinematicDemoFrame) return store
    return {
      ...store,
      activeModeId: cinematicDemoParams.get('mode') === 'winner' ? 'winner-takes-all' : 'attack-defense',
    }
  }, [cinematicDemoParams, isCinematicDemoFrame])
  const [modeStore, setModeStore] = useState<ModeConfigStore>(initialModeStore)
  const [modeStageSelection, setModeStageSelection] = useState<Record<string, string>>(() => (
    isCinematicDemoFrame && cinematicDemoMap && cinematicDemoStage
      ? { [`winner-takes-all:${cinematicDemoMap}`]: cinematicDemoStage }
      : {}
  ))
  const [gameDataPlatform, setGameDataPlatform] = useState<GameDataPlatform>(() =>
    isCinematicModeSwitch ? 'pc' : localStorage.getItem('deltaforce-game-data-platform') === 'mobile' ? 'mobile' : 'pc',
  )

  const [mapId, setMapId] = useState<string>(
    cinematicDemoMap && MAP_BY_ID[cinematicDemoMap]
      ? cinematicDemoMap
      : persisted?.lastMapId && MAP_BY_ID[persisted.lastMapId] ? persisted.lastMapId : 'ascent',
  )
  const [view, setView] = useState<Side>(persisted?.lastView ?? 'attack')
  const [tool, setTool] = useState<ToolMode>('pan')
  const [maps, setMaps] = useState<MapsData>(() => {
    const base: MapsData = {}
    for (const id of DEFAULT_MAP_IDS) base[id] = createEmptyMapState()
    if (persisted?.maps) {
      for (const id of DEFAULT_MAP_IDS) {
        const saved = persisted.maps[id]
        if (saved) {
          // 二次兜底：即便持久化数据形状异常（旧数组/HMR 污染），也规范化为分桶形状
          base[id] = {
            ...createEmptyMapState(),
            ...saved,
            vehicles: vehiclesBucketOf(saved),
            buildings: buildingsBucketOf(saved),
            operators: operatorsBucketOf(saved),
            connections: connectionsBucketOf(saved),
            teams: teamsBucketOf(saved),
            routes: routesBucketOf(saved),
            wargame: wargameOf(saved),
          }
          // 干员列表为空（v8 迁移或新图）时，初始化默认 5 队×4 人；v10 起桶内含双方（我方+敌方）各 20 人
          for (const side of ['attack', 'defense'] as const) {
            const bucket = base[id].operators[side]
            if (!bucket || bucket.length === 0) {
              base[id].operators[side] = buildDefaultOperators(side)
            } else {
              // 兼容 v9 早期数据：干员缺少 operatorId 时按队伍补默认档案
              const fixed = bucket.map((o) => {
                if (o.operatorId) return o
                const pid = defaultProfileForTeam(o.team)
                const profile = profileOf(pid)
                return { ...o, operatorId: pid, cls: profile.cls }
              })
              // v9→v10 迁移：旧桶只有一方 20 人，补齐另一方（敌方）默认干员，形成红蓝对抗
              const own = fixed.filter((o) => o.side === side)
              const enemy = fixed.filter((o) => o.side !== side)
              if (own.length === 0 || enemy.length === 0) {
                const defaults = buildDefaultOperators(side)
                const ownDefaults = defaults.filter((o) => o.side === side)
                const enemyDefaults = defaults.filter((o) => o.side !== side)
                base[id].operators[side] = [...(own.length ? own : ownDefaults), ...(enemy.length ? enemy : enemyDefaults)]
              } else {
                base[id].operators[side] = fixed
              }
            }
          }
        }
      }
    }
    // 无存档、存档不可用或某张新地图尚无兵棋数据时，也必须创建完整的单兵编制。
    // 每个视角桶都包含当前视角的本方与敌方，各 5 队 × 4 人，共 40 名干员。
    for (const id of DEFAULT_MAP_IDS) {
      for (const side of ['attack', 'defense'] as const) {
        if (base[id].operators[side].length === 0) {
          base[id].operators[side] = buildDefaultOperators(side)
        }
      }
    }
    return base
  })
  // 各地图当前激活阶段下标（问题3：点击据点直接切换）
  const [progress, setProgress] = useState<Record<string, number>>(() => {
    const base: Record<string, number> = Object.fromEntries(DEFAULT_MAP_IDS.map((id) => [id, 0]))
    if (persisted?.progress) {
      for (const id of DEFAULT_MAP_IDS) {
        const v = persisted.progress[id]
        if (typeof v === 'number' && v >= 0) base[id] = v
      }
    }
    return base
  })
  const [selectedPoint, setSelectedPoint] = useState<{
    stageId: string
    point: CapturePoint
  } | null>(null)
  // 底部载具部署栏：点击出生点后显示该出生点可部署载具
  const [deployTarget, setDeployTarget] = useState<DeployTarget | null>(null)
  const [skillActionDraft, setSkillActionDraft] = useState<{ operator: OperatorUnit; skill: OperatorSkillDefinition } | null>(null)
  // 自定义载具部署阵营：本方（绿底）/ 敌方（红底）
  const [customOwn, setCustomOwn] = useState<boolean>(true)
  // 战术方案库（第二十一轮：各阶段默认战术部署，按 地图×阶段×视角 保存）
  const [plans, setPlans] = useState<TacticalPlan[]>(() =>
    Array.isArray(persisted?.plans) ? persisted!.plans : [],
  )
  // 战术板弹窗开关
  const [tacticalOpen, setTacticalOpen] = useState(false)
  const [mobileConfirm, setMobileConfirm] = useState<{
    title: string
    message: string
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)
  const [refreshVehicleDelete, setRefreshVehicleDelete] = useState<{ vehicles: VehicleItem[]; uids: string[] } | null>(null)
  // 左右工具栏折叠 + 图层/道具显示开关（问题1/2/8）+ 画笔设置（问题4）
  const [ui, setUi] = useState(() => ({
    paletteOpen: device.mobileLayout || isCinematicMapOnly || isCinematicMobileFrame || cinematicLayoutPreset === 'platformCompare' || cinematicLayoutPreset === 'backdrop' ? false : persisted?.ui?.paletteOpen ?? true,
    panelOpen: device.mobileLayout || isCinematicMapOnly || isCinematicMobileFrame || cinematicLayoutPreset === 'winnerA' || cinematicLayoutPreset === 'platformCompare' || cinematicLayoutPreset === 'backdrop' ? false : persisted?.ui?.panelOpen ?? true,
    legendOpen: device.mobileLayout || isCinematicMapOnly || Boolean(cinematicDefenseDemo) || cinematicLayoutPreset === 'backdrop' ? false : persisted?.ui?.legendOpen ?? true,
    leftPanelWidth: Math.max(300, Math.min(440, persisted?.ui?.leftPanelWidth ?? 300)),
    layers: {
      props: cinematicLayoutPreset === 'backdrop' || isCinematicMobileFrame ? false : persisted?.ui?.layers?.props ?? true,
      points: cinematicLayoutPreset === 'platformCompare' ? true : cinematicLayoutPreset === 'backdrop' || isCinematicMobileFrame ? false : persisted?.ui?.layers?.points ?? true,
      pointsLabels: cinematicLayoutPreset === 'platformCompare' ? true : cinematicLayoutPreset === 'backdrop' || isCinematicMobileFrame ? false : persisted?.ui?.layers?.pointsLabels ?? true,
      pointsCapture: cinematicLayoutPreset === 'platformCompare' ? true : cinematicLayoutPreset === 'backdrop' || isCinematicMobileFrame ? false : persisted?.ui?.layers?.pointsCapture ?? true,
      pointsFrontline: cinematicLayoutPreset === 'platformCompare' ? true : cinematicLayoutPreset === 'backdrop' || isCinematicMobileFrame ? false : persisted?.ui?.layers?.pointsFrontline ?? true,
      spawns: cinematicLayoutPreset === 'platformCompare' ? true : cinematicLayoutPreset === 'backdrop' || isCinematicMobileFrame ? false : persisted?.ui?.layers?.spawns ?? true,
      zones: cinematicLayoutPreset === 'platformCompare' ? true : cinematicLayoutPreset === 'backdrop' || isCinematicMobileFrame ? false : persisted?.ui?.layers?.zones ?? true,
      vehicleRefresh: persisted?.ui?.layers?.vehicleRefresh ?? true,
    } as LayerVisibility,
    propVis: {
      ...DEFAULT_PROP_VIS,
      ...(persisted?.ui?.propVis ?? {}),
    } as PropVisibility,
    draw: {
      color: persisted?.ui?.draw?.color ?? '#ffd54a',
      weight: persisted?.ui?.draw?.weight ?? 4,
      dash: persisted?.ui?.draw?.dash ?? 'solid',
      arrowStyle: persisted?.ui?.draw?.arrowStyle ?? 'triangle',
      arrowSize: persisted?.ui?.draw?.arrowSize ?? 12,
      curve: persisted?.ui?.draw?.curve ?? 'straight',
      curveAmount: persisted?.ui?.draw?.curveAmount ?? 50,
      fillColor: persisted?.ui?.draw?.fillColor ?? '#3f8cff',
      fillEnabled: persisted?.ui?.draw?.fillEnabled ?? false,
      eraserSize: persisted?.ui?.draw?.eraserSize ?? 44,
      eraserMode: persisted?.ui?.draw?.eraserMode ?? 'shape',
    },
    // 左侧面板折叠区块展开状态（持久化，收缩/展开侧栏不重置；兼容旧数据默认全部展开）
    sections: {
      layers: persisted?.ui?.sections?.layers ?? true,
      props: persisted?.ui?.sections?.props ?? true,
      points: persisted?.ui?.sections?.points ?? true,
      vehicles: persisted?.ui?.sections?.vehicles ?? true,
      wargame: persisted?.ui?.sections?.wargame ?? true,
      vehGroups: persisted?.ui?.sections?.vehGroups ?? {},
    },
  }))

  const mapRef = useRef<L.Map | null>(null)
  const [cinematicTouchMap, setCinematicTouchMap] = useState<L.Map | null>(null)
  const touchDemoStartedRef = useRef(false)
  const pawnMotionStartedRef = useRef(false)
  const unitCardsStartedRef = useRef(false)
  const routeGrowStartedRef = useRef(false)
  const defenseDemoStartedRef = useRef(false)
  const stylePanelDemoStartedRef = useRef(false)
  const config = MAP_BY_ID[mapId] ?? MAP_BY_ID.ascent
  const platformStages = useMemo(() => stagesForPlatform(gameDataPlatform), [gameDataPlatform])
  const platformProps = useMemo(() => propsForPlatform(gameDataPlatform), [gameDataPlatform])
  const stages = platformStages[mapId] ?? []
  const capturedStageIndex = Math.min(progress[mapId] ?? 0, Math.max(0, stages.length - 1))
  const activeModeProfile = useMemo(
    () => modeStore.profiles.find((profile) => profile.id === modeStore.activeModeId) ?? null,
    [modeStore.activeModeId, modeStore.profiles],
  )
  const activeModeMap = useMemo(
    () => activeModeProfile
      ? (activeModeProfile.id === 'attack-defense' ? activeModeProfile.platformMaps?.[gameDataPlatform] : activeModeProfile.maps)?.[mapId]
        ?? activeModeProfile.maps[mapId]
        ?? emptyModeMapOverride(mapId)
      : null,
    [activeModeProfile, gameDataPlatform, mapId],
  )
  const gameModeName = activeModeProfile?.name ?? '攻防模式'
  const modeStageKey = activeModeProfile ? `${activeModeProfile.id}:${mapId}` : ''
  const activeModeStageId = activeModeMap
    ? activeModeMap.stages.some((stage) => stage.id === modeStageSelection[modeStageKey])
      ? modeStageSelection[modeStageKey]
      : activeModeMap.stages[0]?.id ?? 'S1'
    : null
  const activeOfficialMode = useMemo(
    () => activeModeProfile ? buildOfficialModeData(activeModeProfile, gameDataPlatform) : null,
    [activeModeProfile, gameDataPlatform],
  )
  const activeOfficialModeMap = activeOfficialMode?.maps[mapId] ?? null
  const pointPanelStages = activeOfficialModeMap?.stages.length ? activeOfficialModeMap.stages : stages
  const pointPanelStageIndex = activeOfficialModeMap?.stages.length
    ? Math.max(0, activeOfficialModeMap.stages.findIndex((stage) => stage.id === activeModeStageId))
    : capturedStageIndex
  const initializedMapEntryRef = useRef('')

  // 每次实际进入“数据端 + 模式 + 地图”组合时都从第一阶段开始：当前
  // 第一阶段据点为中立，后续据点为守方。使用 entry key 防止同一张地图
  // 停留期间因普通状态更新而反复覆盖用户手动设置的据点归属。
  useEffect(() => {
    const entryKey = `${gameDataPlatform}:${activeModeProfile?.id ?? 'attack-defense'}:${mapId}`
    if (initializedMapEntryRef.current === entryKey) return
    initializedMapEntryRef.current = entryKey
    const entryStages = activeOfficialModeMap?.stages.length ? activeOfficialModeMap.stages : stages
    const firstStageId = entryStages[0]?.id
    if (!firstStageId) return

    setProgress((current) => current[mapId] === 0 ? current : { ...current, [mapId]: 0 })
    if (activeModeProfile) {
      const entryModeStageKey = `${activeModeProfile.id}:${mapId}`
      setModeStageSelection((current) => current[entryModeStageKey] === firstStageId
        ? current
        : { ...current, [entryModeStageKey]: firstStageId })
    }
    setMaps((current) => {
      const state = current[mapId] ?? createEmptyMapState()
      const normalized = normalizeObjectivesForStageChange(state, entryStages, 0, 0)
      return { ...current, [mapId]: normalized }
    })
    setSelectedPoint(null)
    setDeployTarget(null)
  }, [activeModeProfile, activeOfficialModeMap, gameDataPlatform, mapId, stages])

  const handleSelectModeStage = useCallback((id: string) => {
    if (!modeStageKey || !activeModeMap?.stages.some((stage) => stage.id === id)) return
    const fromIndex = Math.max(0, activeModeMap.stages.findIndex((stage) => stage.id === activeModeStageId))
    const toIndex = activeModeMap.stages.findIndex((stage) => stage.id === id)
    if (toIndex !== fromIndex) {
      setMaps((current) => {
        const state = current[mapId] ?? createEmptyMapState()
        const sourceStage = activeModeStageId || activeOfficialModeMap?.stages?.[fromIndex]?.id || 'S1'
        const sourceBucket = snapshotTacticalBucket(state, sourceStage, wargameOf(state).round)
        const previousStore = state.tacticalBuckets ?? { activeKey: sourceBucket.key, buckets: {} }
        const stored = { ...previousStore.buckets, [sourceBucket.key]: sourceBucket }
        const targetStage = id
        const currentRoundKey = tacticalBucketKey(targetStage, wargameOf(state).round)
        const existingTarget = stored[currentRoundKey]
          ?? Object.values(stored).filter((bucket) => bucket.stageId === targetStage).sort((a, b) => a.round - b.round)[0]
        const emptyTarget = createEmptyMapState()
        emptyTarget.operators = {
          attack: operatorsBucketOf(state).attack.map((operator) => ({ ...structuredClone(operator), lat: null, lng: null })),
          defense: operatorsBucketOf(state).defense.map((operator) => ({ ...structuredClone(operator), lat: null, lng: null })),
        }
        const targetBase = existingTarget ?? snapshotTacticalBucket(emptyTarget, targetStage, 1)
        const target = {
          ...targetBase,
          operators: {
            attack: targetBase.operators.attack.length ? targetBase.operators.attack : emptyTarget.operators.attack,
            defense: targetBase.operators.defense.length ? targetBase.operators.defense : emptyTarget.operators.defense,
          },
        }
        stored[target.key] = target
        const staged = { ...normalizeObjectivesForStageChange({ ...state, tacticalBuckets: { activeKey: sourceBucket.key, buckets: stored } }, activeOfficialModeMap?.stages ?? [], fromIndex, toIndex), tacticalBuckets: { activeKey: sourceBucket.key, buckets: stored } }
        return { ...current, [mapId]: applyTacticalBucket({ ...staged, tacticalBuckets: { activeKey: target.key, buckets: stored } }, target) }
      })
    }
    setModeStageSelection((current) => ({ ...current, [modeStageKey]: id }))
    setSelectedPoint(null)
    setDeployTarget(null)
  }, [activeModeMap, activeModeStageId, activeOfficialModeMap, mapId, modeStageKey])

  const updateMap = useCallback((id: string, fn: (s: MapState) => MapState) => {
    setMaps((prev) => {
      const before = prev[id] ?? createEmptyMapState()
      const next = fn(before)
      const tacticalContentChanged =
        next.vehicles !== before.vehicles
        || next.buildings !== before.buildings
        || next.drawings !== before.drawings
        || next.operators !== before.operators
        || next.connections !== before.connections
        || next.teams !== before.teams
        || next.routes !== before.routes
        || next.fieldSupports !== before.fieldSupports
        || next.skillActions !== before.skillActions
      const synced = tacticalContentChanged
        ? syncActiveTacticalBucket(next, activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1')
        : next
      return { ...prev, [id]: synced }
    })
  }, [activeModeStageId, capturedStageIndex, stages])

  const handleOpenModeEditor = useCallback(() => {
    const editor = platform.openPath(
      '/mode-config.html',
      {
        target: 'deltaforce-mode-config-editor',
        features: 'popup=yes,width=1440,height=900,resizable=yes,scrollbars=no',
      },
    )
    editor?.focus()
  }, [])

  const handleSelectGameMode = useCallback((id: string) => {
    setModeStore((current) => ({
      ...current,
      activeModeId: id === 'attack-defense' || current.profiles.some((profile) => profile.id === id)
        ? id
        : 'attack-defense',
    }))
    setSelectedPoint(null)
    setDeployTarget(null)
  }, [])

  // 撤回/恢复（重构：历史栈上移 App，覆盖绘制 + 载具，按 地图+视角 分栈）
  // mapsRef：操作前快照的同步来源（setMaps 是异步的，不能从闭包 maps 取最新值）
  const mapsRef = useRef(maps)
  mapsRef.current = maps
  const historyRef = useRef<Record<HistoryKey, { undo: HistoryEntry[]; redo: HistoryEntry[] }>>({})
  // 历史版本号：入栈/出栈后 +1，驱动按钮置灰状态重渲染
  const [histVersion, setHistVersion] = useState(0)
  // 载具旋转会话（滚轮连续滚动时合并为一条历史，300ms 停止后提交）
  const rotateSessionRef = useRef<Record<string, { before: MapStateSnapshot; timer: number }>>({})
  const buildingRotateSessionRef = useRef<Record<string, { before: MapStateSnapshot; timer: number }>>({})

  /** 深拷贝当前地图状态为历史快照 */
  const cloneState = useCallback((s: MapState): MapStateSnapshot => {
    const bucket = vehiclesBucketOf(s)
    const buildings = buildingsBucketOf(s)
    const ops = operatorsBucketOf(s)
    const conns = connectionsBucketOf(s)
    const tm = teamsBucketOf(s)
    const routes = routesBucketOf(s)
    return {
      vehicles: {
        attack: bucket.attack.map((v) => ({ ...v })),
        defense: bucket.defense.map((v) => ({ ...v })),
      },
      buildings: {
        attack: buildings.attack.map((item) => ({ ...item })),
        defense: buildings.defense.map((item) => ({ ...item })),
      },
      drawings: { attack: s.drawings.attack, defense: s.drawings.defense },
      operators: {
        attack: ops.attack.map((o) => ({ ...o })),
        defense: ops.defense.map((o) => ({ ...o })),
      },
      connections: {
        attack: conns.attack.map((c) => ({ ...c })),
        defense: conns.defense.map((c) => ({ ...c })),
      },
      teams: {
        attack: tm.attack.map((t) => ({ ...t })),
        defense: tm.defense.map((t) => ({ ...t })),
      },
      routes: {
        attack: routes.attack.map((r) => ({ ...r, waypoints: r.waypoints.map((p) => [...p] as [number, number]), operatorIds: [...r.operatorIds], vehicleIds: [...r.vehicleIds] })),
        defense: routes.defense.map((r) => ({ ...r, waypoints: r.waypoints.map((p) => [...p] as [number, number]), operatorIds: [...r.operatorIds], vehicleIds: [...r.vehicleIds] })),
      },
    }
  }, [])

  const sameState = useCallback((a: MapStateSnapshot, b: MapStateSnapshot): boolean => {
    const sameBucket = (xs: VehicleItem[], ys: VehicleItem[]) => {
      if (xs.length !== ys.length) return false
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const y = ys[i]
        if (x.uid !== y.uid || x.lat !== y.lat || x.lng !== y.lng || x.rotation !== y.rotation || x.side !== y.side || x.team !== y.team) return false
      }
      return true
    }
    const sameOps = (xs: OperatorUnit[], ys: OperatorUnit[]) => {
      if (xs.length !== ys.length) return false
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const y = ys[i]
        if (x.uid !== y.uid || x.operatorId !== y.operatorId || x.cls !== y.cls || x.status !== y.status || x.lat !== y.lat || x.lng !== y.lng || x.team !== y.team) return false
      }
      return true
    }
    const sameConns = (xs: OperatorConnection[], ys: OperatorConnection[]) => {
      if (xs.length !== ys.length) return false
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const y = ys[i]
        if (x.id !== y.id || x.operatorAId !== y.operatorAId || x.operatorBId !== y.operatorBId || x.style !== y.style) return false
      }
      return true
    }
    const sameTeams = (xs: TeamMarker[], ys: TeamMarker[]) => {
      if (xs.length !== ys.length) return false
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const y = ys[i]
        if (x.uid !== y.uid || x.lat !== y.lat || x.lng !== y.lng || x.role !== y.role || x.name !== y.name) return false
      }
      return true
    }
    const sameRoutes = (xs: TacticalRoute[], ys: TacticalRoute[]) => JSON.stringify(xs) === JSON.stringify(ys)
    const sameBuildings = (xs: BuildingUnit[] = [], ys: BuildingUnit[] = []) => JSON.stringify(xs) === JSON.stringify(ys)
    if (!sameBucket(a.vehicles.attack, b.vehicles.attack)) return false
    if (!sameBucket(a.vehicles.defense, b.vehicles.defense)) return false
    if (!sameBuildings(a.buildings?.attack, b.buildings?.attack)) return false
    if (!sameBuildings(a.buildings?.defense, b.buildings?.defense)) return false
    if (!sameOps(a.operators.attack, b.operators.attack)) return false
    if (!sameOps(a.operators.defense, b.operators.defense)) return false
    if (!sameConns(a.connections.attack, b.connections.attack)) return false
    if (!sameConns(a.connections.defense, b.connections.defense)) return false
    if (!sameTeams(a.teams.attack, b.teams.attack)) return false
    if (!sameTeams(a.teams.defense, b.teams.defense)) return false
    if (!sameRoutes(a.routes.attack, b.routes.attack)) return false
    if (!sameRoutes(a.routes.defense, b.routes.defense)) return false
    return a.drawings.attack === b.drawings.attack && a.drawings.defense === b.drawings.defense
  }, [])

  /** 入栈（去重空操作），按当前 地图+视角 分桶 */
  const pushEntry = useCallback(
    (before: MapStateSnapshot, after: MapStateSnapshot) => {
      if (sameState(before, after)) return
      const key: HistoryKey = `${mapId}:${view}`
      const bucket = historyRef.current[key] ?? (historyRef.current[key] = { undo: [], redo: [] })
      bucket.undo.push({ before, after })
      bucket.redo = []
      setHistVersion((v) => v + 1)
    },
    [mapId, view, sameState],
  )

  /** 载具类操作的统一入栈入口：mutator 为纯函数（输入当前视角载具数组 → 输出新数组） */
  const commitVehicleChange = useCallback(
    (mutator: (vs: VehicleItem[]) => VehicleItem[]) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      updateMap(mapId, (s) => {
        const bucket = vehiclesBucketOf(s)
        return {
          ...s,
          vehicles: { ...bucket, [view]: mutator(bucket[view] ?? []) },
        }
      })
      const after = {
        ...before,
        vehicles: { ...before.vehicles, [view]: mutator(before.vehicles[view] ?? []) },
      }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 绘制操作提交（LayerManager 上报 before/after GeoJSON，App 统一入栈 + 落盘） */
  const handleCommitDraw = useCallback(
    (beforeStr: string, afterStr: string) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const curBucket = vehiclesBucketOf(cur)
      const ops = operatorsBucketOf(cur)
      const conns = connectionsBucketOf(cur)
      const tm = teamsBucketOf(cur)
      const routes = routesBucketOf(cur)
      const mk = (g: string): MapStateSnapshot => ({
        vehicles: { attack: curBucket.attack, defense: curBucket.defense },
        drawings: { ...cur.drawings, [view]: g },
        operators: ops,
        connections: conns,
        teams: tm,
        routes,
      })
      pushEntry(mk(beforeStr), mk(afterStr))
      updateMap(mapId, (s) => ({ ...s, drawings: { ...s.drawings, [view]: afterStr } }))
    },
    [mapId, view, pushEntry, updateMap],
  )

  useEffect(() => {
    if (!isCinematicTouchPrinciples || touchDemoStartedRef.current) return
    const map = cinematicTouchMap
    if (!map) return
    touchDemoStartedRef.current = true
    const uid = 'cinematic_touch_circle'
    const center = L.latLng(-117.455, 87.686)
    const container = map.getContainer()
    const touchPoint = document.createElement('div')
    touchPoint.className = 'app-touch-demo-point'
    container.appendChild(touchPoint)
    const containerSize = container.getBoundingClientRect()
    const emptyDx = -Math.min(280, containerSize.width * .3)
    const emptyDy = Math.min(145, containerSize.height * .24)
    const radius = 8
    const drawing = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          uid,
          type: 'circle',
          color: '#00e39b',
          weight: 4,
          dash: 'solid',
          fillColor: '#00e39b',
          fillEnabled: true,
          radius,
          radiusY: radius,
        },
        geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
      }],
    })
    updateMap(mapId, (current) => ({
      ...current,
      drawings: { ...current.drawings, [view]: drawing },
    }))

    const timers: number[] = []
    const later = (delay: number, action: () => void) => timers.push(window.setTimeout(action, delay))
    const pointAt = (dx = 0, dy = 0) => {
      const rect = map.getContainer().getBoundingClientRect()
      const point = map.latLngToContainerPoint(center)
      return { x: rect.left + point.x + dx, y: rect.top + point.y + dy }
    }
    const placeTouchPoint = (x: number, y: number) => {
      const rect = container.getBoundingClientRect()
      touchPoint.style.left = `${x - rect.left}px`
      touchPoint.style.top = `${y - rect.top}px`
      touchPoint.classList.add('visible')
    }
    const pulseTouchPoint = () => {
      touchPoint.classList.remove('contact')
      void touchPoint.offsetWidth
      touchPoint.classList.add('contact')
    }
    const emit = (type: string, x: number, y: number, buttons: number) => {
      placeTouchPoint(x, y)
      if (type === 'pointerdown') pulseTouchPoint()
      const target = document.elementFromPoint(x, y) ?? map.getContainer()
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
        buttons,
        button: 0,
      }))
    }
    const fireLeafletClick = (point: { x: number; y: number }) => {
      const rect = container.getBoundingClientRect()
      const containerPoint = L.point(point.x - rect.left, point.y - rect.top)
      map.fire('click', {
        latlng: map.containerPointToLatLng(containerPoint),
        layerPoint: map.containerPointToLayerPoint(containerPoint),
        containerPoint,
        originalEvent: new MouseEvent('click', {
          clientX: point.x,
          clientY: point.y,
          button: 0,
          buttons: 0,
        }),
      })
    }
    const tap = (dx: number, dy: number) => {
      const point = pointAt(dx, dy)
      emit('pointerdown', point.x, point.y, 1)
      later(130, () => {
        emit('pointerup', point.x, point.y, 0)
        touchPoint.classList.remove('visible')
      })
    }
    later(900, () => tap(0, 0))
    later(2900, () => {
      const start = pointAt(0, 0)
      const end = pointAt(145, -72)
      emit('pointerdown', start.x, start.y, 1)
      for (let step = 1; step <= 12; step += 1) {
        later(step * 70, () => emit('pointermove', start.x + (end.x - start.x) * step / 12, start.y + (end.y - start.y) * step / 12, 1))
      }
      later(930, () => {
        emit('pointerup', end.x, end.y, 0)
        touchPoint.classList.remove('visible')
        fireLeafletClick(end)
      })
    })
    later(5550, () => tap(emptyDx, emptyDy))
    return () => {
      timers.forEach(window.clearTimeout)
      touchPoint.remove()
    }
  }, [cinematicTouchMap, isCinematicTouchPrinciples, mapId, updateMap, view])

  useEffect(() => {
    if (!isCinematicPawnMotion || !cinematicTouchMap || pawnMotionStartedRef.current) return
    pawnMotionStartedRef.current = true
    const map = cinematicTouchMap
    const center = L.latLng(-117.455, 87.686)
    const uid = 'cinematic_building_unit'
    updateMap(mapId, (current) => ({
      ...current,
      wargame: { ...wargameOf(current), enabled: true },
      buildings: {
        ...buildingsBucketOf(current),
        [view]: [{ uid, kind: 'fixed-machine-gun', name: '固定机枪', side: view, lat: center.lat, lng: center.lng, stageId: cinematicDemoStage ?? 'S1', rotation: 0 }],
      },
    }))

    const container = map.getContainer()
    const touchPoint = document.createElement('div')
    touchPoint.className = 'app-touch-demo-point'
    container.appendChild(touchPoint)
    const timers: number[] = []
    const later = (delay: number, action: () => void) => timers.push(window.setTimeout(action, delay))
    const place = (x: number, y: number, contact = false) => {
      const rect = container.getBoundingClientRect()
      touchPoint.style.left = `${x - rect.left}px`
      touchPoint.style.top = `${y - rect.top}px`
      touchPoint.classList.add('visible')
      if (contact) {
        touchPoint.classList.remove('contact')
        void touchPoint.offsetWidth
        touchPoint.classList.add('contact')
      }
    }
    const pointer = (target: EventTarget, type: string, x: number, y: number, buttons: number, pointerId: number) => {
      place(x, y, type === 'pointerdown')
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId, isPrimary: true, clientX: x, clientY: y, button: 0, buttons }))
    }
    const waitForMarker = (attempt = 0) => {
      const marker = container.querySelector<HTMLElement>('.building-unit-wrap')
      if (!marker) {
        if (attempt < 80) later(60, () => waitForMarker(attempt + 1))
        return
      }
      const rect = marker.getBoundingClientRect()
      const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const end = { x: start.x + 190, y: start.y - 70 }
      pointer(marker, 'pointerdown', start.x, start.y, 1, 50)
      pointer(marker, 'pointerup', start.x, start.y, 0, 50)
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y }))
      touchPoint.classList.remove('visible')
      later(650, () => pointer(marker, 'pointerdown', start.x, start.y, 1, 51))
      for (let step = 1; step <= 14; step += 1) {
        later(650 + step * 70, () => pointer(document, 'pointermove', start.x + (end.x - start.x) * step / 14, start.y + (end.y - start.y) * step / 14, 1, 51))
      }
      later(1740, () => {
        pointer(document, 'pointerup', end.x, end.y, 0, 51)
        touchPoint.classList.remove('visible')
      })
      later(2300, () => {
        const moved = container.querySelector<HTMLElement>('.building-unit-wrap')
        if (!moved) return
        const rotate = container.querySelector<HTMLElement>('.building-rotate-control')
        if (!rotate) return
        const r = rotate.getBoundingClientRect()
        const startRotate = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        const building = container.querySelector<HTMLElement>('.building-unit-wrap')
        if (!building) return
        const buildingRect = building.getBoundingClientRect()
        const cx = buildingRect.left + buildingRect.width / 2
        const cy = buildingRect.top + buildingRect.height / 2
        const radius = Math.max(70, Math.hypot(startRotate.x - cx, startRotate.y - cy))
        const startAngle = Math.atan2(startRotate.y - cy, startRotate.x - cx)
        let finishRotate = startRotate
        pointer(rotate, 'pointerdown', startRotate.x, startRotate.y, 1, 53)
        for (let step = 1; step <= 24; step += 1) later(step * 62, () => {
          const angle = startAngle + Math.PI * 1.35 * step / 24
          finishRotate = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
          pointer(document, 'pointermove', finishRotate.x, finishRotate.y, 1, 53)
        })
        later(1600, () => {
          pointer(document, 'pointerup', finishRotate.x, finishRotate.y, 0, 53)
          touchPoint.classList.remove('visible')
        })
      })
    }
    later(500, () => waitForMarker())
    return () => { timers.forEach(window.clearTimeout); touchPoint.remove() }
  }, [cinematicDemoStage, cinematicTouchMap, isCinematicPawnMotion, mapId, updateMap, view])

  useEffect(() => {
    if (!isCinematicUnitCards || !cinematicTouchMap || unitCardsStartedRef.current) return
    unitCardsStartedRef.current = true
    const map = cinematicTouchMap
    const center = L.latLng(-117.455, 87.686)
    const operatorUid = 'cinematic_unit_cards_operator'
    const vehicleUid = 'cinematic_unit_cards_vehicle'
    const buildingUid = 'cinematic_unit_cards_building'
    updateMap(mapId, (current) => ({
      ...current,
      wargame: { ...wargameOf(current), enabled: true },
      operators: {
        ...operatorsBucketOf(current),
        [view]: [{
          uid: operatorUid, name: 'A1', side: view, team: 'A', operatorId: '10000', cls: 'assault', status: 'alive',
          lat: center.lat, lng: center.lng - 14,
        }],
      },
      vehicles: {
        ...vehiclesBucketOf(current),
        [view]: [{
          uid: vehicleUid, name: 'M1A4主战坦克', category: 'tank', side: view, team: 'B', badge: '坦',
          iconUrl: '/icons/vehicles/legend/主战坦克.png', lat: center.lat, lng: center.lng, stageId: cinematicDemoStage ?? 'S1', rotation: 0, custom: true,
        }],
      },
      buildings: {
        ...buildingsBucketOf(current),
        [view]: [{
          uid: buildingUid, kind: 'fixed-machine-gun', name: '固定机枪', side: view, team: 'C',
          lat: center.lat, lng: center.lng + 14, stageId: cinematicDemoStage ?? 'S1', rotation: 0,
        }],
      },
    }))

    const container = map.getContainer()
    const touchPoint = document.createElement('div')
    touchPoint.className = 'app-touch-demo-point'
    container.appendChild(touchPoint)
    const timers: number[] = []
    const later = (delay: number, action: () => void) => timers.push(window.setTimeout(action, delay))
    const placeTouchPoint = (x: number, y: number) => {
      const rect = container.getBoundingClientRect()
      touchPoint.style.left = `${x - rect.left}px`
      touchPoint.style.top = `${y - rect.top}px`
      touchPoint.classList.add('visible')
    }
    const pulseTouchPoint = () => {
      touchPoint.classList.remove('contact')
      void touchPoint.offsetWidth
      touchPoint.classList.add('contact')
    }
    const tap = (selector: string) => {
      const marker = container.querySelector<HTMLElement>(selector)
      if (!marker) return
      const rect = marker.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      placeTouchPoint(x, y)
      pulseTouchPoint()
      later(130, () => {
        const clickTarget = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.leaflet-marker-icon') ?? marker
        clickTarget.click()
        touchPoint.classList.remove('visible')
      })
    }
    const waitForUnits = (attempt = 0) => {
      const selectors = ['.op-marker', '.veh-marker', '.building-unit']
      if (selectors.some((selector) => !container.querySelector(selector))) {
        if (attempt < 80) later(60, () => waitForUnits(attempt + 1))
        return
      }
      later(700, () => tap(selectors[0]))
      later(3700, () => tap(selectors[1]))
      later(6700, () => tap(selectors[2]))
    }
    later(300, () => waitForUnits())
    return () => {
      timers.forEach(window.clearTimeout)
      touchPoint.remove()
    }
  }, [cinematicDemoStage, cinematicTouchMap, isCinematicUnitCards, mapId, updateMap, view])

  useEffect(() => {
    if (!isCinematicRouteGrow || !cinematicTouchMap || routeGrowStartedRef.current) return
    routeGrowStartedRef.current = true
    const map = cinematicTouchMap
    const center = L.latLng(-117.455, 87.686)
    const operatorUid = 'cinematic_route_grow_operator'
    updateMap(mapId, (current) => ({
      ...current,
      wargame: { ...wargameOf(current), enabled: true },
      operators: {
        ...operatorsBucketOf(current),
        [view]: [{
          uid: operatorUid, name: 'A1', side: view, team: 'A', operatorId: '10000', cls: 'assault', status: 'alive',
          lat: center.lat, lng: center.lng - 22,
        }],
      },
      routes: { ...routesBucketOf(current), [view]: [] },
    }))

    const container = map.getContainer()
    const touchPoint = document.createElement('div')
    touchPoint.className = 'app-touch-demo-point'
    container.appendChild(touchPoint)
    const timers: number[] = []
    const later = (delay: number, action: () => void) => timers.push(window.setTimeout(action, delay))
    const showTouch = (x: number, y: number) => {
      const rect = container.getBoundingClientRect()
      touchPoint.style.left = `${x - rect.left}px`
      touchPoint.style.top = `${y - rect.top}px`
      touchPoint.classList.add('visible')
      touchPoint.classList.remove('contact')
      void touchPoint.offsetWidth
      touchPoint.classList.add('contact')
    }
    const clickElement = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) return false
      const rect = element.getBoundingClientRect()
      showTouch(rect.left + rect.width / 2, rect.top + rect.height / 2)
      later(130, () => {
        element.click()
        touchPoint.classList.remove('visible')
      })
      return true
    }
    const clickMap = (dx: number, dy: number) => {
      const point = map.latLngToContainerPoint(center).add([dx, dy])
      const rect = container.getBoundingClientRect()
      const x = rect.left + point.x
      const y = rect.top + point.y
      showTouch(x, y)
      later(130, () => {
        const target = document.elementFromPoint(x, y) ?? container
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0, detail: 1 }))
        touchPoint.classList.remove('visible')
      })
    }
    const waitFor = (selector: string, action: () => void, attempt = 0) => {
      if (document.querySelector(selector)) action()
      else if (attempt < 80) later(60, () => waitFor(selector, action, attempt + 1))
    }

    later(500, () => waitFor('.op-marker', () => clickElement('.op-marker-wrap')))
    later(1300, () => waitFor('.op-route', () => clickElement('.op-route')))
    later(2200, () => clickMap(20, -18))
    later(3400, () => clickMap(92, -62))
    later(4600, () => clickMap(172, 18))
    later(5800, () => waitFor('.route-mobile-actions .primary', () => clickElement('.route-mobile-actions .primary')))
    later(7000, () => waitFor('.route-waypoint-wrap:not(.origin):not(.end)', () => {
      const waypoint = document.querySelector<HTMLElement>('.route-waypoint-wrap:not(.origin):not(.end)')
      if (!waypoint) return
      const rect = waypoint.getBoundingClientRect()
      const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const end = { x: start.x + 42, y: start.y + 50 }
      showTouch(start.x, start.y)
      waypoint.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, button: 0, buttons: 1 }))
      for (let step = 1; step <= 12; step += 1) later(step * 65, () => {
        const x = start.x + (end.x - start.x) * step / 12
        const y = start.y + (end.y - start.y) * step / 12
        touchPoint.style.left = `${x - container.getBoundingClientRect().left}px`
        touchPoint.style.top = `${y - container.getBoundingClientRect().top}px`
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
      })
      later(900, () => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: end.x, clientY: end.y, button: 0, buttons: 0 }))
        touchPoint.classList.remove('visible')
      })
    }))
    later(9000, () => waitFor('.route-editor-trigger', () => {
      const button = document.querySelector<HTMLElement>('.route-editor-trigger')
      if (!button) return
      const rect = button.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      showTouch(x, y)
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 72, isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
      later(130, () => {
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 72, isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 0 }))
        touchPoint.classList.remove('visible')
      })
    }))
    return () => {
      timers.forEach(window.clearTimeout)
      touchPoint.remove()
    }
  }, [cinematicTouchMap, isCinematicRouteGrow, mapId, updateMap, view])

  useEffect(() => {
    if (!cinematicDefenseDemo || !cinematicTouchMap || defenseDemoStartedRef.current) return
    defenseDemoStartedRef.current = true
    const map = cinematicTouchMap
    setUi((current) => ({
      ...current,
      draw: { ...current.draw, curve: cinematicDefenseDemo, color: '#00e39b', weight: 4, dash: 'solid' },
    }))
    setTool('defense')

    const container = map.getContainer()
    const touchPoint = document.createElement('div')
    touchPoint.className = 'app-touch-demo-point'
    container.appendChild(touchPoint)
    const timers: number[] = []
    const later = (delay: number, action: () => void) => timers.push(window.setTimeout(action, delay))
    const bounds = container.getBoundingClientRect()
    const start = { x: bounds.left + bounds.width / 2 - 105, y: bounds.top + bounds.height / 2 + 58 }
    const end = { x: bounds.left + bounds.width / 2 + 105, y: bounds.top + bounds.height / 2 - 58 }
    const show = (x: number, y: number, contact = false) => {
      const currentBounds = container.getBoundingClientRect()
      touchPoint.style.left = `${x - currentBounds.left}px`
      touchPoint.style.top = `${y - currentBounds.top}px`
      touchPoint.classList.add('visible')
      if (contact) {
        touchPoint.classList.remove('contact')
        void touchPoint.offsetWidth
        touchPoint.classList.add('contact')
      }
    }
    const mouse = (target: EventTarget, type: string, x: number, y: number, buttons: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }))
    }
    const mapMouse = (type: string, x: number, y: number, buttons: number) => {
      container.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons,
      }))
    }
    const steps = cinematicDefenseDemo === 'freehand' ? 22 : 14
    later(850, () => { show(start.x, start.y, true); mapMouse('mousedown', start.x, start.y, 1) })
    for (let step = 1; step <= steps; step += 1) later(850 + step * 55, () => {
      const progress = step / steps
      const wave = cinematicDefenseDemo === 'freehand' ? Math.sin(progress * Math.PI * 3) * 42 : 0
      const x = start.x + (end.x - start.x) * progress
      const y = start.y + (end.y - start.y) * progress + wave
      show(x, y)
      mapMouse('mousemove', x, y, 1)
    })
    later(900 + steps * 55, () => {
      mapMouse('mouseup', end.x, end.y, 0)
      touchPoint.classList.remove('visible')
    })
    const drawFinishedAt = 900 + steps * 55
    if (cinematicDefenseDemo === 'smooth') later(drawFinishedAt + 350, () => {
      const handle = container.querySelector<HTMLElement>('.curve-ctrl-wrap')
      if (!handle) return
      const handleRect = handle.getBoundingClientRect()
      const handleStart = { x: handleRect.left + handleRect.width / 2, y: handleRect.top + handleRect.height / 2 }
      const handleEnd = { x: handleStart.x, y: handleStart.y - 62 }
      show(handleStart.x, handleStart.y, true)
      mouse(handle, 'mousedown', handleStart.x, handleStart.y, 1)
      for (let step = 1; step <= 10; step += 1) later(step * 60, () => {
        const progress = step / 10
        const x = handleStart.x + (handleEnd.x - handleStart.x) * progress
        const y = handleStart.y + (handleEnd.y - handleStart.y) * progress
        show(x, y)
        mapMouse('mousemove', x, y, 1)
      })
      later(680, () => {
        mapMouse('mouseup', handleEnd.x, handleEnd.y, 0)
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: handleEnd.x, clientY: handleEnd.y, button: 0, buttons: 0 }))
        touchPoint.classList.remove('visible')
      })
    })
    const selectAt = drawFinishedAt + (cinematicDefenseDemo === 'smooth' ? 1500 : 450)
    later(selectAt, () => {
      setTool('pan')
      later(220, () => {
        const hitAreas = container.querySelectorAll<SVGPathElement>('.leaflet-draw-pane .draw-hit-area')
        const shape = hitAreas[Math.floor(hitAreas.length / 2)]
        if (!shape) return
        const shapeRect = shape.getBoundingClientRect()
        const x = shapeRect.left + shapeRect.width / 2
        const y = shapeRect.top + shapeRect.height / 2
        show(x, y, true)
        later(120, () => {
          shape.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
          shape.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0 }))
          shape.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 0, detail: 1 }))
          touchPoint.classList.remove('visible')
        })
      })
    })
    return () => {
      timers.forEach(window.clearTimeout)
      touchPoint.remove()
    }
  }, [cinematicDefenseDemo, cinematicTouchMap])

  useEffect(() => {
    if (!isCinematicStylePanelDemo || !cinematicTouchMap || stylePanelDemoStartedRef.current) return
    stylePanelDemoStartedRef.current = true
    const map = cinematicTouchMap
    setUi((current) => ({
      ...current,
      draw: { ...current.draw, color: '#00e39b', fillColor: '#00e39b', fillEnabled: true, weight: 4, dash: 'solid' },
    }))
    setTool('rect')

    const container = map.getContainer()
    const touchPoint = document.createElement('div')
    touchPoint.className = 'app-touch-demo-point'
    container.appendChild(touchPoint)
    const timers: number[] = []
    const later = (delay: number, action: () => void) => timers.push(window.setTimeout(action, delay))
    const bounds = container.getBoundingClientRect()
    const start = { x: bounds.left + bounds.width / 2 - 100, y: bounds.top + bounds.height / 2 - 65 }
    const end = { x: bounds.left + bounds.width / 2 + 85, y: bounds.top + bounds.height / 2 + 55 }
    const show = (x: number, y: number, contact = false) => {
      const currentBounds = container.getBoundingClientRect()
      touchPoint.style.left = `${x - currentBounds.left}px`
      touchPoint.style.top = `${y - currentBounds.top}px`
      touchPoint.classList.add('visible')
      if (contact) {
        touchPoint.classList.remove('contact')
        void touchPoint.offsetWidth
        touchPoint.classList.add('contact')
      }
    }
    const mouse = (target: EventTarget, type: string, x: number, y: number, buttons: number) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }))
    }
    later(850, () => { show(start.x, start.y, true); mouse(container, 'mousedown', start.x, start.y, 1) })
    for (let step = 1; step <= 12; step += 1) later(850 + step * 55, () => {
      const progress = step / 12
      const x = start.x + (end.x - start.x) * progress
      const y = start.y + (end.y - start.y) * progress
      show(x, y)
      mouse(container, 'mousemove', x, y, 1)
    })
    later(1550, () => {
      mouse(container, 'mouseup', end.x, end.y, 0)
      touchPoint.classList.remove('visible')
      setTool('pan')
    })
    later(1950, () => {
      const hitAreas = container.querySelectorAll<SVGPathElement>('.leaflet-draw-pane .draw-hit-area')
      const shape = hitAreas[hitAreas.length - 1]
      if (!shape) return
      const rect = shape.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      show(x, y, true)
      later(120, () => {
        mouse(shape, 'mousedown', x, y, 1)
        mouse(shape, 'mouseup', x, y, 0)
        mouse(shape, 'click', x, y, 0)
        touchPoint.classList.remove('visible')
      })
    })
    later(2650, () => {
      const button = container.querySelector<HTMLElement>('.edit-style-trigger')
      if (!button) return
      const rect = button.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      show(x, y, true)
      later(120, () => {
        mouse(button, 'mousedown', x, y, 1)
        mouse(button, 'mouseup', x, y, 0)
        touchPoint.classList.remove('visible')
      })
    })
    later(3450, () => {
      const header = document.querySelector<HTMLElement>('.text-style-panel .tsp-head')
      if (!header) return
      const rect = header.getBoundingClientRect()
      const from = { x: rect.left + 52, y: rect.top + rect.height / 2 }
      const to = { x: Math.max(bounds.left + 95, from.x - 125), y: Math.min(bounds.bottom - 95, from.y + 70) }
      const pointerId = 71
      const pointer = (target: EventTarget, type: string, x: number, y: number, buttons: number) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons,
      }))
      show(from.x, from.y, true)
      pointer(header, 'pointerdown', from.x, from.y, 1)
      for (let step = 1; step <= 12; step += 1) later(step * 55, () => {
        const progress = step / 12
        const x = from.x + (to.x - from.x) * progress
        const y = from.y + (to.y - from.y) * progress
        show(x, y)
        pointer(header, 'pointermove', x, y, 1)
      })
      later(720, () => {
        pointer(header, 'pointerup', to.x, to.y, 0)
        touchPoint.classList.remove('visible')
      })
    })
    return () => {
      timers.forEach(window.clearTimeout)
      touchPoint.remove()
    }
  }, [cinematicTouchMap, isCinematicStylePanelDemo])

  // 撤回/恢复按钮状态：从当前 地图+视角 的栈长度直接派生
  // histVersion 在此处被读取，驱动栈变化后的按钮置灰状态重渲染
  void histVersion
  const undoCount = historyRef.current[`${mapId}:${view}`]?.undo.length ?? 0
  const redoCount = historyRef.current[`${mapId}:${view}`]?.redo.length ?? 0

  const handleUndo = useCallback(() => {
    const bucket = historyRef.current[`${mapId}:${view}`]
    const entry = bucket?.undo.pop()
    if (!entry) return
    bucket.redo.push(entry)
    updateMap(mapId, (state) => ({ ...state, ...entry.before }))
    setHistVersion((v) => v + 1)
  }, [mapId, updateMap, view])

  const handleRedo = useCallback(() => {
    const bucket = historyRef.current[`${mapId}:${view}`]
    const entry = bucket?.redo.pop()
    if (!entry) return
    bucket.undo.push(entry)
    updateMap(mapId, (state) => ({ ...state, ...entry.after }))
    setHistVersion((v) => v + 1)
  }, [mapId, updateMap, view])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) handleRedo()
        else handleUndo()
      } else if (key === 'y') {
        event.preventDefault()
        handleRedo()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [handleRedo, handleUndo])

  // 删除选中（第十二轮：套索圈选后工具栏按钮删除；信号 + 是否有选中上报）
  const [deleteSelectedTick, setDeleteSelectedTick] = useState(0)
  const [clearDrawTick, setClearDrawTick] = useState(0)
  const [deleteSelCount, setDeleteSelCount] = useState(0)
  const handleDeleteSelected = useCallback(() => setDeleteSelectedTick((t) => t + 1), [])

  useEffect(() => {
    const onBackspace = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (deleteSelCount <= 0) return
      event.preventDefault()
      handleDeleteSelected()
    }
    document.addEventListener('keydown', onBackspace)
    return () => document.removeEventListener('keydown', onBackspace)
  }, [deleteSelCount, handleDeleteSelected])

  // 自动持久化（v14：载具队伍 + 行动指令 V2 + 干员独立任务；旧版本由 storage 统一迁移）
  useEffect(() => {
    if (isCinematicDemoFrame) return
    const snapshot = { version: 16 as const, lastMapId: mapId, lastView: view, maps, progress, plans, ui }
    // 桌面端连续编辑时合并密集写入；Android 保留已验收的持久化行为。
    if (platform.kind === 'android') {
      saveState(snapshot)
      return
    }
    const timer = window.setTimeout(() => saveState(snapshot), 250)
    return () => window.clearTimeout(timer)
  }, [isCinematicDemoFrame, maps, mapId, view, progress, plans, ui])

  useEffect(() => {
    if (isCinematicDemoFrame) return
    saveModeConfigStore(modeStore)
  }, [isCinematicDemoFrame, modeStore])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MODE_CONFIG_STORAGE_KEY || !event.newValue) return
      try {
        const normalized = normalizeModeConfigStore(JSON.parse(event.newValue))
        if (normalized) setModeStore(normalized)
      } catch {
        // 外置配置器写入尚未完成或数据损坏时保留当前可用状态。
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(MODE_CONFIG_SYNC_CHANNEL)
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const normalized = normalizeModeConfigStore(event.data)
      if (normalized) setModeStore(normalized)
    })
    return () => channel.close()
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const payload = event.data as { type?: unknown; store?: unknown } | null
      if (!payload || payload.type !== MODE_CONFIG_SYNC_MESSAGE) return
      try {
        const sourceUrl = new URL(event.origin)
        const trustedLocalSource = sourceUrl.protocol === window.location.protocol
          && (sourceUrl.hostname === '127.0.0.1' || sourceUrl.hostname === 'localhost')
        if (!trustedLocalSource) return
      } catch {
        return
      }
      const normalized = normalizeModeConfigStore(payload.store)
      if (normalized) setModeStore(normalized)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const refreshPublishedMode = () => setModeStore(loadModeConfigStore())
    window.addEventListener('focus', refreshPublishedMode)
    return () => window.removeEventListener('focus', refreshPublishedMode)
  }, [])

  // 切换地图/视角时清空选中态
  useEffect(() => {
    setSelectedPoint(null)
    setDeployTarget(null)
  }, [mapId, view])

  const handleMapReady = useCallback((m: L.Map) => {
    mapRef.current = m
    if (isCinematicTouchPrinciples || isCinematicPawnMotion || isCinematicUnitCards || isCinematicRouteGrow || cinematicDefenseDemo || isCinematicStylePanelDemo) setCinematicTouchMap(m)
  }, [cinematicDefenseDemo, isCinematicPawnMotion, isCinematicRouteGrow, isCinematicStylePanelDemo, isCinematicTouchPrinciples, isCinematicUnitCards])

  const handleLayerChange = useCallback((key: keyof LayerVisibility, value: boolean) => {
    setUi((u) => {
      const next: typeof u = { ...u, layers: { ...u.layers, [key]: value } }
      // 地图道具总开关变化时，所有道具子项跟随开启/关闭
      if (key === 'props') {
        const nextPropVis = { ...u.propVis }
        for (const name of Object.keys(nextPropVis)) {
          nextPropVis[name] = value
        }
        next.propVis = nextPropVis
      }
      // “据点与防线”总开关联动三个子图层。
      if (key === 'points') {
        next.layers.pointsLabels = value
        next.layers.pointsCapture = value
        next.layers.pointsFrontline = value
      }
      // 父项关闭后仍允许直接开启任一子项；开启子项时同步恢复父图层。
      if (
        value &&
        (key === 'pointsLabels' || key === 'pointsCapture' || key === 'pointsFrontline')
      ) {
        next.layers.points = true
      }
      return next
    })
  }, [])

  /** 问题2：道具按类型显示/屏蔽 */
  const handlePropVisChange = useCallback((name: string, value: boolean) => {
    setUi((u) => ({
      ...u,
      layers: value ? { ...u.layers, props: true } : u.layers,
      propVis: { ...u.propVis, [name]: value },
    }))
  }, [])

  /** 问题3：载具旋转（重构：旋转会话合并为一条历史，滚轮停止 300ms 后提交） */
  const handleRotateVehicle = useCallback(
    (uid: string, rotation: number) => {
      const ses = rotateSessionRef.current[uid]
      if (!ses) {
        const cur = mapsRef.current[mapId] ?? createEmptyMapState()
        rotateSessionRef.current[uid] = { before: cloneState(cur), timer: 0 }
      }
      updateMap(mapId, (s) => {
        const bucket = vehiclesBucketOf(s)
        return {
          ...s,
          vehicles: { ...bucket, [view]: bucket[view].map((v) => (v.uid === uid ? { ...v, rotation } : v)) },
        }
      })
      const s = rotateSessionRef.current[uid]
      clearTimeout(s.timer)
      s.timer = window.setTimeout(() => {
        const cur2 = mapsRef.current[mapId] ?? createEmptyMapState()
        pushEntry(s.before, cloneState(cur2))
        delete rotateSessionRef.current[uid]
      }, 300)
    },
    [updateMap, mapId, view, cloneState, pushEntry],
  )

  const handleToggleVehicleFireLine = useCallback((uid: string) => {
    updateMap(mapId, (state) => {
      const bucket = vehiclesBucketOf(state)
      return { ...state, vehicles: { ...bucket, [view]: bucket[view].map((item) => item.uid === uid ? { ...item, fireLineEnabled: !item.fireLineEnabled } : item) } }
    })
  }, [mapId, updateMap, view])

  /** 快捷切换载具阵营（攻↔守）：底色随视角实时判定，切换 side 后自动反转 */
  const handleToggleVehicleSide = useCallback(
    (uid: string) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const vehicle = vehiclesBucketOf(cur)[view].find((item) => item.uid === uid)
      if (!vehicle) return
      const side: Side = vehicle.side === 'attack' ? 'defense' : 'attack'
      const nextVehicles = vehiclesBucketOf(cur)[view].map((item) => item.uid === uid ? { ...item, side } : item)
      const nextRoutes = routesBucketOf(cur)[view].map((route) =>
        route.anchorMode === 'vehicle' && route.anchorVehicleUid === uid ? { ...route, side } : route,
      )
      updateMap(mapId, (state) => ({
        ...state,
        vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
      }))
      pushEntry(before, { ...before, vehicles: { ...before.vehicles, [view]: nextVehicles }, routes: { ...before.routes, [view]: nextRoutes } })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 载具队伍角标点击后循环切换所属队伍。 */
  const handleVehicleTeamChange = useCallback(
    (uid: string, team?: OperatorTeam) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const nextVehicles = vehiclesBucketOf(cur)[view].map((vehicle) => vehicle.uid === uid ? { ...vehicle, team } : vehicle)
      const nextRoutes = routesBucketOf(cur)[view].map((route) =>
        route.anchorMode === 'vehicle' && route.anchorVehicleUid === uid && team ? { ...route, team } : route,
      )
      updateMap(mapId, (state) => ({
        ...state,
        vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
      }))
      pushEntry(before, { ...before, vehicles: { ...before.vehicles, [view]: nextVehicles }, routes: { ...before.routes, [view]: nextRoutes } })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  const handleAddCustomVehicle = useCallback(
    (tpl: CustomVehicleTemplate, own: boolean, team?: OperatorTeam) => {
      const center = mapRef.current?.getCenter() ?? { lat: 0, lng: 0 }
      const stageId = stages[capturedStageIndex]?.id ?? ''
      const vehicle: VehicleItem = {
        uid: genUid('veh'),
        name: tpl.name,
        category: tpl.category,
        side: own ? view : (view === 'attack' ? 'defense' : 'attack'),
        team,
        badge: tpl.badge,
        iconUrl: tpl.iconUrl,
        lat: center.lat,
        lng: center.lng,
        stageId,
        rotation: 0,
        custom: true,
        own,
      }
      commitVehicleChange((vs) => [...vs, vehicle])
      // 修复 BUG：部署后自动切回「查看」工具，否则绘制模式下载具卡片
      // 被 drawing-mode 屏蔽 pointer-events，鼠标无法操作
      setTool('pan')
    },
    [commitVehicleChange, view, stages, capturedStageIndex],
  )

  const handleAddBuilding = useCallback((kind: BuildingUnitKind, own: boolean, team?: OperatorTeam) => {
    const center = mapRef.current?.getCenter() ?? { lat: 0, lng: 0 }
    const buildingConfig = buildingUnitOf(kind)
    const building: BuildingUnit = {
      uid: genUid('building'),
      kind,
      name: `${buildingConfig.name}碉堡`,
      side: own ? view : (view === 'attack' ? 'defense' : 'attack'),
      team,
      lat: center.lat,
      lng: center.lng,
      stageId: stages[capturedStageIndex]?.id ?? '',
      rotation: 0,
    }
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    const nextBuildings = [...buildingsBucketOf(cur)[view], building]
    updateMap(mapId, (state) => ({ ...state, buildings: { ...buildingsBucketOf(state), [view]: nextBuildings } }))
    pushEntry(before, { ...before, buildings: { ...(before.buildings ?? { attack: [], defense: [] }), [view]: nextBuildings } })
    setTool('pan')
  }, [capturedStageIndex, cloneState, mapId, pushEntry, stages, updateMap, view])

  const handleMoveBuilding = useCallback((uid: string, lat: number, lng: number) => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    const originalBuilding = buildingsBucketOf(cur)[view].find((item) => item.uid === uid)
    const nextBuildings = buildingsBucketOf(cur)[view].map((item) => item.uid === uid ? { ...item, lat, lng } : item)
    const nextRoutes = routesBucketOf(cur)[view].map((route) => {
      const oldPoint = route.waypoints[0]
      const legacyBuildingRoute = Boolean(
        originalBuilding
        && route.anchorMode === 'free'
        && oldPoint
        && Math.abs(oldPoint[0] - originalBuilding.lat) < 1e-6
        && Math.abs(oldPoint[1] - originalBuilding.lng) < 1e-6,
      )
      return (route.anchorMode === 'building' && route.anchorBuildingUid === uid) || legacyBuildingRoute
        ? { ...route, anchorMode: 'building' as const, anchorBuildingUid: uid, waypoints: [[lat, lng] as [number, number], ...route.waypoints.slice(1)] }
        : route
    })
    updateMap(mapId, (state) => ({
      ...state,
      buildings: { ...buildingsBucketOf(state), [view]: nextBuildings },
      routes: { ...routesBucketOf(state), [view]: nextRoutes },
    }))
    pushEntry(before, {
      ...before,
      buildings: { ...(before.buildings ?? { attack: [], defense: [] }), [view]: nextBuildings },
      routes: { ...before.routes, [view]: nextRoutes },
    })
  }, [cloneState, mapId, pushEntry, updateMap, view])

  const handleRotateBuilding = useCallback((uid: string, rotation: number) => {
    const session = buildingRotateSessionRef.current[uid]
    if (!session) {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      buildingRotateSessionRef.current[uid] = { before: cloneState(cur), timer: 0 }
    }
    updateMap(mapId, (state) => {
      const bucket = buildingsBucketOf(state)
      return { ...state, buildings: { ...bucket, [view]: bucket[view].map((item) => item.uid === uid ? { ...item, rotation } : item) } }
    })
    const active = buildingRotateSessionRef.current[uid]
    clearTimeout(active.timer)
    active.timer = window.setTimeout(() => {
      const current = mapsRef.current[mapId] ?? createEmptyMapState()
      pushEntry(active.before, cloneState(current))
      delete buildingRotateSessionRef.current[uid]
    }, 300)
  }, [cloneState, mapId, pushEntry, updateMap, view])

  const handleToggleBuildingFireLine = useCallback((uid: string) => {
    updateMap(mapId, (state) => {
      const bucket = buildingsBucketOf(state)
      return { ...state, buildings: { ...bucket, [view]: bucket[view].map((item) => item.uid === uid ? { ...item, fireLineEnabled: !item.fireLineEnabled } : item) } }
    })
  }, [mapId, updateMap, view])

  const handleToggleBuildingSide = useCallback((uid: string) => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    const nextBuildings = buildingsBucketOf(cur)[view].map((item) => item.uid === uid
      ? { ...item, side: (item.side === 'attack' ? 'defense' : 'attack') as Side }
      : item)
    updateMap(mapId, (state) => ({ ...state, buildings: { ...buildingsBucketOf(state), [view]: nextBuildings } }))
    pushEntry(before, { ...before, buildings: { ...(before.buildings ?? { attack: [], defense: [] }), [view]: nextBuildings } })
  }, [cloneState, mapId, pushEntry, updateMap, view])

  const handleBuildingTeamChange = useCallback((uid: string, team?: OperatorTeam) => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    const nextBuildings = buildingsBucketOf(cur)[view].map((item) => item.uid === uid ? { ...item, team } : item)
    updateMap(mapId, (state) => ({ ...state, buildings: { ...buildingsBucketOf(state), [view]: nextBuildings } }))
    pushEntry(before, { ...before, buildings: { ...(before.buildings ?? { attack: [], defense: [] }), [view]: nextBuildings } })
  }, [cloneState, mapId, pushEntry, updateMap, view])

  const handleDeleteBuilding = useCallback((uid: string) => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    const nextBuildings = buildingsBucketOf(cur)[view].filter((item) => item.uid !== uid)
    const currentRoutes = routesBucketOf(cur)[view]
    const removedRouteIds = new Set<string>()
    currentRoutes.forEach((route) => { if (route.anchorMode === 'building' && route.anchorBuildingUid === uid) removedRouteIds.add(route.uid) })
    const nextRoutes = currentRoutes.filter((route) => !removedRouteIds.has(route.uid))
    updateMap(mapId, (state) => ({ ...state, buildings: { ...buildingsBucketOf(state), [view]: nextBuildings }, routes: { ...routesBucketOf(state), [view]: nextRoutes } }))
    pushEntry(before, { ...before, buildings: { ...(before.buildings ?? { attack: [], defense: [] }), [view]: nextBuildings }, routes: { ...before.routes, [view]: nextRoutes } })
  }, [cloneState, mapId, pushEntry, updateMap, view])

  const handleMoveVehicle = useCallback(
    (uid: string, lat: number, lng: number) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const nextVehicles = vehiclesBucketOf(cur)[view].map((vehicle) => vehicle.uid === uid ? { ...vehicle, lat, lng } : vehicle)
      const anchored = routesBucketOf(cur)[view].map((route) =>
        route.anchorMode === 'vehicle' && route.anchorVehicleUid === uid
          ? { ...route, waypoints: [[lat, lng] as [number, number], ...route.waypoints.slice(1)] }
          : route,
      )
      const nextRoutes = syncRouteTargetPosition(anchored, 'vehicle', uid, [lat, lng])
      updateMap(mapId, (state) => ({
        ...state,
        vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
      }))
      pushEntry(before, {
        ...before,
        vehicles: { ...before.vehicles, [view]: nextVehicles },
        routes: { ...before.routes, [view]: nextRoutes },
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  // 点击出生点：弹出底部载具部署栏（仅基地类出生点有载具，附属复活点 baseName=null 不弹）
  const handleSpawnSelect = useCallback((spawn: { stageId: string; side: Side; pos: [number, number]; baseName: string | null }) => {
    if (!spawn.baseName) return
    setDeployTarget(spawn)
  }, [])

  // 部署载具：放置到出生点附近（同种多辆时沿纬度方向错开），整批为一条历史
  // own = 该出生点是否为当前视角的本方（攻方视角点攻方复活点=本方绿，点守方复活点=敌方红）
  const handleDeployVehicle = useCallback(
    (entry: DeployVehicleEntry, target: DeployTarget) => {
      const own = target.side === view
      commitVehicleChange((vs) => {
        const vehicles = [...vs]
        for (let i = 0; i < entry.num; i++) {
          vehicles.push({
            uid: genUid('veh'),
            name: entry.name,
            category: entry.category,
            side: target.side,
            badge: entry.badge,
            iconUrl: entry.iconUrl,
            lat: target.pos[0] + i * 2.4,
            lng: target.pos[1],
            stageId: target.stageId,
            rotation: 0,
            own,
          })
        }
        return vehicles
      })
      // 修复 BUG：部署后自动切回「查看」工具（同上：绘制模式屏蔽载具交互）
      setTool('pan')
    },
    [commitVehicleChange, view],
  )

  const handleDeployVehicleRefresh = useCallback((
    rule: Omit<ModeVehicleRefreshRule, 'verification'>,
    point: Omit<ModeVehicleRefreshPoint, 'verification'>,
    force: boolean,
  ) => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const currentWargame = wargameOf(cur)
    if (currentWargame.usedVehicleRefreshRuleIds[view].includes(rule.uid) || rule.action !== 'refresh') return
    if (!force && activeOfficialModeMap && !evaluateVehicleRefreshRule(rule, currentWargame.battleContext, {
      stages: activeOfficialModeMap.stages,
      currentStageIndex: pointPanelStageIndex,
    }).eligible) return
    const before = cloneState(cur)
    const currentVehicles = vehiclesBucketOf(cur)[view]
    const created: VehicleItem[] = Array.from({ length: Math.max(1, rule.quantity) }, (_, index) => ({
      uid: genUid('veh'),
      name: rule.vehicle.name,
      category: rule.vehicle.category,
      side: rule.side,
      badge: rule.vehicle.badge,
      iconUrl: rule.vehicle.iconUrl,
      lat: point.lat + index * 2.4,
      lng: point.lng,
      stageId: activeModeStageId ?? '',
      rotation: 0,
      own: rule.side === view,
      sourceType: 'vehicle-refresh',
      sourceRuleUid: rule.uid,
      sourcePointUid: point.uid,
    }))
    const nextVehicles = [...currentVehicles, ...created]
    const nextUsed = [...currentWargame.usedVehicleRefreshRuleIds[view], rule.uid]
    updateMap(mapId, (state) => ({
      ...state,
      vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
      wargame: {
        ...wargameOf(state),
        usedVehicleRefreshRuleIds: { ...wargameOf(state).usedVehicleRefreshRuleIds, [view]: nextUsed },
      },
    }))
    pushEntry(before, { ...before, vehicles: { ...before.vehicles, [view]: nextVehicles } })
    setTool('pan')
  }, [activeModeStageId, activeOfficialModeMap, cloneState, mapId, pointPanelStageIndex, pushEntry, updateMap, view])

  const locateVehicleRefreshRule = useCallback((ruleUid: string) => {
    const vehicle = vehiclesBucketOf(mapsRef.current[mapId])[view].find((item) => item.sourceRuleUid === ruleUid)
    if (!vehicle) return
    mapRef.current?.setView([vehicle.lat, vehicle.lng], Math.max(mapRef.current.getZoom(), 4), { animate: true })
  }, [mapId, view])

  const locateVehicleRefreshSource = useCallback((vehicle: VehicleItem) => {
    if (!vehicle.sourcePointUid) return
    const point = activeOfficialModeMap?.vehicleRefreshPoints.find((item) => item.uid === vehicle.sourcePointUid)
    if (!point) return
    mapRef.current?.setView([point.lat, point.lng], Math.max(mapRef.current.getZoom(), 4), { animate: true })
  }, [activeOfficialModeMap])

  const deleteVehicleInstances = useCallback((uids: string[], restoreRules: boolean) => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    const currentVehicles = vehiclesBucketOf(cur)[view]
    const selected = currentVehicles.filter((vehicle) => uids.includes(vehicle.uid))
    if (selected.length === 0) return
    const restoredRuleIds = new Set(restoreRules ? selected.map((vehicle) => vehicle.sourceRuleUid).filter((uid): uid is string => Boolean(uid)) : [])
    const removedIds = new Set(currentVehicles
      .filter((vehicle) => uids.includes(vehicle.uid) || vehicle.sourceRuleUid && restoredRuleIds.has(vehicle.sourceRuleUid))
      .map((vehicle) => vehicle.uid))
    const nextVehicles = currentVehicles.filter((vehicle) => !removedIds.has(vehicle.uid))
    const currentRoutes = routesBucketOf(cur)[view]
    const removedRouteIds = new Set<string>()
    currentRoutes.forEach((route) => { if (route.anchorMode === 'vehicle' && route.anchorVehicleUid && removedIds.has(route.anchorVehicleUid)) removedRouteIds.add(route.uid) })
    const nextRoutes = currentRoutes.filter((route) => !removedRouteIds.has(route.uid)).map((route) => ({ ...route, vehicleIds: route.vehicleIds.filter((vehicleUid) => !removedIds.has(vehicleUid)), ...(route.target?.kind === 'vehicle' && removedIds.has(route.target.uid) ? { target: undefined } : {}) }))
    updateMap(mapId, (state) => {
      const currentWargame = wargameOf(state)
      const used = restoredRuleIds.size > 0
        ? currentWargame.usedVehicleRefreshRuleIds[view].filter((ruleUid) => !restoredRuleIds.has(ruleUid))
        : currentWargame.usedVehicleRefreshRuleIds[view]
      return {
        ...state,
        vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
        wargame: { ...currentWargame, usedVehicleRefreshRuleIds: { ...currentWargame.usedVehicleRefreshRuleIds, [view]: used } },
      }
    })
    pushEntry(before, { ...before, vehicles: { ...before.vehicles, [view]: nextVehicles }, routes: { ...before.routes, [view]: nextRoutes } })
  }, [cloneState, mapId, pushEntry, updateMap, view])

  const handleRestoreVehicleRefresh = useCallback((ruleUid: string) => {
    const vehicle = vehiclesBucketOf(mapsRef.current[mapId])[view].find((item) => item.sourceRuleUid === ruleUid)
    if (vehicle) {
      deleteVehicleInstances([vehicle.uid], true)
      return
    }
    updateMap(mapId, (state) => {
      const currentWargame = wargameOf(state)
      return { ...state, wargame: { ...currentWargame, usedVehicleRefreshRuleIds: { ...currentWargame.usedVehicleRefreshRuleIds, [view]: currentWargame.usedVehicleRefreshRuleIds[view].filter((uid) => uid !== ruleUid) } } }
    })
  }, [deleteVehicleInstances, mapId, updateMap, view])

  const handleDeleteVehicle = useCallback(
    (uid: string) => {
      const vehicle = vehiclesBucketOf(mapsRef.current[mapId])[view].find((item) => item.uid === uid)
      if (vehicle?.sourceType === 'vehicle-refresh') {
        setRefreshVehicleDelete({ vehicles: [vehicle], uids: [uid] })
        return
      }
      deleteVehicleInstances([uid], false)
    },
    [deleteVehicleInstances, mapId, view],
  )

  /** 批量移动载具（套索整体移动，第十四轮）：一次入历史栈 */
  const handleMoveVehicles = useCallback(
    (updates: Record<string, [number, number]>) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const nextVehicles = vehiclesBucketOf(cur)[view].map((vehicle) => {
        const point = updates[vehicle.uid]
        return point ? { ...vehicle, lat: point[0], lng: point[1] } : vehicle
      })
      let nextRoutes = routesBucketOf(cur)[view].map((route) => {
        const point = route.anchorVehicleUid ? updates[route.anchorVehicleUid] : undefined
        return point && route.anchorMode === 'vehicle' ? { ...route, waypoints: [point, ...route.waypoints.slice(1)] } : route
      })
      for (const [uid, point] of Object.entries(updates)) nextRoutes = syncRouteTargetPosition(nextRoutes, 'vehicle', uid, point)
      updateMap(mapId, (state) => ({
        ...state,
        vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
      }))
      pushEntry(before, {
        ...before,
        vehicles: { ...before.vehicles, [view]: nextVehicles },
        routes: { ...before.routes, [view]: nextRoutes },
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 批量删除载具（套索 Delete/删除按钮，第十四轮）：一次入历史栈 */
  const handleDeleteVehicles = useCallback(
    (uids: string[]) => {
      const selectedVehicles = vehiclesBucketOf(mapsRef.current[mapId])[view].filter((vehicle) => uids.includes(vehicle.uid))
      const refreshVehicles = selectedVehicles.filter((vehicle) => vehicle.sourceType === 'vehicle-refresh')
      if (refreshVehicles.length > 0) {
        setRefreshVehicleDelete({ vehicles: refreshVehicles, uids })
        return
      }
      const set = new Set(uids)
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const nextVehicles = vehiclesBucketOf(cur)[view].filter((vehicle) => !set.has(vehicle.uid))
      const nextRoutes = routesBucketOf(cur)[view].map((route) => ({
        ...route,
        vehicleIds: route.vehicleIds.filter((vehicleUid) => !set.has(vehicleUid)),
        ...(route.anchorMode === 'vehicle' && route.anchorVehicleUid && set.has(route.anchorVehicleUid)
          ? { anchorMode: 'free' as const, anchorVehicleUid: undefined }
          : {}),
        ...(route.target?.kind === 'vehicle' && set.has(route.target.uid) ? { target: undefined } : {}),
      }))
      updateMap(mapId, (state) => ({
        ...state,
        vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
      }))
      pushEntry(before, {
        ...before,
        vehicles: { ...before.vehicles, [view]: nextVehicles },
        routes: { ...before.routes, [view]: nextRoutes },
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  const handleDrawSaved = useCallback(
    (side: Side, geoJson: string) => {
      updateMap(mapId, (s) => ({ ...s, drawings: { ...s.drawings, [side]: geoJson } }))
    },
    [mapId, updateMap],
  )

  const clearCurrentDraw = useCallback(() => {
    setClearDrawTick((tick) => tick + 1)
  }, [])

  const handleClearDraw = useCallback(() => {
    if (platform.kind === 'android') {
      setMobileConfirm({
        title: '清空绘制内容',
        message: `确定清空「${config.name}」当前${view === 'attack' ? '攻方' : '守方'}视角的全部绘制内容？`,
        confirmLabel: '确定清空',
        onConfirm: clearCurrentDraw,
      })
      return
    }
    if (window.confirm(`确定清空「${config.name}」当前${view === 'attack' ? '攻方' : '守方'}视角的全部绘制内容？`)) {
      clearCurrentDraw()
    }
  }, [clearCurrentDraw, config.name, view])

  /** 一键消除当前视角全部载具部署图标（入历史栈，可撤回；与"清空本层绘制"对称只清当前视角桶） */
  const clearCurrentVehicles = useCallback(() => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    const after = { ...before, vehicles: { ...before.vehicles, [view]: [] } }
    pushEntry(before, after)
    updateMap(mapId, (s) => ({ ...s, vehicles: { ...s.vehicles, [view]: [] } }))
  }, [mapId, view, cloneState, pushEntry, updateMap])

  const handleClearVehicles = useCallback(() => {
    const message = `确定一键消除本地图当前${view === 'attack' ? '攻方' : '守方'}视角的全部载具部署图标？`
    if (platform.kind === 'android') {
      setMobileConfirm({ title: '清空载具', message, confirmLabel: '确定清空', onConfirm: clearCurrentVehicles })
      return
    }
    if (window.confirm(message)) clearCurrentVehicles()
  }, [clearCurrentVehicles, view])

  /** 一键清空本地图所有画笔和载具（入历史栈，可撤回）；兵棋推演数据不受影响：
   *  干员保留配置但回到未部署（保留自定义昵称/干员/状态），联线与推演状态原样保留。 */
  const clearAllMapContent = useCallback(() => {
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    // 干员回未部署（lat/lng 置 null），配置全部保留；联线/推演状态不动
    const undeployOperators = (side: Side) =>
      (operatorsBucketOf(cur)[side] ?? []).map((o) => ({ ...o, lat: null, lng: null }))
    const after: MapStateSnapshot = {
      vehicles: { attack: [], defense: [] },
      drawings: { attack: emptyGeoJson(), defense: emptyGeoJson() },
      operators: {
        attack: undeployOperators('attack'),
        defense: undeployOperators('defense'),
      },
      // 联线原样保留（未部署的干员被"清除部署"时，联线端点悬浮保留，与 handleClearTeam 语义一致）
      connections: { ...before.connections },
      // 队标直接清空（队标即部署状态，无"未部署的配置形态"；保留会导致左侧按钮无法恢复未部署态）
      teams: { attack: [], defense: [] },
      routes: { attack: [], defense: [] },
      buildings: { attack: [], defense: [] },
      fieldSupports: { attack: [], defense: [] },
      skillActions: [],
    }
    pushEntry(before, after)
    updateMap(mapId, (s) => ({
      ...s,
      vehicles: { attack: [], defense: [] },
      buildings: { attack: [], defense: [] },
      drawings: { attack: emptyGeoJson(), defense: emptyGeoJson() },
      operators: {
        attack: (operatorsBucketOf(s).attack ?? []).map((o) => ({ ...o, lat: null, lng: null })),
        defense: (operatorsBucketOf(s).defense ?? []).map((o) => ({ ...o, lat: null, lng: null })),
      },
      // 联线 / 推演状态原样保留
      connections: { ...connectionsBucketOf(s) },
      teams: { attack: [], defense: [] },
      routes: { attack: [], defense: [] },
      fieldSupports: { attack: [], defense: [] },
      skillActions: [],
      wargame: { ...wargameOf(s) },
    }))
  }, [mapId, cloneState, pushEntry, updateMap])

  const handleClearAll = useCallback(() => {
    const message = `确定一键清空「${config.name}」的所有画笔和载具部署图标？（兵棋干员回到未部署，攻防进度保留）`
    if (platform.kind === 'android') {
      setMobileConfirm({ title: '清空地图内容', message, confirmLabel: '确定清空', onConfirm: clearAllMapContent })
      return
    }
    if (window.confirm(message)) clearAllMapContent()
  }, [clearAllMapContent, config.name])

  const handleResetProgress = useCallback(() => {
    if (!window.confirm('确定重置本图攻防进度？所有阶段回到未激活状态。')) return
    setProgress((prev) => ({ ...prev, [mapId]: 0 }))
    setSelectedPoint(null)
  }, [mapId])

  // ================= 兵棋推演 =================
  const state = maps[mapId] ?? createEmptyMapState()
  // 当前视角干员/联线/推演状态（派生，供面板与地图层使用）
  // 视角桶内同时存双方：我方 20 人（side === view）+ 敌方 20 人（side !== view），形成红蓝对抗
  const operators = operatorsBucketOf(state)[view]
  const connections = connectionsBucketOf(state)[view]
  const wargame = wargameOf(state)
  const fieldSupports = fieldSupportsBucketOf(state)[view]

  const handleAddFieldSupport = useCallback((definition: import('./types').FieldSupportDefinition, side: Side) => {
    const center = mapRef.current?.getCenter() ?? { lat: 0, lng: 0 }
    const stageId = activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1'
    updateMap(mapId, (current) => {
      const buckets = fieldSupportsBucketOf(current)
      const item: import('./types').FieldSupportInstance = {
        uid: genUid('support'),
        definitionId: definition.id,
        name: definition.name,
        iconUrl: definition.iconUrl,
        side,
        lat: center.lat,
        lng: center.lng,
        radius: definition.defaultRadius,
        stageId,
      }
      return { ...current, fieldSupports: { ...buckets, [view]: [...buckets[view], item] } }
    })
    setTool('pan')
  }, [activeModeStageId, capturedStageIndex, mapId, stages, updateMap, view])

  const handleMoveFieldSupport = useCallback((uid: string, lat: number, lng: number) => {
    updateMap(mapId, (current) => {
      const buckets = fieldSupportsBucketOf(current)
      return { ...current, fieldSupports: { ...buckets, [view]: buckets[view].map((item) => item.uid === uid ? { ...item, lat, lng } : item) } }
    })
  }, [mapId, updateMap, view])

  const handleDeleteFieldSupport = useCallback((uid: string) => {
    updateMap(mapId, (current) => {
      const buckets = fieldSupportsBucketOf(current)
      return { ...current, fieldSupports: { ...buckets, [view]: buckets[view].filter((item) => item.uid !== uid) } }
    })
  }, [mapId, updateMap, view])

  /** 推演状态局部更新（enabled/round/showConnections/connectMode） */
  const handleWargameChange = useCallback(
    (patch: Partial<WargameState>) => {
      updateMap(mapId, (s) => ({ ...s, wargame: { ...wargameOf(s), ...patch } }))
    },
    [mapId, updateMap],
  )
  const handleRoundChange = useCallback((round: number) => {
    updateMap(mapId, (state) => {
      const stageId = activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1'
      const current = snapshotTacticalBucket(state, stageId, wargameOf(state).round)
      const buckets = { ...(state.tacticalBuckets ?? { activeKey: current.key, buckets: {} }).buckets, [current.key]: current }
      const target = buckets[tacticalBucketKey(stageId, round)]
      return target ? applyTacticalBucket({ ...state, tacticalBuckets: { activeKey: target.key, buckets } }, target) : createTacticalRound({ ...state, tacticalBuckets: { activeKey: current.key, buckets } }, stageId, round)
    })
  }, [activeModeStageId, capturedStageIndex, mapId, stages, updateMap])
  const handleCreateRound = useCallback((copy: boolean) => {
    updateMap(mapId, (state) => {
      const stageId = activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1'
      const currentRound = wargameOf(state).round
      const current = snapshotTacticalBucket(state, stageId, currentRound)
      const store = state.tacticalBuckets ?? { activeKey: current.key, buckets: {} }
      const buckets = { ...store.buckets, [current.key]: current }
      const stageRounds = Object.values(buckets).filter((bucket) => bucket.stageId === stageId).map((bucket) => bucket.round)
      const targetRound = copy ? Math.max(currentRound, ...stageRounds) + 1 : currentRound + 1
      const existing = buckets[tacticalBucketKey(stageId, targetRound)]
      if (existing) return applyTacticalBucket({ ...state, tacticalBuckets: { activeKey: existing.key, buckets } }, existing)
      return createTacticalRound({ ...state, tacticalBuckets: { activeKey: current.key, buckets } }, stageId, targetRound, copy)
    })
  }, [activeModeStageId, capturedStageIndex, mapId, stages, updateMap])
  const handleDeleteRound = useCallback(() => {
    updateMap(mapId, (state) => {
      const stageId = activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1'
      const current = snapshotTacticalBucket(state, stageId, wargameOf(state).round)
      const buckets = { ...(state.tacticalBuckets ?? { activeKey: current.key, buckets: {} }).buckets }
      delete buckets[current.key]
      const target = Object.values(buckets).filter((bucket) => bucket.stageId === stageId).sort((a, b) => a.round - b.round)[0]
      return target ? applyTacticalBucket({ ...state, tacticalBuckets: { activeKey: target.key, buckets } }, target) : state
    })
  }, [activeModeStageId, capturedStageIndex, mapId, stages, updateMap])

  // 枪线按钮上的滚轮只调整该兵棋的地图距离，不触发兵棋朝向旋转。
  useEffect(() => {
    const adjust = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: 'operator' | 'team' | 'vehicle' | 'building'; uid: string; delta: number }>).detail
      if (!detail?.uid || !Number.isFinite(detail.delta)) return
      const nextLength = (value?: number) => Math.max(0, Math.min(240, (value ?? 56) + detail.delta))
      updateMap(mapId, (state) => {
        if (detail.kind === 'vehicle') {
          const bucket = vehiclesBucketOf(state)
          return { ...state, vehicles: { ...bucket, [view]: bucket[view].map((item) => item.uid === detail.uid ? { ...item, fireLineLength: nextLength(item.fireLineLength) } : item) } }
        }
        if (detail.kind === 'building') {
          const bucket = buildingsBucketOf(state)
          return { ...state, buildings: { ...bucket, [view]: bucket[view].map((item) => item.uid === detail.uid ? { ...item, fireLineLength: nextLength(item.fireLineLength) } : item) } }
        }
        if (detail.kind === 'team') {
          const bucket = teamsBucketOf(state)
          return { ...state, teams: { ...bucket, [view]: bucket[view].map((item) => item.uid === detail.uid ? { ...item, fireLineLength: nextLength(item.fireLineLength) } : item) } }
        }
        const bucket = operatorsBucketOf(state)
        return { ...state, operators: { ...bucket, [view]: bucket[view].map((item) => item.uid === detail.uid ? { ...item, fireLineLength: nextLength(item.fireLineLength) } : item) } }
      })
    }
    window.addEventListener('unit-fireline-length', adjust)
    return () => window.removeEventListener('unit-fireline-length', adjust)
  }, [mapId, updateMap, view])

  useEffect(() => {
    if (!device.mobileLayout) return
    const target = window as unknown as {
      __unitFireLineDragStart?: (event: PointerEvent, kind: 'operator' | 'team' | 'vehicle' | 'building', uid: string) => void
    }
    target.__unitFireLineDragStart = (event, kind, uid) => {
      event.preventDefault()
      event.stopPropagation()
      const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : event.target instanceof HTMLElement ? event.target : null
      try { button?.setPointerCapture(event.pointerId) } catch { /* pointer may already have been released */ }
      const pointerId = event.pointerId
      let moved = false
      let slider: HTMLInputElement | null = null
      let longPressTimer: number | undefined
      const closeSlider = () => { slider?.remove(); slider = null }
      longPressTimer = window.setTimeout(() => {
        if (!button) return
        moved = true
        slider = document.createElement('input')
        slider.type = 'range'; slider.min = '0'; slider.max = '240'; slider.step = '1'
        slider.value = button.dataset.firelineLength ?? '56'
        slider.className = 'mobile-fireline-slider'
        const rect = button.getBoundingClientRect()
        slider.style.left = `${Math.max(8, Math.min(window.innerWidth - 188, rect.left + rect.width / 2 - 90))}px`
        slider.style.top = `${Math.max(8, rect.top - 42)}px`
        slider.addEventListener('pointerdown', (e) => { e.stopPropagation() })
        slider.addEventListener('input', () => {
          const next = Number(slider?.value ?? 56)
          const previous = Number(button.dataset.firelineLength ?? 56)
          button.dataset.firelineLength = String(next)
          window.dispatchEvent(new CustomEvent('unit-fireline-length', { detail: { kind, uid, delta: next - previous } }))
        })
        document.body.appendChild(slider)
        slider.focus()
        window.setTimeout(() => {
          const dismiss = (dismissEvent: PointerEvent) => {
            if (dismissEvent.target === slider) return
            closeSlider()
            document.removeEventListener('pointerdown', dismiss, true)
          }
          document.addEventListener('pointerdown', dismiss, true)
        }, 0)
      }, 450)
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        moveEvent.preventDefault()
        if (!slider) return
      }
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
        try { button?.releasePointerCapture(pointerId) } catch { /* capture may already be lost */ }
        if (longPressTimer) window.clearTimeout(longPressTimer)
        if (!moved && finishEvent.type === 'pointerup') {
          window.dispatchEvent(new CustomEvent('unit-fireline-toggle', { detail: { kind, uid } }))
        }
      }
      document.addEventListener('pointermove', move, { passive: false })
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }
    return () => { delete target.__unitFireLineDragStart }
  }, [device.mobileLayout])

  const handleObjectiveStateChange = useCallback((pointName: string, objectiveState: TacticalObjectiveState) => {
    updateMap(mapId, (state) => {
      const currentWargame = wargameOf(state)
      return {
        ...state,
        wargame: {
          ...currentWargame,
          battleContext: {
            ...currentWargame.battleContext,
            objectiveStates: { ...currentWargame.battleContext.objectiveStates, [pointName]: objectiveState },
          },
        },
      }
    })
  }, [mapId, updateMap])

  /** 干员操作的统一入栈入口（与 commitVehicleChange 对称） */
  const commitOperatorChange = useCallback(
    (mutator: (ops: OperatorUnit[]) => OperatorUnit[]) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const current = operatorsBucketOf(cur)[view] ?? []
      const currentByUid = new Map(current.map((operator) => [operator.uid, operator]))
      const nextOperators = mutator(current)
      const undeployed = new Set(nextOperators.filter((operator) => operator.lat == null || operator.lng == null).map((operator) => operator.uid))
      const changedOperator = new Set(nextOperators.filter((operator) => {
        const previous = currentByUid.get(operator.uid)
        return previous && previous.operatorId !== operator.operatorId
      }).map((operator) => operator.uid))
      const clearedSkillSources = new Set([...undeployed, ...changedOperator])
      const nextSkillActions = (cur.skillActions ?? []).filter((action) => !clearedSkillSources.has(action.sourceOperatorUid))
      let nextRoutes = routesBucketOf(cur)[view]
      const removedRouteIds = new Set<string>()
      for (const route of nextRoutes) {
        if (route.anchorMode === 'operator' && route.anchorOperatorUid && undeployed.has(route.anchorOperatorUid)) {
          removedRouteIds.add(route.uid)
        }
      }
      if (removedRouteIds.size > 0) nextRoutes = nextRoutes.filter((route) => !removedRouteIds.has(route.uid))
      for (const operator of nextOperators) {
        const previous = currentByUid.get(operator.uid)
        if (!previous || operator.lat == null || operator.lng == null) continue
        if (operator.lat === previous.lat && operator.lng === previous.lng) continue
        const point: [number, number] = [operator.lat, operator.lng]
        nextRoutes = nextRoutes.map((route) =>
          route.anchorMode === 'operator' && route.anchorOperatorUid === operator.uid
            ? { ...route, waypoints: [point, ...route.waypoints.slice(1)] }
            : route,
        )
        nextRoutes = syncRouteTargetPosition(nextRoutes, 'operator', operator.uid, point)
      }
      updateMap(mapId, (s) => ({
        ...s,
        operators: { ...operatorsBucketOf(s), [view]: nextOperators },
        routes: { ...routesBucketOf(s), [view]: nextRoutes },
        skillActions: nextSkillActions,
      }))
      const after: MapStateSnapshot = {
        ...before,
        operators: { ...before.operators, [view]: nextOperators },
        routes: { ...before.routes, [view]: nextRoutes },
        skillActions: nextSkillActions,
      }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 切换具体干员（如 红狼 → 蜂医）：职业随所选干员档案自动变化 */
  const handleOperatorChange = useCallback(
    (uid: string, operatorId: string) => {
      const profile = profileOf(operatorId)
      commitOperatorChange((ops) =>
        ops.map((o) => (o.uid === uid ? { ...o, operatorId, cls: profile.cls } : o)),
      )
    },
    [commitOperatorChange],
  )

  /** 编辑干员昵称（如 A1 → 老K），地图标记同步更新 */
  const handleOperatorRename = useCallback(
    (uid: string, name: string) => {
      commitOperatorChange((ops) => ops.map((o) => (o.uid === uid ? { ...o, name } : o)))
    },
    [commitOperatorChange],
  )

  /** 切换干员状态（存活/重伤/阵亡） */
  const handleOperatorStatusChange = useCallback(
    (uid: string, status: OperatorUnit['status']) => {
      commitOperatorChange((ops) => ops.map((o) => (o.uid === uid ? { ...o, status } : o)))
    },
    [commitOperatorChange],
  )

  /** 单干员部署/清除 toggle（第二十四轮）：未部署→部署到地图中心附近，已部署→回未部署 */
  const handleToggleOperatorDeploy = useCallback(
    (uid: string) => {
      const center = mapRef.current?.getCenter() ?? { lat: 0, lng: 0 }
      const offset = device.mobileLayout ? 0 : 12
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const current = operatorsBucketOf(cur)[view]
      const operator = current.find((item) => item.uid === uid)
      if (!operator) return
      const deploying = operator.lat == null || operator.lng == null
      const point: [number, number] = [center.lat + offset, center.lng + offset]
      const nextOperators = current.map((item) => item.uid === uid
        ? deploying ? { ...item, lat: point[0], lng: point[1] } : { ...item, lat: null, lng: null }
        : item)
      let nextRoutes = routesBucketOf(cur)[view]
      if (deploying) {
        nextRoutes = nextRoutes.map((route) =>
          route.anchorMode === 'operator' && route.anchorOperatorUid === uid
            ? { ...route, waypoints: [point, ...route.waypoints.slice(1)] }
            : route,
        )
        nextRoutes = syncRouteTargetPosition(nextRoutes, 'operator', uid, point)
      } else {
        const removedRouteIds = new Set<string>()
        for (const route of nextRoutes) {
          if (route.anchorMode === 'operator' && route.anchorOperatorUid === uid) {
            removedRouteIds.add(route.uid)
          }
        }
        nextRoutes = nextRoutes.filter((route) => !removedRouteIds.has(route.uid))
      }
      updateMap(mapId, (state) => ({
        ...state,
        operators: { ...operatorsBucketOf(state), [view]: nextOperators },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
        skillActions: deploying ? state.skillActions : (state.skillActions ?? []).filter((action) => action.sourceOperatorUid !== uid),
      }))
      pushEntry(before, {
        ...before,
        operators: { ...before.operators, [view]: nextOperators },
        routes: { ...before.routes, [view]: nextRoutes },
        skillActions: deploying ? before.skillActions : (before.skillActions ?? []).filter((action) => action.sourceOperatorUid !== uid),
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap, device.mobileLayout],
  )

  /** 拖拽移动干员（高频，不入历史栈；与载具移动一致） */
  const handleOperatorMove = useCallback(
    (uid: string, lat: number, lng: number) => {
      updateMap(mapId, (s) => {
        const bucket = operatorsBucketOf(s)
        const routeBucket = routesBucketOf(s)
        const anchored = routeBucket[view].map((route) =>
          route.anchorMode === 'operator' && route.anchorOperatorUid === uid
            ? { ...route, waypoints: [[lat, lng] as [number, number], ...route.waypoints.slice(1)] }
            : route,
        )
        return {
          ...s,
          operators: { ...bucket, [view]: bucket[view].map((o) => (o.uid === uid ? { ...o, lat, lng } : o)) },
          routes: { ...routeBucket, [view]: syncRouteTargetPosition(anchored, 'operator', uid, [lat, lng]) },
        }
      })
    },
    [mapId, view, updateMap],
  )

  const handleRotateOperator = useCallback((uid: string, rotation: number) => {
    updateMap(mapId, (state) => {
      const bucket = operatorsBucketOf(state)
      return { ...state, operators: { ...bucket, [view]: bucket[view].map((item) => item.uid === uid ? { ...item, rotation } : item) } }
    })
  }, [mapId, updateMap, view])

  const handleToggleOperatorFireLine = useCallback((uid: string) => {
    updateMap(mapId, (state) => {
      const bucket = operatorsBucketOf(state)
      return { ...state, operators: { ...bucket, [view]: bucket[view].map((item) => item.uid === uid ? { ...item, fireLineEnabled: !item.fireLineEnabled } : item) } }
    })
  }, [mapId, updateMap, view])

  /** 部署某方某队全部干员：围绕当前地图中心环形排布（视角桶内含双方，需按 阵营+队 定位） */
  const handleDeployTeam = useCallback(
    (side: Side, team: OperatorTeam) => {
      const center = mapRef.current?.getCenter() ?? { lat: 0, lng: 0 }
      const offset = device.mobileLayout ? 7 : 12
      const order: Record<OperatorTeam, [number, number][]> = {
        A: [[-offset, -offset], [offset, -offset], [-offset, offset], [offset, offset]],
        B: [[offset * 1.6, 0], [-offset * 1.6, 0], [offset * 1.6, offset], [-offset * 1.6, -offset]],
        C: [[0, offset * 1.6], [0, -offset * 1.6], [offset, offset * 1.6], [-offset, -offset * 1.6]],
        D: [[offset * 1.6, offset * 1.6], [-offset * 1.6, offset * 1.6], [offset * 1.6, -offset * 1.6], [-offset * 1.6, -offset * 1.6]],
        E: [[-offset, -offset], [offset, -offset], [-offset, offset], [offset, offset]],
      }
      const spots = order[team]
      commitOperatorChange((ops) =>
        ops.map((o, i) => {
          if (o.side !== side || o.team !== team) return o
          const s = spots[i % spots.length]
          return { ...o, lat: center.lat + s[0], lng: center.lng + s[1] }
        }),
      )
    },
    [commitOperatorChange, device.mobileLayout],
  )

  /** 清除某方某队全部干员部署（回未部署） */
  const handleClearTeam = useCallback(
    (side: Side, team: OperatorTeam) => {
      commitOperatorChange((ops) =>
        ops.map((o) => (o.side === side && o.team === team ? { ...o, lat: null, lng: null } : o)),
      )
    },
    [commitOperatorChange],
  )

  /** 批量移动干员（套索整体移动，第十七轮）：一次入历史栈 */
  const handleMoveOperators = useCallback(
    (updates: Record<string, [number, number]>) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const nextOperators = operatorsBucketOf(cur)[view].map((operator) => {
        const point = updates[operator.uid]
        return point ? { ...operator, lat: point[0], lng: point[1] } : operator
      })
      let nextRoutes = routesBucketOf(cur)[view].map((route) => {
        const point = route.anchorOperatorUid ? updates[route.anchorOperatorUid] : undefined
        return point && route.anchorMode === 'operator' ? { ...route, waypoints: [point, ...route.waypoints.slice(1)] } : route
      })
      for (const [uid, point] of Object.entries(updates)) nextRoutes = syncRouteTargetPosition(nextRoutes, 'operator', uid, point)
      updateMap(mapId, (state) => ({
        ...state,
        operators: { ...operatorsBucketOf(state), [view]: nextOperators },
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
      }))
      pushEntry(before, {
        ...before,
        operators: { ...before.operators, [view]: nextOperators },
        routes: { ...before.routes, [view]: nextRoutes },
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 批量删除干员（套索 Delete/删除按钮，第十七轮）：干员回未部署（保留配置），一次入历史栈 */
  const handleDeleteOperators = useCallback(
    (uids: string[]) => {
      const set = new Set(uids)
      commitOperatorChange((ops) => ops.map((o) => (set.has(o.uid) ? { ...o, lat: null, lng: null } : o)))
    },
    [commitOperatorChange],
  )

  /** 一键建立协同：该队已部署干员按顺序建立关系（1-2、2-3、3-4），已有关系跳过。 */
  const handleConnectTeam = useCallback(
    (side: Side, team: OperatorTeam) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      // 该方该队已部署干员（按当前列表顺序，即 1-2-3-4 的顺序）
      const deployed = (operatorsBucketOf(cur)[view] ?? []).filter(
        (o) => o.side === side && o.team === team && o.lat != null && o.lng != null,
      )
      if (deployed.length < 2) return
      const existing = new Set<string>()
      for (const c of connectionsBucketOf(cur)[view]) {
        existing.add([c.operatorAId, c.operatorBId].sort().join('|'))
      }
      const created: OperatorConnection[] = []
      for (let i = 0; i < deployed.length - 1; i++) {
        const key = [deployed[i].uid, deployed[i + 1].uid].sort().join('|')
        if (existing.has(key)) continue
        created.push({
          id: genUid('conn'),
          side: view,
          operatorAId: deployed[i].uid,
          operatorBId: deployed[i + 1].uid,
          team,
          style: 'dashed',
          createdAt: Date.now(),
        })
      }
      if (created.length === 0) return
      const next = [...connectionsBucketOf(cur)[view], ...created]
      updateMap(mapId, (s) => ({ ...s, connections: { ...connectionsBucketOf(s), [view]: next } }))
      const after: MapStateSnapshot = { ...before, connections: { ...before.connections, [view]: next } }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 一键清除某方全部干员部署（回未部署；保留配置/状态/连线），入历史栈 */
  const handleClearSideDeploy = useCallback(
    (side: Side) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      updateMap(mapId, (s) => ({
        ...s,
        operators: {
          ...operatorsBucketOf(s),
          [view]: operatorsBucketOf(s)[view].map((o) => (o.side === side ? { ...o, lat: null, lng: null } : o)),
        },
      }))
      const after: MapStateSnapshot = {
        ...before,
        operators: {
          ...before.operators,
          [view]: before.operators[view].map((o) => (o.side === side ? { ...o, lat: null, lng: null } : o)),
        },
      }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 一键解除某方全部协同关系。 */
  const handleClearSideConnections = useCallback(
    (side: Side) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const ops = operatorsBucketOf(cur)[view]
      const uids = new Set(ops.filter((o) => o.side === side).map((o) => o.uid))
      const remain = connectionsBucketOf(cur)[view].filter((c) => !uids.has(c.operatorAId) && !uids.has(c.operatorBId))
      if (remain.length === connectionsBucketOf(cur)[view].length) return
      updateMap(mapId, (s) => ({ ...s, connections: { ...connectionsBucketOf(s), [view]: remain } }))
      const after: MapStateSnapshot = { ...before, connections: { ...before.connections, [view]: remain } }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 一键解除某队全部协同关系。 */
  const handleClearTeamConnections = useCallback(
    (side: Side, team: OperatorTeam) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const ops = operatorsBucketOf(cur)[view]
      const uids = new Set(ops.filter((o) => o.side === side && o.team === team).map((o) => o.uid))
      const remain = connectionsBucketOf(cur)[view].filter((c) => !uids.has(c.operatorAId) && !uids.has(c.operatorBId))
      if (remain.length === connectionsBucketOf(cur)[view].length) return
      updateMap(mapId, (s) => ({ ...s, connections: { ...connectionsBucketOf(s), [view]: remain } }))
      const after: MapStateSnapshot = { ...before, connections: { ...before.connections, [view]: remain } }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 一键重置推演：清空当前视角全部阶段/回合兵棋数据，回到第 1 回合。 */
  const handleWargameReset = useCallback(() => {
    if (!window.confirm(`确定重置${view === 'attack' ? '攻方' : '守方'}视角全部兵棋推演？将清空所有阶段/回合中的兵棋、路线、枪线、绘制与备注。`)) return
    const cur = mapsRef.current[mapId] ?? createEmptyMapState()
    const before = cloneState(cur)
    updateMap(mapId, (s) => {
      const resetView = (bucket: TacticalBucket): TacticalBucket => ({
        ...bucket,
        vehicles: { ...bucket.vehicles, [view]: [] },
        buildings: { ...bucket.buildings, [view]: [] },
        operators: { ...bucket.operators, [view]: buildDefaultOperators(view) },
        connections: { ...bucket.connections, [view]: [] },
        teams: { ...bucket.teams, [view]: [] },
        routes: { ...bucket.routes, [view]: [] },
        fieldSupports: { ...(bucket.fieldSupports ?? { attack: [], defense: [] }), [view]: [] },
        skillActions: (bucket.skillActions ?? []).filter((action) => action.side !== view),
        updatedAt: Date.now(),
      })
      const buckets = Object.fromEntries(Object.entries(s.tacticalBuckets?.buckets ?? {}).map(([key, bucket]) => [key, resetView(bucket)]))
      return {
        ...s,
        vehicles: { ...vehiclesBucketOf(s), [view]: [] },
        buildings: { ...buildingsBucketOf(s), [view]: [] },
        operators: { ...operatorsBucketOf(s), [view]: buildDefaultOperators(view) },
        connections: { ...connectionsBucketOf(s), [view]: [] },
        teams: { ...teamsBucketOf(s), [view]: [] },
        routes: { ...routesBucketOf(s), [view]: [] },
        fieldSupports: { ...fieldSupportsBucketOf(s), [view]: [] },
        tacticalBuckets: { activeKey: tacticalBucketKey(activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1', 1), buckets },
        wargame: { ...wargameOf(s), round: 1, connectMode: false },
      }
    })
    const after: MapStateSnapshot = {
      ...before,
      operators: { ...before.operators, [view]: buildDefaultOperators(view) },
      connections: { ...before.connections, [view]: [] },
      teams: { ...before.teams, [view]: [] },
      fieldSupports: { ...(before.fieldSupports ?? { attack: [], defense: [] }), [view]: [] },
    }
    pushEntry(before, after)
  }, [activeModeStageId, capturedStageIndex, mapId, stages, view, cloneState, pushEntry, updateMap])

  // ---- 战术板：导出 + 方案管理（第二十一轮） ----
  /** 导出战术板 HTML（当前视角全部战术层 + 静态层，范围可选当前阶段/全部阶段） */
  const handleExportTactical = useCallback(
    async (stageMode: 'current' | 'all' | 'overview', exportStageId: string, exportRound: number) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const stageId = exportStageId || activeModeStageId || stages[capturedStageIndex]?.id || 'S1'
      const allBuckets = cur.tacticalBuckets?.buckets ?? {}
      const bucket = allBuckets[tacticalBucketKey(stageId, exportRound)]
      const source = bucket ? applyTacticalBucket(cur, bucket) : cur
      const snapshots = stageMode !== 'current'
        ? Object.values(allBuckets).sort((a, b) => {
            const stageOrder = stages.findIndex((stage) => stage.id === a.stageId) - stages.findIndex((stage) => stage.id === b.stageId)
            return stageOrder || a.round - b.round
          }).map((item) => ({
            key: item.key,
            stageId: item.stageId,
            round: item.round,
            capturedStageIndex: stages.findIndex((stage) => stage.id === item.stageId),
            geoJson: item.drawings[view] ?? emptyGeoJson(),
            vehicles: item.vehicles[view] ?? [],
            buildings: item.buildings[view] ?? [],
            operators: item.operators[view] ?? [],
            connections: item.connections[view] ?? [],
            teams: item.teams[view] ?? [],
            routes: item.routes[view] ?? [],
            fieldSupports: item.fieldSupports?.[view] ?? [],
            // 一个战术视角中可同时部署敌我双方技能，不能按技能阵营过滤。
            skillActions: item.skillActions ?? [],
            notesMarkdown: wargameOf(cur).stageNotes?.[item.stageId] ?? item.notesMarkdown ?? '',
          }))
        : undefined
      const propsList = platformProps[mapId] ?? []
      const html = await buildTacticalHtml({
        config,
        mapName: config.name,
        view,
        stageMode,
        capturedStageIndex,
        stages,
        geoJson: source.drawings[view] ?? emptyGeoJson(),
        vehicles: vehiclesBucketOf(source)[view],
        buildings: buildingsBucketOf(source)[view],
        operators: operatorsBucketOf(source)[view],
        connections: connectionsBucketOf(source)[view],
        teams: teamsBucketOf(source)[view],
        teamRoles: wargameOf(source).teamRoles,
        routes: routesBucketOf(source)[view],
        fieldSupports: fieldSupportsBucketOf(source)[view],
        skillActions: source.skillActions ?? [],
        showProps: ui.layers.props,
        propVis: ui.propVis,
        propsList,
        notesMarkdown: wargameOf(source).stageNotes?.[stageId] ?? wargameOf(source).notesMarkdown ?? '',
        noteImages: wargameOf(source).noteImages ?? {},
        snapshots,
      })
      const stageTag = stageMode === 'current' ? `${stageId}-R${exportRound}` : stageMode === 'overview' ? 'overview' : 'all'
      downloadText(`战术板_${config.name}_${view === 'attack' ? '攻方' : '守方'}_${stageTag}.html`, html)
    },
    [mapId, config, view, activeModeStageId, capturedStageIndex, stages, platformProps, ui.layers.props, ui.propVis],
  )

  const handleOperatorSkillUse = useCallback(
    (uid: string, activeSkillSlot?: 1 | 2 | 3 | 4) => {
      const current = mapsRef.current[mapId] ?? createEmptyMapState()
      const operator = operatorsBucketOf(current)[view].find((item) => item.uid === uid)
      if (!operator || activeSkillSlot == null) {
        setSkillActionDraft(null)
        return
      }
      const skill = operatorSkillsOf(operator.operatorId).find((item) => item.slot === activeSkillSlot)
      if (!skill || skill.kind === 'passive') return
      if (skill.placementMode === 'self') {
        updateMap(mapId, (state) => ({
          ...state,
          skillActions: [...(state.skillActions ?? []), {
            uid: genUid('skill'), sourceOperatorUid: operator.uid, operatorId: operator.operatorId,
            skillSlot: skill.slot, skillName: skill.name, kind: skill.kind, placementMode: skill.placementMode,
            side: operator.side, effectArea: skill.effectArea, canBindTarget: skill.canBindTarget,
            tracking: skill.tracking, sector: skill.sector, visible: true, createdAt: Date.now(),
          }],
        }))
        return
      }
      setSkillActionDraft({ operator, skill })
      setTool('pan')
    },
    [mapId, updateMap, view],
  )

  const handlePlaceSkillAction = useCallback((lat: number, lng: number) => {
    if (!skillActionDraft) return
    const { operator, skill } = skillActionDraft
    if (operator.lat == null || operator.lng == null) return
    const source: [number, number] = [operator.lat, operator.lng]
    const target: [number, number] = [lat, lng]
    const isSwarmCorridor = operator.operatorId === '10018' && skill.slot === 4
    const isSmokeWall = operator.operatorId === '10001' && skill.slot === 2
    const isSmokeSkill = skill.name.includes('烟雾')
    const geometry: import('./types').OperatorSkillActionGeometry = isSwarmCorridor
      ? { type: 'line', points: [source, target], width: 34, widthRatio: 0.01425 }
      : isSmokeWall
        ? { type: 'line', points: [source, target], width: 24, widthRatio: SHARED_SMOKE_WIDTH_RATIO }
        : isSmokeSkill
          ? { type: 'area', center: target, radius: 60, radiusRatio: SHARED_SMOKE_RADIUS_RATIO }
      : skill.placementMode === 'area'
      ? { type: 'area', center: target, radius: 60 }
      : skill.placementMode === 'target-point' || skill.placementMode === 'target-unit' || skill.placementMode === 'ally-unit'
        ? { type: 'point', position: target }
        : skill.placementMode === 'guided-path'
          ? { type: 'curve', start: source, controls: [[(source[0] + target[0]) / 2 + 10, (source[1] + target[1]) / 2]], end: target }
          : { type: 'trajectory', points: [source, target] }
    updateMap(mapId, (state) => ({
      ...state,
      skillActions: [...(state.skillActions ?? []), {
        uid: genUid('skill'), sourceOperatorUid: operator.uid, operatorId: operator.operatorId,
        skillSlot: skill.slot, skillName: skill.name, kind: skill.kind, placementMode: skill.placementMode,
        side: operator.side, geometry, effectArea: skill.effectArea, canBindTarget: skill.canBindTarget,
        tracking: skill.tracking, sector: skill.sector, visible: true, createdAt: Date.now(),
      }],
    }))
    setSkillActionDraft(null)
  }, [mapId, skillActionDraft, updateMap])

  const handleSelectSkillTarget = useCallback((targetUid: string) => {
    if (!skillActionDraft) return
    const current = mapsRef.current[mapId] ?? createEmptyMapState()
    const target = operatorsBucketOf(current)[view].find((item) => item.uid === targetUid)
    const { operator, skill } = skillActionDraft
    if (!target || target.lat == null || target.lng == null || target.uid === operator.uid) return
    if (skill.placementMode === 'ally-unit' && target.side !== operator.side) return
    if (skill.placementMode === 'target-unit' && target.side === operator.side) return
    updateMap(mapId, (state) => ({
      ...state,
      skillActions: [...(state.skillActions ?? []), {
        uid: genUid('skill'), sourceOperatorUid: operator.uid, operatorId: operator.operatorId,
        skillSlot: skill.slot, skillName: skill.name, kind: skill.kind, placementMode: skill.placementMode,
        side: operator.side, targetUid: target.uid, geometry: { type: 'point', position: [target.lat as number, target.lng as number] },
        effectArea: skill.effectArea, canBindTarget: skill.canBindTarget, tracking: skill.tracking,
        sector: skill.sector, visible: true, createdAt: Date.now(),
      }],
    }))
    setSkillActionDraft(null)
  }, [mapId, skillActionDraft, updateMap, view])

  const handleDeleteSkillAction = useCallback((uid: string) => {
    updateMap(mapId, (state) => ({ ...state, skillActions: (state.skillActions ?? []).filter((action) => action.uid !== uid) }))
  }, [mapId, updateMap])

  const handleUpdateSkillActionGeometry = useCallback((uid: string, geometry: import('./types').OperatorSkillActionGeometry) => {
    updateMap(mapId, (state) => ({ ...state, skillActions: (state.skillActions ?? []).map((action) => action.uid === uid ? { ...action, geometry } : action) }))
  }, [mapId, updateMap])

  const handleExportNativeTactical = useCallback((scope: 'all' | 'stage' | 'current' = 'all') => {
    const current = mapsRef.current[mapId] ?? createEmptyMapState()
    const activeKey = current.tacticalBuckets?.activeKey
    const currentBucket = activeKey ? current.tacticalBuckets?.buckets[activeKey] : undefined
    const buckets = current.tacticalBuckets?.buckets ?? {}
    const selectedBuckets = scope === 'stage' && currentBucket
      ? Object.fromEntries(Object.entries(buckets).filter(([, bucket]) => bucket.stageId === currentBucket.stageId))
      : scope === 'current' && currentBucket ? { [currentBucket.key]: currentBucket } : buckets
    const payload = {
      format: 'deltaforce-native-tactical-board',
      version: 1,
      scope,
      exportedAt: new Date().toISOString(),
      mapId,
      view,
      mapState: { ...createEmptyMapState(), tacticalBuckets: { activeKey: currentBucket?.key ?? '', buckets: selectedBuckets } },
    }
    const suffix = currentBucket ? (scope === 'stage' ? `_${currentBucket.stageId}-all` : scope === 'current' ? `_${currentBucket.stageId}-R${currentBucket.round}` : '_all') : ''
    downloadText(`原生战术包_${config.name}_${view === 'attack' ? '攻方' : '守方'}${suffix}.dfboard`, JSON.stringify(payload), 'application/json')
  }, [config.name, mapId, view])

  const handleImportNativeTactical = useCallback(async (file: File) => {
    let payload: { format?: unknown; version?: unknown; scope?: unknown; mapId?: unknown; view?: unknown; mapState?: unknown }
    try {
      payload = JSON.parse(await file.text()) as typeof payload
    } catch {
      window.alert('无法读取原生战术包：文件不是有效的 JSON。')
      return
    }
    if (payload.format !== 'deltaforce-native-tactical-board' || payload.version !== 1 || typeof payload.mapId !== 'string' || !MAP_BY_ID[payload.mapId] || !payload.mapState || typeof payload.mapState !== 'object') {
      window.alert('无法导入：文件不是受支持的原生战术包。')
      return
    }
    const targetMapId = payload.mapId
    const source = payload.mapState as MapState
    if (!window.confirm(`导入将覆盖“${MAP_BY_ID[targetMapId].name}”现有战术数据，是否继续？`)) return
    const imported: MapState = {
      ...createEmptyMapState(),
      ...source,
      vehicles: vehiclesBucketOf(source),
      buildings: buildingsBucketOf(source),
      operators: operatorsBucketOf(source),
      connections: connectionsBucketOf(source),
      teams: teamsBucketOf(source),
      routes: routesBucketOf(source),
      drawings: { attack: normalizeDrawingGeoJson(source.drawings?.attack ?? emptyGeoJson()), defense: normalizeDrawingGeoJson(source.drawings?.defense ?? emptyGeoJson()) },
      fieldSupports: fieldSupportsBucketOf(source),
      skillActions: Array.isArray(source.skillActions) ? source.skillActions : [],
      wargame: wargameOf(source),
    }
    const rawStore = source.tacticalBuckets
    const migratedBuckets = rawStore && typeof rawStore === 'object' && rawStore.buckets && typeof rawStore.buckets === 'object'
      ? Object.fromEntries(Object.values(rawStore.buckets).map((bucket) => normalizeTacticalBucket(bucket)).filter((bucket): bucket is NonNullable<typeof bucket> => Boolean(bucket)).map((bucket) => [bucket.key, bucket]))
      : {}
    const activeKey = rawStore && typeof rawStore.activeKey === 'string' && migratedBuckets[rawStore.activeKey]
      ? rawStore.activeKey
      : Object.keys(migratedBuckets)[0] ?? tacticalBucketKey('S1', imported.wargame.round)
    imported.tacticalBuckets = { activeKey, buckets: migratedBuckets }
    const activeBucket = migratedBuckets[activeKey]
    if (activeBucket) Object.assign(imported, applyTacticalBucket(imported, activeBucket))
    const packageScope = payload.scope === 'stage' || payload.scope === 'current' ? payload.scope : 'all'
    setMaps((current) => {
      if (packageScope === 'all') return { ...current, [targetMapId]: imported }
      const existing = current[targetMapId] ?? createEmptyMapState()
      const existingStore = existing.tacticalBuckets ?? { activeKey: '', buckets: {} }
      const mergedBuckets = packageScope === 'stage' && activeBucket
        ? { ...existingStore.buckets, ...Object.fromEntries(Object.entries(existingStore.buckets).filter(([, bucket]) => bucket.stageId !== activeBucket.stageId)), ...migratedBuckets }
        : { ...existingStore.buckets, ...migratedBuckets }
      const merged = { ...existing, tacticalBuckets: { activeKey, buckets: mergedBuckets } }
      return { ...current, [targetMapId]: activeBucket ? applyTacticalBucket(merged, activeBucket) : merged }
    })
    setMapId(targetMapId)
    setView(payload.view === 'defense' ? 'defense' : 'attack')
    if (activeBucket) {
      setProgress((current) => ({ ...current, [targetMapId]: Math.max(0, stages.findIndex((stage) => stage.id === activeBucket.stageId)) }))
      setModeStageSelection((current) => ({ ...current, [`${activeModeProfile?.id ?? 'attack-defense'}:${targetMapId}`]: activeBucket.stageId }))
    }
    window.alert(packageScope === 'stage' ? '当前阶段原生包已导入，其他阶段保持不变。' : packageScope === 'current' ? '当前回合原生包已导入，其他阶段回合保持不变。' : '原生战术包已导入。')
  }, [])

  /** 保存当前战术为方案（自定义名称；记录当前 地图×阶段×视角 的完整部署快照） */
  const handleSavePlan = useCallback(
    (name: string) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const stageId = activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1'
      const plan: TacticalPlan = {
        id: genUid('plan'),
        name: name.trim() || '未命名战术',
        mapId,
        stageId,
        view,
        createdAt: Date.now(),
        vehicles: vehiclesBucketOf(cur)[view].map((v) => ({ ...v })),
        drawings: cur.drawings[view] ?? emptyGeoJson(),
        operators: operatorsBucketOf(cur)[view].map((o) => ({ ...o })),
        connections: connectionsBucketOf(cur)[view].map((c) => ({ ...c })),
        teams: teamsBucketOf(cur)[view].map((t) => ({ ...t })),
        routes: routesBucketOf(cur)[view].map((r) => ({ ...r, waypoints: r.waypoints.map((p) => [...p] as [number, number]) })),
        fieldSupports: fieldSupportsBucketOf(cur)[view].map((item) => ({ ...item })),
        skillActions: (cur.skillActions ?? []).filter((item) => item.side === view).map((item) => ({ ...item })),
        usedVehicleRefreshRuleIds: [...wargameOf(cur).usedVehicleRefreshRuleIds[view]],
        battleContext: structuredClone(wargameOf(cur).battleContext),
      }
      setPlans((prev) => [...prev, plan])
    },
    [activeModeStageId, mapId, view, capturedStageIndex, stages],
  )

  /** 应用方案：将方案快照写入当前地图/视角（阶段由用户自行切换），入历史栈 */
  const handleApplyPlan = useCallback(
    (plan: TacticalPlan) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const veh = (plan.vehicles ?? []).map((v) => ({ ...v }))
      const ops = (plan.operators ?? []).map((o) => ({ ...o }))
      const conns = (plan.connections ?? []).map((c) => ({ ...c }))
      const tm = (plan.teams ?? []).map((t) => ({ ...t }))
      const routeItems = (plan.routes ?? []).map((r) => ({ ...r, waypoints: r.waypoints.map((p) => [...p] as [number, number]) }))
      const draw = plan.drawings || emptyGeoJson()
      updateMap(mapId, (s) => ({
        ...s,
        vehicles: { ...vehiclesBucketOf(s), [view]: veh },
        drawings: { ...s.drawings, [view]: draw },
        operators: { ...operatorsBucketOf(s), [view]: ops },
        connections: { ...connectionsBucketOf(s), [view]: conns },
        teams: { ...teamsBucketOf(s), [view]: tm },
        routes: { ...routesBucketOf(s), [view]: routeItems },
        fieldSupports: { ...fieldSupportsBucketOf(s), [view]: (plan.fieldSupports ?? []).map((item) => ({ ...item })) },
        skillActions: [ ...(s.skillActions ?? []).filter((item) => item.side !== view), ...(plan.skillActions ?? []).map((item) => ({ ...item })) ],
        wargame: {
          ...wargameOf(s),
          ...(plan.battleContext ? { battleContext: structuredClone(plan.battleContext) } : {}),
          usedVehicleRefreshRuleIds: { ...wargameOf(s).usedVehicleRefreshRuleIds, [view]: [...(plan.usedVehicleRefreshRuleIds ?? [])] },
        },
      }))
      const after: MapStateSnapshot = {
        ...before,
        vehicles: { ...before.vehicles, [view]: veh },
        drawings: { ...before.drawings, [view]: draw },
        operators: { ...before.operators, [view]: ops },
        connections: { ...before.connections, [view]: conns },
        teams: { ...before.teams, [view]: tm },
        routes: { ...before.routes, [view]: routeItems },
        fieldSupports: { ...(before.fieldSupports ?? { attack: [], defense: [] }), [view]: (plan.fieldSupports ?? []).map((item) => ({ ...item })) },
        skillActions: [ ...(before.skillActions ?? []).filter((item) => item.side !== view), ...(plan.skillActions ?? []).map((item) => ({ ...item })) ],
      }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 删除方案 */
  const handleDeletePlan = useCallback((id: string) => {
    setPlans((prev) => prev.filter((p) => p.id !== id))
  }, [])

  // ---- 干员协同关系 ----
  /** 关系编辑模式的第一名干员（null = 等待选择）。 */
  const [pendingConnect, setPendingConnect] = useState<string | null>(null)

  /** 依次点击两名同阵营干员建立协同；重复点击同一人则解除其全部协同。 */
  const handleConnectClick = useCallback(
    (uid: string) => {
      if (pendingConnect === null) {
        setPendingConnect(uid)
        return
      }
      if (pendingConnect === uid) {
        // 再次点击同一干员：解除其所有协同关系
        const cur = mapsRef.current[mapId] ?? createEmptyMapState()
        const before = cloneState(cur)
        const bucket = connectionsBucketOf(cur)
        const remain = bucket[view].filter((c) => c.operatorAId !== uid && c.operatorBId !== uid)
        updateMap(mapId, (s) => ({ ...s, connections: { ...connectionsBucketOf(s), [view]: remain } }))
        const after: MapStateSnapshot = { ...before, connections: { ...before.connections, [view]: remain } }
        pushEntry(before, after)
        setPendingConnect(null)
        return
      }
      // 两个不同干员：建立协同关系（仅允许同阵营协同）
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const a = operatorsBucketOf(cur)[view].find((o) => o.uid === pendingConnect)
      const b = operatorsBucketOf(cur)[view].find((o) => o.uid === uid)
      // 两端点必须已部署到地图
      if (!a || !b || a.lat == null || b.lat == null) {
        setPendingConnect(uid)
        return
      }
      // 跨阵营不可连线：切换到新端点作为第一击
      if (a.side !== b.side) {
        setPendingConnect(uid)
        return
      }
      const currentConnections = connectionsBucketOf(cur)[view]
      const relationExists = currentConnections.some((connection) =>
        (connection.operatorAId === pendingConnect && connection.operatorBId === uid) ||
        (connection.operatorAId === uid && connection.operatorBId === pendingConnect),
      )
      if (relationExists) {
        setPendingConnect(null)
        return
      }
      const team = a.team
      const conn: OperatorConnection = {
        id: genUid('conn'),
        side: view,
        operatorAId: pendingConnect,
        operatorBId: uid,
        team,
        style: 'dashed',
        createdAt: Date.now(),
      }
      const next = [...currentConnections, conn]
      updateMap(mapId, (s) => ({ ...s, connections: { ...connectionsBucketOf(s), [view]: next } }))
      const after: MapStateSnapshot = { ...before, connections: { ...before.connections, [view]: next } }
      pushEntry(before, after)
      // 保持关系编辑模式，清空本次待选对象。
      setPendingConnect(null)
    },
    [pendingConnect, mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 关系编辑模式下点击关系线：解除该关系。 */
  const handleRemoveConnection = useCallback(
    (id: string) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const remain = connectionsBucketOf(cur)[view].filter((c) => c.id !== id)
      updateMap(mapId, (s) => ({ ...s, connections: { ...connectionsBucketOf(s), [view]: remain } }))
      const after: MapStateSnapshot = { ...before, connections: { ...before.connections, [view]: remain } }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  // ---- 兵棋队标（第二十三轮：简化部署单位） ----
  // 当前视角队标桶（与干员同构：视角桶内含双方，side === view 为我方）
  const teams = teamsBucketOf(state)[view]
  const routes = routesBucketOf(state)[view]
  const vehicles = vehiclesBucketOf(state)[view]
  const buildings = buildingsBucketOf(state)[view]

  /** 路线操作统一入历史栈；路线作为兵棋数据独立于普通绘制。 */
  const commitRouteChange = useCallback(
    (mutator: (items: TacticalRoute[]) => TacticalRoute[]) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const current = routesBucketOf(cur)[view] ?? []
      const next = mutator(current)
      updateMap(mapId, (s) => ({
        ...s,
        routes: { ...routesBucketOf(s), [view]: next },
      }))
      pushEntry(before, { ...before, routes: { ...before.routes, [view]: next } })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  const handleCreateRoute = useCallback(
    (route: TacticalRoute) => {
      const boundOperators = operators.filter((o) => o.side === route.side && o.team === route.team).map((o) => o.uid)
      const boundVehicles = vehiclesBucketOf(mapsRef.current[mapId])[view]
        .filter((v) => v.side === route.side && v.team === route.team)
        .map((v) => v.uid)
      commitRouteChange((items) => [...items, {
        ...route,
        operatorIds: route.anchorMode === 'team' && route.operatorIds.length === 0 ? boundOperators : route.operatorIds,
        vehicleIds: route.anchorMode === 'team' && route.vehicleIds.length === 0 ? boundVehicles : route.vehicleIds,
      }])
    },
    [operators, mapId, view, commitRouteChange],
  )

  const handleUpdateRoute = useCallback(
    (uid: string, patch: Partial<TacticalRoute>) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const current = routesBucketOf(cur)[view]
      const previous = current.find((route) => route.uid === uid)
      if (!previous) return
      const updated = { ...previous, ...patch }

      // 父路线插入/删除节点后，优先用分支旧锚点坐标重新定位节点下标。
      let nextRoutes = current.map((route) => {
        if (route.uid === uid) return updated
        if (route.anchorMode !== 'branch' || route.branchFromRouteUid !== uid) return route
        const oldIndex = route.branchFromWaypointIndex ?? previous.waypoints.length - 1
        const oldAnchor = previous.waypoints[Math.max(0, Math.min(oldIndex, previous.waypoints.length - 1))]
        const matchedIndex = updated.waypoints.findIndex((point) => point[0] === oldAnchor[0] && point[1] === oldAnchor[1])
        return matchedIndex >= 0 ? { ...route, branchFromWaypointIndex: matchedIndex } : route
      })

      let nextTeams = teamsBucketOf(cur)[view]
      if (updated.anchorMode === 'team' && updated.waypoints[0]) {
        const origin = updated.waypoints[0]
        const previousOrigin = previous.waypoints[0]
        if (origin[0] !== previousOrigin[0] || origin[1] !== previousOrigin[1]) {
          nextTeams = nextTeams.map((team) => team.uid === updated.teamMarkerUid ? { ...team, lat: origin[0], lng: origin[1] } : team)
          nextRoutes = nextRoutes.map((route) =>
            route.uid !== uid && route.anchorMode === 'team' && route.teamMarkerUid === updated.teamMarkerUid
              ? { ...route, waypoints: [[...origin] as [number, number], ...route.waypoints.slice(1)] }
              : route,
          )
          nextRoutes = syncRouteTargetPosition(nextRoutes, 'team', updated.teamMarkerUid, origin)
        }
      }
      let nextOperators = operatorsBucketOf(cur)[view]
      if (updated.anchorMode === 'operator' && updated.anchorOperatorUid && updated.waypoints[0]) {
        const origin = updated.waypoints[0]
        const previousOrigin = previous.waypoints[0]
        if (origin[0] !== previousOrigin[0] || origin[1] !== previousOrigin[1]) {
          nextOperators = nextOperators.map((operator) =>
            operator.uid === updated.anchorOperatorUid ? { ...operator, lat: origin[0], lng: origin[1] } : operator,
          )
          nextRoutes = nextRoutes.map((route) =>
            route.uid !== uid && route.anchorMode === 'operator' && route.anchorOperatorUid === updated.anchorOperatorUid
              ? { ...route, waypoints: [[...origin] as [number, number], ...route.waypoints.slice(1)] }
              : route,
          )
          nextRoutes = syncRouteTargetPosition(nextRoutes, 'operator', updated.anchorOperatorUid, origin)
        }
      }
      let nextVehicles = vehiclesBucketOf(cur)[view]
      if (updated.anchorMode === 'vehicle' && updated.anchorVehicleUid && updated.waypoints[0]) {
        const origin = updated.waypoints[0]
        const previousOrigin = previous.waypoints[0]
        if (origin[0] !== previousOrigin[0] || origin[1] !== previousOrigin[1]) {
          nextVehicles = nextVehicles.map((vehicle) =>
            vehicle.uid === updated.anchorVehicleUid ? { ...vehicle, lat: origin[0], lng: origin[1] } : vehicle,
          )
          nextRoutes = nextRoutes.map((route) =>
            route.uid !== uid && route.anchorMode === 'vehicle' && route.anchorVehicleUid === updated.anchorVehicleUid
              ? { ...route, waypoints: [[...origin] as [number, number], ...route.waypoints.slice(1)] }
              : route,
          )
          nextRoutes = syncRouteTargetPosition(nextRoutes, 'vehicle', updated.anchorVehicleUid, origin)
        }
      }
      // 所有共享兵棋锚点更新完成后再刷新分支，避免分支读取到其他路线的旧起点。
      nextRoutes = syncBranchRouteOrigins(nextRoutes)
      updateMap(mapId, (state) => ({
        ...state,
        routes: { ...routesBucketOf(state), [view]: nextRoutes },
        teams: { ...teamsBucketOf(state), [view]: nextTeams },
        operators: { ...operatorsBucketOf(state), [view]: nextOperators },
        vehicles: { ...vehiclesBucketOf(state), [view]: nextVehicles },
      }))
      pushEntry(before, {
        ...before,
        routes: { ...before.routes, [view]: nextRoutes },
        teams: { ...before.teams, [view]: nextTeams },
        operators: { ...before.operators, [view]: nextOperators },
        vehicles: { ...before.vehicles, [view]: nextVehicles },
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  const handleDeleteRoute = useCallback(
    (uid: string) => commitRouteChange((items) => {
      const ids = routeAndDescendantIds(items, uid)
      return items.filter((route) => !ids.has(route.uid))
    }),
    [commitRouteChange],
  )

  /** 队标操作的统一入栈入口（与 commitOperatorChange 对称） */
  const commitTeamChange = useCallback(
    (mutator: (ts: TeamMarker[]) => TeamMarker[]) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      updateMap(mapId, (s) => {
        const bucket = teamsBucketOf(s)
        return {
          ...s,
          teams: { ...bucket, [view]: mutator(bucket[view] ?? []) },
        }
      })
      const after: MapStateSnapshot = {
        ...before,
        teams: { ...before.teams, [view]: mutator(before.teams[view] ?? []) },
      }
      pushEntry(before, after)
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 部署/新建某方某队的通用队标；队标只表示队伍，不再区分步兵/载具职责。 */
  const handleDeployTeamMarker = useCallback(
    (side: Side, team: OperatorTeam, name?: string) => {
      const center = mapRef.current?.getCenter() ?? { lat: 0, lng: 0 }
      const offset = device.mobileLayout ? 0 : 10
      commitTeamChange((ts) => {
        const existing = ts.find((t) => t.side === side && t.team === team)
        if (existing) {
          return ts.map((t) =>
            t.uid === existing.uid ? { ...t, lat: center.lat + offset, lng: center.lng + offset } : t,
          )
        }
        const mk: TeamMarker = {
          uid: genUid('tm'),
          side,
          team,
          role: 'infantry',
          name: name?.trim() || `${team}队`,
          lat: center.lat + offset,
          lng: center.lng + offset,
        }
        return [...ts, mk]
      })
    },
    [mapId, view, commitTeamChange, device.mobileLayout],
  )

  /** 拖拽移动队标（高频，不入历史栈；与干员一致） */
  const handleTeamMarkerMove = useCallback(
    (uid: string, lat: number, lng: number) => {
      updateMap(mapId, (s) => {
        const bucket = teamsBucketOf(s)
        const routeBucket = routesBucketOf(s)
        const anchored = routeBucket[view].map((route) =>
          route.anchorMode === 'team' && route.teamMarkerUid === uid
            ? { ...route, waypoints: [[lat, lng] as [number, number], ...route.waypoints.slice(1)] }
            : route,
        )
        const nextRoutes = syncRouteTargetPosition(anchored, 'team', uid, [lat, lng])
        return {
          ...s,
          teams: { ...bucket, [view]: bucket[view].map((t) => (t.uid === uid ? { ...t, lat, lng } : t)) },
          routes: { ...routeBucket, [view]: nextRoutes },
        }
      })
    },
    [mapId, view, updateMap],
  )

  const handleRotateTeamMarker = useCallback((uid: string, rotation: number) => {
    updateMap(mapId, (state) => {
      const bucket = teamsBucketOf(state)
      return { ...state, teams: { ...bucket, [view]: bucket[view].map((item) => item.uid === uid ? { ...item, rotation } : item) } }
    })
  }, [mapId, updateMap, view])

  const handleToggleTeamFireLine = useCallback((uid: string) => {
    updateMap(mapId, (state) => {
      const bucket = teamsBucketOf(state)
      return { ...state, teams: { ...bucket, [view]: bucket[view].map((item) => item.uid === uid ? { ...item, fireLineEnabled: !item.fireLineEnabled } : item) } }
    })
  }, [mapId, updateMap, view])

  useEffect(() => {
    if (!device.mobileLayout) return
    const toggle = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: 'operator' | 'team' | 'vehicle' | 'building'; uid: string }>).detail
      if (!detail?.uid) return
      if (detail.kind === 'operator') handleToggleOperatorFireLine(detail.uid)
      else if (detail.kind === 'team') handleToggleTeamFireLine(detail.uid)
      else if (detail.kind === 'vehicle') handleToggleVehicleFireLine(detail.uid)
      else handleToggleBuildingFireLine(detail.uid)
    }
    window.addEventListener('unit-fireline-toggle', toggle)
    return () => window.removeEventListener('unit-fireline-toggle', toggle)
  }, [device.mobileLayout, handleToggleBuildingFireLine, handleToggleOperatorFireLine, handleToggleTeamFireLine, handleToggleVehicleFireLine])

  /** 删除队标 */
  const handleDeleteTeamMarker = useCallback(
    (uid: string) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const nextTeams = teamsBucketOf(cur)[view].filter((t) => t.uid !== uid)
      const currentRoutes = routesBucketOf(cur)[view]
      const removedRouteIds = new Set<string>()
      currentRoutes.forEach((route) => { if (route.anchorMode === 'team' && route.teamMarkerUid === uid) removedRouteIds.add(route.uid) })
      const nextRoutes = currentRoutes.filter((route) => !removedRouteIds.has(route.uid)).map((route) => route.target?.kind === 'team' && route.target.uid === uid ? { ...route, target: undefined } : route)
      updateMap(mapId, (s) => ({
        ...s,
        teams: { ...teamsBucketOf(s), [view]: nextTeams },
        routes: { ...routesBucketOf(s), [view]: nextRoutes },
      }))
      pushEntry(before, {
        ...before,
        teams: { ...before.teams, [view]: nextTeams },
        routes: { ...before.routes, [view]: nextRoutes },
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 批量移动队标（套索整体移动） */
  const handleMoveTeamMarkers = useCallback(
    (updates: Record<string, [number, number]>) => {
      const cur = mapsRef.current[mapId] ?? createEmptyMapState()
      const before = cloneState(cur)
      const nextTeams = teamsBucketOf(cur)[view].map((t) => {
        const p = updates[t.uid]
        return p ? { ...t, lat: p[0], lng: p[1] } : t
      })
      let nextRoutes = syncBranchRouteOrigins(routesBucketOf(cur)[view].map((route) => {
        const p = updates[route.teamMarkerUid]
        return p && route.anchorMode === 'team' ? { ...route, waypoints: [p, ...route.waypoints.slice(1)] } : route
      }))
      for (const [uid, point] of Object.entries(updates)) nextRoutes = syncRouteTargetPosition(nextRoutes, 'team', uid, point)
      updateMap(mapId, (s) => ({
        ...s,
        teams: { ...teamsBucketOf(s), [view]: nextTeams },
        routes: { ...routesBucketOf(s), [view]: nextRoutes },
      }))
      pushEntry(before, {
        ...before,
        teams: { ...before.teams, [view]: nextTeams },
        routes: { ...before.routes, [view]: nextRoutes },
      })
    },
    [mapId, view, cloneState, pushEntry, updateMap],
  )

  /** 批量删除队标（套索 Delete） */
  const handleDeleteTeamMarkers = useCallback(
    (uids: string[]) => {
      const set = new Set(uids)
      commitTeamChange((ts) => ts.map((t) => (set.has(t.uid) ? { ...t, lat: null, lng: null } : t)))
    },
    [commitTeamChange],
  )

  /** 右键取消关系编辑：清空待选对象并退出编辑模式。 */
  const handleCancelConnect = useCallback(() => {
    setPendingConnect(null)
    updateMap(mapId, (s) => ({ ...s, wargame: { ...wargameOf(s), connectMode: false } }))
  }, [mapId, updateMap])

  // 干员位置注册表（联线端点实时跟随；由 OperatorLayer 维护）
  const operatorPosRef = useRef<Record<string, [number, number]>>({})
  // 队标位置注册表（套索框选/整体移动；由 TeamLayer 维护）
  const teamPosRef = useRef<Record<string, [number, number]>>({})

  // ---- 点位选择（问题3：点击据点直接切换防线状态） ----
  const handleSelectPoint = useCallback(
    (point: CapturePoint, stageId: string) => {
      if (activeModeMap && modeStageKey) {
        if (activeModeMap.stages.some((stage) => stage.id === stageId)) {
          handleSelectModeStage(stageId)
        }
      } else {
        // 切换防线状态：该据点所在阶段成为当前激活阶段
        const idx = stages.findIndex((s) => s.id === stageId)
        if (idx >= 0) {
          if (idx !== capturedStageIndex) {
            updateMap(mapId, (state) => {
              const fromStage = stages[capturedStageIndex]?.id ?? 'S1'
              const toStage = stages[idx]?.id ?? fromStage
              const source = snapshotTacticalBucket(state, fromStage, wargameOf(state).round)
              const buckets = { ...(state.tacticalBuckets?.buckets ?? {}), [source.key]: source }
              const targetKey = tacticalBucketKey(toStage, wargameOf(state).round)
              const target = buckets[targetKey] ?? snapshotTacticalBucket(createEmptyMapState(), toStage, wargameOf(state).round)
              buckets[targetKey] = target
              const staged = normalizeObjectivesForStageChange({ ...state, tacticalBuckets: { activeKey: source.key, buckets } }, stages, capturedStageIndex, idx)
              return applyTacticalBucket({ ...staged, tacticalBuckets: { activeKey: target.key, buckets } }, target)
            })
          }
          setProgress((prev) => ({ ...prev, [mapId]: idx }))
        }
      }
      setSelectedPoint((prev) =>
        prev?.point.name === point.name && prev.stageId === stageId ? null : { point, stageId },
      )
    },
    [activeModeMap, capturedStageIndex, handleSelectModeStage, mapId, modeStageKey, stages, updateMap],
  )
  const handleClosePointDetail = useCallback(() => setSelectedPoint(null), [])
  const handleResetPointPanel = useCallback(() => {
    const firstModeStage = activeModeMap?.stages[0]
    if (firstModeStage) {
      handleSelectModeStage(firstModeStage.id)
      return
    }
    handleResetProgress()
  }, [activeModeMap, handleResetProgress, handleSelectModeStage])
  const handleToggleLegend = useCallback(() => {
    setUi((current) => ({ ...current, legendOpen: !current.legendOpen }))
  }, [])
  const handleSelectPointPanelStage = useCallback((stageId: string) => {
    if (activeModeMap) {
      handleSelectModeStage(stageId)
      return
    }
    const stageIndex = stages.findIndex((stage) => stage.id === stageId)
    if (stageIndex < 0) return
    if (stageIndex !== capturedStageIndex) {
      updateMap(mapId, (state) => normalizeObjectivesForStageChange(state, stages, capturedStageIndex, stageIndex))
    }
    setProgress((current) => ({ ...current, [mapId]: stageIndex }))
    setSelectedPoint(null)
    setDeployTarget(null)
  }, [activeModeMap, capturedStageIndex, handleSelectModeStage, mapId, stages, updateMap])

  return (
    <div className={`app platform-${device.platform} ${device.mobileLayout ? 'mobile-layout' : 'desktop-layout'} ${ui.paletteOpen ? 'left-panel-open' : 'left-panel-closed'} ${isCinematicMapOnly ? 'cinematic-map-only' : ''} ${isCinematicLayerTour ? 'cinematic-layer-tour' : ''} ${isCinematicBattleCompare ? `cinematic-battle-${cinematicDemoStage?.toLowerCase()}` : ''} ${isCinematicC1Highlight ? `cinematic-c1-${cinematicDemoStage?.toLowerCase()}` : ''}`} style={{ '--left-panel-width': `${ui.leftPanelWidth}px` } as CSSProperties}>
      <Toolbar
        mapId={mapId}
        onMapId={setMapId}
        gameDataPlatform={gameDataPlatform}
        onGameDataPlatform={(nextPlatform) => {
          setGameDataPlatform(nextPlatform)
          localStorage.setItem('deltaforce-game-data-platform', nextPlatform)
          setProgress((current) => ({ ...current, [mapId]: 0 }))
          setSelectedPoint(null)
          setDeployTarget(null)
        }}
        gameModeName={gameModeName}
        gameModeOptions={modeStore.profiles.map((profile) => ({ id: profile.id, name: profile.name }))}
        onGameMode={handleSelectGameMode}
        onOpenModeEditor={handleOpenModeEditor}
        view={view}
        onView={setView}
        tool={tool}
        onTool={setTool}
        draw={ui.draw}
        onDrawChange={(draw) => setUi((u) => ({ ...u, draw }))}
        dirty={tool !== 'pan'}
        canUndo={undoCount > 0}
        onUndo={handleUndo}
        canRedo={redoCount > 0}
        onRedo={handleRedo}
        canDeleteSel={deleteSelCount > 0}
        onDeleteSelected={handleDeleteSelected}
        onClearDraw={handleClearDraw}
        onClearVehicles={handleClearVehicles}
        onClearAll={handleClearAll}
        onOpenTactical={() => setTacticalOpen(true)}
        cinematicModeSwitch={isCinematicModeSwitch}
      />
      <div className="main">
        {isCinematicLayerTour && <div className="cinematic-stage-indicator"><small>当前阶段</small><b>S1 · 外围争夺</b></div>}
        <LeftPanel
          mapId={mapId}
          open={ui.paletteOpen}
          onToggle={() => setUi((u) => ({ ...u, paletteOpen: !u.paletteOpen }))}
          width={ui.leftPanelWidth}
          onWidthChange={(leftPanelWidth) => setUi((current) => ({ ...current, leftPanelWidth }))}
          layers={ui.layers}
          onLayerChange={handleLayerChange}
          vehicleRefreshAvailable={(activeOfficialModeMap?.vehicleRefreshRules.length ?? 0) > 0}
          propVis={ui.propVis}
          onPropVisChange={handlePropVisChange}
          sections={ui.sections}
          onSectionChange={(key, v, group) =>
            setUi((u) => {
              if (key === 'vehGroups' && group) {
                return { ...u, sections: { ...u.sections, vehGroups: { ...u.sections.vehGroups, [group]: v } } }
              }
              return { ...u, sections: { ...u.sections, [key]: v } }
            })
          }
          customOwn={customOwn}
          onCustomOwnChange={setCustomOwn}
          onAddCustom={handleAddCustomVehicle}
          // 兵棋推演
          view={view}
          operators={operators}
          wargame={wargame}
          connectionCount={connections.length}
          connections={connections}
          onWargameChange={handleWargameChange}
          onOperatorChange={handleOperatorChange}
          onOperatorRename={handleOperatorRename}
          onOperatorStatusChange={handleOperatorStatusChange}
          onToggleOperatorDeploy={handleToggleOperatorDeploy}
          onDeployTeam={handleDeployTeam}
          onClearTeam={handleClearTeam}
          onConnectTeam={handleConnectTeam}
          onClearSideDeploy={handleClearSideDeploy}
          onClearSideConnections={handleClearSideConnections}
          onClearTeamConnections={handleClearTeamConnections}
          onWargameReset={handleWargameReset}
          // 队标（第二十三轮）
          teams={teams}
          onDeployTeamMarker={handleDeployTeamMarker}
          onDeleteTeamMarker={handleDeleteTeamMarker}
          vehicles={vehicles}
          buildings={buildings}
          onAddBuilding={handleAddBuilding}
          stageLabel={pointPanelStages[pointPanelStageIndex] ? `${pointPanelStages[pointPanelStageIndex].id} · ${pointPanelStages[pointPanelStageIndex].label}` : ''}
          stageOptions={pointPanelStages.map((stage) => ({ id: stage.id, label: stage.label }))}
          onStageChange={handleSelectModeStage}
          onRoundChange={handleRoundChange}
          roundOptions={(() => {
            const rounds = Array.from(new Set(Object.values(state.tacticalBuckets?.buckets ?? {})
              .filter((bucket) => bucket.stageId === (activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1'))
              .map((bucket) => bucket.round))).sort((a, b) => a - b)
            return rounds.length ? rounds : [wargame.round || 1]
          })()}
          onCreateRound={handleCreateRound}
          onDeleteRound={handleDeleteRound}
          objectiveNames={pointPanelStages[pointPanelStageIndex]?.points.map((point) => point.name) ?? []}
          vehicleRefreshRules={activeOfficialModeMap?.vehicleRefreshRules ?? []}
          fieldSupports={fieldSupports}
          onAddFieldSupport={handleAddFieldSupport}
        />
        <MapView
          key={`${gameDataPlatform}:${mapId}`}
          config={config}
          mobileLayout={device.mobileLayout}
          modeData={activeOfficialModeMap}
          modeStageId={activeModeStageId}
          view={view}
          tool={tool}
          onTool={setTool}
          state={state}
          fieldSupports={fieldSupports}
          onMoveFieldSupport={handleMoveFieldSupport}
          onDeleteFieldSupport={handleDeleteFieldSupport}
          stages={stages}
          propsOverride={platformProps[mapId]}
          capturedStageIndex={capturedStageIndex}
          selectedPoint={selectedPoint}
          layers={ui.layers}
          propVis={ui.propVis}
          draw={ui.draw}
          onCommitDraw={handleCommitDraw}
          leftOpen={ui.paletteOpen}
          rightOpen={ui.panelOpen}
          legendOpen={ui.legendOpen}
          onToggleLegend={handleToggleLegend}
          deleteSelectedTick={deleteSelectedTick}
          clearDrawTick={clearDrawTick}
          onDeleteSelCount={setDeleteSelCount}
          onMapReady={handleMapReady}
          onMoveVehicle={handleMoveVehicle}
          onRotateVehicle={handleRotateVehicle}
          onToggleVehicleFireLine={handleToggleVehicleFireLine}
          onDeleteVehicle={handleDeleteVehicle}
          onLocateVehicleRefreshSource={locateVehicleRefreshSource}
          onToggleVehicleSide={handleToggleVehicleSide}
          onChangeVehicleTeam={handleVehicleTeamChange}
          buildings={buildings}
          onMoveBuilding={handleMoveBuilding}
          onRotateBuilding={handleRotateBuilding}
          onToggleBuildingFireLine={handleToggleBuildingFireLine}
          onToggleBuildingSide={handleToggleBuildingSide}
          onChangeBuildingTeam={handleBuildingTeamChange}
          onDeleteBuilding={handleDeleteBuilding}
          onMoveVehicles={handleMoveVehicles}
          onDeleteVehicles={handleDeleteVehicles}
          onMoveOperators={handleMoveOperators}
          onDeleteOperators={handleDeleteOperators}
          onDrawSaved={handleDrawSaved}
          onSelectPoint={handleSelectPoint}
          onObjectiveStateChange={handleObjectiveStateChange}
          onCloseDetail={handleClosePointDetail}
          onSpawnSelect={handleSpawnSelect}
          // 兵棋推演（视角桶内含双方，绿=我方/红=敌方）
          operators={operators}
          connections={connections}
          wargame={wargame}
          pendingConnect={pendingConnect}
          operatorPosRef={operatorPosRef}
          onMoveOperator={handleOperatorMove}
          onRotateOperator={handleRotateOperator}
          onToggleOperatorFireLine={handleToggleOperatorFireLine}
          onClearOperatorDeploy={handleToggleOperatorDeploy}
          onConnectClick={handleConnectClick}
          onRemoveConnection={handleRemoveConnection}
          onCancelConnect={handleCancelConnect}
          onOperatorChange={handleOperatorChange}
          onOperatorStatusChange={handleOperatorStatusChange}
          onOperatorSkillUse={handleOperatorSkillUse}
          skillActionDraft={skillActionDraft}
          onPlaceSkillAction={handlePlaceSkillAction}
          onCancelSkillAction={() => setSkillActionDraft(null)}
          onSelectSkillTarget={handleSelectSkillTarget}
          onDeleteSkillAction={handleDeleteSkillAction}
          onUpdateSkillActionGeometry={handleUpdateSkillActionGeometry}
          onOperatorRename={handleOperatorRename}
          // 兵棋队标（第二十三轮）
          teams={teams}
          teamPosRef={teamPosRef}
          onMoveTeamMarker={handleTeamMarkerMove}
          onRotateTeamMarker={handleRotateTeamMarker}
          onToggleTeamFireLine={handleToggleTeamFireLine}
          onDeleteTeamMarker={handleDeleteTeamMarker}
          onMoveTeamMarkers={handleMoveTeamMarkers}
          onDeleteTeamMarkers={handleDeleteTeamMarkers}
          routes={routes}
          battleContext={wargame.battleContext}
          usedVehicleRefreshRuleIds={wargame.usedVehicleRefreshRuleIds[view]}
          onDeployVehicleRefresh={handleDeployVehicleRefresh}
          onRestoreVehicleRefresh={handleRestoreVehicleRefresh}
          onLocateVehicleRefresh={locateVehicleRefreshRule}
          onCreateRoute={handleCreateRoute}
          onUpdateRoute={handleUpdateRoute}
          onDeleteRoute={handleDeleteRoute}
          cinematicInitialView={isCinematicDemoFrame && (isCinematicMobileFrame || Number.isFinite(cinematicFocusLat) && Number.isFinite(cinematicFocusLng))
            ? {
                center: Number.isFinite(cinematicFocusLat) && Number.isFinite(cinematicFocusLng) ? [cinematicFocusLat, cinematicFocusLng] : [-117.455, 87.686],
                zoom: Number.isFinite(cinematicFocusZoom) ? cinematicFocusZoom : isCinematicMobileFrame ? 4.2 : 4.8,
              }
            : null}
          cinematicBattleCompare={isCinematicBattleCompare ? cinematicDemoStage : null}
        />
        <PointPanel
          stages={pointPanelStages}
          capturedStageIndex={pointPanelStageIndex}
          view={view}
          selectedName={selectedPoint?.point.name ?? null}
          open={ui.panelOpen}
          onToggle={() => setUi((u) => ({ ...u, panelOpen: !u.panelOpen }))}
          onSelectStage={handleSelectPointPanelStage}
          onSelect={handleSelectPoint}
          onResetProgress={handleResetPointPanel}
          battleContext={wargame.battleContext}
        />
        <DeployBar
          mapId={mapId}
          view={view}
          target={deployTarget}
          deployByStage={activeOfficialModeMap?.deploy}
          onClose={() => setDeployTarget(null)}
          onDeploy={handleDeployVehicle}
        />
      </div>

      {/* 战术板弹窗（第二十一轮：导出 HTML + 方案管理） */}
      {mobileConfirm && (
        <div
          className="mobile-confirm-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setMobileConfirm(null)
          }}
        >
          <div className="mobile-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mobile-confirm-title">
            <h2 id="mobile-confirm-title">{mobileConfirm.title}</h2>
            <p>{mobileConfirm.message}</p>
            <div className="mobile-confirm-actions">
              <button type="button" onClick={() => setMobileConfirm(null)}>取消</button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const action = mobileConfirm.onConfirm
                  setMobileConfirm(null)
                  action()
                }}
              >
                {mobileConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {refreshVehicleDelete && (
        <div className="mobile-confirm-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setRefreshVehicleDelete(null) }}>
          <div className="mobile-confirm-dialog refresh-vehicle-dialog" role="dialog" aria-modal="true" aria-labelledby="refresh-vehicle-delete-title">
            <h2 id="refresh-vehicle-delete-title">处理刷新载具</h2>
            <p>{refreshVehicleDelete.vehicles.length === 1 ? `“${refreshVehicleDelete.vehicles[0].name}”来自载具刷新规则。` : `选中内容包含 ${refreshVehicleDelete.vehicles.length} 个刷新载具。`}请选择删除后的规则状态。</p>
            <div className="refresh-vehicle-dialog-options">
              <button type="button" className="danger" onClick={() => { const uids = refreshVehicleDelete.uids; setRefreshVehicleDelete(null); deleteVehicleInstances(uids, false) }}><strong>视为损失</strong><small>删除兵棋，本轮规则仍保持已使用</small></button>
              <button type="button" onClick={() => { const uids = refreshVehicleDelete.uids; setRefreshVehicleDelete(null); deleteVehicleInstances(uids, true) }}><strong>复原刷新规则</strong><small>删除对应规则产生的兵棋，并恢复为可部署</small></button>
              <button type="button" onClick={() => setRefreshVehicleDelete(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      <TacticalBoardModal
        open={tacticalOpen}
        mapId={mapId}
        mapNameOf={(id) => MAP_BY_ID[id]?.name ?? id}
        mapName={config.name}
        view={view}
        stageId={activeModeStageId ?? stages[capturedStageIndex]?.id ?? 'S1'}
        stageOptions={stages.map((stage) => ({ id: stage.id, label: stage.label }))}
        stageLabel={activeOfficialModeMap?.stages.find((stage) => stage.id === activeModeStageId)
          ? `${activeModeStageId} · ${activeOfficialModeMap.stages.find((stage) => stage.id === activeModeStageId)?.label}`
          : stages[capturedStageIndex] ? `${stages[capturedStageIndex].id} · ${stages[capturedStageIndex].label}` : ''}
        plans={plans}
        round={wargame.round}
        roundOptions={(() => {
          const rounds = Array.from(new Set(Object.values(state.tacticalBuckets?.buckets ?? {}).map((bucket) => bucket.round))).sort((a, b) => a - b)
          return rounds.length ? rounds : [wargame.round || 1]
        })()}
        roundOptionsByStage={Object.fromEntries(stages.map((stage) => {
          const rounds = Array.from(new Set(Object.values(state.tacticalBuckets?.buckets ?? {}).filter((bucket) => bucket.stageId === stage.id).map((bucket) => bucket.round))).sort((a, b) => a - b)
          return [stage.id, rounds.length ? rounds : [1]]
        }))}
        onExport={(m, stageId, round) => void handleExportTactical(m, stageId, round)}
        onExportNative={handleExportNativeTactical}
        onImportNative={handleImportNativeTactical}
        onSavePlan={handleSavePlan}
        onApplyPlan={handleApplyPlan}
        onDeletePlan={handleDeletePlan}
        onClose={() => setTacticalOpen(false)}
      />
    </div>
  )
}
