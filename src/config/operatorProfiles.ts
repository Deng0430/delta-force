/**
 * 干员档案库：来源于官网接口 dfm/operator.list（用户提供，已登录抓取）。
 * 包含全部 16 名干员的代号、本名、职业、头像。
 * 兵棋推演中每个干员槽位可选择具体干员（如 红狼 → 蜂医），职业随干员自动变化。
 */
import type { OperatorClass } from '../types'

export interface OperatorProfile {
  /** 干员 id（官网 id 字段） */
  id: string
  /** 干员代号（游戏内名称，如 红狼/蜂医） */
  name: string
  /** 本名（如 凯·席尔瓦） */
  fullName: string
  /** 职业（突击/工程/侦察/支援 → 模型 medical 对应官方"支援"） */
  cls: OperatorClass
  /** 头像本地路径（下载自 playerhub.df.qq.com 并压缩为 120x120） */
  avatarUrl: string
  /** 职业描述 */
  desc: string
}

const AVATAR_BASE = '/icons/operators/avatars'

/** 全部 16 名干员（官网 operator.list 顺序） */
export const OPERATOR_PROFILES: OperatorProfile[] = [
  { id: '10017', name: '乌鲁鲁', fullName: '大卫·费莱尔', cls: 'engineer', avatarUrl: `${AVATAR_BASE}/op_10017.png`, desc: '装备支援、设施破坏' },
  { id: '10025', name: '回声', fullName: '卢克·埃弗里', cls: 'recon', avatarUrl: `${AVATAR_BASE}/op_10025.png`, desc: '情报收集、目标标记' },
  { id: '10007', name: '威龙', fullName: '王宇昊', cls: 'assault', avatarUrl: `${AVATAR_BASE}/op_10007.png`, desc: '正面火力、突破防线' },
  { id: '10020', name: '无名', fullName: '埃利·德·孟贝尔', cls: 'assault', avatarUrl: `${AVATAR_BASE}/op_10020.png`, desc: '正面火力、突破防线' },
  { id: '10023', name: '比特', fullName: '拉希德·拉哈尔', cls: 'engineer', avatarUrl: `${AVATAR_BASE}/op_10023.png`, desc: '装备支援、设施破坏' },
  { id: '10026', name: '液氮', fullName: '加布里埃尔·默里尔', cls: 'engineer', avatarUrl: `${AVATAR_BASE}/op_10026.png`, desc: '装备支援、设施破坏' },
  { id: '10019', name: '深蓝', fullName: '阿列克谢·彼得罗夫', cls: 'engineer', avatarUrl: `${AVATAR_BASE}/op_10019.png`, desc: '装备支援、设施破坏' },
  { id: '10002', name: '牧羊人', fullName: '泰瑞·缪萨', cls: 'engineer', avatarUrl: `${AVATAR_BASE}/op_10002.png`, desc: '装备支援、设施破坏' },
  { id: '10021', name: '疾风', fullName: '克莱尔·安·拜尔斯', cls: 'assault', avatarUrl: `${AVATAR_BASE}/op_10021.png`, desc: '正面火力、突破防线' },
  { id: '10000', name: '红狼', fullName: '凯·席尔瓦', cls: 'assault', avatarUrl: `${AVATAR_BASE}/op_10000.png`, desc: '正面火力、突破防线' },
  { id: '10018', name: '蛊', fullName: '佐娅·庞琴科娃', cls: 'medical', avatarUrl: `${AVATAR_BASE}/op_10018.png`, desc: '治疗、复活队友' },
  { id: '10001', name: '蜂医', fullName: '罗伊·斯米', cls: 'medical', avatarUrl: `${AVATAR_BASE}/op_10001.png`, desc: '治疗、复活队友' },
  { id: '10024', name: '蝶', fullName: '莉娜·范德梅尔', cls: 'medical', avatarUrl: `${AVATAR_BASE}/op_10024.png`, desc: '治疗、复活队友' },
  { id: '10022', name: '银翼', fullName: '兰登·哈里森', cls: 'recon', avatarUrl: `${AVATAR_BASE}/op_10022.png`, desc: '情报收集、目标标记' },
  { id: '10006', name: '露娜', fullName: '金卢娜', cls: 'recon', avatarUrl: `${AVATAR_BASE}/op_10006.png`, desc: '情报收集、目标标记' },
  { id: '10016', name: '骇爪', fullName: '麦晓雯', cls: 'recon', avatarUrl: `${AVATAR_BASE}/op_10016.png`, desc: '情报收集、目标标记' },
]

export function profileOf(id: string): OperatorProfile {
  return OPERATOR_PROFILES.find((p) => p.id === id) ?? OPERATOR_PROFILES[0]
}

/** 按职业分组干员档案（面板下拉分组用） */
export function profilesByClass(): Record<OperatorClass, OperatorProfile[]> {
  const out: Record<OperatorClass, OperatorProfile[]> = {
    assault: [],
    engineer: [],
    medical: [],
    recon: [],
  }
  for (const p of OPERATOR_PROFILES) out[p.cls].push(p)
  return out
}

/** 每队默认干员档案 id（按队伍循环分配不同干员，便于区分） */
const TEAM_DEFAULT_PROFILE: Record<string, string> = {
  A: '10000', // 红狼（突击）
  B: '10001', // 蜂医（医疗）
  C: '10022', // 银翼（侦察）
  D: '10017', // 乌鲁鲁（工程）
  E: '10007', // 威龙（突击）
}

/** 取某队的默认干员档案 id */
export function defaultProfileForTeam(team: string): string {
  return TEAM_DEFAULT_PROFILE[team] ?? '10000'
}

/** 每个职业的代表干员档案 id（点击职业按钮切换职业时，干员自动切换为该职业代表干员） */
const CLASS_DEFAULT_PROFILE: Record<OperatorClass, string> = {
  assault: '10000', // 红狼
  engineer: '10017', // 乌鲁鲁
  medical: '10001', // 蜂医
  recon: '10016', // 骇爪
}

/** 取某职业的默认干员档案 id（切换职业用） */
export function defaultProfileForClass(cls: OperatorClass): string {
  return CLASS_DEFAULT_PROFILE[cls] ?? '10000'
}
