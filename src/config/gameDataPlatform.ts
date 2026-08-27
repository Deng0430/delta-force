import type { MapProp, StageConfig, StageVehicle } from '../types'
import { STAGES_BY_MAP } from './points'
import { MAP_PROPS } from './pointsStages'
import { MOBILE_OFFICIAL_DATA } from './mobileOfficialData'
import mobileAttackDefenseOfficial from './mobileAttackDefenseOfficial.json'
import mobilePcParitySnapshot from './mobilePcParitySnapshot.json'
import mobileDeploySnapshot from './mobileDeploySnapshot.json'
import pcAttackDefenseOfficial from './pcAttackDefenseOfficial.json'
import { DEPLOY_BY_MAP, localDeployIconUrl, type DeployVehicleEntry, type StageDeploy } from './deployVehicles'
import { vehicleLegendAssetUrl } from './vehicleLegendAssets'
import { normalizeAttackDefenseData } from './attackDefenseSpawns'

export type GameDataPlatform = 'pc' | 'mobile'

type MobileVehiclePatch = {
  name: string
  icon: string
  trigger: string
  positions: [number, number][]
}

function mergeVehicles(base: StageVehicle[], patches: MobileVehiclePatch[]): StageVehicle[] {
  return patches.map((patch) => {
    const template = base.find((vehicle) => vehicle.icon === patch.icon || vehicle.name === patch.name)
    return {
      name: patch.name,
      badge: template?.badge ?? patch.name.slice(0, 1),
      category: template?.category ?? 'recon',
      icon: patch.icon,
      trigger: patch.trigger,
      pos: patch.positions[0] ?? template?.pos ?? [0, 0],
      posList: patch.positions,
    }
  })
}

function buildMobileStages(): Record<string, StageConfig[]> {
  const result: Record<string, StageConfig[]> = { ...STAGES_BY_MAP }
  for (const [mapId, patches] of Object.entries(MOBILE_OFFICIAL_DATA.maps)) {
    const baseStages = STAGES_BY_MAP[mapId] ?? []
    result[mapId] = patches.map((patch, index) => {
      const base = baseStages[index]
      if (!base) throw new Error(`Missing PC stage template for ${mapId} S${index + 1}`)
      return {
        ...base,
        points: patch.points as unknown as StageConfig['points'],
        zone: patch.zone ? { name: `${mapId} ${patch.id} 防线`, latlngs: patch.zone.latlngs as unknown as [number, number][] } : null,
        attackSpawns: patch.attackSpawns as unknown as [number, number][],
        // 移动端抓取数据中部分地图（如临界点）的复活点名称为空；部署表按
        // 复活点名称关联载具，此处必须回退 PC 模板中的同位置名称。
        attackSpawnNames: patch.attackSpawns.map((_, spawnIndex) => (
          patch.attackSpawnNames[spawnIndex]?.trim() || base.attackSpawnNames?.[spawnIndex] || ''
        )) as string[],
        defenseSpawns: patch.defenseSpawns as unknown as [number, number][],
        defenseSpawnNames: patch.defenseSpawns.map((_, spawnIndex) => (
          patch.defenseSpawnNames[spawnIndex]?.trim() || base.defenseSpawnNames?.[spawnIndex] || ''
        )) as string[],
        attackBaseZone: patch.attackBaseZone as unknown as [number, number][],
        defenseBaseZone: patch.defenseBaseZone as unknown as [number, number][],
        attackVehicles: mergeVehicles(base.attackVehicles, patch.vehicles as unknown as MobileVehiclePatch[]),
        defenseVehicles: base.defenseVehicles,
      }
    })
  }
  for (const [mapId, snapshot] of Object.entries(mobilePcParitySnapshot.maps)) {
    result[mapId] = structuredClone(snapshot.stages) as unknown as StageConfig[]
  }
  for (const [mapId, map] of Object.entries(mobileAttackDefenseOfficial.maps)) {
    result[mapId] = map.stages as unknown as StageConfig[]
  }
  return result
}

const RAW_MOBILE_STAGES_BY_MAP = buildMobileStages()
const PC_OFFICIAL_MAPS = pcAttackDefenseOfficial.maps as unknown as Record<string, {
  stages: StageConfig[]
  props: MapProp[]
  deploy: Record<string, StageDeploy>
}>
const RAW_PC_STAGES_BY_MAP: Record<string, StageConfig[]> = {
  ...STAGES_BY_MAP,
  ...Object.fromEntries(Object.entries(PC_OFFICIAL_MAPS).map(([mapId, map]) => [mapId, structuredClone(map.stages)])),
}
const PC_MAP_PROPS: Record<string, MapProp[]> = {
  ...MAP_PROPS,
  ...Object.fromEntries(Object.entries(PC_OFFICIAL_MAPS).map(([mapId, map]) => [mapId, structuredClone(map.props)])),
}
const RAW_PC_DEPLOY_BY_MAP: Record<string, Record<string, StageDeploy>> = {
  ...DEPLOY_BY_MAP,
  ...Object.fromEntries(Object.entries(PC_OFFICIAL_MAPS).map(([mapId, map]) => [mapId, structuredClone(map.deploy)])),
}
export const MOBILE_MAP_PROPS: Record<string, MapProp[]> = {
  ...MAP_PROPS,
  ...(MOBILE_OFFICIAL_DATA.props as unknown as Record<string, MapProp[]>),
  ...Object.fromEntries(Object.entries(mobilePcParitySnapshot.maps).map(([mapId, snapshot]) => [mapId, structuredClone(snapshot.props)])) as Record<string, MapProp[]>,
  ...Object.fromEntries(Object.entries(mobileAttackDefenseOfficial.maps).map(([mapId, map]) => [mapId, map.props])) as Record<string, MapProp[]>,
}

type SnapshotDeployEntry = Omit<DeployVehicleEntry, 'iconUrl' | 'spawnUid'>

function snapshotIconUrl(entry: SnapshotDeployEntry): string {
  const direct = vehicleLegendAssetUrl(entry.icon)
  if (direct) return direct
  if (entry.legendKey) {
    const legend = vehicleLegendAssetUrl(entry.legendKey.replace(/^nav_/, ''))
    if (legend) return legend
  }
  return localDeployIconUrl(entry.icon)
}

const SNAPSHOT_MOBILE_DEPLOY = Object.fromEntries(
  Object.entries(mobileDeploySnapshot.maps).map(([mapId, deploy]) => [mapId,
    Object.fromEntries(Object.entries(deploy).map(([stageId, stage]) => [stageId, {
      attack: stage.attack.map((entry) => ({ ...entry, iconUrl: snapshotIconUrl(entry as SnapshotDeployEntry) })),
      defense: stage.defense.map((entry) => ({ ...entry, iconUrl: snapshotIconUrl(entry as SnapshotDeployEntry) })),
    }])) as Record<string, StageDeploy>,
  ]),
) as Record<string, Record<string, StageDeploy>>

// 所有非烬区地图均由独立移动端部署快照覆盖；烬区随后由官方手游 JSON 覆盖。
// 保留 DEPLOY_BY_MAP 作为未来新增地图的安全兜底，不影响现有地图的数据隔离。
const MOBILE_DEPLOY_BY_MAP: Record<string, Record<string, StageDeploy>> = {
  ...DEPLOY_BY_MAP,
  ...SNAPSHOT_MOBILE_DEPLOY,
  ...Object.fromEntries(
    Object.entries(mobileAttackDefenseOfficial.maps).map(([mapId, map]) => [mapId, map.deploy]),
  ) as unknown as Record<string, Record<string, StageDeploy>>,
}

const PC_ATTACK_DEFENSE_DATA = normalizeAttackDefenseData('pc', RAW_PC_STAGES_BY_MAP, RAW_PC_DEPLOY_BY_MAP)
const MOBILE_ATTACK_DEFENSE_DATA = normalizeAttackDefenseData('mobile', RAW_MOBILE_STAGES_BY_MAP, MOBILE_DEPLOY_BY_MAP)

/** 已补齐统一复活点 UID 的移动端攻防阶段。 */
export const MOBILE_STAGES_BY_MAP = MOBILE_ATTACK_DEFENSE_DATA.stages

export function stagesForPlatform(platform: GameDataPlatform): Record<string, StageConfig[]> {
  return platform === 'mobile' ? MOBILE_STAGES_BY_MAP : PC_ATTACK_DEFENSE_DATA.stages
}

export function propsForPlatform(platform: GameDataPlatform): Record<string, MapProp[]> {
  return platform === 'mobile' ? MOBILE_MAP_PROPS : PC_MAP_PROPS
}

export function deployForPlatform(platform: GameDataPlatform): Record<string, Record<string, StageDeploy>> {
  return platform === 'mobile' ? MOBILE_ATTACK_DEFENSE_DATA.deploy : PC_ATTACK_DEFENSE_DATA.deploy
}
