import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Marker, Tooltip, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { OperatorTeam, Side, VehicleItem } from '../types'
import { teamOf } from '../config/operators'
import { platform } from '../platform'

interface VehicleLayerProps {
  vehicles: VehicleItem[]
  /** 当前攻防视角：本方部署 = 绿底，敌方 = 红底（随视角实时反转） */
  view: Side
  /** 是否允许拖拽（绘制模式下禁止，避免误拖） */
  canDrag: boolean
  /** 绘制工具激活时禁用点击展开（不弹载具属性） */
  interactive: boolean
  allowSelect: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  /** 问题3：旋转角度回调（持久化） */
  onRotate: (uid: string, rotation: number) => void
  onToggleFireLine: (uid: string) => void
  onDelete: (uid: string) => void
  /** 定位该兵棋对应的官方载具刷新点。 */
  onLocateRefreshSource: (vehicle: VehicleItem) => void
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
function buildVehicleIcon(v: VehicleItem, view: Side, expanded: boolean, showControls: boolean): L.DivIcon {
  const sideCls = v.side === 'attack' ? 'attack' : 'defense'
  // 图例图标（base64 data URI）正常大小；无图例的本地 PNG 图标（如 ATV）加 no-legend 缩小
  const legendCls = v.iconUrl.startsWith('data:') ? '' : 'no-legend'
  const enlargedLegendCls = v.name.includes('主战坦克') || v.name.includes('两栖装甲') ? 'enlarged-legend-icon' : ''
  const cls = ['veh-marker', sideCls, legendCls, enlargedLegendCls, expanded ? 'expanded' : '', showControls ? 'controls-enabled' : '', v.sourceType === 'vehicle-refresh' ? 'refresh-origin' : ''].filter(Boolean).join(' ')
  const team = v.team ? teamOf(v.team) : null
  const sideColor = vehicleColor(v, view)
  const fireLineClick = platform.kind === 'android' ? '' : `onclick="event.stopPropagation();event.preventDefault();window.__vehFireLine('${v.uid}')"`
  // 快捷切换阵营按钮（左上角，hover 显示）：点击切换攻↔守，底色随视角实时反转
  const sideBtn = `
    <button class="veh-side" title="切换本方/敌方" aria-label="切换本方/敌方" onclick="event.stopPropagation();event.preventDefault();window.__vehSide('${v.uid}')">
      <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3.5 1 6l2.5 2.5M8.5 3.5 11 6l-2.5 2.5M1 6h10"/></svg>
    </button>`
  const mobileControls = platform.kind === 'android' ? `
        <button type="button" class="veh-rotate-control unit-rotate-drag" aria-label="按住并拖动旋转载具" onmousedown="event.stopPropagation();event.preventDefault()" ontouchstart="event.stopPropagation();event.preventDefault()" onpointerdown="window.__vehRotateStart(event,'${v.uid}')"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>
        <button type="button" class="veh-delete-control danger" aria-label="删除载具" onclick="event.stopPropagation();event.preventDefault();window.__vehDelete('${v.uid}')"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>` : ''
  const refreshOrigin = v.sourceType === 'vehicle-refresh'
    ? platform.kind === 'android' && !expanded
      ? '<span class="veh-refresh-badge" aria-hidden="true">刷</span>'
      : `<button type="button" class="veh-refresh-origin" title="刷新载具 · 点击定位原刷新点" aria-label="定位原刷新点" onclick="event.stopPropagation();event.preventDefault();window.__vehRefreshSource('${v.uid}')">刷</button>`
    : ''
  return L.divIcon({
    className: 'veh-marker-wrap',
    html: `
      <div class="${cls}" style="--vc:${sideColor};--veh-team:${team?.color ?? sideColor};--veh-fill:${team?.color ?? sideColor}">
        <span class="veh-side-ring"></span>
        <span class="veh-bg"></span>
        <img class="veh-icon" src="${v.iconUrl}" alt="${v.name}" draggable="false" />
        <span class="veh-action-fan" aria-hidden="true"></span>
        ${sideBtn}
        <button class="veh-team-letter" title="${team ? `${team.name}（点击切换队伍）` : '无队伍（点击设置队伍）'}" aria-label="切换载具所属队伍" onclick="event.stopPropagation();event.preventDefault();window.__vehTeam('${v.uid}')">${team?.id ?? '–'}</button>
        <button class="veh-route" title="绘制${v.name}行动路线" aria-label="绘制载具行动路线" onclick="event.stopPropagation();event.preventDefault();window.__vehRoute('${v.uid}')"><i class="fa-solid fa-route" aria-hidden="true"></i></button>
        <button class="veh-fireline${v.fireLineEnabled ? ' active' : ''}" data-fireline-length="${v.fireLineLength ?? 56}" title="${v.fireLineEnabled ? '关闭' : '开启'}枪线；长按调整长度" aria-label="切换枪线，长按调整长度" onwheel="event.stopPropagation();event.preventDefault();window.dispatchEvent(new CustomEvent('unit-fireline-length',{detail:{kind:'vehicle',uid:'${v.uid}',delta:event.deltaY>0?-4:4}}))" onpointerdown="window.__unitFireLineDragStart?.(event,'vehicle','${v.uid}')" ${fireLineClick}><i class="fa-solid fa-crosshairs" aria-hidden="true"></i></button>
        ${refreshOrigin}
        ${mobileControls}
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
  allowSelect,
  onMove,
  onRotate,
  onToggleFireLine,
  onDelete,
  onLocateRefreshSource,
  onToggleSide,
  onChangeTeam,
  onStartRoute,
  posRef,
}: {
  vehicle: VehicleItem
  view: Side
  canDrag: boolean
  interactive: boolean
  allowSelect: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleFireLine: (uid: string) => void
  onDelete: (uid: string) => void
  onLocateRefreshSource: (vehicle: VehicleItem) => void
  onToggleSide: (uid: string) => void
  onChangeTeam: (uid: string, team?: OperatorTeam) => void
  onStartRoute: (uid: string) => void
  posRef: MutableRefObject<Record<string, [number, number]>>
}) {
  const ref = useRef<L.Marker | null>(null)
  const [expanded, setExpanded] = useState(false)
  const touchTapAtRef = useRef(0)
  const map = useMap()

  useEffect(() => {
    if (platform.kind !== 'android') return
    const collapse = () => setExpanded(false)
    const selectOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== vehicle.uid) collapse()
    }
    map.on('click', collapse)
    window.addEventListener('mobile-unit-selected', selectOther)
    return () => {
      map.off('click', collapse)
      window.removeEventListener('mobile-unit-selected', selectOther)
    }
  }, [map, vehicle.uid])
  // 最新角度副本：滚轮连续滚动时无需 React 往返，直接读/写
  const rotRef = useRef(vehicle.rotation ?? 0)
  rotRef.current = vehicle.rotation ?? 0
  const mapBearingRef = useRef(map.getBearing())

  useEffect(() => {
    const syncMapBearing = () => {
      mapBearingRef.current = map.getBearing()
      const image = (ref.current?.getElement() as HTMLElement | null)?.querySelector<HTMLElement>('.veh-icon')
      if (image) image.style.transform = `rotate(${rotRef.current + mapBearingRef.current}deg)`
    }
    map.on('rotate', syncMapBearing)
    syncMapBearing()
    return () => {
      map.off('rotate', syncMapBearing)
    }
  }, [map, expanded])

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
    () => buildVehicleIcon(vehicle, view, expanded, interactive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicle.name, vehicle.iconUrl, vehicle.side, vehicle.team, vehicle.sourceType, vehicle.fireLineEnabled, view, expanded, interactive],
  )

  // 问题3：把 state 中的角度写入图标 DOM（单一数据源）。元素重建（如展开/收起）后自动恢复当前角度。
  useEffect(() => {
    const el = ref.current?.getElement() as HTMLElement | null
    const img = el?.querySelector<HTMLElement>('.veh-icon')
    if (img) img.style.transform = `rotate(${(vehicle.rotation ?? 0) + mapBearingRef.current}deg)`
  }, [vehicle.rotation, expanded, icon])

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
      if (img) img.style.transform = `rotate(${next + mapBearingRef.current}deg)`
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

  useEffect(() => {
    const w = window as unknown as { __vehFireLine?: (uid: string) => void; __vehFireLineHandlers?: Record<string, () => void> }
    if (!w.__vehFireLine) w.__vehFireLine = (uid) => w.__vehFireLineHandlers?.[uid]?.()
    if (!w.__vehFireLineHandlers) w.__vehFireLineHandlers = {}
    w.__vehFireLineHandlers[vehicle.uid] = () => onToggleFireLine(vehicle.uid)
    return () => { if (w.__vehFireLineHandlers) delete w.__vehFireLineHandlers[vehicle.uid] }
  }, [vehicle.uid, onToggleFireLine])

  useEffect(() => {
    if (platform.kind !== 'android') return
    const w = window as unknown as {
      __vehRotateStart?: (event: PointerEvent, uid: string) => void
      __vehRotateStartHandlers?: Record<string, (event: PointerEvent) => void>
      __vehDelete?: (uid: string) => void
      __vehDeleteHandlers?: Record<string, () => void>
    }
    if (!w.__vehRotateStart) w.__vehRotateStart = (event, uid) => w.__vehRotateStartHandlers?.[uid]?.(event)
    if (!w.__vehRotateStartHandlers) w.__vehRotateStartHandlers = {}
    if (!w.__vehDelete) w.__vehDelete = (uid) => w.__vehDeleteHandlers?.[uid]?.()
    if (!w.__vehDeleteHandlers) w.__vehDeleteHandlers = {}
    w.__vehRotateStartHandlers[vehicle.uid] = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const marker = ref.current?.getElement()
      if (!marker) return
      ref.current?.dragging?.disable()
      const rect = marker.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const startPointerAngle = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI
      const startRotation = rotRef.current
      let finalRotation = startRotation
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return
        moveEvent.preventDefault()
        const pointerAngle = Math.atan2(moveEvent.clientY - cy, moveEvent.clientX - cx) * 180 / Math.PI
        finalRotation = (startRotation + pointerAngle - startPointerAngle + 360) % 360
        rotRef.current = finalRotation
        window.dispatchEvent(new CustomEvent('unit-rotation-preview', { detail: { uid: vehicle.uid, rotation: finalRotation } }))
        const image = marker.querySelector<HTMLElement>('.veh-icon')
        if (image) image.style.transform = `rotate(${finalRotation + mapBearingRef.current}deg)`
      }
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== event.pointerId) return
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
        window.dispatchEvent(new CustomEvent('unit-rotation-preview', { detail: { uid: vehicle.uid, rotation: null } }))
        if (platform.kind !== 'android' && canDrag) ref.current?.dragging?.enable()
        onRotate(vehicle.uid, Math.round(finalRotation))
      }
      document.addEventListener('pointermove', move, { passive: false })
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }
    w.__vehDeleteHandlers[vehicle.uid] = () => onDelete(vehicle.uid)
    return () => {
      if (w.__vehRotateStartHandlers) delete w.__vehRotateStartHandlers[vehicle.uid]
      if (w.__vehDeleteHandlers) delete w.__vehDeleteHandlers[vehicle.uid]
    }
  }, [vehicle.uid, canDrag, onRotate, onDelete])

  useEffect(() => {
    if (platform.kind !== 'android' || !interactive) return
    let element: HTMLElement | null = null
    let bindTimer: number | undefined
    let disposed = false
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('button')) {
        event.stopPropagation()
        return
      }
      if (event.pointerType === 'mouse') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const marker = ref.current
      if (!marker) return
      const mapDraggingWasEnabled = map.dragging.enabled()
      if (mapDraggingWasEnabled) map.dragging.disable()
      marker.dragging?.disable()
      const pointerId = event.pointerId
      const startPointer = L.point(event.clientX, event.clientY)
      const startLatLng = marker.getLatLng()
      let moved = false
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        moveEvent.preventDefault()
        const delta = L.point(moveEvent.clientX, moveEvent.clientY).subtract(startPointer)
        if (delta.distanceTo(L.point(0, 0)) <= 5) return
        moved = true
        const origin = map.latLngToContainerPoint(startLatLng)
        const point = map.containerPointToLatLng(origin.add(delta))
        marker.setLatLng(point)
        posRef.current[vehicle.uid] = [point.lat, point.lng]
        marker.getElement()?.classList.add('mobile-unit-dragging')
      }
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
        marker.getElement()?.classList.remove('mobile-unit-dragging')
        if (mapDraggingWasEnabled) map.dragging.enable()
        if (moved) {
          const point = marker.getLatLng()
          onMove(vehicle.uid, point.lat, point.lng)
          setExpanded(true)
        } else if (allowSelect) {
          touchTapAtRef.current = Date.now()
          window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: vehicle.uid }))
          setExpanded((value) => !value)
        }
      }
      document.addEventListener('pointermove', move, { passive: false })
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }
    const bind = () => {
      if (disposed) return
      element = ref.current?.getElement() ?? null
      if (!element) {
        bindTimer = window.setTimeout(bind, 40)
        return
      }
      element.addEventListener('pointerdown', onPointerDown, { passive: false })
    }
    bind()
    return () => {
      disposed = true
      if (bindTimer) window.clearTimeout(bindTimer)
      element?.removeEventListener('pointerdown', onPointerDown)
    }
  }, [allowSelect, interactive, map, onMove, posRef, vehicle.uid])

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

  useEffect(() => {
    if (vehicle.sourceType !== 'vehicle-refresh') return
    const w = window as unknown as {
      __vehRefreshSource?: (uid: string) => void
      __vehRefreshSourceHandlers?: Record<string, () => void>
    }
    if (!w.__vehRefreshSource) w.__vehRefreshSource = (uid) => w.__vehRefreshSourceHandlers?.[uid]?.()
    if (!w.__vehRefreshSourceHandlers) w.__vehRefreshSourceHandlers = {}
    w.__vehRefreshSourceHandlers[vehicle.uid] = () => onLocateRefreshSource(vehicle)
    return () => { if (w.__vehRefreshSourceHandlers) delete w.__vehRefreshSourceHandlers[vehicle.uid] }
  }, [onLocateRefreshSource, vehicle])

  return (
    <Marker
      ref={ref}
      position={[vehicle.lat, vehicle.lng]}
      icon={icon}
      draggable={canDrag && platform.kind !== 'android'}
      zIndexOffset={800}
      // 绘制工具激活时禁用交互：载具图标不拦截 mousedown，绘制可穿过
      interactive={interactive}
      eventHandlers={{
        click: (event) => {
          // 绘制工具激活时忽略点击（不展开载具属性卡）
          if (!interactive || !allowSelect) return
          if (platform.kind === 'android') {
            if (Date.now() - touchTapAtRef.current < 500) return
            L.DomEvent.stopPropagation(event)
            window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: vehicle.uid }))
          }
          setExpanded((v) => !v)
        },
        dragstart: () => ref.current?.getElement()?.classList.add('mobile-unit-dragging'),
        drag: (e) => {
          const ll = (e.target as L.Marker).getLatLng()
          posRef.current[vehicle.uid] = [ll.lat, ll.lng]
          window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', {
            detail: { phase: 'move', kind: 'vehicle', uid: vehicle.uid, lat: ll.lat, lng: ll.lng },
          }))
        },
        dragend: (e) => {
          ref.current?.getElement()?.classList.remove('mobile-unit-dragging')
          const ll = (e.target as L.Marker).getLatLng()
          onMove(vehicle.uid, ll.lat, ll.lng)
          if (platform.kind === 'android') setExpanded(true)
          window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', {
            detail: { phase: 'end', kind: 'vehicle', uid: vehicle.uid, lat: ll.lat, lng: ll.lng },
          })))
        },
        contextmenu: (event) => {
          L.DomEvent.stopPropagation(event)
          if (platform.kind !== 'android') onDelete(vehicle.uid)
        },
      }}
    >
      {platform.kind !== 'android' && <Tooltip direction="top" offset={[0, -30]}>
        {vehicle.name}{vehicle.sourceType === 'vehicle-refresh' ? ' · 刷新载具' : ''} · 滚轮旋转 · 右键删除 · 枪线按钮上滚轮调长度
      </Tooltip>}
    </Marker>
  )
}

/**
 * 载具卡片图层：
 * 载具以 Leaflet Marker（divIcon）渲染，跟随地图缩放/平移；
 * 显示模式与地图道具一致（彩色底衬圆标），支持滚轮旋转与拖拽，
 * 坐标与旋转角度均持久化到 localStorage。
 */
export default function VehicleLayer({ vehicles, view, canDrag, interactive, allowSelect, onMove, onRotate, onToggleFireLine, onDelete, onLocateRefreshSource, onToggleSide, onChangeTeam, onStartRoute, posRef }: VehicleLayerProps) {
  return (
    <>
      {vehicles.map((v) => (
        <VehicleMarker
          key={v.uid}
          vehicle={v}
          view={view}
          canDrag={canDrag}
          interactive={interactive}
          allowSelect={allowSelect}
          onMove={onMove}
          onRotate={onRotate}
          onToggleFireLine={onToggleFireLine}
          onDelete={onDelete}
          onLocateRefreshSource={onLocateRefreshSource}
          onToggleSide={onToggleSide}
          onChangeTeam={onChangeTeam}
          onStartRoute={onStartRoute}
          posRef={posRef}
        />
      ))}
    </>
  )
}
