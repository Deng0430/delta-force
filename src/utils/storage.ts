import type { BuildingUnit, MapState, OperatorConnection, OperatorTeam, OperatorUnit, PersistedAppState, Side, TacticalBucket, TacticalRoute, TeamMarker, VehicleItem, WargameState } from '../types'
import { TEAMS } from '../config/operators'
import { orderTypeOf } from '../config/routes'
import { DEPLOY_VEHICLE_CATALOG } from '../config/deployVehicles'
import { emptyGeoJson } from './geo'

/** 正式应用数据的本地存储键。 */
export const APP_STORAGE_KEY = 'deltaforce-tactical-map-v1'
export const APP_STORAGE_VERSION = 17 as const

/** 战术状态的完整外层身份：游戏数据端 × 模式 × 地图。 */
export function tacticalContextKey(gameDataPlatform: 'pc' | 'mobile', modeId: string, mapId: string): string {
  return `${gameDataPlatform}:${encodeURIComponent(modeId)}:${mapId}`
}

function legacyStorageContext(): { gameDataPlatform: 'pc' | 'mobile'; modeId: string } {
  const gameDataPlatform = localStorage.getItem('deltaforce-game-data-platform') === 'mobile' ? 'mobile' : 'pc'
  try {
    const modeStore = JSON.parse(localStorage.getItem('deltaforce-mode-configs-v1') ?? '{}') as { activeModeId?: unknown }
    return {
      gameDataPlatform,
      modeId: typeof modeStore.activeModeId === 'string' && modeStore.activeModeId ? modeStore.activeModeId : 'attack-defense',
    }
  } catch {
    return { gameDataPlatform, modeId: 'attack-defense' }
  }
}
/** 数据版本：v8 = 载具按攻/守方分桶存储（切换视角只显示当前视角，与画笔绘制对称）。
 *  v9 = 新增兵棋推演（干员 operators / 联线 connections / 推演状态 wargame）。
 *  v10 = 新增战术方案库（plans：各阶段默认战术部署）。
 *  v11 = 新增兵棋队标（teams：简化部署，队伍字母 + 作用标志）。
 *  v12 = 载具增加 team，新增队伍进攻路线 routes。
 *  v13 = 路线升级为行动指令 V2（类型/状态/样式/吸附/分支）。
 *  v14 = 支持干员独立任务路线与路线成员绑定。
 *  v17 = 战术状态按“游戏数据端 × 模式 × 地图”建立独立上下文。
 *  loadState 兼容 v7-v17，并统一迁移为当前分桶形状。 */

/** 默认推演状态 */
export function emptyWargameState(): WargameState {
  // 小队作用默认取 TEAMS.desc（可在左侧面板编辑，存于 teamRoles）
  const teamRoles: Record<string, string> = {}
  for (const t of TEAMS) teamRoles[t.id] = t.desc
  return {
    enabled: true,
    round: 1,
    showConnections: true,
    showFireLines: true,
    showRouteLabels: true,
    notesMarkdown: '',
    stageNotes: {},
    noteImages: {},
    connectMode: false,
    teamRoles,
    battleContext: {
      tickets: { attack: null, defense: null },
      matchTimeSeconds: null,
      objectiveStates: {},
      objectiveCountdowns: {},
      mapEvents: [],
    },
    usedVehicleRefreshRuleIds: { attack: [], defense: [] },
  }
}

/**
 * 载具形状规范化：兼容旧数据（v8 早期 / HMR 污染产生的平铺数组 VehicleItem[]）
 * 与正规数据（Record<Side, VehicleItem[]>），统一迁移为分桶形状。
 * 旧数组按 item.side 归入攻/守桶。
 */
function normalizeVehicles(vehicles: unknown): Record<Side, VehicleItem[]> {
  const normalizeList = (items: VehicleItem[]) => items.map((item) => {
    const currentVehicle = DEPLOY_VEHICLE_CATALOG.find((entry) => (
      entry.name === item.name
      || entry.name.includes(item.name)
      || item.name.includes(entry.name)
    ))
    return {
      ...item,
      // 已部署的刷新载具也应随内置图例更新，不能永久使用存档中的旧 URL。
      iconUrl: currentVehicle?.iconUrl ?? item.iconUrl,
      team: (['A', 'B', 'C', 'D', 'E'].includes(item.team ?? '') ? item.team : undefined) as OperatorTeam | undefined,
    }
  })
  // 新形状：Record<Side, VehicleItem[]>
  if (vehicles && typeof vehicles === 'object' && !Array.isArray(vehicles)) {
    const v = vehicles as Record<string, unknown>
    const attack = Array.isArray(v.attack) ? (v.attack as VehicleItem[]) : []
    const defense = Array.isArray(v.defense) ? (v.defense as VehicleItem[]) : []
    return { attack: normalizeList(attack), defense: normalizeList(defense) }
  }
  // 旧形状：VehicleItem[]（按 item.side 分桶）
  if (Array.isArray(vehicles)) {
    const out: Record<Side, VehicleItem[]> = { attack: [], defense: [] }
    for (const item of vehicles as VehicleItem[]) {
      if (item && typeof item === 'object' && 'uid' in item) {
        const side: Side = item.side === 'defense' ? 'defense' : 'attack'
        out[side].push(item)
      }
    }
    return { attack: normalizeList(out.attack), defense: normalizeList(out.defense) }
  }
  return { attack: [], defense: [] }
}

function normalizeBuildings(buildings: unknown): Record<Side, BuildingUnit[]> {
  if (!buildings || typeof buildings !== 'object' || Array.isArray(buildings)) return { attack: [], defense: [] }
  const value = buildings as Record<string, unknown>
  const normalizeList = (items: unknown): BuildingUnit[] => (Array.isArray(items) ? items : [])
    .filter((item): item is BuildingUnit => Boolean(item && typeof item === 'object' && typeof (item as BuildingUnit).uid === 'string'))
    .map((item) => ({
      ...item,
      kind: (['fixed-machine-gun', 'fixed-anti-air', 'coastal-gun'].includes(item.kind) ? item.kind : 'fixed-machine-gun') as BuildingUnit['kind'],
      side: item.side === 'defense' ? 'defense' : 'attack',
      team: (['A', 'B', 'C', 'D', 'E'].includes(item.team ?? '') ? item.team : undefined) as OperatorTeam | undefined,
      rotation: typeof item.rotation === 'number' && Number.isFinite(item.rotation) ? ((item.rotation % 360) + 360) % 360 : 0,
    }))
  return { attack: normalizeList(value.attack), defense: normalizeList(value.defense) }
}

/** 防御性读取进攻路线分桶；损坏或旧数据缺失时返回空。 */
export function normalizeTacticalRoute(route: TacticalRoute): TacticalRoute {
  const orderTypes = ['move', 'attack', 'recon', 'flank', 'retreat', 'escort', 'resupply', 'hold'] as const
  const statuses = ['planned', 'pending', 'executing', 'completed', 'cancelled'] as const
  const lineStyles = ['solid', 'dashed', 'dotted'] as const
  const orderType = orderTypes.includes(route.orderType) ? route.orderType : 'attack'
  const meta = orderTypeOf(orderType)
  const team = (['A', 'B', 'C', 'D', 'E'].includes(route.team) ? route.team : 'A') as OperatorTeam
  const teamColor = TEAMS.find((item) => item.id === team)?.color ?? TEAMS[0].color
  return {
    ...route,
    team,
    orderType,
    status: statuses.includes(route.status) ? route.status : 'planned',
    color: typeof route.color === 'string' && route.color ? route.color : teamColor,
    lineStyle: lineStyles.includes(route.lineStyle) ? route.lineStyle : meta.lineStyle,
    opacity: typeof route.opacity === 'number' && Number.isFinite(route.opacity) ? Math.max(0.2, Math.min(1, route.opacity)) : 0.92,
    strokeWidth: typeof route.strokeWidth === 'number' && Number.isFinite(route.strokeWidth) ? Math.max(1, Math.min(10, route.strokeWidth)) : 3.5,
    anchorMode: route.anchorMode === 'free' || route.anchorMode === 'branch' || route.anchorMode === 'operator' || route.anchorMode === 'vehicle' || route.anchorMode === 'building'
      ? route.anchorMode
      : route.branchFromRouteUid ? 'branch' : 'team',
    operatorIds: Array.isArray(route.operatorIds) ? route.operatorIds : [],
    vehicleIds: Array.isArray(route.vehicleIds) ? route.vehicleIds : [],
  }
}

function normalizeRoutes(routes: unknown): Record<Side, TacticalRoute[]> {
  if (routes && typeof routes === 'object' && !Array.isArray(routes)) {
    const v = routes as Record<string, unknown>
    const valid = (items: unknown): TacticalRoute[] =>
      (Array.isArray(items) ? items : [])
        .filter((r): r is TacticalRoute => {
          if (!r || typeof r !== 'object') return false
          const route = r as TacticalRoute
          return typeof route.uid === 'string' && Array.isArray(route.waypoints) && route.waypoints.length >= 2
        })
        .map(normalizeTacticalRoute)
    return { attack: valid(v.attack), defense: valid(v.defense) }
  }
  return { attack: [], defense: [] }
}

/** 防御性读取干员分桶（缺失/损坏时返回空） */
function normalizeOperators(operators: unknown): Record<Side, OperatorUnit[]> {
  if (operators && typeof operators === 'object' && !Array.isArray(operators)) {
    const v = operators as Record<string, unknown>
    const attack = Array.isArray(v.attack) ? (v.attack as OperatorUnit[]) : []
    const defense = Array.isArray(v.defense) ? (v.defense as OperatorUnit[]) : []
    return { attack, defense }
  }
  return { attack: [], defense: [] }
}

/** 防御性读取联线分桶 */
function normalizeConnections(connections: unknown): Record<Side, OperatorConnection[]> {
  if (connections && typeof connections === 'object' && !Array.isArray(connections)) {
    const v = connections as Record<string, unknown>
    const attack = Array.isArray(v.attack) ? (v.attack as OperatorConnection[]) : []
    const defense = Array.isArray(v.defense) ? (v.defense as OperatorConnection[]) : []
    return { attack, defense }
  }
  return { attack: [], defense: [] }
}

/** 防御性读取队标分桶 */
function normalizeTeams(teams: unknown): Record<Side, TeamMarker[]> {
  if (teams && typeof teams === 'object' && !Array.isArray(teams)) {
    const v = teams as Record<string, unknown>
    const attack = Array.isArray(v.attack) ? (v.attack as TeamMarker[]) : []
    const defense = Array.isArray(v.defense) ? (v.defense as TeamMarker[]) : []
    return { attack, defense }
  }
  return { attack: [], defense: [] }
}

export function loadState(): PersistedAppState | null {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedAppState
    // 兼容 v7（载具平铺数组）/ v8（载具分桶）：统一迁移为分桶形状，避免用户数据丢失
    const v = parsed?.version
    if (parsed && typeof parsed === 'object' && parsed.maps && typeof v === 'number' && v >= 7 && v <= APP_STORAGE_VERSION) {
      for (const id of Object.keys(parsed.maps)) {
        const m = parsed.maps[id]
        if (m) {
          m.vehicles = normalizeVehicles(m.vehicles)
          m.buildings = normalizeBuildings(m.buildings)
          // v8→v9 迁移：补充兵棋推演字段（旧数据默认空 + 关闭）
          if (v === 8) {
            m.operators = { attack: [], defense: [] }
            m.connections = { attack: [], defense: [] }
            m.wargame = emptyWargameState()
          } else if (v === 9 || v === 10 || v === 11) {
            m.operators = normalizeOperators(m.operators)
            m.connections = normalizeConnections(m.connections)
            m.wargame = { ...emptyWargameState(), ...(m.wargame ?? {}) }
          }
          // v11 起：队标分桶（v10 及更早数据默认空）
          m.teams = normalizeTeams(m.teams)
          m.routes = normalizeRoutes(m.routes)
          m.fieldSupports = fieldSupportsBucketOf(m)
          m.drawings = { attack: normalizeDrawingGeoJson(m.drawings?.attack ?? emptyGeoJson()), defense: normalizeDrawingGeoJson(m.drawings?.defense ?? emptyGeoJson()) }
          if (!m.tacticalBuckets) {
            const bucket = snapshotTacticalBucket(m, 'S1', wargameOf(m).round)
            m.tacticalBuckets = { activeKey: bucket.key, buckets: { [bucket.key]: bucket } }
          }
        }
      }
      // v9→v10：战术方案库缺省为空数组（不丢历史数据）
      if (!Array.isArray(parsed.plans)) parsed.plans = []
      const legacyContext = legacyStorageContext()
      parsed.plans = parsed.plans.map((plan) => ({
        ...plan,
        gameDataPlatform: plan.gameDataPlatform === 'mobile' ? 'mobile' : plan.gameDataPlatform === 'pc' ? 'pc' : legacyContext.gameDataPlatform,
        modeId: typeof plan.modeId === 'string' && plan.modeId ? plan.modeId : legacyContext.modeId,
        routes: Array.isArray(plan.routes) ? plan.routes.map(normalizeTacticalRoute) : [],
        usedVehicleRefreshRuleIds: Array.isArray(plan.usedVehicleRefreshRuleIds) ? plan.usedVehicleRefreshRuleIds : [],
      }))
      if (v < APP_STORAGE_VERSION) {
        parsed.maps = Object.fromEntries(Object.entries(parsed.maps).map(([mapId, map]) => [
          tacticalContextKey(legacyContext.gameDataPlatform, legacyContext.modeId, mapId),
          map,
        ]))
        parsed.progress = Object.fromEntries(Object.entries(parsed.progress ?? {}).map(([mapId, value]) => [
          tacticalContextKey(legacyContext.gameDataPlatform, legacyContext.modeId, mapId),
          value,
        ]))
        parsed.version = APP_STORAGE_VERSION
      }
      return parsed
    }
    return null
  } catch (err) {
    console.warn('[storage] 读取失败，将使用默认数据', err)
    return null
  }
}

export function saveState(state: PersistedAppState): void {
  try {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state))
  } catch (err) {
    console.warn('[storage] 保存失败', err)
  }
}

function drawingUid(seed: string, index: number): string {
  let hash = 2166136261
  for (const char of `${seed}:${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `drawing_${(hash >>> 0).toString(36)}_${index}`
}

export function normalizeDrawingGeoJson(raw: string): string {
  try {
    const value = JSON.parse(raw)
    if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features)) return emptyGeoJson()
    value.features = value.features.map((feature: Record<string, unknown>, index: number) => ({
      ...feature,
      properties: { ...((feature.properties as Record<string, unknown> | null) ?? {}), uid: typeof (feature.properties as Record<string, unknown> | null)?.uid === 'string' ? (feature.properties as Record<string, unknown>).uid : drawingUid(JSON.stringify(feature.geometry ?? feature), index) },
    }))
    return JSON.stringify(value)
  } catch {
    return emptyGeoJson()
  }
}

/** 新建一张地图的空白数据 */
export function createEmptyMapState(): MapState {
  return {
    vehicles: { attack: [], defense: [] },
    buildings: { attack: [], defense: [] },
    drawings: { attack: emptyGeoJson(), defense: emptyGeoJson() },
    operators: { attack: [], defense: [] },
    connections: { attack: [], defense: [] },
    teams: { attack: [], defense: [] },
    routes: { attack: [], defense: [] },
    fieldSupports: { attack: [], defense: [] },
    skillActions: [],
    wargame: emptyWargameState(),
    tacticalBuckets: { activeKey: '', buckets: {} },
  }
}

export function tacticalBucketKey(stageId: string, round: number): string {
  return `${stageId}:R${Math.max(1, Math.floor(round || 1))}`
}

export function snapshotTacticalBucket(map: MapState, stageId: string, round: number): import('../types').TacticalBucket {
  const wargame = wargameOf(map)
  const clone = <T>(value: T): T => structuredClone(value)
  return {
    key: tacticalBucketKey(stageId, round), stageId, round, updatedAt: Date.now(),
    vehicles: clone(vehiclesBucketOf(map)), buildings: clone(buildingsBucketOf(map)), drawings: clone(map.drawings),
    operators: clone(operatorsBucketOf(map)), connections: clone(connectionsBucketOf(map)), teams: clone(teamsBucketOf(map)),
    routes: clone(routesBucketOf(map)), fieldSupports: clone(fieldSupportsBucketOf(map)), skillActions: clone(map.skillActions ?? []), notesMarkdown: wargame.notesMarkdown,
  }
}

/** Normalize a native-import bucket using the same compatibility rules as a map state. */
export function normalizeTacticalBucket(raw: unknown): TacticalBucket | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<TacticalBucket>
  if (typeof value.stageId !== 'string' || !Number.isFinite(value.round)) return null
  const round = Math.max(1, Math.floor(value.round as number))
  const base = createEmptyMapState()
  const source = {
    ...base,
    vehicles: value.vehicles,
    buildings: value.buildings,
    drawings: value.drawings,
    operators: value.operators,
    connections: value.connections,
    teams: value.teams,
    routes: value.routes,
    fieldSupports: value.fieldSupports,
    skillActions: value.skillActions,
  } as MapState
  const normalized: TacticalBucket = {
    key: tacticalBucketKey(value.stageId, round),
    stageId: value.stageId,
    round,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    vehicles: vehiclesBucketOf(source),
    buildings: buildingsBucketOf(source),
    drawings: {
      attack: normalizeDrawingGeoJson(source.drawings?.attack ?? emptyGeoJson()),
      defense: normalizeDrawingGeoJson(source.drawings?.defense ?? emptyGeoJson()),
    },
    operators: operatorsBucketOf(source),
    connections: connectionsBucketOf(source),
    teams: teamsBucketOf(source),
    routes: routesBucketOf(source),
    fieldSupports: fieldSupportsBucketOf(source),
    skillActions: Array.isArray(value.skillActions) ? value.skillActions : [],
    notesMarkdown: typeof value.notesMarkdown === 'string' ? value.notesMarkdown : '',
  }
  return normalized
}

/**
 * Persist the live tactical projection into its active stage/round bucket.
 * Callers should invoke this after tactical content changes, rather than
 * waiting for a stage/round switch or an export to take a snapshot.
 */
export function syncActiveTacticalBucket(map: MapState, currentStageId = 'S1'): MapState {
  const store = map.tacticalBuckets ?? { activeKey: '', buckets: {} }
  // 界面当前阶段与回合是实时战术投影的唯一归属。不能优先信任旧
  // activeKey：进入地图时会回到 S1，而持久化的 activeKey 可能仍在 S2，
  // 继续沿用它会把 S1 的编辑实时写入错误阶段。
  const stageId = currentStageId || 'S1'
  const round = Math.max(1, Math.floor(wargameOf(map).round || 1))
  // App mutations replace the affected arrays/objects, so retaining these
  // references keeps prior buckets isolated without deep-cloning on every
  // pointer-move event.
  const bucket: TacticalBucket = {
    key: tacticalBucketKey(stageId, round),
    stageId,
    round,
    updatedAt: Date.now(),
    vehicles: vehiclesBucketOf(map),
    buildings: buildingsBucketOf(map),
    drawings: map.drawings,
    operators: operatorsBucketOf(map),
    connections: connectionsBucketOf(map),
    teams: teamsBucketOf(map),
    routes: routesBucketOf(map),
    fieldSupports: fieldSupportsBucketOf(map),
    skillActions: map.skillActions ?? [],
    notesMarkdown: wargameOf(map).notesMarkdown,
  }
  return {
    ...map,
    tacticalBuckets: {
      activeKey: bucket.key,
      buckets: { ...store.buckets, [bucket.key]: bucket },
    },
  }
}

export function applyTacticalBucket(map: MapState, bucket: import('../types').TacticalBucket): MapState {
  return { ...map, vehicles: bucket.vehicles, buildings: bucket.buildings, drawings: bucket.drawings, operators: bucket.operators,
    connections: bucket.connections, teams: bucket.teams, routes: bucket.routes, fieldSupports: bucket.fieldSupports ?? { attack: [], defense: [] }, skillActions: bucket.skillActions ?? [],
    wargame: { ...wargameOf(map), round: bucket.round } }
}

export function createTacticalRound(map: MapState, stageId: string, round: number, copyFromCurrent = false): MapState {
  const current = snapshotTacticalBucket(map, stageId, wargameOf(map).round)
  const store = map.tacticalBuckets ?? { activeKey: current.key, buckets: {} }
  const key = tacticalBucketKey(stageId, round)
  const source = copyFromCurrent ? current : null
  const emptyRound = createEmptyMapState()
  // A new round starts without deployed tactical elements, but the operator
  // roster is configuration rather than deployment data. Preserve custom
  // names/operator choices/status while returning every operator to reserve.
  emptyRound.operators = {
    attack: operatorsBucketOf(map).attack.map((operator) => ({ ...structuredClone(operator), lat: null, lng: null })),
    defense: operatorsBucketOf(map).defense.map((operator) => ({ ...structuredClone(operator), lat: null, lng: null })),
  }
  const bucket: TacticalBucket = source
    ? { ...structuredClone(source), key, round, updatedAt: Date.now() }
    : snapshotTacticalBucket(emptyRound, stageId, round)
  const buckets = { ...store.buckets, [current.key]: current, [key]: bucket }
  return applyTacticalBucket({ ...map, tacticalBuckets: { activeKey: key, buckets } }, bucket)
}

/** 防御性读取某张地图的载具分桶（避免旧数据/损坏数据导致 TypeError） */
export function vehiclesBucketOf(s: MapState | undefined | null): Record<Side, VehicleItem[]> {
  if (!s) return { attack: [], defense: [] }
  return normalizeVehicles(s.vehicles)
}

export function buildingsBucketOf(s: MapState | undefined | null): Record<Side, BuildingUnit[]> {
  if (!s) return { attack: [], defense: [] }
  return normalizeBuildings(s.buildings)
}

/** 防御性读取某张地图的干员分桶 */
export function operatorsBucketOf(s: MapState | undefined | null): Record<Side, OperatorUnit[]> {
  if (!s) return { attack: [], defense: [] }
  return normalizeOperators(s.operators)
}

/** 防御性读取某张地图的联线分桶 */
export function connectionsBucketOf(s: MapState | undefined | null): Record<Side, OperatorConnection[]> {
  if (!s) return { attack: [], defense: [] }
  return normalizeConnections(s.connections)
}

/** 防御性读取某张地图的队标分桶 */
export function teamsBucketOf(s: MapState | undefined | null): Record<Side, TeamMarker[]> {
  if (!s) return { attack: [], defense: [] }
  return normalizeTeams(s.teams)
}

/** 防御性读取进攻路线分桶 */
export function routesBucketOf(s: MapState | undefined | null): Record<Side, TacticalRoute[]> {
  if (!s) return { attack: [], defense: [] }
  return normalizeRoutes(s.routes)
}

export function fieldSupportsBucketOf(s: MapState | undefined | null): Record<Side, import('../types').FieldSupportInstance[]> {
  const value = s?.fieldSupports
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { attack: [], defense: [] }
  return {
    attack: Array.isArray(value.attack) ? value.attack : [],
    defense: Array.isArray(value.defense) ? value.defense : [],
  }
}

/** 防御性读取推演状态 */
export function wargameOf(s: MapState | undefined | null): WargameState {
  if (!s?.wargame) return emptyWargameState()
  const fallback = emptyWargameState()
  const battleContext = s.wargame.battleContext
  const used = s.wargame.usedVehicleRefreshRuleIds
  const storedStageNotes = s.wargame.stageNotes && typeof s.wargame.stageNotes === 'object' ? s.wargame.stageNotes : {}
  const stageNotes = Object.keys(storedStageNotes).length === 0 && s.wargame.notesMarkdown?.trim()
    ? { S1: s.wargame.notesMarkdown }
    : storedStageNotes
  const rawObjectiveStates = battleContext?.objectiveStates && typeof battleContext.objectiveStates === 'object'
    ? battleContext.objectiveStates
    : Object.fromEntries((Array.isArray(battleContext?.capturedObjectives) ? battleContext.capturedObjectives : []).map((name) => [name, { owner: 'attack', capturingSide: null, progress: 100 }]))
  const objectiveStates = Object.fromEntries(Object.entries(rawObjectiveStates).map(([name, raw]) => {
    const state = raw && typeof raw === 'object' ? raw : { owner: 'neutral', capturingSide: null, progress: 0 }
    const owner = state.owner === 'attack' || state.owner === 'defense' ? state.owner : 'neutral'
    const capturingSide = state.capturingSide === 'attack' || state.capturingSide === 'defense' ? state.capturingSide : null
    const progress = typeof state.progress === 'number' && Number.isFinite(state.progress) ? Math.max(0, Math.min(100, state.progress)) : 0
    return [name, { owner, capturingSide, progress }]
  }))
  return {
    ...fallback,
    ...s.wargame,
    enabled: true,
    stageNotes,
    noteImages: s.wargame.noteImages && typeof s.wargame.noteImages === 'object' ? s.wargame.noteImages : {},
    showRouteLabels: s.wargame.showRouteLabels !== false,
    battleContext: {
      ...fallback.battleContext,
      ...(battleContext ?? {}),
      tickets: { ...fallback.battleContext.tickets, ...(battleContext?.tickets ?? {}) },
      objectiveStates,
      objectiveCountdowns: battleContext?.objectiveCountdowns && typeof battleContext.objectiveCountdowns === 'object' ? battleContext.objectiveCountdowns : {},
      mapEvents: Array.isArray(battleContext?.mapEvents) ? battleContext.mapEvents : [],
    },
    usedVehicleRefreshRuleIds: {
      attack: Array.isArray(used?.attack) ? used.attack : [],
      defense: Array.isArray(used?.defense) ? used.defense : [],
    },
  }
}
