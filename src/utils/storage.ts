import type { BuildingUnit, MapState, OperatorConnection, OperatorTeam, OperatorUnit, PersistedAppState, Side, TacticalRoute, TeamMarker, VehicleItem, WargameState } from '../types'
import { TEAMS } from '../config/operators'
import { orderTypeOf } from '../config/routes'
import { emptyGeoJson } from './geo'

/** 正式应用数据的本地存储键。 */
export const APP_STORAGE_KEY = 'deltaforce-tactical-map-v1'
/** 数据版本：v8 = 载具按攻/守方分桶存储（切换视角只显示当前视角，与画笔绘制对称）。
 *  v9 = 新增兵棋推演（干员 operators / 联线 connections / 推演状态 wargame）。
 *  v10 = 新增战术方案库（plans：各阶段默认战术部署）。
 *  v11 = 新增兵棋队标（teams：简化部署，队伍字母 + 作用标志）。
 *  v12 = 载具增加 team，新增队伍进攻路线 routes。
 *  v13 = 路线升级为行动指令 V2（类型/状态/样式/吸附/分支）。
 *  v14 = 支持干员独立任务路线与路线成员绑定。
 *  loadState 兼容 v7-v14，并统一迁移为当前分桶形状。 */

/** 默认推演状态 */
export function emptyWargameState(): WargameState {
  // 小队作用默认取 TEAMS.desc（可在左侧面板编辑，存于 teamRoles）
  const teamRoles: Record<string, string> = {}
  for (const t of TEAMS) teamRoles[t.id] = t.desc
  return { enabled: false, round: 1, showConnections: true, connectMode: false, teamRoles }
}

/**
 * 载具形状规范化：兼容旧数据（v8 早期 / HMR 污染产生的平铺数组 VehicleItem[]）
 * 与正规数据（Record<Side, VehicleItem[]>），统一迁移为分桶形状。
 * 旧数组按 item.side 归入攻/守桶。
 */
function normalizeVehicles(vehicles: unknown): Record<Side, VehicleItem[]> {
  const normalizeList = (items: VehicleItem[]) => items.map((item) => ({
    ...item,
    team: (['A', 'B', 'C', 'D', 'E'].includes(item.team ?? '') ? item.team : undefined) as OperatorTeam | undefined,
  }))
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
    anchorMode: route.anchorMode === 'free' || route.anchorMode === 'branch' || route.anchorMode === 'operator' || route.anchorMode === 'vehicle'
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
    if (parsed && typeof parsed === 'object' && parsed.maps && typeof v === 'number' && v >= 7 && v <= 16) {
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
        }
      }
      // v9→v10：战术方案库缺省为空数组（不丢历史数据）
      if (!Array.isArray(parsed.plans)) parsed.plans = []
      parsed.plans = parsed.plans.map((plan) => ({
        ...plan,
        routes: Array.isArray(plan.routes) ? plan.routes.map(normalizeTacticalRoute) : [],
      }))
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
    wargame: emptyWargameState(),
  }
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

/** 防御性读取推演状态 */
export function wargameOf(s: MapState | undefined | null): WargameState {
  if (!s?.wargame) return emptyWargameState()
  return { ...emptyWargameState(), ...s.wargame }
}
