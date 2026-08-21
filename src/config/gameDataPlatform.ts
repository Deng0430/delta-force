import type { MapProp, StageConfig, StageVehicle } from '../types'
import { STAGES_BY_MAP } from './points'
import { MAP_PROPS } from './pointsStages'
import { MOBILE_OFFICIAL_DATA } from './mobileOfficialData'
import mobileAttackDefenseOfficial from './mobileAttackDefenseOfficial.json'
import { DEPLOY_BY_MAP, type StageDeploy } from './deployVehicles'

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
        attackSpawnNames: patch.attackSpawnNames.map((name) => name ?? '') as string[],
        defenseSpawns: patch.defenseSpawns as unknown as [number, number][],
        defenseSpawnNames: patch.defenseSpawnNames.map((name) => name ?? '') as string[],
        attackBaseZone: patch.attackBaseZone as unknown as [number, number][],
        defenseBaseZone: patch.defenseBaseZone as unknown as [number, number][],
        attackVehicles: mergeVehicles(base.attackVehicles, patch.vehicles as unknown as MobileVehiclePatch[]),
        defenseVehicles: base.defenseVehicles,
      }
    })
  }
  for (const [mapId, map] of Object.entries(mobileAttackDefenseOfficial.maps)) {
    result[mapId] = map.stages as unknown as StageConfig[]
  }
  return result
}

export const MOBILE_STAGES_BY_MAP = buildMobileStages()
export const MOBILE_MAP_PROPS: Record<string, MapProp[]> = {
  ...MAP_PROPS,
  ...(MOBILE_OFFICIAL_DATA.props as unknown as Record<string, MapProp[]>),
  ...Object.fromEntries(Object.entries(mobileAttackDefenseOfficial.maps).map(([mapId, map]) => [mapId, map.props])) as Record<string, MapProp[]>,
}

const MOBILE_DEPLOY_BY_MAP = Object.fromEntries(
  Object.entries(mobileAttackDefenseOfficial.maps).map(([mapId, map]) => [mapId, map.deploy]),
) as unknown as Record<string, Record<string, StageDeploy>>

export function stagesForPlatform(platform: GameDataPlatform): Record<string, StageConfig[]> {
  return platform === 'mobile' ? MOBILE_STAGES_BY_MAP : STAGES_BY_MAP
}

export function propsForPlatform(platform: GameDataPlatform): Record<string, MapProp[]> {
  return platform === 'mobile' ? MOBILE_MAP_PROPS : MAP_PROPS
}

export function deployForPlatform(platform: GameDataPlatform): Record<string, Record<string, StageDeploy>> {
  return platform === 'mobile' ? MOBILE_DEPLOY_BY_MAP : DEPLOY_BY_MAP
}
