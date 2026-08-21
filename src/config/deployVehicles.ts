/**
 * 官网临界点（flashpoint）攻防模式初始载具部署数据
 * 数据来源：官网地图工具 map_ljd.js → window['pc_ljd'].deploy（攻防模式）
 * 按阶段（Sector S1/S2/S3）+ 阵营（进攻/防守）组织，与项目阶段配置一一对应。
 * 字段含义（官网原字段）：
 * - 投放机制：阵营常驻
 * - 投放方式：基地旁边小方向盘
 * - 允许非队友的友方部署：是/否
 * - 备注：官网出生点位置名（公园/检查站/天桥/卸货场/海墙/集散区）
 * - CD：冷却时间（秒）
 * - num：可部署数量
 */
import type { VehicleCategory } from '../types'
import { vehicleLegendAssetUrl } from './vehicleLegendAssets'

export interface DeployVehicleEntry {
  /** 载具名（官网 deploy 数据 name） */
  name: string
  /** 官网图标 key（deploy_*.png，位于 dzc_i 目录） */
  icon: string
  /** 地图图例图标 key（nav_*，优先使用）；无对应图例时回退本地展示图标 */
  legendKey?: string
  /** 地图标记图标 URL（图例 base64 优先，回退本地 deploy PNG） */
  iconUrl: string
  /** 冷却时间（秒） */
  cd: number
  /** 可部署数量 */
  num: number
  /** 官网备注（出生点位置名） */
  note: string
  /** 是否允许非队友的友方部署 */
  allowTeammate: boolean
  /** 卡片徽标（图标加载失败兜底） */
  badge: string
  /** 载具分类 */
  category: VehicleCategory
}

/** 单阶段载具部署（按阵营） */
export interface StageDeploy {
  attack: DeployVehicleEntry[]
  defense: DeployVehicleEntry[]
}

/** 本地展示图标目录（无补充图例资源时使用）。 */
const LOCAL_DEPLOY_BASE = '/icons/vehicles/deploy'

export function localDeployIconUrl(deployKey: string): string {
  const extension = deployKey === 'ucb9597' ? 'svg' : 'png'
  return `${LOCAL_DEPLOY_BASE}/deploy_${deployKey}.${extension}`
}

/**
 * 解析地图标记图标：优先官网图例图标（nav_* base64，与地图图例栏一致），
 * 无图例时回退本地 deploy 展示图标。
 */
function resolveIcon(deployKey: string, legendKey?: string): string {
  const suppliedLegend = vehicleLegendAssetUrl(deployKey)
  if (suppliedLegend) return suppliedLegend
  if (legendKey) {
    const l = vehicleLegendAssetUrl(legendKey.replace(/^nav_/, ''))
    if (l) return l
  }
  return localDeployIconUrl(deployKey)
}

/** 数据条目（不含派生字段 iconUrl） */
type RawEntry = Omit<DeployVehicleEntry, 'iconUrl'>
type RawStage = Record<string, { attack: RawEntry[]; defense: RawEntry[] }>

/** 为每个条目补充 iconUrl 后导出 */
function build(raw: RawStage): Record<string, StageDeploy> {
  const out: Record<string, StageDeploy> = {}
  const withDerivedFields = (entry: RawEntry): DeployVehicleEntry => ({
    ...entry,
    // 摩托艇是独立水面载具，不属于支援载具；兼容旧抓取数据中的分类值。
    category: entry.name === '摩托艇' ? 'water' : entry.category,
    iconUrl: resolveIcon(entry.icon, entry.legendKey),
  })
  for (const [sid, s] of Object.entries(raw)) {
    out[sid] = {
      attack: s.attack.map(withDerivedFields),
      defense: s.defense.map(withDerivedFields),
    }
  }
  return out
}

/** 临界点攻防模式各阶段载具部署（S1/S2/S3） */
const RAW_DEPLOY: RawStage = {
  S1: {
    attack: [
      { name: '侦察直升机', icon: 'xnzsj', legendKey: 'nav_zczsj', cd: 150, num: 1, note: '公园', allowTeammate: true, badge: '侦', category: 'helo' },
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '公园', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: '突击车', icon: 'orvtjc', legendKey: 'nav_orvtjc', cd: 75, num: 1, note: '公园', allowTeammate: true, badge: '突', category: 'recon' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '公园', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: '检查站', allowTeammate: false, badge: '防', category: 'ifv' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 1, note: '检查站', allowTeammate: false, badge: '全', category: 'recon' },
    ],
  },
  S2: {
    attack: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '天桥', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: '突击车', icon: 'orvtjc', legendKey: 'nav_orvtjc', cd: 75, num: 1, note: '天桥', allowTeammate: true, badge: '突', category: 'recon' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '天桥', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '卸货场', allowTeammate: false, badge: '全', category: 'recon' },
    ],
  },
  S3: {
    attack: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '海墙', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: '突击车', icon: 'orvtjc', legendKey: 'nav_orvtjc', cd: 75, num: 1, note: '海墙', allowTeammate: true, badge: '突', category: 'recon' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '海墙', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '集散区', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '集散区', allowTeammate: false, badge: '全', category: 'recon' },
    ],
  },
}

export const FLASHPOINT_DEPLOY = build(RAW_DEPLOY)

/** 攀升攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_ASCENT: RawStage = {
  S1: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '北边滩头', allowTeammate: false, badge: '坦', category: 'tank' },
      { name: '轻型战术车', icon: 'losvjpc', cd: 45, num: 1, note: '北边滩头', allowTeammate: true, badge: '轻', category: 'recon' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 30, num: 2, note: '海上基地', allowTeammate: false, badge: '舟', category: 'supply' },
      { name: '突击直升机', icon: 'tjzsj', legendKey: 'nav_tjzsj', cd: 150, num: 1, note: '海上基地', allowTeammate: false, badge: '突', category: 'helo' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 1, note: '北边滩头', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: '轻型战术车', icon: 'losvjpc', cd: 45, num: 1, note: '临时营地', allowTeammate: true, badge: '轻', category: 'recon' },
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: '临时营地', allowTeammate: false, badge: '防', category: 'ifv' },
    ],
  },
  S2: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '北边废墟', allowTeammate: false, badge: '坦', category: 'tank' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 1, note: '北边废墟', allowTeammate: false, badge: '全', category: 'recon' },
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '北边废墟', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 1, note: '南边高坡', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: '轻型战术车', icon: 'losvjpc', cd: 45, num: 1, note: '隧道入口', allowTeammate: false, badge: '轻', category: 'recon' },
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '隧道入口', allowTeammate: false, badge: '坦', category: 'tank' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 1, note: '隧道入口', allowTeammate: false, badge: '全', category: 'recon' },
    ],
  },
  S3: {
    attack: [
      { name: 'LAV G1步战车', icon: 'g1bzc', cd: 120, num: 1, note: '隧道平台入口', allowTeammate: false, badge: '步', category: 'ifv' },
    ],
    defense: [],
  },
  S4: {
    attack: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '洞穴出口', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [],
  },
}

export const ASCENT_DEPLOY = build(RAW_DEPLOY_ASCENT)

/** 断层攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_FAULT: RawStage = {
  S1: {
    attack: [
      { name: 'F-45A战斗机', icon: 'f45azdj', cd: 150, num: 2, note: 'GTI3号阵地', allowTeammate: false, badge: '机', category: 'helo' },
      { name: 'LAV G1步战车', icon: 'g1bzc', cd: 90, num: 1, note: 'GTI2号阵地', allowTeammate: false, badge: '步', category: 'ifv' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: 'GTI2号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'F-45A战斗机', icon: 'f45azdj', cd: 150, num: 2, note: 'GTI1号阵地', allowTeammate: false, badge: '机', category: 'helo' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: 'GTI1号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
  },
  S2: {
    attack: [
      { name: '突击直升机', icon: 'tjzsj', legendKey: 'nav_tjzsj', cd: 150, num: 1, note: 'GTI4号阵地', allowTeammate: false, badge: '突', category: 'helo' },
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: 'GTI4号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: 'GTI4号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '哈夫克3号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: '哈夫克3号阵地', allowTeammate: false, badge: '防', category: 'ifv' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: '哈夫克3号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
  },
  S3: {
    attack: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: 'GTI7号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: '哈夫克4号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
  },
}

export const FAULT_DEPLOY = build(RAW_DEPLOY_FAULT)

/** 断轨攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_BROKENTRACK: RawStage = {
  S1: {
    attack: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: '运输要道', allowTeammate: false, badge: '全', category: 'recon' },
      { name: '轻型战术车', icon: 'losvjpc', cd: 15, num: 1, note: '运输要道', allowTeammate: false, badge: '轻', category: 'recon' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '山间小路', allowTeammate: false, badge: '全', category: 'recon' },
      { name: '轻型战术车', icon: 'losvjpc', cd: 15, num: 1, note: '山间小路', allowTeammate: false, badge: '轻', category: 'recon' },
    ],
    defense: [
    ],
  },
  S2: {
    attack: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '进攻方矿场入口', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '进攻方二号二号矿场入口', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
    defense: [
    ],
  },
  S3: {
    attack: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '进攻方工人宿舍', allowTeammate: false, badge: '全', category: 'recon' },
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '进攻方工人宿舍', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: '进攻方矿山山头', allowTeammate: false, badge: '全', category: 'recon' },
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '进攻方矿山山头', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
    defense: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '园区出口', allowTeammate: false, badge: '炮', category: 'ifv' },
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '铁道岔路口', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
  },
  S4: {
    attack: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 3, note: '进攻方铁轨岔路口', allowTeammate: false, badge: '全', category: 'recon' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '进攻方园区出口', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
    ],
  },
}

export const BROKENTRACK_DEPLOY = build(RAW_DEPLOY_BROKENTRACK)

/** 克劳狄斗兽场攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_COLOSSEUM: RawStage = {
  S1: {
    attack: [
      { name: '两栖装甲运输车', icon: 'sxzjc', legendKey: 'nav_sxzjc', cd: 0, num: 1, note: 'GTI1号阵地', allowTeammate: false, badge: '载', category: 'apc' },
    ],
    defense: [
    ],
  },
  S2: {
    attack: [
      { name: '鱼鹰直升机', icon: 'ymfg', cd: 90, num: 1, note: 'GTI4号阵地', allowTeammate: false, badge: '运', category: 'helo' },
      { name: '轻型坦克', icon: 'qxtk', cd: 90, num: 1, note: 'GTI4号阵地', allowTeammate: false, badge: '轻', category: 'tank' },
    ],
    defense: [
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: '哈夫克3号阵地', allowTeammate: false, badge: '防', category: 'ifv' },
    ],
  },
  S4: {
    attack: [
      { name: 'F-45A战斗机', icon: 'f45azdj', cd: 100, num: 1, note: 'GTI10号阵地', allowTeammate: false, badge: '机', category: 'helo' },
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: 'GTI10号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
    defense: [
      { name: 'F-45A战斗机', icon: 'f45azdj', cd: 100, num: 1, note: '哈夫克7号阵地', allowTeammate: false, badge: '机', category: 'helo' },
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: '哈夫克7号阵地', allowTeammate: false, badge: '防', category: 'ifv' },
      { name: '两栖装甲运输车', icon: 'sxzjc', legendKey: 'nav_sxzjc', cd: 90, num: 1, note: '哈夫克7号阵地', allowTeammate: false, badge: '载', category: 'apc' },
    ],
  },
}

export const COLOSSEUM_DEPLOY = build(RAW_DEPLOY_COLOSSEUM)

/** 风暴眼攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_STORMEYE: RawStage = {
  S1: {
    attack: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '进攻方1号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '进攻方1号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
      { name: '侦察直升机', icon: 'xnzsj', legendKey: 'nav_zczsj', cd: 150, num: 1, note: '进攻方1号阵地', allowTeammate: false, badge: '侦', category: 'helo' },
    ],
    defense: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '防守方1号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '防守方1号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: '防守方1号阵地', allowTeammate: false, badge: '防', category: 'ifv' },
    ],
  },
  S2: {
    attack: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '进攻方1号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: 'GTQ-35轻型坦克', icon: 'qxtk', cd: 90, num: 1, note: '进攻方3号阵地', allowTeammate: false, badge: '轻', category: 'tank' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '进攻方4号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
    ],
    defense: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '防守方1号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '防守方4号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
      { name: 'GTQ-35轻型坦克', icon: 'qxtk', cd: 90, num: 1, note: '防守方3号阵地', allowTeammate: false, badge: '轻', category: 'tank' },
    ],
  },
  S3: {
    attack: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '进攻方1号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '进攻方7号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
      { name: 'GTQ-35轻型坦克', icon: 'qxtk', cd: 90, num: 1, note: '进攻方6号阵地', allowTeammate: false, badge: '轻', category: 'tank' },
    ],
    defense: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '防守方1号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '防守方6号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '防守方7号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
  },
  S4: {
    attack: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '进攻方8号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '进攻方9号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
    ],
    defense: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '防守方8号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '防守方10号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
    ],
  },
  S5: {
    attack: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '进攻方13号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '进攻方13号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
      { name: 'GTQ-35轻型坦克', icon: 'qxtk', cd: 90, num: 1, note: '进攻方13号阵地', allowTeammate: false, badge: '轻', category: 'tank' },
    ],
    defense: [
      { name: '摩托艇', icon: 'mtt', cd: 5, num: 2, note: '防守方12号阵地', allowTeammate: false, badge: '艇', category: 'supply' },
      { name: '冲锋舟', icon: 'cfz', legendKey: 'nav_cfz', cd: 90, num: 1, note: '防守方12号阵地', allowTeammate: true, badge: '舟', category: 'supply' },
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '防守方12号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
  },
}

export const STORMEYE_DEPLOY = build(RAW_DEPLOY_STORMEYE)

/** 烬区攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_EMBER: RawStage = {
  S2: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '岩下村', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
    defense: [
      { name: 'LAV G1步战车', icon: 'g1bzc', cd: 90, num: 1, note: '办公区', allowTeammate: false, badge: '步', category: 'ifv' },
    ],
  },
}

export const EMBER_DEPLOY = build(RAW_DEPLOY_EMBER)

/** 金字塔攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_PYRAMID: RawStage = {
  S1: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: 'GTI1号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
      { name: '侦察直升机', icon: 'xnzsj', legendKey: 'nav_zczsj', cd: 120, num: 1, note: 'GTI2号阵地', allowTeammate: true, badge: '侦', category: 'helo' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 1, note: 'GTI2号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: '哈夫克1号阵地', allowTeammate: false, badge: '防', category: 'ifv' },
    ],
  },
  S2: {
    attack: [
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 1, note: 'GTI3号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
    ],
  },
  S3: {
    attack: [
      { name: 'GTQ-35轻型坦克', icon: 'qxtk', cd: 90, num: 1, note: 'GTI4号阵地', allowTeammate: false, badge: '轻', category: 'tank' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: 'GTI4号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '哈夫克5号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
  },
}

export const PYRAMID_DEPLOY = build(RAW_DEPLOY_PYRAMID)

/** 堑壕战攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_TRENCH: RawStage = {
  S1: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '进攻方2号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
    defense: [],
  },
  S2: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '进攻方3号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
    defense: [],
  },
  S3: {
    attack: [],
    defense: [
      { name: '突击车', icon: 'orvtjc', legendKey: 'nav_orvtjc', cd: 60, num: 1, note: '防守方4号阵地', allowTeammate: true, badge: '突', category: 'recon' },
    ],
  },
  S4: {
    attack: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '进攻方8号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
    defense: [],
  },
  S5: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '进攻方9号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
      { name: 'ATV全地形车', icon: 'atvqdxc', cd: 15, num: 2, note: '进攻方9号阵地', allowTeammate: false, badge: '全', category: 'recon' },
    ],
    defense: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '防守方8号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
  },
}

export const TRENCH_DEPLOY = build(RAW_DEPLOY_TRENCH)

/** 乌姆斯运河攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_UMUSCANAL: RawStage = {
  S1: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: 'GTI1号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
      { name: '两栖装甲运输车', icon: 'sxzjc', legendKey: 'nav_sxzjc', cd: 90, num: 1, note: 'GTI2号阵地', allowTeammate: false, badge: '载', category: 'apc' },
    ],
    defense: [
    ],
  },
  S2: {
    attack: [
      { name: '轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: 'GTI4号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
    defense: [
      { name: '轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '哈夫克2号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
  },
  S3: {
    attack: [
      { name: '两栖装甲运输车', icon: 'sxzjc', legendKey: 'nav_sxzjc', cd: 90, num: 1, note: 'GTI8号阵地', allowTeammate: false, badge: '载', category: 'apc' },
      { name: 'F-45A战斗机', icon: 'f45azdj', cd: 100, num: 2, note: 'GTI8号阵地', allowTeammate: false, badge: '机', category: 'helo' },
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: 'GTI8号阵地', allowTeammate: false, badge: '防', category: 'ifv' },
    ],
    defense: [
      { name: 'F-45A战斗机', icon: 'f45azdj', cd: 100, num: 2, note: '哈夫克5号阵地', allowTeammate: false, badge: '机', category: 'helo' },
      { name: '轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '哈夫克5号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
  },
  S4: {
    attack: [
      { name: 'LAV AA防空车', icon: 'aakfc', legendKey: 'nav_fkc', cd: 90, num: 1, note: 'GTI11号阵地', allowTeammate: false, badge: '防', category: 'ifv' },
      { name: '侦察直升机', icon: 'xnzsj', legendKey: 'nav_zczsj', cd: 100, num: 1, note: 'GTI11号阵地', allowTeammate: false, badge: '侦', category: 'helo' },
    ],
    defense: [
      { name: 'F-45A战斗机', icon: 'f45azdj', cd: 100, num: 1, note: '哈夫克7号阵地', allowTeammate: false, badge: '机', category: 'helo' },
    ],
  },
}

export const UMUSCANAL_DEPLOY = build(RAW_DEPLOY_UMUSCANAL)

/** 余震攻防模式各阶段载具部署（S1/S2/...） */
const RAW_DEPLOY_AFTERSHOCK: RawStage = {
  S1: {
    attack: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: 'GTI1号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
      { name: '两栖装甲运输车', icon: 'sxzjc', legendKey: 'nav_sxzjc', cd: 90, num: 1, note: 'GTI2号阵地', allowTeammate: false, badge: '载', category: 'apc' },
    ],
    defense: [
      { name: 'M1A4主战坦克', icon: 'm1a4zztk', cd: 120, num: 1, note: '哈夫克1号阵地', allowTeammate: false, badge: '坦', category: 'tank' },
    ],
  },
  S2: {
    attack: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: 'GTI3号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
    defense: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '哈夫克2号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
  },
  S3: {
    attack: [],
    defense: [
      { name: '突击车', icon: 'orvtjc', legendKey: 'nav_orvtjc', cd: 60, num: 1, note: '防守方4号阵地', allowTeammate: true, badge: '突', category: 'recon' },
    ],
  },
  S4: {
    attack: [
      { name: 'FSV轮式突击炮', icon: 'lstjp', legendKey: 'nav_lstjp', cd: 90, num: 1, note: '进攻方8号阵地', allowTeammate: false, badge: '炮', category: 'ifv' },
    ],
    defense: [],
  },
}

export const AFTERSHOCK_DEPLOY = build(RAW_DEPLOY_AFTERSHOCK)

/** 各地图完整的官网攻防载具部署表，供主地图和模式配置器共同使用。 */
export const DEPLOY_BY_MAP: Record<string, Record<string, StageDeploy>> = {
  ascent: ASCENT_DEPLOY,
  flashpoint: FLASHPOINT_DEPLOY,
  fault: FAULT_DEPLOY,
  brokentrack: BROKENTRACK_DEPLOY,
  colosseum: COLOSSEUM_DEPLOY,
  stormeye: STORMEYE_DEPLOY,
  ember: EMBER_DEPLOY,
  pyramid: PYRAMID_DEPLOY,
  trench: TRENCH_DEPLOY,
  umuscanal: UMUSCANAL_DEPLOY,
  aftershock: AFTERSHOCK_DEPLOY,
}

/** 编辑器可补充配置、但攻防默认部署表中未预置的正式载具。 */
const EXTRA_DEPLOY_VEHICLES: DeployVehicleEntry[] = [
  {
    name: 'UCB-95/97攻击艇',
    icon: 'ucb9597',
    iconUrl: resolveIcon('ucb9597'),
    cd: 90,
    num: 1,
    note: '',
    allowTeammate: false,
    badge: '攻',
    category: 'water',
  },
]

/** 去重后的正式载具目录，用于自定义模式为复活点增减具体可部署载具。 */
export const DEPLOY_VEHICLE_CATALOG: DeployVehicleEntry[] = Array.from(
  new Map(
    Object.values(DEPLOY_BY_MAP)
      .flatMap((stages) => Object.values(stages))
      .flatMap((stage) => [...stage.attack, ...stage.defense])
      .concat(EXTRA_DEPLOY_VEHICLES)
      // 官方旧数据曾将 qxtk 写作“轻型坦克”，新数据写作正式名称
      // “GTQ-35轻型坦克”；两者是同一载具，编辑器目录只保留正式名称。
      .map((entry) => [entry.icon === 'qxtk' ? 'GTQ-35轻型坦克' : entry.name, entry.icon === 'qxtk' ? { ...entry, name: 'GTQ-35轻型坦克' } : entry]),
  ).values(),
)
