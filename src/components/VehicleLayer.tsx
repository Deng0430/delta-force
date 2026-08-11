import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Marker } from 'react-leaflet'
import * as L from 'leaflet'
import type { OperatorTeam, Side, VehicleItem } from '../types'
import { teamOf } from '../config/operators'

interface VehicleLayerProps {
  vehicles: VehicleItem[]
  /** 当前攻防视角：本方部署 = 绿底，敌方 = 红底（随视角实时反转） */
  view: Side
  /** 是否允许拖拽（绘制模式下禁止，避免误拖） */
  canDrag: boolean
  /** 绘制工具激活时禁用点击展开（不弹载具属性） */
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  /** 问题3：旋转角度回调（持久化） */
  onRotate: (uid: string, rotation: number) => void
  onDelete: (uid: string) => void
  /** 快捷切换载具阵营（攻↔守） */
  onToggleSide: (uid: string) => void
  /** 循环切换载具所属 A-E 队 */
  onChangeTeam: (uid: string, team?: OperatorTeam) => void
  /** 从该载具位置创建行动路线 */
  onStartRoute: (uid: string) => void
  /** 载具位置注册表（第十四轮：套索框选/整体移动的实时位置来源） */
  posRef: MutableRefObject<Record<string, [number, number]>>
}

/** 本方部署 = 绿底；敌方部署 = 红底（与复活点配色一致） */
const OWN_COLOR = '#01ff84'
const ENEMY_COLOR = '#e0453a'

/** 底色随当前视角实时判定：own = (side === view)，切换攻/守视角后双方底色自动反转 */
function vehicleColor(v: VehicleItem, view: Side): string {
  return v.side === view ? OWN_COLOR : ENEMY_COLOR
}

/** 滚轮单次旋转步进（度） */
const ROTATE_STEP = 15

/**
 * 载具卡片 divIcon（显示模式与地图道具一致；第二十轮：仿兵棋干员——阵营发光外圈 + 名字常驻底部）：
 * - 默认：阵营色底衬圆标 + 官网图标（小尺寸标记）
 * - 阵营外圈：绿（本方）/红（敌方）发光环，与兵棋棋子一致，一眼区分敌我
 * - 载具名字：常驻显示在卡片下方（仿兵棋名字标签）
 * - hover：显示删除叉 + 快捷切换阵营按钮
 * - 点击展开：名称 + × 移除按钮
 * - 滚轮旋转：悬停时滚动滚轮 ±15°，角度持久化到 localStorage
 * 旋转角度为单一数据源（state），由 effect 统一写入内联 transform；
 * 不使用 CSS var/transition，避免角度跨越 0/360 边界时产生"自动旋转一周"的补间动画（问题3）。
 * 删除按钮使用内联 onclick 调用 window.__vehDel（见 VehicleMarker），
 * 规避 Leaflet divIcon DOM 重建导致的 addEventListener 失效问题。
 */
function buildVehicleIcon(v: VehicleItem, view: Side, expanded: boolean): L.DivIcon {
  const sideCls = v.side === 'attack' ? 'attack' : 'defense'
  // 图例图标（base64 data URI）正常大小；无图例的本地 PNG 图标（如 ATV）加 no-legend 缩小
  const legendCls = v.iconUrl.startsWith('data:') ? '' : 'no-legend'
  const cls = ['veh-marker', sideCls, legendCls, expanded ? 'expanded' : ''].join(' ')
  const team = v.team ? teamOf(v.team) : null
  const sideColor = vehicleColor(v, view)
  // 快捷切换阵营按钮（左上角，hover 显示）：点击切换攻↔守，底色随视角实时反转
  const sideBtn = `
    <button class="veh-side" title="切换本方/敌方" aria-label="切换本方/敌方" onclick="event.stopPropagation();event.preventDefault();window.__vehSide('${v.uid}')">
      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5 1 6l2.5 2.5M8.5 3.5 11 6l-2.5 2.5M1 6h10"/></svg>
    </button>`
  return L.divIcon({
    className: 'veh-marker-wrap',
    html: `
      <div class="${cls}" style="--vc:${sideColor};--veh-team:${team?.color ?? sideColor};--veh-fill:${team?.color ?? sideColor}">
        <span class="veh-side-ring"></span>
        <span class="veh-bg"></span>
        <img class="veh-icon" src="${v.iconUrl}" alt="${v.name}" draggable="false" />
        ${sideBtn}
        <button class="veh-team-letter" title="${team ? `${team.name}（点击切换队伍）` : '无队伍（点击设置队伍）'}" aria-label="切换载具所属队伍" onclick="event.stopPropagation();event.preventDefault();window.__vehTeam('${v.uid}')">${team?.id ?? '–'}</button>
        <button class="veh-route" title="绘制${v.name}行动路线" aria-label="绘制载具行动路线" onclick="event.stopPropagation();event.preventDefault();window.__vehRoute('${v.uid}')"><i class="fa-solid fa-route" aria-hidden="true"></i></button>
        <span class="veh-name">${v.name}</span>
      </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

/** 单个可拖拽/可旋转载具标记 */
function VehicleMarker({
  vehicle,
  view,
  canDrag,
  interactive,
  onMove,
  onRotate,
  onDelete,
  onToggleSide,
  onChangeTeam,
  onStartRoute,
  posRef,
}: {
  vehicle: VehicleItem
  view: Side
  canDrag: boolean
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onDelete: (uid: string) => void
  onToggleSide: (uid: string) => void
  onChangeTeam: (uid: string, team?: OperatorTeam) => void
  onStartRoute: (uid: string) => void
  posRef: MutableRefObject<Record<string, [number, number]>>
}) {
  const ref = useRef<L.Marker | null>(null)
  const [expanded, setExpanded] = useState(false)
  // 最新角度副本：滚轮连续滚动时无需 React 往返，直接读/写
  const rotRef = useRef(vehicle.rotation ?? 0)
  rotRef.current = vehicle.rotation ?? 0

  // 位置注册表（第十四轮：套索框选/整体移动读取实时位置）
  useEffect(() => {
    posRef.current[vehicle.uid] = [vehicle.lat, vehicle.lng]
    return () => {
      delete posRef.current[vehicle.uid]
    }
  }, [vehicle.uid, vehicle.lat, vehicle.lng, posRef])

  // 关键：不依赖 rotation，旋转时 icon 引用不变 → DOM 元素不重建 → 监听器持续有效
  // view / side 变化时重建 icon：底色随攻/守视角实时反转，切换按钮语义同步
  const icon = useMemo(
    () => buildVehicleIcon(vehicle, view, expanded),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicle.name, vehicle.iconUrl, vehicle.side, vehicle.team, view, expanded],
  )

  // 问题3：把 state 中的角度写入图标 DOM（单一数据源）。元素重建（如展开/收起）后自动恢复当前角度。
  useEffect(() => {
    const el = ref.current?.getElement() as HTMLElement | null
    const img = el?.querySelector<HTMLElement>('.veh-icon')
    if (img) img.style.transform = `rotate(${vehicle.rotation ?? 0}deg)`
  }, [vehicle.rotation, expanded])

  // 问题3：滚轮旋转（轮询等待图标元素就绪后绑定，DOM 直接更新角度）
  useEffect(() => {
    let el: HTMLElement | null = null
    let timer: number | undefined
    let disposed = false

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? ROTATE_STEP : -ROTATE_STEP
      const next = (Math.round(rotRef.current + delta) % 360 + 360) % 360
      rotRef.current = next
      // 直接写 DOM（无 transition，角度精确响应用户滚轮，不产生额外旋转）
      const img = el?.querySelector<HTMLElement>('.veh-icon')
      if (img) img.style.transform = `rotate(${next}deg)`
      onRotate(vehicle.uid, next)
    }

    const tryBind = () => {
      if (disposed) return
      el = (ref.current?.getElement() as HTMLElement | null) ?? null
      if (!el) {
        timer = window.setTimeout(tryBind, 40)
        return
      }
      el.addEventListener('wheel', onWheel, { passive: false })
    }

    tryBind()
    return () => {
      disposed = true
      if (timer) window.clearTimeout(timer)
      el?.removeEventListener('wheel', onWheel)
    }
  }, [vehicle.uid, onRotate, expanded])

  // 快捷切换阵营按钮：window.__vehSide(uid)，与删除按钮同样的分发器机制
  useEffect(() => {
    const w = window as unknown as {
      __vehSide?: (uid: string) => void
      __vehSideHandlers?: Record<string, () => void>
    }
    if (!w.__vehSide) {
      w.__vehSide = (uid: string) => w.__vehSideHandlers?.[uid]?.()
    }
    if (!w.__vehSideHandlers) w.__vehSideHandlers = {}
    w.__vehSideHandlers[vehicle.uid] = () => onToggleSide(vehicle.uid)
    return () => {
      if (w.__vehSideHandlers) delete w.__vehSideHandlers[vehicle.uid]
    }
  }, [vehicle.uid, onToggleSide])

  // 左下角队伍角标：点击按 A→B→C→D→E 循环，变化立即持久化。
  useEffect(() => {
    const w = window as unknown as {
      __vehTeam?: (uid: string) => void
      __vehTeamHandlers?: Record<string, () => void>
    }
    if (!w.__vehTeam) w.__vehTeam = (uid: string) => w.__vehTeamHandlers?.[uid]?.()
    if (!w.__vehTeamHandlers) w.__vehTeamHandlers = {}
    w.__vehTeamHandlers[vehicle.uid] = () => {
      const order: Array<OperatorTeam | undefined> = [undefined, 'A', 'B', 'C', 'D', 'E']
      const index = order.indexOf(vehicle.team)
      onChangeTeam(vehicle.uid, order[(index + 1) % order.length])
    }
    return () => {
      if (w.__vehTeamHandlers) delete w.__vehTeamHandlers[vehicle.uid]
    }
  }, [vehicle.uid, vehicle.team, onChangeTeam])

  useEffect(() => {
    const w = window as unknown as {
      __vehRoute?: (uid: string) => void
      __vehRouteHandlers?: Record<string, () => void>
    }
    if (!w.__vehRoute) w.__vehRoute = (uid: string) => w.__vehRouteHandlers?.[uid]?.()
    if (!w.__vehRouteHandlers) w.__vehRouteHandlers = {}
    w.__vehRouteHandlers[vehicle.uid] = () => onStartRoute(vehicle.uid)
    return () => {
      if (w.__vehRouteHandlers) delete w.__vehRouteHandlers[vehicle.uid]
    }
  }, [vehicle.uid, onStartRoute])

  return (
    <Marker
      ref={ref}
      position={[vehicle.lat, vehicle.lng]}
      icon={icon}
      draggable={canDrag}
      zIndexOffset={800}
      // 绘制工具激活时禁用交互：载具图标不拦截 mousedown，绘制可穿过
      interactive={interactive}
      eventHandlers={{
        click: () => {
          // 绘制工具激活时忽略点击（不展开载具属性卡）
          if (!interactive) return
          setExpanded((v) => !v)
        },
        dragstart: () => setExpanded(false),
        dragend: (e) => {
          const ll = (e.target as L.Marker).getLatLng()
          onMove(vehicle.uid, ll.lat, ll.lng)
        },
        contextmenu: (event) => {
          L.DomEvent.stopPropagation(event)
          onDelete(vehicle.uid)
        },
      }}
    />
  )
}

/**
 * 载具卡片图层：
 * 载具以 Leaflet Marker（divIcon）渲染，跟随地图缩放/平移；
 * 显示模式与地图道具一致（彩色底衬圆标），支持滚轮旋转与拖拽，
 * 坐标与旋转角度均持久化到 localStorage。
 */
export default function VehicleLayer({ vehicles, view, canDrag, interactive, onMove, onRotate, onDelete, onToggleSide, onChangeTeam, onStartRoute, posRef }: VehicleLayerProps) {
  return (
    <>
      {vehicles.map((v) => (
        <VehicleMarker
          key={v.uid}
          vehicle={v}
          view={view}
          canDrag={canDrag}
          interactive={interactive}
          onMove={onMove}
          onRotate={onRotate}
          onDelete={onDelete}
          onToggleSide={onToggleSide}
          onChangeTeam={onChangeTeam}
          onStartRoute={onStartRoute}
          posRef={posRef}
        />
      ))}
    </>
  )
}
