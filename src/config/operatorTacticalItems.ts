import type { OperatorClass } from '../types'
import type { SkillPlacementMode } from './operatorSkills'

export type TacticalItemUseType = 'carry' | 'self' | 'placement' | 'launcher' | 'target'

export interface TacticalItemUseMode {
  type: TacticalItemUseType
  label: string
  placementMode: SkillPlacementMode
}

export interface OperatorTacticalItemDefinition {
  id: string
  name: string
  operatorClass: OperatorClass
  iconUrl: string
  useTypes: TacticalItemUseType[]
  modes: TacticalItemUseMode[]
  effectArea?: boolean
}

const BASE = '/icons/operators/tactical-items'
const mode = (type: TacticalItemUseType, label: string, placementMode: SkillPlacementMode): TacticalItemUseMode => ({ type, label, placementMode })
const item = (
  operatorClass: OperatorClass,
  id: string,
  name: string,
  file: string,
  modes: TacticalItemUseMode[],
  effectArea = false,
): OperatorTacticalItemDefinition => {
  const carry = mode('carry', '携带', 'self')
  const functionalModes = modes.filter((entry) => entry.type !== 'self')
  return {
    operatorClass,
    id,
    name,
    iconUrl: `${BASE}/${file}`,
    useTypes: [...new Set(modes.map((entry) => entry.type))],
    modes: [carry, ...functionalModes],
    effectArea,
  }
}

export const OPERATOR_TACTICAL_ITEMS: OperatorTacticalItemDefinition[] = [
  item('assault', 'assault-armor-plate', '护甲板', 'assault-armor-plate.png', [mode('self', '对自己使用', 'self')]),
  item('assault', 'assault-recovery-injector', '恢复针剂', 'assault-recovery-injector.png', [mode('self', '对自己使用', 'self')]),
  item('assault', 'assault-anti-personnel-grenade', '反人员榴弹', 'assault-anti-personnel-grenade.png', [mode('launcher', '发射', 'trajectory')], true),
  item('assault', 'assault-emp-grenade', 'EMP榴弹', 'assault-emp-grenade.png', [mode('launcher', '发射', 'trajectory')], true),
  item('assault', 'assault-high-explosive-launcher', '高爆榴弹发射器', 'assault-high-explosive-launcher.png', [mode('launcher', '发射', 'trajectory')], true),
  item('assault', 'assault-flamethrower', '喷火器', 'assault-flamethrower.png', [mode('launcher', '喷射', 'trajectory')], true),

  item('engineer', 'engineer-at-mine', '反坦克地雷', 'engineer-at-mine.png', [mode('placement', '放置', 'target-point')]),
  item('engineer', 'engineer-ads', 'ADS近防系统', 'engineer-ads.png', [mode('placement', '放置', 'target-point')], true),
  item('engineer', 'engineer-welding-torch', '焊枪', 'engineer-welding-torch.png', [mode('target', '指定对象', 'target-point')]),
  item('engineer', 'engineer-flamethrower', '喷火器', 'engineer-flamethrower.png', [mode('launcher', '喷射', 'trajectory')], true),
  item('engineer', 'engineer-at4', 'AT-4发射器', 'engineer-at4.png', [mode('launcher', '发射', 'trajectory')], true),
  item('engineer', 'engineer-javelin', '标枪发射器', 'engineer-javelin.png', [mode('launcher', '发射', 'guided-path'), mode('target', '标记目标', 'target-point')], true),
  item('engineer', 'engineer-stinger', '毒刺发射器', 'engineer-stinger.png', [mode('launcher', '发射', 'guided-path'), mode('target', '标记目标', 'target-point')], true),
  item('engineer', 'engineer-wire-guided-missile', '线控导弹发射器', 'engineer-wire-guided-missile.png', [mode('launcher', '发射', 'guided-path')], true),

  item('medical', 'medical-med-pack', '医疗包', 'medical-med-pack.png', [mode('self', '对自己使用', 'self'), mode('target', '交给队友', 'ally-unit')]),
  item('medical', 'medical-ammo-pack', '弹药包', 'medical-ammo-pack.png', [mode('self', '对自己使用', 'self'), mode('target', '交给队友', 'ally-unit')]),
  item('medical', 'medical-ammo-crate', '弹药箱', 'medical-ammo-crate.png', [mode('placement', '放置', 'target-point')], true),
  item('medical', 'medical-med-crate', '医疗箱', 'medical-med-crate.png', [mode('placement', '放置', 'target-point')], true),
  item('medical', 'medical-smoke-launcher', '烟雾榴弹发射器', 'medical-smoke-launcher.png', [mode('launcher', '发射', 'trajectory')], true),

  item('recon', 'recon-claymore', '阔剑地雷', 'recon-claymore.png', [mode('placement', '放置', 'target-point')]),
  item('recon', 'recon-beacon', '侦察信标', 'recon-beacon.png', [mode('placement', '放置', 'target-point')], true),
  item('recon', 'recon-laser-designator', '镭射指示器', 'recon-laser-designator.png', [mode('target', '指定目标', 'target-point')]),
]

export function tacticalItemsOf(operatorClass: OperatorClass): OperatorTacticalItemDefinition[] {
  return OPERATOR_TACTICAL_ITEMS.filter((entry) => entry.operatorClass === operatorClass)
}

export const TACTICAL_ITEM_TYPE_LABEL: Record<TacticalItemUseType, string> = {
  carry: '携带',
  self: '自用',
  placement: '放置',
  launcher: '发射',
  target: '对象',
}
