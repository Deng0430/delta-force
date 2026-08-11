import type { BuildingUnitKind } from '../types'
import { POINT_ICON_BASE } from './points'

export interface BuildingUnitConfig {
  kind: BuildingUnitKind
  name: string
  iconKey: string
  iconUrl: string
  description: string
  accent: string
}

const createBuilding = (kind: BuildingUnitKind, name: string, iconKey: string, description: string, accent: string): BuildingUnitConfig => ({
  kind,
  name,
  iconKey,
  iconUrl: `${POINT_ICON_BASE}/${iconKey}.png`,
  description,
  accent,
})

export const BUILDING_UNIT_OPTIONS: BuildingUnitConfig[] = [
  createBuilding('fixed-machine-gun', '固定机枪', 'q_gdjq', '压制步兵与轻型目标', '#f08c2a'),
  createBuilding('fixed-anti-air', '固定防空炮', 'q_gdaap', '防御低空航空单位', '#e0453a'),
  createBuilding('coastal-gun', '岸防炮', 'q_afp', '封锁岸线与水上通道', '#d63f3f'),
]

export function buildingUnitOf(kind: BuildingUnitKind): BuildingUnitConfig {
  return BUILDING_UNIT_OPTIONS.find((item) => item.kind === kind) ?? BUILDING_UNIT_OPTIONS[0]
}
