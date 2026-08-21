/**
 * 自定义载具库
 *
 * 图标优先级：优先使用官网图例图标（nav_* base64），没有对应图例图标的回退到 deploy_* PNG。
 * - 图例图标提取自官网 main.css .img_nav_* 类，base64 内嵌，无需外部请求，为官网图例栏原图。
 * - deploy_* 图标为地图上载具部署点的 mark 级 PNG 标志，非图例图标。
 */

import type { VehicleCategory } from '../types'
import { vehicleLegendAssetUrl } from './vehicleLegendAssets'

export interface CustomVehicleTemplate {
  name: string
  badge: string
  category: VehicleCategory
  /** 官网图例图标名（nav_*，如有），否则为 deploy_* */
  iconKey: string
  /** 图标 URL（优先 base64 图例图标，回退 PNG） */
  iconUrl: string
  /** 可用地图（[]=全地图可用） */
  maps: string[]
  /** UI 分组 */
  group: '地面载具' | '空中载具' | '水上载具'
}

function legend(key: string): string | undefined {
  const deployKey = key.replace(/^nav_/, '')
  return vehicleLegendAssetUrl(deployKey)
}

function deployPng(key: string): string {
  return vehicleLegendAssetUrl(key) ?? `/icons/vehicles/deploy/deploy_${key}.png`
}

export const CUSTOM_VEHICLES: CustomVehicleTemplate[] = [
  // ── 地面载具 ──
  {
    name: 'M1A4主战坦克', badge: '坦', category: 'tank', iconKey: 'm1a4zztk',
    iconUrl: deployPng('m1a4zztk'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: 'GTQ-35轻型坦克', badge: '轻', category: 'tank', iconKey: 'qxtk',
    iconUrl: deployPng('qxtk'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: 'LAV-G1步战车', badge: '步', category: 'ifv', iconKey: 'g1bzc',
    iconUrl: deployPng('g1bzc'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: 'LAV-AA防空车', badge: '防', category: 'ifv', iconKey: 'nav_fkc',
    // 有图例图标 nav_fkc（官网 LAV_AD防空车）
    iconUrl: legend('nav_fkc') ?? deployPng('aakfc'),
    maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: 'FSV轮式突击炮', badge: '炮', category: 'ifv', iconKey: 'nav_lstjp',
    // 有图例图标 nav_lstjp（官网 轮式突击炮）
    iconUrl: legend('nav_lstjp') ?? deployPng('lstjp'),
    maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: '突击车', badge: '突', category: 'recon', iconKey: 'nav_orvtjc',
    // 有图例图标 nav_orvtjc（官网 突击车）
    iconUrl: legend('nav_orvtjc') ?? deployPng('orvtjc'),
    maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: '全地形车', badge: '全', category: 'recon', iconKey: 'atvqdxc',
    iconUrl: deployPng('atvqdxc'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: 'AAV两栖装甲运输车', badge: '两', category: 'apc', iconKey: 'sxzjc',
    iconUrl: deployPng('sxzjc'),
    maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  {
    name: '轻型战术车', badge: '轻', category: 'recon', iconKey: 'losvjpc',
    iconUrl: deployPng('losvjpc'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '地面载具',
  },
  // ── 空中载具 ──
  {
    name: 'AH-1035D突击直升机', badge: '攻', category: 'helo', iconKey: 'nav_tjzsj',
    // 有图例图标 nav_tjzsj（官网 武装直升机）
    iconUrl: legend('nav_tjzsj') ?? deployPng('tjzsj'),
    maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '空中载具',
  },
  {
    name: 'MH-33D侦察直升机', badge: '侦', category: 'helo', iconKey: 'nav_zczsj',
    // 有图例图标 nav_zczsj（官网 侦查直升机）
    iconUrl: legend('nav_zczsj') ?? deployPng('xnzsj'),
    maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '空中载具',
  },
  {
    name: 'CSV-35运输直升机', badge: '运', category: 'helo', iconKey: 'ymfg',
    iconUrl: deployPng('ymfg'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '空中载具',
  },
  {
    name: 'F-45A战斗机', badge: '机', category: 'helo', iconKey: 'f45azdj',
    iconUrl: deployPng('f45azdj'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '空中载具',
  },
  // ── 水上载具 ──
  {
    name: '摩托艇', badge: '摩', category: 'water', iconKey: 'mtt',
    iconUrl: deployPng('mtt'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '水上载具',
  },
  {
    name: 'UCB-95/97攻击艇', badge: '攻', category: 'water', iconKey: 'ucb9597',
    iconUrl: deployPng('ucb9597'), maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '水上载具',
  },
  {
    name: '冲锋舟', badge: '舟', category: 'supply', iconKey: 'nav_cfz',
    // 有图例图标 nav_cfz（官网 冲锋舟）
    iconUrl: legend('nav_cfz') ?? deployPng('cfz'),
    maps: ['ascent', 'flashpoint', 'fault', 'brokentrack', 'colosseum', 'stormeye', 'ember', 'pyramid', 'trench', 'umuscanal', 'aftershock'], group: '水上载具',
  },
]

/**
 * 根据当前地图筛选可用载具。
 * maps=[] 表示全地图可用；否则仅包含当前地图的载具。
 */
export function vehiclesForMap(mapId: string): CustomVehicleTemplate[] {
  return CUSTOM_VEHICLES.filter((v) => v.maps.length === 0 || v.maps.includes(mapId))
}
