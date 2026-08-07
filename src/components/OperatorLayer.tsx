import { useEffect, useMemo, useRef } from 'react'
import { Marker } from 'react-leaflet'
import * as L from 'leaflet'
import type { OperatorUnit, Side, TacticalRoute } from '../types'
import { operatorClassOf, teamOf } from '../config/operators'
import { profileOf } from '../config/operatorProfiles'
import { orderStatusLabel, orderTypeOf } from '../config/routes'

interface OperatorLayerProps {
  /** 当前视角（决定我方/敌方配色：op.side === view 为我方绿，敌方红） */
  view: Side
  /** 当前视角桶内全部干员（40 人 = 我方 20 + 敌方 20，均可部署/移动/连线对抗） */
  operators: OperatorUnit[]
  /** 干员坐标注册表：uid → [lat, lng]，供协同关系层读取端点 */
  posRef: React.MutableRefObject<Record<string, [number, number]>>
  /** 是否允许拖拽（绘制工具激活时禁止） */
  canDrag: boolean
  /** 关系编辑模式：点击干员用于建立/解除协同，而非打开气泡 */
  connectMode: boolean
  /** 被选中（连线第一端点）的干员 uid，高亮边框 */
  pendingConnect: string | null
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  routes: TacticalRoute[]
  onClearDeploy: (uid: string) => void
  onStartRoute: (uid: string) => void
  /** 关系编辑点击回调（App 决定建立/解除关系） */
  onConnectClick: (uid: string) => void
  /** 普通模式点击回调：打开更换干员气泡（携带地图容器坐标，用于气泡定位） */
  onEditClick: (uid: string, containerPoint: { x: number; y: number }) => void
  /** 双击代号回调：快捷编辑昵称 */
  onRenameClick: (uid: string, containerPoint: { x: number; y: number }) => void
}

/** 干员状态样式映射 */
const STATUS_META: Record<OperatorUnit['status'], { cls: string; label: string }> = {
  alive: { cls: '', label: '存活' },
  injured: { cls: 'injured', label: '重伤' },
  killed: { cls: 'killed', label: '阵亡' },
}

/** 阵营色：我方绿 / 敌方红（与干员外圈一致，连线颜色遵循"绿我红敌"语义）
 *  bright = 外圈/光晕亮色；deep = 标签底色（深一档，保证白字对比度） */
const SIDE_COLOR = {
  own: { bright: '#01ff84', deep: '#067a4e' },
  enemy: { bright: '#e0453a', deep: '#a02a22' },
} as const

/** 队伍色暗化（用于主图标圆底渐变的下端，保证白色职业剪影对比度；C队白→浅灰） */
function darken(hex: string, f = 0.6): string {
  const m = hex.replace('#', '')
  const r = Math.round(parseInt(m.slice(0, 2), 16) * f)
  const g = Math.round(parseInt(m.slice(2, 4), 16) * f)
  const b = Math.round(parseInt(m.slice(4, 6), 16) * f)
  return `rgb(${r},${g},${b})`
}

/**
 * 构建干员 divIcon（第十七轮：阵营外圈绿/红区分敌我；第十八轮：辨识度增强；第十九轮：主图标改职业图标）：
 * - 主图标：队伍色渐变圆底 + 职业图标白色剪影（队伍色=圆底，职业=剪影形状，去干员头像与左下角角标）
 * - 队伍色主边框 + 状态角标 + 代号/干员名（干员身份由底部名字标签体现）
 * - 外圈：阵营色粗环 + 发光（我方=绿，敌方=红），兵棋红蓝对抗一眼区分
 */
function buildOperatorIcon(op: OperatorUnit, view: Side, connectMode: boolean, pending: boolean, taskRoute?: TacticalRoute): L.DivIcon {
  const team = teamOf(op.team)
  const profile = profileOf(op.operatorId)
  const clsConf = operatorClassOf(op.cls)
  const status = STATUS_META[op.status]
  const own = op.side === view
  const sideCls = own ? 'side-own' : 'side-enemy'
  const sc = own ? SIDE_COLOR.own : SIDE_COLOR.enemy
  const classes = [
    'op-marker',
    sideCls,
    status.cls,
    connectMode ? 'connect' : '',
    pending ? 'pending' : '',
    op.status === 'killed' ? 'dead' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const task = taskRoute ? orderTypeOf(taskRoute.orderType) : null
  const taskBadge = task && taskRoute
    ? `<span class="op-task" style="--op-task-color:${taskRoute.color}" title="${task.label} · ${orderStatusLabel(taskRoute.status)}"><i class="fa-solid ${task.icon}" aria-hidden="true"></i></span>`
    : ''
  return L.divIcon({
    className: 'op-marker-wrap',
    html: `
      <div class="${classes}" tabindex="0" style="--op-team:${team.color};--op-cls:${clsConf.color};--op-side:${sc.bright};--op-side-deep:${sc.deep};--op-team-dark:${darken(team.color)}" title="${profile.name} · ${clsConf.name} · ${status.label} · 右键清除部署">
        <span class="op-side-ring"></span>
        <span class="op-team-bg"></span>
        <img class="op-cls-main" src="${clsConf.iconUrl}" alt="${clsConf.name}" draggable="false" />
        <span class="op-code" title="点击编辑昵称">${op.name}</span>
        <span class="op-name">${profile.name}</span>
        <span class="op-status-dot" style="background:${op.status === 'alive' ? 'var(--green)' : op.status === 'injured' ? '#f4cf67' : '#7a8185'}"></span>
        ${taskBadge}
        <button class="op-route" title="为${op.name}创建行动路线" aria-label="创建干员行动路线"><i class="fa-solid fa-route" aria-hidden="true"></i></button>
      </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

/** 单个干员标记 */
function OperatorMarker({
  op,
  view,
  canDrag,
  connectMode,
  pending,
  interactive,
  posRef,
  onMove,
  taskRoute,
  onClearDeploy,
  onStartRoute,
  onConnectClick,
  onEditClick,
  onRenameClick,
}: {
  op: OperatorUnit
  view: Side
  canDrag: boolean
  connectMode: boolean
  pending: boolean
  interactive: boolean
  posRef: React.MutableRefObject<Record<string, [number, number]>>
  onMove: (uid: string, lat: number, lng: number) => void
  taskRoute?: TacticalRoute
  onClearDeploy: (uid: string) => void
  onStartRoute: (uid: string) => void
  onConnectClick: (uid: string) => void
  onEditClick: (uid: string, containerPoint: { x: number; y: number }) => void
  /** 双击代号快捷编辑昵称 */
  onRenameClick: (uid: string, containerPoint: { x: number; y: number }) => void
}) {
  const ref = useRef<L.Marker | null>(null)

  // 位置注册表：联线层读取端点（干员移动时连线跟随）
  useEffect(() => {
    if (op.lat == null || op.lng == null) {
      delete posRef.current[op.uid]
      return
    }
    posRef.current[op.uid] = [op.lat, op.lng]
    return () => {
      delete posRef.current[op.uid]
    }
  }, [op.uid, op.lat, op.lng, posRef])

  const icon = useMemo(
    () => buildOperatorIcon(op, view, connectMode, pending, taskRoute),
    // 干员/职业/状态/队伍色/昵称变化需重建图标
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [op.operatorId, op.cls, op.status, op.team, op.name, op.side, view, connectMode, pending, taskRoute?.uid, taskRoute?.orderType, taskRoute?.status, taskRoute?.color],
  )

  // 代号标签响应：单击代号 = 快捷编辑昵称（与棋子单击三级菜单分离）。
  // 在 Marker 的 click 内按事件目标分流：Leaflet 的 marker click 对图标元素及其
  // 任何子元素（含伸出图标盒外的代号标签）都稳定触发，避免在子元素上单独绑定
  // 原生监听（挂载时序不可靠：Marker 尚未加入地图时 getElement() 为 null 导致监听丢失）。
  // 关系编辑模式下点击代号等同于点击棋子，不进入改名。
  // 未部署（null 坐标）不渲染
  if (op.lat == null || op.lng == null) return null

  return (
    <Marker
      ref={ref}
      position={[op.lat, op.lng]}
      icon={icon}
      draggable={canDrag}
      zIndexOffset={820}
      interactive={interactive}
      eventHandlers={{
        click: (e) => {
          // 阻止冒泡：避免地图点击事件误关气泡
          L.DomEvent.stopPropagation(e)
          const t = e.originalEvent.target as HTMLElement | null
          if (t?.closest?.('.op-route')) {
            onStartRoute(op.uid)
            return
          }
          // 点击顶部代号：快捷编辑昵称（与棋子单击三级菜单分离）
          if (t?.closest?.('.op-code')) {
            if (connectMode) {
              onConnectClick(op.uid)
            } else {
              // 传入容器像素坐标，用于地图上就近显示昵称编辑浮层
              onRenameClick(op.uid, { x: e.containerPoint.x, y: e.containerPoint.y })
            }
            return
          }
          if (connectMode) {
            onConnectClick(op.uid)
          } else {
            // 传入容器像素坐标，用于地图上就近显示更换干员气泡
            onEditClick(op.uid, { x: e.containerPoint.x, y: e.containerPoint.y })
          }
        },
        drag: (e) => {
          // 拖拽过程中实时上报位置：连线层端点跟随，实现连线实时更新
          const ll = (e.target as L.Marker).getLatLng()
          onMove(op.uid, ll.lat, ll.lng)
        },
        contextmenu: (e) => {
          L.DomEvent.stop(e.originalEvent)
          onClearDeploy(op.uid)
        },
        dragend: (e) => {
          const ll = (e.target as L.Marker).getLatLng()
          onMove(op.uid, ll.lat, ll.lng)
        },
      }}
    />
  )
}

/**
 * 干员标记图层（兵棋推演）：
 * 以 Leaflet Marker + divIcon 渲染，队伍色边框 + 阵营外圈（我方绿/敌方红）+ 干员头像 + 职业小圆 + 代号/名字 + 状态角标。
 * 视角桶内同时含双方 40 人（op.side === view 为我方绿圈，op.side !== view 为敌方红圈）；
 * 双方均可部署、拖拽、连线——兵棋红蓝对抗。
 * 支持拖拽部署位置；关系编辑模式建立协同，普通模式打开干员编辑气泡。
 */
export default function OperatorLayer({
  view,
  operators,
  posRef,
  canDrag,
  connectMode,
  pendingConnect,
  interactive,
  onMove,
  routes,
  onClearDeploy,
  onStartRoute,
  onConnectClick,
  onEditClick,
  onRenameClick,
}: OperatorLayerProps) {
  const routesByOperator = useMemo(() => {
    const statusPriority: Record<TacticalRoute['status'], number> = { executing: 0, pending: 1, planned: 2, completed: 3, cancelled: 4 }
    const map = new Map<string, TacticalRoute>()
    for (const route of routes) {
      for (const uid of route.operatorIds) {
        const current = map.get(uid)
        if (!current || statusPriority[route.status] < statusPriority[current.status]) map.set(uid, route)
      }
    }
    return map
  }, [routes])
  return (
    <>
      {operators.map((op) => (
        <OperatorMarker
          key={op.uid}
          op={op}
          view={view}
          canDrag={canDrag}
          connectMode={connectMode}
          pending={pendingConnect === op.uid}
          interactive={interactive}
          posRef={posRef}
          onMove={onMove}
          taskRoute={routesByOperator.get(op.uid)}
          onClearDeploy={onClearDeploy}
          onStartRoute={onStartRoute}
          onConnectClick={onConnectClick}
          onEditClick={onEditClick}
          onRenameClick={onRenameClick}
        />
      ))}
    </>
  )
}
