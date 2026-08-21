import type { FieldSupportDefinition } from '../types'

const BASE = '/icons/field-supports'

/** 胜者为王地图工具中提供的阵地支援资源。 */
export const FIELD_SUPPORTS: FieldSupportDefinition[] = [
  { id: 'guided-missile', name: '制导导弹', iconUrl: `${BASE}/deploy_zddd.png`, description: '指定位置的精确打击', defaultRadius: 70 },
  { id: 'strategic-beacon', name: '战略信标', iconUrl: `${BASE}/deploy_zlxb.png`, description: '部署战略信标', defaultRadius: 48 },
  { id: 'artillery-salvo', name: '炮兵齐发', iconUrl: `${BASE}/deploy_pbqf.png`, description: '对区域进行炮火覆盖', defaultRadius: 95 },
  { id: 'smoke-cover', name: '烟幕覆盖', iconUrl: `${BASE}/deploy_ymfg.png`, description: '在区域内生成烟幕', defaultRadius: 85 },
  { id: 'vehicle-airdrop', name: '载具空投', iconUrl: `${BASE}/deploy_clkt.png`, description: '向指定位置空投载具支援', defaultRadius: 48 },
]

export function fieldSupportOf(id: string): FieldSupportDefinition | undefined {
  return FIELD_SUPPORTS.find((item) => item.id === id)
}
