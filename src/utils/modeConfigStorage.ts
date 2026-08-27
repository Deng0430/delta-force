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
  ModeVehicleRefreshPoint,
  ModeVehicleRefreshRule,
  ModeVehicleRefreshTriggerType,
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
import { DEPLOY_BY_MAP, DEPLOY_VEHICLE_CATALOG, localDeployIconUrl, type DeployVehicleEntry, type StageDeploy } from '../config/deployVehicles'
import winnerTakesAllOfficial from '../config/winnerTakesAllOfficial.json'
import mobileWinnerTakesAllOfficial from '../config/mobileWinnerTakesAllOfficial.json'
import { deployForPlatform, propsForPlatform, stagesForPlatform, type GameDataPlatform } from '../config/gameDataPlatform'
import { makeWinnerSpawnUid } from '../config/attackDefenseSpawns'

/** 正式应用模式配置的本地存储键。 */
export const MODE_CONFIG_STORAGE_KEY = 'deltaforce-mode-configs-v1'
export const MODE_CONFIG_SYNC_CHANNEL = 'deltaforce-mode-config-sync-v1'
export const MODE_CONFIG_SYNC_MESSAGE = 'deltaforce-mode-config-sync'
const MODE_STORAGE_VERSION = 32 as const

const SIDES: Side[] = ['attack', 'defense']
const VERIFICATIONS: ModeConfigVerification[] = ['draft', 'confirmed']
const ZONE_KINDS: ModeZoneKind[] = ['own', 'enemy', 'neutral', 'restricted']
const ZONE_ROLES: ModeZoneRole[] = ['attack-base', 'defense-base', 'capture', 'frontline', 'custom']
const VEHICLE_CATEGORIES: VehicleCategory[] = ['tank', 'ifv', 'apc', 'recon', 'helo', 'water', 'supply']
const VEHICLE_REFRESH_TRIGGER_TYPES: ModeVehicleRefreshTriggerType[] = ['tickets', 'match-time', 'objective-countdown', 'objective-captured', 'map-event']

export function emptyModeMapOverride(mapId: string): ModeMapOverride {
  return {
    mapId,
    notes: '',
    stages: (STAGES_BY_MAP[mapId] ?? []).map((stage) => ({ id: stage.id, label: stage.label })),
    zones: [],
    spawns: [],
    objectives: [],
    props: [],
    vehicleRefreshPoints: [],
    vehicleRefreshRules: [],
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
  const attackDefense = createModeProfile('攻防模式', 'attack-defense')
  attackDefense.description = '内置攻防模式数据，可分别编辑 PC 端与移动端。'
  const pcMaps = Object.fromEntries(MAPS.map((map) => [map.id, syncModeMapFromAttackDefense(map.id, stagesForPlatform('pc')[map.id] ?? [], propsForPlatform('pc'), deployForPlatform('pc'))]))
  const mobileMaps = Object.fromEntries(MAPS.map((map) => [map.id, syncModeMapFromAttackDefense(map.id, stagesForPlatform('mobile')[map.id] ?? [], propsForPlatform('mobile'), deployForPlatform('mobile'))]))
  attackDefense.platformMaps = { pc: pcMaps, mobile: mobileMaps }
  attackDefense.maps = pcMaps
  const winner = createModeProfile('胜者为王', 'winner-takes-all')
  winner.description = winnerTakesAllOfficial.mode.description
  const winnerPcMaps = Object.fromEntries(
    MAPS.map((map) => {
      const official = (winnerTakesAllOfficial.maps as unknown as Partial<Record<string, OfficialModeMapData>>)[map.id]
      return [
        map.id,
        official
          ? modeMapFromOfficial(map.id, official)
          : syncModeMapFromAttackDefense(map.id, stagesForPlatform('pc')[map.id] ?? [], propsForPlatform('pc'), deployForPlatform('pc')),
      ]
    }),
  )
  const winnerMobileMaps = Object.fromEntries(
    MAPS.map((map) => {
      const official = (mobileWinnerTakesAllOfficial.maps as unknown as Partial<Record<string, OfficialModeMapData>>)[map.id]
      return [map.id, official ? modeMapFromOfficial(map.id, official) : structuredClone(winnerPcMaps[map.id])]
    }),
  )
  winner.maps = winnerPcMaps
  winner.platformMaps = { pc: winnerPcMaps, mobile: winnerMobileMaps }
  return {
    version: MODE_STORAGE_VERSION,
    activeModeId: 'attack-defense',
    profiles: [attackDefense, winner],
  }
}

interface OfficialModeMapData {
  stages: StageConfig[]
  props: MapProp[]
  deploy: Record<string, StageDeploy>
  vehicleRefreshPoints?: ModeVehicleRefreshPoint[]
  vehicleRefreshRules?: ModeVehicleRefreshRule[]
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
      // schemaVersion 2 直接使用固化复活点 UID；旧导入包仅在这里执行一次兼容转换。
      const legacyPoints = side === 'attack' ? stage.attackSpawns : stage.defenseSpawns
      const legacyNames = side === 'attack' ? stage.attackSpawnNames : stage.defenseSpawnNames
      const sourceSpawns = stage.spawns?.filter((spawn) => spawn.side === side) ?? legacyPoints.map((point, index) => ({
        uid: makeWinnerSpawnUid('pc', mapId, stage.id, side, point[0], point[1]),
        stageId: stage.id,
        name: legacyNames?.[index] || `${stage.id} · ${side === 'attack' ? '进攻方' : '防守方'}复活点 ${index + 1}`,
        side,
        lat: point[0],
        lng: point[1],
      }))
      const deployments = official.deploy[stage.id]?.[side] ?? []
      sourceSpawns.forEach((spawn) => {
        const deployVehicles = deployments
          .filter((vehicle) => vehicle.spawnUid ? vehicle.spawnUid === spawn.uid : vehicle.note === spawn.name)
          .map(({ note: _note, ...vehicle }) => {
            // 官方固化 JSON 可能保留抓取时的旧 iconUrl；统一通过当前载具目录重解析，
            // 确保图例资源迁移后（例如 AA 防空车）不会继续引用已删除的旧路径。
            return normalizeDeployVehicle(vehicle) ?? vehicle
          })
        spawns.push({
          uid: spawn.uid,
          stageId: stage.id,
          name: spawn.name,
          side,
          lat: spawn.lat,
          lng: spawn.lng,
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
    notes: '内置数据：胜者为王（2026-08-21）。',
    stages: official.stages.map((stage) => ({ id: stage.id, label: stage.label })),
    zones,
    spawns,
    objectives,
    props: official.props.map((prop, index) => ({
      uid: `builtin_wta_${mapId}_prop-${index}`,
      stageId: '*',
      name: prop.name,
      icon: prop.icon,
      lat: prop.lat,
      lng: prop.lng,
      verification: 'confirmed',
    })),
    vehicleRefreshPoints: (official.vehicleRefreshPoints ?? []).map((point) => ({ ...point, verification: 'confirmed' })),
    vehicleRefreshRules: (official.vehicleRefreshRules ?? []).map((rule) => ({
      ...rule,
      trigger: { ...rule.trigger },
      vehicle: normalizeDeployVehicle(rule.vehicle) ?? { ...rule.vehicle },
      verification: 'confirmed',
    })),
    updatedAt: Date.now(),
  }
}

export function syncModeMapFromAttackDefense(
  mapId: string,
  stages: StageConfig[],
  propsByMap: Record<string, MapProp[]> = MAP_PROPS,
  deployByMap: Record<string, Record<string, StageDeploy>> = DEPLOY_BY_MAP,
): ModeMapOverride {
  const zones: ModeZone[] = []
  const spawns: ModeSpawnPoint[] = []
  const objectives: ModeObjectivePoint[] = []

  const asModeVehicle = (entry: DeployVehicleEntry): ModeDeployVehicle => normalizeDeployVehicle(entry) ?? ({
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

    stage.spawns.forEach((spawn) => {
      const deployVehicles = (deployByMap[mapId]?.[stage.id]?.[spawn.side] ?? [])
        .filter((vehicle) => vehicle.spawnUid === spawn.uid)
        .map(asModeVehicle)
      spawns.push({
        uid: spawn.uid,
        stageId: stage.id,
        name: spawn.name,
        side: spawn.side,
        lat: spawn.lat,
        lng: spawn.lng,
        vehicleDeploy: deployVehicles.length > 0,
        vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))],
        deployVehicles,
        verification: 'confirmed',
      })
    })
  }

  const propKeys = new Set<string>()
  const props: ModeMapProp[] = []
  for (const prop of propsByMap[mapId] ?? []) {
    const key = `${prop.name}:${prop.icon}:${prop.lat}:${prop.lng}`
    if (propKeys.has(key)) continue
    propKeys.add(key)
    props.push({
      uid: `sync_${mapId}_prop-${props.length}`,
      stageId: '*',
      name: prop.name,
      icon: prop.icon,
      lat: prop.lat,
      lng: prop.lng,
      verification: 'confirmed',
    })
  }

  return {
    mapId,
    notes: '已从对应游戏数据端的攻防模式同步。',
    stages: stages.map((stage) => ({ id: stage.id, label: stage.label })),
    zones,
    spawns,
    objectives,
    props,
    vehicleRefreshPoints: [],
    vehicleRefreshRules: [],
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
  // 旧胜者数据曾把“轻型坦克”的 deploy key 误写成主战坦克。名称在这里
  // 仅用于纠正这一已知坏数据，之后统一以稳定图标键解析载具身份。
  const canonicalIcon = vehicle.name === '轻型坦克' ? 'qxtk' : vehicle.icon
  // 图例资源会持续更新；载入固化数据或旧存档时按 deploy key 重新解析，
  // 避免刷新规则永久保留导入当时的旧 base64 / deploy 图标。
  const currentCatalogVehicle = DEPLOY_VEHICLE_CATALOG.find((entry) => entry.icon === canonicalIcon)
    ?? DEPLOY_VEHICLE_CATALOG.find((entry) => entry.name === vehicle.name)
  const storedIconUrl = typeof vehicle.iconUrl === 'string' ? vehicle.iconUrl : localDeployIconUrl(canonicalIcon)
  const iconUrl = currentCatalogVehicle?.iconUrl
    ?? (vehicle.icon === 'ucb9597' && storedIconUrl.endsWith('.png')
      ? localDeployIconUrl(vehicle.icon)
      : storedIconUrl)
  return {
    // 合并官方旧字段“轻型坦克”和正式字段 GTQ-35轻型坦克。
    name: currentCatalogVehicle?.name ?? vehicle.name,
    icon: currentCatalogVehicle?.icon ?? canonicalIcon,
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
    stageId: '*',
    name: typeof prop.name === 'string' && prop.name.trim() ? prop.name : '未命名道具',
    icon: typeof prop.icon === 'string' && prop.icon ? prop.icon : 'q_gddyx',
    lat,
    lng,
    verification: VERIFICATIONS.includes(prop.verification as ModeConfigVerification)
      ? (prop.verification as ModeConfigVerification)
      : 'draft',
  }
}

function normalizeVehicleRefreshPoint(value: unknown): ModeVehicleRefreshPoint | null {
  if (!value || typeof value !== 'object') return null
  const point = value as Partial<ModeVehicleRefreshPoint>
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (typeof point.uid !== 'string' || !point.uid || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    uid: point.uid,
    name: typeof point.name === 'string' && point.name.trim() ? point.name.trim() : '载具刷新位置',
    lat,
    lng,
    verification: VERIFICATIONS.includes(point.verification as ModeConfigVerification)
      ? (point.verification as ModeConfigVerification)
      : 'draft',
  }
}

function normalizeVehicleRefreshRule(value: unknown): ModeVehicleRefreshRule | null {
  if (!value || typeof value !== 'object') return null
  const rule = value as Partial<ModeVehicleRefreshRule>
  const trigger = rule.trigger && typeof rule.trigger === 'object' ? rule.trigger : null
  let triggerType = trigger && VEHICLE_REFRESH_TRIGGER_TYPES.includes(trigger.type as ModeVehicleRefreshTriggerType)
    ? (trigger.type as ModeVehicleRefreshTriggerType)
    : null
  const vehicle = normalizeDeployVehicle(rule.vehicle)
  if (typeof rule.uid !== 'string' || !rule.uid || !trigger || !triggerType || !vehicle) return null
  // 兼容编辑器旧版本把“100兵力”误判成 map-event 的数据。
  const legacyTickets = triggerType === 'map-event'
    ? String(trigger.value ?? '').trim().match(/^(?:兵力\s*)?(\d+)\s*兵力$/)
    : null
  if (legacyTickets) triggerType = 'tickets'
  const triggerValue = legacyTickets
    ? Number(legacyTickets[1])
    : triggerType === 'tickets' || triggerType === 'objective-countdown'
    ? Number(trigger.value)
    : String(trigger.value ?? '')
  if ((typeof triggerValue === 'number' && !Number.isFinite(triggerValue)) || triggerValue === '') return null
  return {
    uid: rule.uid,
    objective: typeof rule.objective === 'string' && rule.objective.trim() ? rule.objective.trim().toUpperCase() : '?',
    side: SIDES.includes(rule.side as Side) ? (rule.side as Side) : 'attack',
    action: rule.action === 'disable' ? 'disable' : 'refresh',
    trigger: { type: triggerType, value: triggerValue },
    vehicle,
    quantity: Number.isFinite(rule.quantity) ? Math.max(1, Number(rule.quantity)) : 1,
    refreshPointUid: typeof rule.refreshPointUid === 'string' ? rule.refreshPointUid : '',
    note: typeof rule.note === 'string' ? rule.note : '',
    verification: VERIFICATIONS.includes(rule.verification as ModeConfigVerification)
      ? (rule.verification as ModeConfigVerification)
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
  const propKeys = new Set<string>()
  const props = (Array.isArray(map.props)
    ? map.props.map(normalizeProp).filter((prop): prop is ModeMapProp => prop != null)
    : []).filter((prop) => {
      const key = `${prop.name}:${prop.icon}:${prop.lat}:${prop.lng}`
      if (propKeys.has(key)) return false
      propKeys.add(key)
      return true
    })
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
    props,
    vehicleRefreshPoints: Array.isArray(map.vehicleRefreshPoints)
      ? map.vehicleRefreshPoints.map(normalizeVehicleRefreshPoint).filter((point): point is ModeVehicleRefreshPoint => point != null)
      : [],
    vehicleRefreshRules: Array.isArray(map.vehicleRefreshRules)
      ? map.vehicleRefreshRules.map(normalizeVehicleRefreshRule).filter((rule): rule is ModeVehicleRefreshRule => rule != null)
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
  const platformMaps = profile.platformMaps && typeof profile.platformMaps === 'object'
    ? Object.fromEntries((['pc', 'mobile'] as const).flatMap((platform) => {
        const source = profile.platformMaps?.[platform]
        if (!source || typeof source !== 'object') return []
        return [[platform, Object.fromEntries(Object.entries(source).map(([mapId, map]) => [mapId, normalizeMapOverride(mapId, map)]))]]
      })) as GameModeProfile['platformMaps']
    : undefined
  const now = Date.now()
  return {
    id: profile.id,
    name: profile.name.trim() || '未命名模式',
    description: typeof profile.description === 'string' ? profile.description : '',
    maps,
    platformMaps,
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
  let attackDefense = profiles.find((profile) => profile.id === 'attack-defense')
  if (!attackDefense) {
    attackDefense = createModeProfile('攻防模式', 'attack-defense')
    profiles.unshift(attackDefense)
  }
  if (!attackDefense.platformMaps?.pc || !attackDefense.platformMaps?.mobile) {
    const pcMaps = attackDefense.platformMaps?.pc ?? (Object.keys(attackDefense.maps).length > 0 ? attackDefense.maps : Object.fromEntries(MAPS.map((map) => [map.id, syncModeMapFromAttackDefense(map.id, stagesForPlatform('pc')[map.id] ?? [], propsForPlatform('pc'), deployForPlatform('pc'))])))
    const mobileMaps = attackDefense.platformMaps?.mobile ?? Object.fromEntries(MAPS.map((map) => [map.id, syncModeMapFromAttackDefense(map.id, stagesForPlatform('mobile')[map.id] ?? [], propsForPlatform('mobile'), deployForPlatform('mobile'))]))
    attackDefense.platformMaps = { pc: pcMaps, mobile: mobileMaps }
    attackDefense.maps = pcMaps
  }
  // v26 固化 2026-08-27“烬区 / 堑壕战·攻防·PC端”完整单图数据。
  // 仅更新 PC 数据端，移动端继续使用其独立快照与官方手游数据。
  if (sourceVersion < 26) {
    const pcMaps = attackDefense.platformMaps!.pc!
    for (const mapId of ['ember', 'trench']) {
      pcMaps[mapId] = syncModeMapFromAttackDefense(
        mapId,
        stagesForPlatform('pc')[mapId] ?? [],
        propsForPlatform('pc'),
        deployForPlatform('pc'),
      )
    }
    attackDefense.maps = pcMaps
  }
  // v30 将“烬区·胜者为王·PE端”的地图内容同步到“烬区·攻防·PE端”。
  // 胜者专属刷新载具不属于攻防数据；移动端攻防固化源已显式清空
  // vehicleRefreshPoints / vehicleRefreshRules，因此此处完整替换不会误带刷新规则。
  if (sourceVersion < 30) {
    const mobileMaps = attackDefense.platformMaps!.mobile!
    mobileMaps.ember = syncModeMapFromAttackDefense(
      'ember',
      stagesForPlatform('mobile').ember ?? [],
      propsForPlatform('mobile'),
      deployForPlatform('mobile'),
    )
    attackDefense.platformMaps = { ...attackDefense.platformMaps, mobile: mobileMaps }
    attackDefense.maps = attackDefense.platformMaps.pc!
    attackDefense.updatedAt = Date.now()
  }
  // v32 固化 2026-08-27“烬区·攻防·PE端”独立官方数据。
  // 完整替换该单图，确保不会混入胜者为王专属的刷新载具与规则。
  if (sourceVersion < 32) {
    const mobileMaps = attackDefense.platformMaps!.mobile!
    mobileMaps.ember = syncModeMapFromAttackDefense(
      'ember',
      stagesForPlatform('mobile').ember ?? [],
      propsForPlatform('mobile'),
      deployForPlatform('mobile'),
    )
    attackDefense.platformMaps = { ...attackDefense.platformMaps, mobile: mobileMaps }
    attackDefense.maps = attackDefense.platformMaps.pc!
    attackDefense.updatedAt = Date.now()
  }
  // v18 从腾讯官方 map_dg.js 的 init 数据补回断轨 S4 守方活动区。
  // 两个游戏数据端的官方边界一致；仅替换该区域，保留其他已有编辑。
  if (sourceVersion < 18) {
    for (const gameDataPlatform of ['pc', 'mobile'] as const) {
      const platformMaps = attackDefense.platformMaps?.[gameDataPlatform]
      const current = platformMaps?.brokentrack
      if (!platformMaps || !current) continue
      const builtin = syncModeMapFromAttackDefense(
        'brokentrack',
        stagesForPlatform(gameDataPlatform).brokentrack ?? [],
        propsForPlatform(gameDataPlatform),
        deployForPlatform(gameDataPlatform),
      )
      const correctedZone = builtin.zones.find((zone) => zone.stageId === 'S4' && zone.role === 'defense-base')
      if (!correctedZone) continue
      const hasZone = current.zones.some((zone) => zone.stageId === 'S4' && zone.role === 'defense-base')
      platformMaps.brokentrack = {
        ...current,
        zones: hasZone
          ? current.zones.map((zone) => zone.stageId === 'S4' && zone.role === 'defense-base' ? correctedZone : zone)
          : [...current.zones, correctedZone],
        updatedAt: Date.now(),
      }
    }
    attackDefense.maps = attackDefense.platformMaps!.pc!
  }
  // v20 修复移动端攻防载具部署表被局部官方数据整体覆盖的问题。只为原本
  // 没有部署数据的内置复活点补回载具，保留用户在编辑器中的其他修改。
  if (sourceVersion < 20) {
    const mobileMaps = attackDefense.platformMaps?.mobile ?? {}
    for (const map of MAPS) {
      const builtin = syncModeMapFromAttackDefense(
        map.id,
        stagesForPlatform('mobile')[map.id] ?? [],
        propsForPlatform('mobile'),
        deployForPlatform('mobile'),
      )
      const current = mobileMaps[map.id]
      if (!current) {
        mobileMaps[map.id] = builtin
        continue
      }
      const builtinSpawns = new Map(builtin.spawns.map((spawn) => [spawn.uid, spawn]))
      let changed = false
      const spawns = current.spawns.map((spawn) => {
        const source = builtinSpawns.get(spawn.uid)
        if (!source) return spawn
        const generatedName = /^S\d+ · (?:进攻方|防守方)复活点 \d+$/.test(spawn.name)
        const restoreName = (!spawn.name.trim() || generatedName) && source.name !== spawn.name
        const restoreVehicles = spawn.deployVehicles.length === 0 && source.deployVehicles.length > 0
        if (!restoreName && !restoreVehicles) return spawn
        changed = true
        return {
          ...spawn,
          name: restoreName ? source.name : spawn.name,
          vehicleDeploy: restoreVehicles ? source.vehicleDeploy : spawn.vehicleDeploy,
          vehicleCategories: restoreVehicles ? [...source.vehicleCategories] : spawn.vehicleCategories,
          deployVehicles: restoreVehicles ? source.deployVehicles.map((vehicle) => ({ ...vehicle })) : spawn.deployVehicles,
        }
      })
      if (changed) mobileMaps[map.id] = { ...current, spawns, updatedAt: Date.now() }
    }
    attackDefense.platformMaps = { ...attackDefense.platformMaps, mobile: mobileMaps }
    attackDefense.maps = attackDefense.platformMaps.pc!
  }
  // v21 统一正式攻防与模式编辑器的复活点身份，并把部署载具外键由名称迁移为 UID。
  // 用户修改过的显示名称、坐标、区域等继续保留；仅替换可识别的内置复活点 UID，
  // 并补齐此前因名称不一致或跨阶段继承而缺失的官方载具。
  if (sourceVersion < 21) {
    for (const gameDataPlatform of ['pc', 'mobile'] as const) {
      const platformMaps = attackDefense.platformMaps?.[gameDataPlatform]
      if (!platformMaps) continue
      for (const map of MAPS) {
        const builtin = syncModeMapFromAttackDefense(
          map.id,
          stagesForPlatform(gameDataPlatform)[map.id] ?? [],
          propsForPlatform(gameDataPlatform),
          deployForPlatform(gameDataPlatform),
        )
        const current = platformMaps[map.id]
        if (!current) {
          platformMaps[map.id] = builtin
          continue
        }
        const usedBuiltin = new Set<string>()
        const migrated = current.spawns.map((spawn) => {
          const sameSideStage = builtin.spawns.filter((candidate) => candidate.stageId === spawn.stageId && candidate.side === spawn.side)
          const coordinateMatch = sameSideStage.find((candidate) => Math.abs(candidate.lat - spawn.lat) < 0.001 && Math.abs(candidate.lng - spawn.lng) < 0.001)
          const legacyIndex = spawn.uid.match(/(?:attack|defense)-spawn-(\d+)$/)?.[1]
          const indexMatch = legacyIndex == null ? undefined : sameSideStage[Number(legacyIndex)]
          const source = builtin.spawns.find((candidate) => candidate.uid === spawn.uid) ?? coordinateMatch ?? indexMatch
          if (!source) return spawn
          usedBuiltin.add(source.uid)
          const vehicleKeys = new Set(spawn.deployVehicles.map((vehicle) => `${vehicle.name}:${vehicle.icon}`))
          const missingVehicles = source.deployVehicles.filter((vehicle) => !vehicleKeys.has(`${vehicle.name}:${vehicle.icon}`))
          const deployVehicles = [...spawn.deployVehicles, ...missingVehicles.map((vehicle) => ({ ...vehicle }))]
          return {
            ...spawn,
            uid: source.uid,
            vehicleDeploy: spawn.vehicleDeploy || deployVehicles.length > 0,
            vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))],
            deployVehicles,
          }
        })
        const added = builtin.spawns.filter((spawn) => !usedBuiltin.has(spawn.uid))
        platformMaps[map.id] = {
          ...current,
          spawns: [...migrated, ...added.map((spawn) => ({ ...spawn, deployVehicles: spawn.deployVehicles.map((vehicle) => ({ ...vehicle })) }))],
          updatedAt: Date.now(),
        }
      }
    }
    attackDefense.maps = attackDefense.platformMaps!.pc!
  }
  // v13 同步官方断层复活点与克劳狄斗兽场密集阵，PC/移动端官方数据一致。
  if (sourceVersion < 13) {
    const platformMaps = attackDefense.platformMaps!
    const pcMaps = platformMaps.pc!
    const mobileMaps = platformMaps.mobile!
    for (const mapId of ['fault', 'colosseum']) {
      pcMaps[mapId] = syncModeMapFromAttackDefense(mapId, stagesForPlatform('pc')[mapId] ?? [], propsForPlatform('pc'), deployForPlatform('pc'))
      mobileMaps[mapId] = syncModeMapFromAttackDefense(
        mapId,
        stagesForPlatform('mobile')[mapId] ?? [],
        propsForPlatform('mobile'),
        deployForPlatform('mobile'),
      )
    }
    attackDefense.maps = pcMaps
  }
  // v11 固化“烬区·攻防·移动端”编辑数据。仅覆盖移动端烬区，PC端及其他地图保持不变。
  if (sourceVersion < 11) {
    const mobileMaps = attackDefense.platformMaps?.mobile ?? {}
    attackDefense.platformMaps = {
      ...attackDefense.platformMaps,
      mobile: {
        ...mobileMaps,
        ember: syncModeMapFromAttackDefense(
          'ember',
          stagesForPlatform('mobile').ember ?? [],
          propsForPlatform('mobile'),
          deployForPlatform('mobile'),
        ),
      },
    }
  }
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
        winner.maps[map.id] = syncModeMapFromAttackDefense(map.id, stagesForPlatform('pc')[map.id] ?? [], propsForPlatform('pc'), deployForPlatform('pc'))
      }
    }
    // v12 固化全部地图的胜者为王载具刷新数据。仅同步刷新位置和规则，
    // 保留用户对阶段、区域、复活点、据点及地图道具的已有编辑。
    if (sourceVersion < 12) {
      for (const map of MAPS) {
        const official = (winnerTakesAllOfficial.maps as unknown as Partial<Record<string, OfficialModeMapData>>)[map.id]
        if (!official) continue
        const current = winner.maps[map.id] ?? modeMapFromOfficial(map.id, official)
        const builtin = modeMapFromOfficial(map.id, official)
        winner.maps[map.id] = {
          ...current,
          vehicleRefreshPoints: builtin.vehicleRefreshPoints,
          vehicleRefreshRules: builtin.vehicleRefreshRules,
          updatedAt: Date.now(),
        }
      }
    }
    // v14 更新“烬区·胜者为王”载具刷新信息：A/B 点共用同一刷新位置。
    // 仅替换刷新点和规则，保留该地图其他已有编辑。
    if (sourceVersion < 14) {
      const official = winnerTakesAllOfficial.maps.ember as unknown as OfficialModeMapData
      const current = winner.maps.ember ?? modeMapFromOfficial('ember', official)
      const builtin = modeMapFromOfficial('ember', official)
      winner.maps.ember = {
        ...current,
        vehicleRefreshPoints: builtin.vehicleRefreshPoints,
        vehicleRefreshRules: builtin.vehicleRefreshRules,
        updatedAt: Date.now(),
      }
    }
    // v15 修正“断层·胜者为王” S2 守方活动区的重复边界。
    // 只替换对应的阶段区域，不覆盖该地图的其他编辑内容。
    if (sourceVersion < 15) {
      const official = winnerTakesAllOfficial.maps.fault as unknown as OfficialModeMapData
      const current = winner.maps.fault ?? modeMapFromOfficial('fault', official)
      const builtin = modeMapFromOfficial('fault', official)
      const correctedZone = builtin.zones.find((zone) => zone.stageId === 'S2' && zone.role === 'defense-base')
      if (correctedZone) {
        const hasZone = current.zones.some((zone) => zone.stageId === 'S2' && zone.role === 'defense-base')
        winner.maps.fault = {
          ...current,
          zones: hasZone
            ? current.zones.map((zone) => zone.stageId === 'S2' && zone.role === 'defense-base' ? correctedZone : zone)
            : [...current.zones, correctedZone],
          updatedAt: Date.now(),
        }
      }
    }
    // v16 固化 2026-08-17“堑壕战·胜者为王”官方区域数据。
    if (sourceVersion < 16) {
      const official = winnerTakesAllOfficial.maps.trench as unknown as OfficialModeMapData
      winner.maps.trench = modeMapFromOfficial('trench', official)
    }
    // v17 固化 2026-08-17“断轨·胜者为王”官方数据。
    if (sourceVersion < 17) {
      const official = winnerTakesAllOfficial.maps.brokentrack as unknown as OfficialModeMapData
      winner.maps.brokentrack = modeMapFromOfficial('brokentrack', official)
    }
    // v19 固化 2026-08-21 导出的全部 11 张“胜者为王”地图数据。
    // 本轮是全量正式数据发布，统一替换旧内置地图，避免局部迁移遗留旧阶段、
    // 区域、复活点、道具、部署或载具刷新规则。
    if (sourceVersion < 19) {
      for (const map of MAPS) {
        const official = (winnerTakesAllOfficial.maps as unknown as Partial<Record<string, OfficialModeMapData>>)[map.id]
        if (!official) continue
        winner.maps[map.id] = modeMapFromOfficial(map.id, official)
      }
    }
    // v22 将胜者为王旧的数组序号型复活点 UID 迁移为固化稳定 UID。
    // 只替换内置复活点身份并补齐官方部署载具；用户改名、移动及自建元素均保留。
    if (sourceVersion < 22) {
      for (const map of MAPS) {
        const official = (winnerTakesAllOfficial.maps as unknown as Partial<Record<string, OfficialModeMapData>>)[map.id]
        if (!official) continue
        const builtin = modeMapFromOfficial(map.id, official)
        const current = winner.maps[map.id]
        if (!current) {
          winner.maps[map.id] = builtin
          continue
        }
        const usedBuiltin = new Set<string>()
        const migrated = current.spawns.map((spawn) => {
          const sameSideStage = builtin.spawns.filter((candidate) => candidate.stageId === spawn.stageId && candidate.side === spawn.side)
          const coordinateMatch = sameSideStage.find((candidate) => Math.abs(candidate.lat - spawn.lat) < 0.001 && Math.abs(candidate.lng - spawn.lng) < 0.001)
          const legacyIndex = spawn.uid.match(/(?:attack|defense)-spawn-(\d+)$/)?.[1]
          const indexMatch = legacyIndex == null ? undefined : sameSideStage[Number(legacyIndex)]
          const source = builtin.spawns.find((candidate) => candidate.uid === spawn.uid) ?? coordinateMatch ?? indexMatch
          if (!source) return spawn
          usedBuiltin.add(source.uid)
          const vehicleKeys = new Set(spawn.deployVehicles.map((vehicle) => `${vehicle.name}:${vehicle.icon}`))
          const missingVehicles = source.deployVehicles.filter((vehicle) => !vehicleKeys.has(`${vehicle.name}:${vehicle.icon}`))
          const deployVehicles = [...spawn.deployVehicles, ...missingVehicles.map((vehicle) => ({ ...vehicle }))]
          return {
            ...spawn,
            uid: source.uid,
            vehicleDeploy: spawn.vehicleDeploy || deployVehicles.length > 0,
            vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))],
            deployVehicles,
          }
        })
        const added = builtin.spawns.filter((spawn) => !usedBuiltin.has(spawn.uid))
        winner.maps[map.id] = {
          ...current,
          spawns: [...migrated, ...added.map((spawn) => ({ ...spawn, deployVehicles: spawn.deployVehicles.map((vehicle) => ({ ...vehicle })) }))],
          updatedAt: Date.now(),
        }
      }
    }
    // v23 固化 2026-08-23“攀升·胜者为王”新增的 8 个冲锋舟刷新点与规则。
    // 按稳定 UID 更新官方条目并追加缺失条目，同时保留用户自建的其他刷新数据。
    if (sourceVersion < 23) {
      const official = winnerTakesAllOfficial.maps.ascent as unknown as OfficialModeMapData
      const current = winner.maps.ascent ?? modeMapFromOfficial('ascent', official)
      const builtin = modeMapFromOfficial('ascent', official)
      const refreshPoints = new Map(current.vehicleRefreshPoints.map((point) => [point.uid, point]))
      const refreshRules = new Map(current.vehicleRefreshRules.map((rule) => [rule.uid, rule]))
      builtin.vehicleRefreshPoints.forEach((point) => refreshPoints.set(point.uid, point))
      builtin.vehicleRefreshRules.forEach((rule) => refreshRules.set(rule.uid, rule))
      winner.maps.ascent = {
        ...current,
        vehicleRefreshPoints: [...refreshPoints.values()],
        vehicleRefreshRules: [...refreshRules.values()],
        updatedAt: Date.now(),
      }
    }
    // v24 固化 2026-08-23“堑壕战·胜者为王”A 点占领区及 S1-S3 活动区范围。
    // 仅按稳定 UID 替换本次变更的官方区域，保留其他地图元素和用户自建区域。
    if (sourceVersion < 24) {
      const official = winnerTakesAllOfficial.maps.trench as unknown as OfficialModeMapData
      const current = winner.maps.trench ?? modeMapFromOfficial('trench', official)
      const builtin = modeMapFromOfficial('trench', official)
      const updatedZoneUids = new Set([
        'builtin_wta_trench_S1_front',
        'builtin_wta_trench_S1_attack-base',
        'builtin_wta_trench_S1_defense-base',
        'builtin_wta_trench_S1_capture-0',
        'builtin_wta_trench_S2_front',
        'builtin_wta_trench_S2_attack-base',
        'builtin_wta_trench_S2_defense-base',
        'builtin_wta_trench_S3_front',
        'builtin_wta_trench_S3_attack-base',
      ])
      const replacements = new Map(
        builtin.zones
          .filter((zone) => updatedZoneUids.has(zone.uid))
          .map((zone) => [zone.uid, zone]),
      )
      const zones = current.zones.map((zone) => replacements.get(zone.uid) ?? zone)
      const existingZoneUids = new Set(zones.map((zone) => zone.uid))
      replacements.forEach((zone, uid) => {
        if (!existingZoneUids.has(uid)) zones.push(zone)
      })
      winner.maps.trench = {
        ...current,
        zones,
        updatedAt: Date.now(),
      }
    }
    // v25 固化 2026-08-23“堑壕战·胜者为王”S4、S5 进攻方活动区。
    // 其余数据与上一版语义一致，仅替换本次变化的两个官方区域。
    if (sourceVersion < 25) {
      const official = winnerTakesAllOfficial.maps.trench as unknown as OfficialModeMapData
      const current = winner.maps.trench ?? modeMapFromOfficial('trench', official)
      const builtin = modeMapFromOfficial('trench', official)
      const updatedZoneUids = new Set([
        'builtin_wta_trench_S4_attack-base',
        'builtin_wta_trench_S5_attack-base',
      ])
      const replacements = new Map(
        builtin.zones
          .filter((zone) => updatedZoneUids.has(zone.uid))
          .map((zone) => [zone.uid, zone]),
      )
      const zones = current.zones.map((zone) => replacements.get(zone.uid) ?? zone)
      const existingZoneUids = new Set(zones.map((zone) => zone.uid))
      replacements.forEach((zone, uid) => {
        if (!existingZoneUids.has(uid)) zones.push(zone)
      })
      winner.maps.trench = {
        ...current,
        zones,
        updatedAt: Date.now(),
      }
    }
    // v26 固化 2026-08-27“烬区 / 堑壕战·胜者为王·PC端”完整单图数据。
    if (sourceVersion < 26) {
      for (const mapId of ['ember', 'trench'] as const) {
        const official = winnerTakesAllOfficial.maps[mapId] as unknown as OfficialModeMapData
        winner.maps[mapId] = modeMapFromOfficial(mapId, official)
      }
    }
    // v27 将胜者为王从单份 maps 深复制为 PC / PE 两套完全独立的数据。
    // 初次迁移两端内容相同；后续编辑、导入与固化均只改变所选数据端。
    if (sourceVersion < 27 || !winner.platformMaps?.pc || !winner.platformMaps?.mobile) {
      const pcSource = winner.platformMaps?.pc ?? winner.maps
      const mobileSource = winner.platformMaps?.mobile ?? pcSource
      const pcMaps = structuredClone(pcSource)
      const mobileMaps = structuredClone(mobileSource)
      winner.platformMaps = { ...winner.platformMaps, pc: pcMaps, mobile: mobileMaps }
      winner.maps = pcMaps
      winner.updatedAt = Date.now()
    } else {
      // maps 始终保持为 PC 兼容别名，避免旧调用误读 PE 数据。
      winner.maps = winner.platformMaps.pc
    }
    // v28 固化 2026-08-27“烬区·胜者为王·PE端”更新。
    // 只替换移动端烬区，PC 数据端以及移动端其他地图保持不变。
    if (sourceVersion < 28) {
      const official = mobileWinnerTakesAllOfficial.maps.ember as unknown as OfficialModeMapData
      const mobileMaps = winner.platformMaps?.mobile ?? structuredClone(winner.maps)
      mobileMaps.ember = modeMapFromOfficial('ember', official)
      winner.platformMaps = { ...winner.platformMaps, mobile: mobileMaps }
      winner.maps = winner.platformMaps.pc ?? winner.maps
      winner.updatedAt = Date.now()
    }
    // v29 仅更新“烬区·胜者为王·PE端”的 A 点刷新载具规则，
    // 保留用户在该地图上的其他编辑内容。
    if (sourceVersion < 29) {
      const official = mobileWinnerTakesAllOfficial.maps.ember as unknown as OfficialModeMapData
      const builtin = modeMapFromOfficial('ember', official)
      const mobileMaps = winner.platformMaps?.mobile ?? structuredClone(winner.maps)
      const current = mobileMaps.ember ?? builtin
      mobileMaps.ember = {
        ...current,
        vehicleRefreshRules: builtin.vehicleRefreshRules,
        updatedAt: Date.now(),
      }
      winner.platformMaps = { ...winner.platformMaps, mobile: mobileMaps }
      winner.maps = winner.platformMaps.pc ?? winner.maps
      winner.updatedAt = Date.now()
    }
    // v32 固化 2026-08-27“烬区·胜者为王·PE端”独立官方数据。
    // 完整替换该单图，包括胜者模式专属的载具刷新点与刷新规则。
    if (sourceVersion < 32) {
      const official = mobileWinnerTakesAllOfficial.maps.ember as unknown as OfficialModeMapData
      const mobileMaps = winner.platformMaps?.mobile ?? structuredClone(winner.maps)
      mobileMaps.ember = modeMapFromOfficial('ember', official)
      winner.platformMaps = { ...winner.platformMaps, mobile: mobileMaps }
      winner.maps = winner.platformMaps.pc ?? winner.maps
      winner.updatedAt = Date.now()
    }
  }
  return { version: MODE_STORAGE_VERSION, activeModeId, profiles }
}

/** 攻防与胜者为王均按游戏数据端隔离；自定义模式没有 platformMaps 时继续共用 maps。 */
export function modeUsesPlatformMaps(profile: Pick<GameModeProfile, 'id' | 'platformMaps'>): boolean {
  return profile.id === 'attack-defense' || profile.id === 'winner-takes-all' || Boolean(profile.platformMaps)
}

/** 统一获取指定游戏数据端的地图表，兼容尚未迁移的旧存储。 */
export function modeMapsForPlatform(
  profile: Pick<GameModeProfile, 'maps' | 'platformMaps'>,
  gameDataPlatform: GameDataPlatform,
): Record<string, ModeMapOverride> {
  return profile.platformMaps?.[gameDataPlatform] ?? profile.maps
}

export interface ModeConfigImportResult {
  store: ModeConfigStore
  profileId: string
  kind: 'backup' | 'official'
}

function mergeItemsByUid<T extends { uid: string }>(current: T[], incoming: T[]): T[] {
  const replacements = new Map(incoming.map((item) => [item.uid, item]))
  const merged = current.map((item) => replacements.get(item.uid) ?? item)
  const existingUids = new Set(merged.map((item) => item.uid))
  incoming.forEach((item) => {
    if (!existingUids.has(item.uid)) merged.push(item)
  })
  return merged
}

function mergeImportedMaps(
  current: Record<string, ModeMapOverride>,
  incoming: Record<string, ModeMapOverride>,
  zonesOnly: boolean,
): Record<string, ModeMapOverride> {
  const maps = { ...current }
  for (const [mapId, imported] of Object.entries(incoming)) {
    const existing = current[mapId]
    maps[mapId] = existing && zonesOnly
      ? {
          ...existing,
          zones: mergeItemsByUid(existing.zones, imported.zones),
          updatedAt: Date.now(),
        }
      : imported
  }
  return maps
}

/**
 * 同时接收编辑器完整备份与“导出正式数据”文件。
 * 正式数据只更新文件中包含的模式/地图；攻防数据写入当前选择的数据端。
 */
export function importModeConfigData(
  currentStore: ModeConfigStore,
  value: unknown,
  gameDataPlatform: GameDataPlatform = 'pc',
): ModeConfigImportResult | null {
  const backup = normalizeModeConfigStore(value)
  if (backup) {
    return {
      store: backup,
      profileId: backup.profiles[0]?.id ?? 'attack-defense',
      kind: 'backup',
    }
  }

  if (!value || typeof value !== 'object') return null
  const source = value as {
    format?: unknown
    importScope?: unknown
    mode?: { id?: unknown; name?: unknown; description?: unknown }
    maps?: unknown
  }
  if (
    source.format !== 'deltaforce-map-mode'
    || !source.mode
    || typeof source.mode.id !== 'string'
    || !source.mode.id.trim()
    || typeof source.mode.name !== 'string'
    || !source.maps
    || typeof source.maps !== 'object'
    || Array.isArray(source.maps)
  ) return null

  const importedMaps: Record<string, ModeMapOverride> = {}
  try {
    for (const map of MAPS) {
      const rawMap = (source.maps as Record<string, unknown>)[map.id]
      if (rawMap == null) continue
      if (!rawMap || typeof rawMap !== 'object') return null
      const official = rawMap as Partial<OfficialModeMapData>
      if (!Array.isArray(official.stages) || !Array.isArray(official.props) || !official.deploy || typeof official.deploy !== 'object') return null
      importedMaps[map.id] = modeMapFromOfficial(map.id, official as OfficialModeMapData)
    }
  } catch {
    return null
  }
  if (Object.keys(importedMaps).length === 0) return null

  const now = Date.now()
  const zonesOnly = source.importScope === 'zones'
  const profileId = source.mode.id.trim()
  const existing = currentStore.profiles.find((profile) => profile.id === profileId)
  let importedProfile: GameModeProfile
  if (profileId === 'attack-defense' || profileId === 'winner-takes-all') {
    const base = existing ?? createModeProfile(source.mode.name.trim() || '攻防模式', profileId)
    const pcMaps = base.platformMaps?.pc ?? base.maps
    const mobileMaps = base.platformMaps?.mobile ?? structuredClone(base.maps)
    const targetMaps = mergeImportedMaps(
      gameDataPlatform === 'pc' ? pcMaps : mobileMaps,
      importedMaps,
      zonesOnly,
    )
    importedProfile = {
      ...base,
      name: source.mode.name.trim() || base.name,
      description: typeof source.mode.description === 'string' ? source.mode.description : base.description,
      maps: gameDataPlatform === 'pc' ? targetMaps : pcMaps,
      platformMaps: {
        ...base.platformMaps,
        pc: gameDataPlatform === 'pc' ? targetMaps : pcMaps,
        mobile: gameDataPlatform === 'mobile' ? targetMaps : mobileMaps,
      },
      updatedAt: now,
    }
  } else {
    const base = existing ?? createModeProfile(source.mode.name.trim() || '未命名模式', profileId)
    importedProfile = {
      ...base,
      name: source.mode.name.trim() || base.name,
      description: typeof source.mode.description === 'string' ? source.mode.description : base.description,
      maps: mergeImportedMaps(base.maps, importedMaps, zonesOnly),
      updatedAt: now,
    }
  }

  const profiles = existing
    ? currentStore.profiles.map((profile) => profile.id === profileId ? importedProfile : profile)
    : [...currentStore.profiles, importedProfile]
  return {
    store: { ...currentStore, version: MODE_STORAGE_VERSION, profiles },
    profileId,
    kind: 'official',
  }
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
export function buildOfficialModeData(
  profile: GameModeProfile,
  gameDataPlatform: GameDataPlatform = 'pc',
  mapId?: string,
) {
  const maps: Record<string, {
    stages: StageConfig[]
    props: MapProp[]
    deploy: Record<string, StageDeploy>
    vehicleRefreshPoints: Omit<ModeVehicleRefreshPoint, 'verification'>[]
    vehicleRefreshRules: Omit<ModeVehicleRefreshRule, 'verification'>[]
  }> = {}

  const targetMaps = mapId ? MAPS.filter((map) => map.id === mapId) : MAPS
  for (const map of targetMaps) {
    const profileMaps = modeMapsForPlatform(profile, gameDataPlatform)
    const config = profileMaps[map.id] ?? emptyModeMapOverride(map.id)
    const baseStages = stagesForPlatform(gameDataPlatform)[map.id] ?? []
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
        spawns: [...attackSpawns, ...defenseSpawns].map((spawn) => ({
          uid: spawn.uid,
          stageId: definition.id,
          name: spawn.name,
          side: spawn.side,
          lat: spawn.lat,
          lng: spawn.lng,
        })),
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
        .flatMap((spawn) => spawn.deployVehicles.map((vehicle) => ({ ...vehicle, spawnUid: spawn.uid, note: spawn.name })))
      deploy[stage.id] = { attack: entries('attack'), defense: entries('defense') }
    }

    maps[map.id] = {
      stages,
      props: config.props.map((prop) => ({
        name: prop.name,
        icon: prop.icon,
        lat: prop.lat,
        lng: prop.lng,
        stage: '',
      })),
      deploy,
      vehicleRefreshPoints: config.vehicleRefreshPoints.map(({ verification: _verification, ...point }) => point),
      vehicleRefreshRules: config.vehicleRefreshRules.map(({ verification: _verification, ...rule }) => ({
        ...rule,
        trigger: { ...rule.trigger },
        vehicle: { ...rule.vehicle },
      })),
    }
  }

  return {
    format: 'deltaforce-map-mode',
    schemaVersion: 1,
    mode: { id: profile.id, name: profile.name, description: profile.description },
    maps,
  }
}
