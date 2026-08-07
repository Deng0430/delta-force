/**
 * 兵棋推演：干员职业与队伍配置
 * 职业体系参考三角洲行动官方干员分类（突击/工程/侦察/支援）。
 * 图标来源：官网接口 dfm/operator.list 返回的 armyTypePic（官方职业图标），
 * 已下载至 public/icons/operators/cls_*.png。
 */
import type { OperatorClass, OperatorTeam } from '../types'
import { defaultProfileForTeam, profileOf } from './operatorProfiles'

/** 职业配置 */
export interface OperatorClassConfig {
  id: OperatorClass
  name: string
  /** 官方职业图标 URL（本地化） */
  iconUrl: string
  /** 卡片徽标（图标加载失败兜底） */
  badge: string
  /** 职业标识色（用于图标底色/描边） */
  color: string
  desc: string
}

/** 职业图标本地路径（下载自官网 playerhub.df.qq.com，官方 armyTypePic） */
const CLS_ICON_BASE = '/icons/operators'

export const OPERATOR_CLASSES: OperatorClassConfig[] = [
  { id: 'assault', name: '突击', iconUrl: `${CLS_ICON_BASE}/cls_assault.png`, badge: '突', color: '#e0453a', desc: '正面火力、突破防线' },
  { id: 'engineer', name: '工程', iconUrl: `${CLS_ICON_BASE}/cls_engineer.png`, badge: '工', color: '#f4cf67', desc: '装备支援、设施破坏' },
  // 官方职业为"支援"（医疗/治疗），模型字段沿用 medical
  { id: 'medical', name: '医疗', iconUrl: `${CLS_ICON_BASE}/cls_support.png`, badge: '医', color: '#01ff84', desc: '治疗、复活队友' },
  { id: 'recon', name: '侦察', iconUrl: `${CLS_ICON_BASE}/cls_recon.png`, badge: '侦', color: '#3f8cff', desc: '情报收集、目标标记' },
]

export function operatorClassOf(cls: OperatorClass): OperatorClassConfig {
  return OPERATOR_CLASSES.find((c) => c.id === cls) ?? OPERATOR_CLASSES[0]
}

/** 队伍配置（每方 A-E 五个队）；desc 为默认小队作用（可编辑） */
export interface TeamConfig {
  id: OperatorTeam
  name: string
  color: string
  /** 默认小队作用（左侧可编辑，存于 wargame.teamRoles） */
  desc: string
}

export const TEAMS: TeamConfig[] = [
  { id: 'A', name: 'A队', color: '#e0453a', desc: '主力突破' },
  { id: 'B', name: 'B队', color: '#3f8cff', desc: '侧翼支援' },
  // C队原为绿色 #01ff84（与我方阵营色冲突），后改橙色（近D黄）、粉色（近E紫）、青色（近B蓝），现用白色
  { id: 'C', name: 'C队', color: '#f2f4f8', desc: '掩护佯攻' },
  { id: 'D', name: 'D队', color: '#f4cf67', desc: '火力压制' },
  { id: 'E', name: 'E队', color: '#c77dff', desc: '机动预备' },
]

export function teamOf(id: OperatorTeam): TeamConfig {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0]
}

/** 每队干员人数 */
export const TEAM_SIZE = 4

/**
 * 生成一个视角场景的完整兵棋干员列表（40 人 = 我方 20 + 敌方 20）：
 * 数据存储在设计上"按视角分桶"——operators.attack 桶 = 攻方视角场景（攻方我方 + 守方敌方），
 * operators.defense 桶 = 守方视角场景（守方我方 + 攻方敌方）。
 * 两方都部署在同一场景内形成红蓝对抗；uid 以干员自身阵营为前缀（同桶内唯一）。
 */
export function buildDefaultOperators(side: 'attack' | 'defense'): {
  uid: string
  name: string
  side: 'attack' | 'defense'
  team: OperatorTeam
  operatorId: string
  cls: OperatorClass
  status: 'alive' | 'injured' | 'killed'
  lat: number | null
  lng: number | null
}[] {
  const out: {
    uid: string
    name: string
    side: 'attack' | 'defense'
    team: OperatorTeam
    operatorId: string
    cls: OperatorClass
    status: 'alive' | 'injured' | 'killed'
    lat: number | null
    lng: number | null
  }[] = []
  // 本场景两方：我方 = side，敌方 = 对立方
  const sides: ('attack' | 'defense')[] = [side, side === 'attack' ? 'defense' : 'attack']
  for (const s of sides) {
    for (const team of TEAMS) {
      // 该队默认干员档案（红狼/蜂医/银翼/乌鲁鲁/威龙），同队 4 个槽位共用同一干员
      const pid = defaultProfileForTeam(team.id)
      const profile = profileOf(pid)
      for (let i = 1; i <= TEAM_SIZE; i++) {
        out.push({
          uid: `${s}_${team.id}${i}`,
          name: `${team.id}${i}`,
          side: s,
          team: team.id,
          operatorId: pid,
          cls: profile.cls,
          status: 'alive',
          lat: null,
          lng: null,
        })
      }
    }
  }
  return out
}
