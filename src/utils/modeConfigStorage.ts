import type {
  GameModeProfile,
  ModeConfigStore,
  ModeConfigVerification,
  ModeDeployVehicle,
  ModeMapProp,
  ModeMapOverride,
  ModeObjectivePoint,
  ModeSpawnPoint,
  ModeStageDefinition,
  ModeZone,
  ModeZoneKind,
  ModeZoneRole,
  MapProp,
  Side,
  StageConfig,
  VehicleCategory,
} from '../types'
import { MAPS } from '../config/maps'
import { STAGES_BY_MAP } from '../config/points'
import { MAP_PROPS } from '../config/pointsStages'
import { DEPLOY_BY_MAP, localDeployIconUrl, type DeployVehicleEntry, type StageDeploy } from '../config/deployVehicles'
import winnerTakesAllOfficial from '../config/winnerTakesAllOfficial.json'

/** 正式应用模式配置的本地存储键。 */
export const MODE_CONFIG_STORAGE_KEY = 'deltaforce-mode-configs-v1'
export const MODE_CONFIG_SYNC_CHANNEL = 'deltaforce-mode-config-sync-v1'
export const MODE_CONFIG_SYNC_MESSAGE = 'deltaforce-mode-config-sync'
const MODE_STORAGE_VERSION = 8 as const

const SIDES: Side[] = ['attack', 'defense']
const VERIFICATIONS: ModeConfigVerification[] = ['draft', 'confirmed']
const ZONE_KINDS: ModeZoneKind[] = ['own', 'enemy', 'neutral', 'restricted']
const ZONE_ROLES: ModeZoneRole[] = ['attack-base', 'defense-base', 'capture', 'frontline', 'custom']
const VEHICLE_CATEGORIES: VehicleCategory[] = ['tank', 'ifv', 'apc', 'recon', 'helo', 'water', 'supply']

export function emptyModeMapOverride(mapId: string): ModeMapOverride {
  return {
    mapId,
    notes: '',
    stages: (STAGES_BY_MAP[mapId] ?? []).map((stage) => ({ id: stage.id, label: stage.label })),
    zones: [],
    spawns: [],
    objectives: [],
    props: [],
    updatedAt: Date.now(),
  }
}

export function createModeProfile(name = '新模式', id?: string): GameModeProfile {
  const now = Date.now()
  return {
    id: id ?? `mode_${now.toString(36)}`,
    name,
    description: '',
    maps: {},
    createdAt: now,
    updatedAt: now,
  }
}

function defaultStore(): ModeConfigStore {
  const winner = createModeProfile('胜者为王', 'winner-takes-all')
  winner.description = winnerTakesAllOfficial.mode.description
  winner.maps = Object.fromEntries(
    MAPS.map((map) => {
      const official = (winnerTakesAllOfficial.maps as unknown as Partial<Record<string, OfficialModeMapData>>)[map.id]
      return [
        map.id,
        official
          ? modeMapFromOfficial(map.id, official)
          : syncModeMapFromAttackDefense(map.id, STAGES_BY_MAP[map.id] ?? []),
      ]
    }),
  )
  return {
    version: MODE_STORAGE_VERSION,
    activeModeId: 'attack-defense',
    profiles: [winner],
  }
}

interface OfficialModeMapData {
  stages: StageConfig[]
  props: MapProp[]
  deploy: Record<string, StageDeploy>
}

/** 将编辑器导出的正式版地图数据还原为可继续编辑、可持久化的模式地图。 */
function modeMapFromOfficial(mapId: string, official: OfficialModeMapData): ModeMapOverride {
  const zones: ModeZone[] = []
  const spawns: ModeSpawnPoint[] = []
  const objectives: ModeObjectivePoint[] = []

  const addZone = (
    uid: string,
    stageId: string,
    name: string,
    kind: ModeZoneKind,
    color: string,
    points: [number, number][],
    role: ModeZoneRole,
    objectiveUid?: string,
  ) => {
    if (points.length < 3) return ''
    zones.push({
      uid,
      stageId,
      name,
      kind,
      role,
      objectiveUid,
      color,
      points: points.map((point) => [...point] as [number, number]),
      verification: 'confirmed',
    })
    return uid
  }

  for (const stage of official.stages) {
    if (stage.zone) addZone(`builtin_wta_${mapId}_${stage.id}_front`, stage.id, stage.zone.name, 'neutral', '#f4cf67', stage.zone.latlngs, 'frontline')
    addZone(`builtin_wta_${mapId}_${stage.id}_attack-base`, stage.id, `${stage.id} · 进攻方活动区`, 'own', '#01ff84', stage.attackBaseZone, 'attack-base')
    addZone(`builtin_wta_${mapId}_${stage.id}_defense-base`, stage.id, `${stage.id} · 防守方活动区`, 'enemy', '#e0453a', stage.defenseBaseZone, 'defense-base')

    stage.points.forEach((point, index) => {
      const objectiveUid = `builtin_wta_${mapId}_${stage.id}_objective-${index}`
      const captureZoneUid = addZone(
        `builtin_wta_${mapId}_${stage.id}_capture-${index}`,
        stage.id,
        `${stage.id} · ${point.name}占领区`,
        'neutral',
        '#f4cf67',
        point.capturable,
        'capture',
        objectiveUid,
      )
      objectives.push({
        uid: objectiveUid,
        stageId: stage.id,
        name: point.name,
        note: point.note,
        icon: point.icon,
        captureZoneUid,
        lat: point.lat,
        lng: point.lng,
        verification: 'confirmed',
      })
    })

    for (const side of SIDES) {
      const points = side === 'attack' ? stage.attackSpawns : stage.defenseSpawns
      const names = side === 'attack' ? stage.attackSpawnNames : stage.defenseSpawnNames
      const deployments = official.deploy[stage.id]?.[side] ?? []
      points.forEach((point, index) => {
        const name = names?.[index] || `${stage.id} · ${side === 'attack' ? '进攻方' : '防守方'}复活点 ${index + 1}`
        const deployVehicles = deployments
          .filter((vehicle) => vehicle.note === name)
          .map(({ note: _note, ...vehicle }) => vehicle)
        spawns.push({
          uid: `builtin_wta_${mapId}_${stage.id}_${side}-spawn-${index}`,
          stageId: stage.id,
          name,
          side,
          lat: point[0],
          lng: point[1],
          vehicleDeploy: deployVehicles.length > 0,
          vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))],
          deployVehicles,
          verification: 'confirmed',
        })
      })
    }
  }

  return {
    mapId,
    notes: '内置数据：攀升 · 胜者为王（2026-08-14）。',
    stages: official.stages.map((stage) => ({ id: stage.id, label: stage.label })),
    zones,
    spawns,
    objectives,
    props: official.props.map((prop, index) => ({
      uid: `builtin_wta_${mapId}_prop-${index}`,
      stageId: prop.stage.match(/S\d+/i)?.[0].toUpperCase() ?? '*',
      name: prop.name,
      icon: prop.icon,
      lat: prop.lat,
      lng: prop.lng,
      verification: 'confirmed',
    })),
    updatedAt: Date.now(),
  }
}

export function syncModeMapFromAttackDefense(mapId: string, stages: StageConfig[]): ModeMapOverride {
  const zones: ModeZone[] = []
  const spawns: ModeSpawnPoint[] = []
  const objectives: ModeObjectivePoint[] = []

  const asModeVehicle = (entry: DeployVehicleEntry): ModeDeployVehicle => ({
    name: entry.name,
    icon: entry.icon,
    iconUrl: entry.iconUrl,
    legendKey: entry.legendKey,
    badge: entry.badge,
    category: entry.category,
    cd: entry.cd,
    num: entry.num,
    allowTeammate: entry.allowTeammate,
  })

  for (const stage of stages) {
    const addZone = (
      suffix: string,
      name: string,
      kind: ModeZoneKind,
      color: string,
      points: [number, number][],
      role: ModeZoneRole,
      objectiveUid?: string,
    ) => {
      if (points.length < 3) return ''
      const uid = `sync_${mapId}_${stage.id}_${suffix}`
      zones.push({
        uid,
        stageId: stage.id,
        name,
        kind,
        role,
        objectiveUid,
        color,
        points: points.map((point) => [...point] as [number, number]),
        verification: 'confirmed',
      })
      return uid
    }

    if (stage.zone) addZone('front', `${stage.id} · ${stage.zone.name || stage.label}`, 'neutral', '#f4cf67', stage.zone.latlngs, 'frontline')
    addZone('attack-base', `${stage.id} · 进攻方活动区`, 'own', '#01ff84', stage.attackBaseZone, 'attack-base')
    addZone('defense-base', `${stage.id} · 防守方活动区`, 'enemy', '#e0453a', stage.defenseBaseZone, 'defense-base')
    stage.points.forEach((point, index) => {
      const objectiveUid = `sync_${mapId}_${stage.id}_objective-${index}`
      const captureZoneUid = addZone(
        `point-${index}`,
        `${stage.id} · ${point.name}占领区`,
        'neutral',
        '#f4cf67',
        point.capturable,
        'capture',
        objectiveUid,
      )
      objectives.push({
        uid: objectiveUid,
        stageId: stage.id,
        name: point.name,
        note: point.note,
        icon: point.icon,
        captureZoneUid,
        lat: point.lat,
        lng: point.lng,
        verification: 'confirmed',
      })
    })

    stage.attackSpawns.forEach((point, index) => {
      const baseName = stage.attackSpawnNames?.[index] ?? null
      const deployVehicles = baseName
        ? (DEPLOY_BY_MAP[mapId]?.[stage.id]?.attack ?? []).filter((vehicle) => vehicle.note === baseName).map(asModeVehicle)
        : []
      spawns.push({
        uid: `sync_${mapId}_${stage.id}_attack-spawn-${index}`,
        stageId: stage.id,
        name: baseName || `${stage.id} · 进攻方复活点 ${index + 1}`,
        side: 'attack',
        lat: point[0],
        lng: point[1],
        vehicleDeploy: deployVehicles.length > 0,
        vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))],
        deployVehicles,
        verification: 'confirmed',
      })
    })
    stage.defenseSpawns.forEach((point, index) => {
      const baseName = stage.defenseSpawnNames?.[index] ?? null
      const deployVehicles = baseName
        ? (DEPLOY_BY_MAP[mapId]?.[stage.id]?.defense ?? []).filter((vehicle) => vehicle.note === baseName).map(asModeVehicle)
        : []
      spawns.push({
        uid: `sync_${mapId}_${stage.id}_defense-spawn-${index}`,
        stageId: stage.id,
        name: baseName || `${stage.id} · 防守方复活点 ${index + 1}`,
        side: 'defense',
        lat: point[0],
        lng: point[1],
        vehicleDeploy: deployVehicles.length > 0,
        vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))],
        deployVehicles,
        verification: 'confirmed',
      })
    })
  }

  const propKeys = new Set<string>()
  const props: ModeMapProp[] = []
  for (const prop of MAP_PROPS[mapId] ?? []) {
    const stageId = prop.stage.match(/S\d+/i)?.[0].toUpperCase() ?? '*'
    const key = `${stageId}:${prop.name}:${prop.icon}:${prop.lat}:${prop.lng}`
    if (propKeys.has(key)) continue
    propKeys.add(key)
    props.push({
      uid: `sync_${mapId}_prop-${props.length}`,
      stageId,
      name: prop.name,
      icon: prop.icon,
      lat: prop.lat,
      lng: prop.lng,
      verification: 'confirmed',
    })
  }

  return {
    mapId,
    notes: '已从攻防模式同步；请根据胜者为王实际数据修改差异。',
    stages: stages.map((stage) => ({ id: stage.id, label: stage.label })),
    zones,
    spawns,
    objectives,
    props,
    updatedAt: Date.now(),
  }
}

function finitePoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lat = Number(value[0])
  const lng = Number(value[1])
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
}

function normalizeZone(value: unknown): ModeZone | null {
  if (!value || typeof value !== 'object') return null
  const zone = value as Partial<ModeZone>
  const points = Array.isArray(zone.points)
    ? zone.points.map(finitePoint).filter((point): point is [number, number] => point != null)
    : []
  if (typeof zone.uid !== 'string' || points.length < 3) return null
  return {
    uid: zone.uid,
    stageId: typeof zone.stageId === 'string' && zone.stageId ? zone.stageId : 'S1',
    name: typeof zone.name === 'string' && zone.name.trim() ? zone.name : '未命名区域',
    kind: ZONE_KINDS.includes(zone.kind as ModeZoneKind) ? (zone.kind as ModeZoneKind) : 'neutral',
    role: ZONE_ROLES.includes(zone.role as ModeZoneRole)
      ? (zone.role as ModeZoneRole)
      : zone.name?.includes('进攻方活动区')
        ? 'attack-base'
        : zone.name?.includes('防守方活动区')
          ? 'defense-base'
          : zone.name?.includes('占领区')
            ? 'capture'
            : 'custom',
    objectiveUid: typeof zone.objectiveUid === 'string' ? zone.objectiveUid : undefined,
    color: typeof zone.color === 'string' && zone.color ? zone.color : '#f4cf67',
    points,
    verification: VERIFICATIONS.includes(zone.verification as ModeConfigVerification)
      ? (zone.verification as ModeConfigVerification)
      : 'draft',
  }
}

function normalizeSpawn(value: unknown): ModeSpawnPoint | null {
  if (!value || typeof value !== 'object') return null
  const spawn = value as Partial<ModeSpawnPoint>
  const lat = Number(spawn.lat)
  const lng = Number(spawn.lng)
  if (typeof spawn.uid !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    uid: spawn.uid,
    stageId: typeof spawn.stageId === 'string' && spawn.stageId ? spawn.stageId : 'S1',
    name: typeof spawn.name === 'string' && spawn.name.trim() ? spawn.name : '未命名复活点',
    side: SIDES.includes(spawn.side as Side) ? (spawn.side as Side) : 'attack',
    lat,
    lng,
    vehicleDeploy: Boolean(spawn.vehicleDeploy),
    vehicleCategories: Array.isArray(spawn.vehicleCategories)
      ? spawn.vehicleCategories.filter((category): category is VehicleCategory =>
          VEHICLE_CATEGORIES.includes(category as VehicleCategory),
        )
      : [],
    deployVehicles: Array.isArray(spawn.deployVehicles)
      ? spawn.deployVehicles.map(normalizeDeployVehicle).filter((vehicle): vehicle is ModeDeployVehicle => vehicle != null)
      : [],
    verification: VERIFICATIONS.includes(spawn.verification as ModeConfigVerification)
      ? (spawn.verification as ModeConfigVerification)
      : 'draft',
  }
}

function normalizeDeployVehicle(value: unknown): ModeDeployVehicle | null {
  if (!value || typeof value !== 'object') return null
  const vehicle = value as Partial<ModeDeployVehicle>
  if (typeof vehicle.name !== 'string' || typeof vehicle.icon !== 'string') return null
  const category = VEHICLE_CATEGORIES.includes(vehicle.category as VehicleCategory)
    ? (vehicle.category as VehicleCategory)
    : 'recon'
  const storedIconUrl = typeof vehicle.iconUrl === 'string' ? vehicle.iconUrl : localDeployIconUrl(vehicle.icon)
  const iconUrl = vehicle.icon === 'ucb9597' && storedIconUrl.endsWith('.png')
    ? localDeployIconUrl(vehicle.icon)
    : storedIconUrl
  return {
    name: vehicle.name,
    icon: vehicle.icon,
    iconUrl,
    legendKey: typeof vehicle.legendKey === 'string' ? vehicle.legendKey : undefined,
    badge: typeof vehicle.badge === 'string' && vehicle.badge ? vehicle.badge : vehicle.name.slice(0, 1),
    category,
    cd: Number.isFinite(vehicle.cd) ? Number(vehicle.cd) : 0,
    num: Number.isFinite(vehicle.num) ? Number(vehicle.num) : 1,
    allowTeammate: Boolean(vehicle.allowTeammate),
  }
}

function normalizeObjective(value: unknown): ModeObjectivePoint | null {
  if (!value || typeof value !== 'object') return null
  const point = value as Partial<ModeObjectivePoint>
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (typeof point.uid !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    uid: point.uid,
    stageId: typeof point.stageId === 'string' && point.stageId ? point.stageId : 'S1',
    name: typeof point.name === 'string' && point.name.trim() ? point.name : '未命名据点',
    note: typeof point.note === 'string' ? point.note : '',
    icon: typeof point.icon === 'string' && point.icon ? point.icon : 'q_jd_a',
    captureZoneUid: typeof point.captureZoneUid === 'string' ? point.captureZoneUid : '',
    lat,
    lng,
    verification: VERIFICATIONS.includes(point.verification as ModeConfigVerification)
      ? (point.verification as ModeConfigVerification)
      : 'draft',
  }
}

function normalizeProp(value: unknown): ModeMapProp | null {
  if (!value || typeof value !== 'object') return null
  const prop = value as Partial<ModeMapProp>
  const lat = Number(prop.lat)
  const lng = Number(prop.lng)
  if (typeof prop.uid !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    uid: prop.uid,
    stageId: typeof prop.stageId === 'string' && prop.stageId ? prop.stageId : '*',
    name: typeof prop.name === 'string' && prop.name.trim() ? prop.name : '未命名道具',
    icon: typeof prop.icon === 'string' && prop.icon ? prop.icon : 'q_gddyx',
    lat,
    lng,
    verification: VERIFICATIONS.includes(prop.verification as ModeConfigVerification)
      ? (prop.verification as ModeConfigVerification)
      : 'draft',
  }
}

function normalizeMapOverride(mapId: string, value: unknown): ModeMapOverride {
  if (!value || typeof value !== 'object') return emptyModeMapOverride(mapId)
  const map = value as Partial<ModeMapOverride>
  const zones = Array.isArray(map.zones)
    ? map.zones.map(normalizeZone).filter((zone): zone is ModeZone => zone != null)
    : []
  const objectives = Array.isArray(map.objectives)
    ? map.objectives.map(normalizeObjective).filter((point): point is ModeObjectivePoint => point != null)
    : []
  const fallbackStages = (STAGES_BY_MAP[mapId] ?? []).map((stage) => ({ id: stage.id, label: stage.label }))
  const stageIds = new Set<string>()
  const stages: ModeStageDefinition[] = Array.isArray(map.stages)
    ? map.stages.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const stage = value as Partial<ModeStageDefinition>
        const id = typeof stage.id === 'string' ? stage.id.trim().toUpperCase() : ''
        if (!id || stageIds.has(id)) return []
        stageIds.add(id)
        return [{ id, label: typeof stage.label === 'string' && stage.label.trim() ? stage.label.trim() : `阶段 ${id}` }]
      })
    : fallbackStages
  if (stages.length === 0) stages.push({ id: 'S1', label: '第一阶段' })
  for (const point of objectives) {
    let zone = zones.find((item) => item.uid === point.captureZoneUid)
    if (!zone) zone = zones.find((item) => item.role === 'capture' && item.name.includes(point.name))
    if (!zone) continue
    point.captureZoneUid = zone.uid
    zone.role = 'capture'
    zone.objectiveUid = point.uid
  }
  return {
    mapId,
    notes: typeof map.notes === 'string' ? map.notes : '',
    stages,
    zones,
    spawns: Array.isArray(map.spawns)
      ? map.spawns.map(normalizeSpawn).filter((spawn): spawn is ModeSpawnPoint => spawn != null)
      : [],
    objectives,
    props: Array.isArray(map.props)
      ? map.props.map(normalizeProp).filter((prop): prop is ModeMapProp => prop != null)
      : [],
    updatedAt: Number.isFinite(map.updatedAt) ? Number(map.updatedAt) : Date.now(),
  }
}

function normalizeProfile(value: unknown): GameModeProfile | null {
  if (!value || typeof value !== 'object') return null
  const profile = value as Partial<GameModeProfile>
  if (typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string') return null
  const maps: Record<string, ModeMapOverride> = {}
  if (profile.maps && typeof profile.maps === 'object') {
    for (const [mapId, map] of Object.entries(profile.maps)) maps[mapId] = normalizeMapOverride(mapId, map)
  }
  const now = Date.now()
  return {
    id: profile.id,
    name: profile.name.trim() || '未命名模式',
    description: typeof profile.description === 'string' ? profile.description : '',
    maps,
    createdAt: Number.isFinite(profile.createdAt) ? Number(profile.createdAt) : now,
    updatedAt: Number.isFinite(profile.updatedAt) ? Number(profile.updatedAt) : now,
  }
}

export function normalizeModeConfigStore(value: unknown): ModeConfigStore | null {
  if (!value || typeof value !== 'object') return null
  const store = value as Partial<ModeConfigStore>
  const sourceVersion = Number((value as { version?: unknown }).version ?? 1)
  const profiles = Array.isArray(store.profiles)
    ? store.profiles.map(normalizeProfile).filter((profile): profile is GameModeProfile => profile != null)
    : []
  if (profiles.length === 0) return null
  const activeModeId =
    store.activeModeId === 'attack-defense' || profiles.some((profile) => profile.id === store.activeModeId)
      ? String(store.activeModeId)
      : 'attack-defense'
  const winner = profiles.find((profile) => profile.id === 'winner-takes-all')
  if (winner) {
    for (const map of MAPS) {
      // v5 首次固化“攀升·胜者为王”正式数据；迁移完成后继续保留用户后续修改。
      if (map.id === 'ascent' && sourceVersion < 5) {
        winner.maps.ascent = modeMapFromOfficial('ascent', winnerTakesAllOfficial.maps.ascent as unknown as OfficialModeMapData)
        continue
      }
      // v6 首次固化“烬区·胜者为王”正式数据；不重复覆盖已固化的攀升。
      if (map.id === 'ember' && sourceVersion < 6) {
        winner.maps.ember = modeMapFromOfficial('ember', winnerTakesAllOfficial.maps.ember as unknown as OfficialModeMapData)
        continue
      }
      // v7 更新“攀升·胜者为王”正式数据；仅覆盖该内置地图，保留烬区与其他模式配置。
      if (map.id === 'ascent' && sourceVersion < 7) {
        winner.maps.ascent = modeMapFromOfficial('ascent', winnerTakesAllOfficial.maps.ascent as unknown as OfficialModeMapData)
        continue
      }
      // v8 再次发布 2026-08-14 攀升数据，确保已经写入 v7 的安装用户
      // 也能获得 S1 守方复活点新增的 M1A4 主战坦克。
      if (map.id === 'ascent' && sourceVersion < 8) {
        winner.maps.ascent = modeMapFromOfficial('ascent', winnerTakesAllOfficial.maps.ascent as unknown as OfficialModeMapData)
        continue
      }
      // 更早的旧格式仍需补齐其他地图；已有数据在本轮只迁移对应新增地图。
      if (sourceVersion < 4 || !winner.maps[map.id]) {
        winner.maps[map.id] = syncModeMapFromAttackDefense(map.id, STAGES_BY_MAP[map.id] ?? [])
      }
    }
  }
  return { version: MODE_STORAGE_VERSION, activeModeId, profiles }
}

export function loadModeConfigStore(): ModeConfigStore {
  try {
    const raw = localStorage.getItem(MODE_CONFIG_STORAGE_KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw) as { version?: unknown }
    const normalized = normalizeModeConfigStore(parsed) ?? defaultStore()
    // 迁移不能只停留在当前窗口内存中，否则其他正式版/编辑器窗口仍可能
    // 用旧存储内容覆盖新数据。版本发生变化时立即写回规范化结果。
    if (Number(parsed.version ?? 1) !== normalized.version) {
      localStorage.setItem(MODE_CONFIG_STORAGE_KEY, JSON.stringify(normalized))
    }
    return normalized
  } catch (error) {
    console.warn('[mode-config] 读取失败，将使用默认草稿', error)
    return defaultStore()
  }
}

export function saveModeConfigStore(store: ModeConfigStore): void {
  try {
    localStorage.setItem(MODE_CONFIG_STORAGE_KEY, JSON.stringify(store))
  } catch (error) {
    console.warn('[mode-config] 保存失败', error)
  }
}

/** 保存并主动通知已打开的正式版窗口立即应用模式配置。 */
export function publishModeConfigStore(store: ModeConfigStore): void {
  saveModeConfigStore(store)
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(MODE_CONFIG_SYNC_CHANNEL)
    channel.postMessage(store)
    channel.close()
  }
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: MODE_CONFIG_SYNC_MESSAGE, store }, '*')
  }
}

/**
 * 将编辑器模型转换为项目正式版直接使用的 StageConfig / MAP_PROPS / DEPLOY 数据形状。
 * uid、权限等编辑器元数据不会混入运行时配置。
 */
export function buildOfficialModeData(profile: GameModeProfile) {
  const maps: Record<string, { stages: StageConfig[]; props: MapProp[]; deploy: Record<string, StageDeploy> }> = {}

  for (const map of MAPS) {
    const config = profile.maps[map.id] ?? emptyModeMapOverride(map.id)
    const baseStages = STAGES_BY_MAP[map.id] ?? []
    const stages = config.stages.map((definition): StageConfig => {
      const base = baseStages.find((stage) => stage.id === definition.id)
      const zones = config.zones.filter((zone) => zone.stageId === definition.id)
      const objectives = config.objectives.filter((point) => point.stageId === definition.id)
      const attackSpawns = config.spawns.filter((spawn) => spawn.stageId === definition.id && spawn.side === 'attack')
      const defenseSpawns = config.spawns.filter((spawn) => spawn.stageId === definition.id && spawn.side === 'defense')
      const frontline = zones.find((zone) => zone.role === 'frontline')
      const attackBase = zones.find((zone) => zone.role === 'attack-base')
      const defenseBase = zones.find((zone) => zone.role === 'defense-base')
      return {
        id: definition.id,
        label: definition.label,
        zone: frontline ? { name: frontline.name, latlngs: frontline.points } : null,
        attackBaseZone: attackBase?.points ?? [],
        defenseBaseZone: defenseBase?.points ?? [],
        points: objectives.map((point) => ({
          name: point.name,
          note: point.note,
          icon: point.icon,
          lat: point.lat,
          lng: point.lng,
          capturable: zones.find((zone) => zone.uid === point.captureZoneUid)?.points ?? [],
        })),
        attackSpawns: attackSpawns.map((spawn) => [spawn.lat, spawn.lng]),
        defenseSpawns: defenseSpawns.map((spawn) => [spawn.lat, spawn.lng]),
        attackSpawnNames: attackSpawns.map((spawn) => spawn.name),
        defenseSpawnNames: defenseSpawns.map((spawn) => spawn.name),
        attackVehicles: base?.attackVehicles ?? [],
        defenseVehicles: base?.defenseVehicles ?? [],
      }
    })

    const deploy: Record<string, StageDeploy> = {}
    for (const stage of stages) {
      const stageSpawns = config.spawns.filter((spawn) => spawn.stageId === stage.id)
      const entries = (side: Side): DeployVehicleEntry[] => stageSpawns
        .filter((spawn) => spawn.side === side && spawn.vehicleDeploy)
        .flatMap((spawn) => spawn.deployVehicles.map((vehicle) => ({ ...vehicle, note: spawn.name })))
      deploy[stage.id] = { attack: entries('attack'), defense: entries('defense') }
    }

    maps[map.id] = {
      stages,
      props: config.props.map((prop) => ({
        name: prop.name,
        icon: prop.icon,
        lat: prop.lat,
        lng: prop.lng,
        stage: prop.stageId === '*' ? '' : prop.stageId,
      })),
      deploy,
    }
  }

  return {
    format: 'deltaforce-map-mode',
    schemaVersion: 1,
    mode: { id: profile.id, name: profile.name, description: profile.description },
    maps,
  }
}
