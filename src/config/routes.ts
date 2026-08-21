import type { TacticalOrderStatus, TacticalOrderType, TacticalRoute, TacticalRouteLineStyle } from '../types'

export const ORDER_TYPE_OPTIONS: { id: TacticalOrderType; label: string; color: string; lineStyle: TacticalRouteLineStyle; icon: string }[] = [
  { id: 'move', label: '机动', color: '#3f8cff', lineStyle: 'dashed', icon: 'fa-person-running' },
  { id: 'attack', label: '进攻', color: '#ff554d', lineStyle: 'solid', icon: 'fa-burst' },
  { id: 'recon', label: '侦察', color: '#38d9e6', lineStyle: 'dotted', icon: 'fa-binoculars' },
  { id: 'flank', label: '迂回', color: '#f4cf67', lineStyle: 'dashed', icon: 'fa-route' },
  { id: 'retreat', label: '撤退', color: '#9aa1a8', lineStyle: 'dashed', icon: 'fa-backward' },
  { id: 'escort', label: '护送', color: '#c77dff', lineStyle: 'solid', icon: 'fa-shield-halved' },
  { id: 'resupply', label: '补给', color: '#01ff84', lineStyle: 'dotted', icon: 'fa-boxes-stacked' },
  { id: 'hold', label: '固守', color: '#ff9f43', lineStyle: 'solid', icon: 'fa-shield' },
]

export const ORDER_STATUS_OPTIONS: { id: TacticalOrderStatus; label: string; icon: string }[] = [
  { id: 'planned', label: '计划中', icon: 'fa-clipboard-list' },
  { id: 'pending', label: '待执行', icon: 'fa-clock' },
  { id: 'executing', label: '执行中', icon: 'fa-play' },
  { id: 'completed', label: '已完成', icon: 'fa-check' },
  { id: 'cancelled', label: '已取消', icon: 'fa-ban' },
]

export const ROUTE_LINE_OPTIONS: { id: TacticalRouteLineStyle; label: string }[] = [
  { id: 'solid', label: '实线' },
  { id: 'dashed', label: '虚线' },
  { id: 'dotted', label: '点线' },
]

export function orderTypeOf(id: TacticalOrderType) {
  return ORDER_TYPE_OPTIONS.find((item) => item.id === id) ?? ORDER_TYPE_OPTIONS[1]
}

export function orderStatusLabel(id: TacticalOrderStatus): string {
  return ORDER_STATUS_OPTIONS.find((item) => item.id === id)?.label ?? '计划中'
}

export function routeDashArray(style: TacticalRouteLineStyle, orderType?: TacticalOrderType): string | undefined {
  if (style === 'solid') return orderType === 'escort' ? '18 3' : undefined
  if (style === 'dashed') {
    if (orderType === 'move') return '16 7'
    if (orderType === 'flank') return '13 5 3 5'
    if (orderType === 'retreat') return '6 5'
    return '12 7'
  }
  if (style === 'dotted') {
    if (orderType === 'resupply') return '5 4 1 4'
    return '2 7'
  }
  return undefined
}

export function routeVisual(route: TacticalRoute, selected = false) {
  const completed = route.status === 'completed'
  const cancelled = route.status === 'cancelled'
  const executing = route.status === 'executing'
  const baseWeight = typeof route.strokeWidth === 'number' && Number.isFinite(route.strokeWidth)
    ? Math.max(1, Math.min(10, route.strokeWidth))
    : 3.5
  return {
    color: completed ? '#7f888f' : cancelled ? '#656b70' : route.color,
    // 选中态由元素选择框表达，路线本身始终保留用户设置的实际粗细。
    weight: selected ? baseWeight : executing ? Math.max(baseWeight + 1, 5) : baseWeight,
    opacity: Math.max(0.12, Math.min(1, route.opacity)) * (completed ? 0.58 : cancelled ? 0.35 : route.status === 'planned' ? 0.72 : 1),
    dashArray: routeDashArray(route.lineStyle, route.orderType),
  }
}
