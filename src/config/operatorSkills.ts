export type OperatorSkillSlot = 1 | 2 | 3 | 4
export type OperatorSkillKind = 'ultimate' | 'gadget' | 'passive'
export type SkillPlacementMode = 'self' | 'target-point' | 'area' | 'trajectory' | 'guided-path' | 'target-unit' | 'ally-unit'

export interface OperatorSkillDefinition {
  slot: OperatorSkillSlot
  name: string
  iconUrl: string
  kind: OperatorSkillKind
  placementMode?: SkillPlacementMode
  effectArea?: boolean
  canBindTarget?: boolean
  tracking?: boolean
  sector?: boolean
}

type SkillSpec = Omit<OperatorSkillDefinition, 'slot' | 'iconUrl'>
const S = (name: string, kind: OperatorSkillKind, placementMode?: SkillPlacementMode, extra: Partial<SkillSpec> = {}): SkillSpec => ({ name, kind, ...(placementMode ? { placementMode } : {}), ...extra })

const SKILLS: Record<string, [SkillSpec, SkillSpec, SkillSpec, SkillSpec]> = {
  '10016': [S('情报探测','ultimate','area'), S('飞行闪光弹','gadget','guided-path'), S('数据飞刀','gadget','trajectory'), S('被动技能','passive')],
  '10007': [S('范围打击','ultimate','trajectory',{effectArea:true}), S('定向位移','gadget','self'), S('反载爆炸物','gadget','target-unit'), S('被动技能','passive')],
  '10017': [S('巡飞弹','ultimate','guided-path',{canBindTarget:true,tracking:true}), S('速凝掩体','gadget','target-point'), S('燃烧弹','gadget','trajectory',{effectArea:true}), S('被动技能','passive')],
  '10006': [S('探测箭','ultimate','trajectory',{effectArea:true}), S('电击箭','gadget','trajectory'), S('投掷手雷','gadget','trajectory'), S('被动技能','passive')],
  '10001': [S('强化或治疗队友','ultimate','ally-unit'), S('长烟','gadget','guided-path',{effectArea:true}), S('投掷烟雾弹','gadget','trajectory',{effectArea:true}), S('被动技能','passive')],
  '10000': [S('动力外骨骼强化','ultimate','self'), S('榴弹','gadget','trajectory',{effectArea:true}), S('投掷烟雾弹','gadget','trajectory',{effectArea:true}), S('被动技能','passive')],
  '10002': [S('声波压制区域','ultimate','area'), S('放置装置','gadget','target-point'), S('投掷手雷','gadget','trajectory',{effectArea:true}), S('被动技能','passive')],
  '10018': [S('被动技能','passive'), S('烟雾弹','gadget','trajectory',{effectArea:true}), S('自我增益','gadget','self'), S('飞行虫群','ultimate','trajectory',{effectArea:true})],
  '10019': [S('被动技能','passive'), S('护盾','ultimate','self'), S('钩爪拉拽干员','gadget','ally-unit'), S('投掷铁丝网','gadget','trajectory',{effectArea:true})],
  '10020': [S('被动技能','passive'), S('投掷飞盘','gadget','trajectory'), S('投掷闪光弹','gadget','trajectory'), S('静默脚步','ultimate','self')],
  '10021': [S('被动技能','passive'), S('定向位移','gadget','self'), S('投掷型电刺','gadget','trajectory'), S('锚点','ultimate','target-point')],
  '10022': [S('被动技能','passive'), S('干员侦察','gadget','target-unit'), S('飞行无人机侦察','gadget','guided-path',{effectArea:true}), S('电磁干扰弹','gadget','trajectory',{effectArea:true})],
  '10023': [S('烟雾地雷','gadget','target-point'), S('小蜘蛛陷阱','gadget','target-point'), S('被动技能','passive'), S('自动寻敌蜘蛛','ultimate','guided-path',{tracking:true})],
  '10024': [S('群体治疗/支援区域','ultimate','area'), S('治疗烟雾','gadget','ally-unit',{effectArea:true}), S('投掷烟雾弹','gadget','trajectory',{effectArea:true}), S('救援/复活','gadget','ally-unit')],
  '10025': [S('投掷干扰弹','gadget','trajectory'), S('投掷闪光弹','gadget','trajectory'), S('扇形区域侦察','ultimate','area',{sector:true}), S('被动技能','passive')],
  '10026': [S('被动技能','passive'), S('寒霜榴弹','ultimate','trajectory',{effectArea:true}), S('冷罐','gadget','trajectory'), S('追踪震撼弹','gadget','trajectory',{tracking:true})],
}

/** 本地技能图标与已确认的战术部署元数据。 */
export function operatorSkillsOf(operatorId: string): OperatorSkillDefinition[] {
  const specs = SKILLS[operatorId]
  return ([1, 2, 3, 4] as const).map((slot) => ({
    slot,
    ...(specs?.[slot - 1] ?? S(`技能 ${slot}`, 'gadget')),
    iconUrl: `/icons/operators/skills/${operatorId}/skill_${slot}.png`,
  }))
}
