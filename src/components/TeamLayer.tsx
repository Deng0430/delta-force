import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Tooltip, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { Side, TeamMarker } from '../types'
import { teamOf } from '../config/operators'
import { platform } from '../platform'

interface TeamLayerProps {
  view: Side
  /** 当前视角桶内全部队标（含双方：side === view 为我方绿，敌方红） */
  teams: TeamMarker[]
  /** 小队名称表（wargame.teamRoles，队标名称与其同步；缺省回退队标自带 name） */
  teamNames: Record<string, string>
  /** 队标坐标注册表：uid → [lat, lng]，供套索框选/整体移动读取 */
  posRef: React.MutableRefObject<Record<string, [number, number]>>
  /** 是否允许拖拽（绘制工具激活时禁止） */
  canDrag: boolean
  interactive: boolean
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleFireLine: (uid: string) => void
  onDelete: (uid: string) => void
  onStartRoute: (uid: string) => void
}

/** 阵营色：我方绿 / 敌方红（与干员棋子一致） */
const SIDE_COLOR = {
  own: { bright: '#01ff84', deep: '#067a4e' },
  enemy: { bright: '#e0453a', deep: '#a02a22' },
} as const

/** 队伍色暗化（圆底渐变下端） */
function darken(hex: string, f = 0.6): string {
  const m = hex.replace('#', '')
  const r = Math.round(parseInt(m.slice(0, 2), 16) * f)
  const g = Math.round(parseInt(m.slice(2, 4), 16) * f)
  const b = Math.round(parseInt(m.slice(4, 6), 16) * f)
  return `rgb(${r},${g},${b})`
}

/**
 * 构建队标 divIcon（第二十三轮）：
 * - 主图标：队伍色渐变圆底 + 队伍字母（A/B/C…，与干员棋子的职业剪影位置一致）
 * - 棋子上方：小队名称标签（同干员名字条风格，阵营色底）
 * - 外圈：阵营色粗环 + 发光（我方=绿，敌方=红，与干员/载具一致）
 * 大小 30px，与载具卡片相当。
 */
function buildTeamIcon(tm: TeamMarker, view: Side, teamName?: string, expanded = false): L.DivIcon {
  const team = teamOf(tm.team)
  const fireLineClick = platform.kind === 'android' ? '' : `onclick="event.stopPropagation();event.preventDefault();window.__tmFireLine('${tm.uid}')"`
  const own = tm.side === view
  const sc = own ? SIDE_COLOR.own : SIDE_COLOR.enemy
  const name = teamName?.trim() || tm.name || `${tm.team}队`
  return L.divIcon({
    className: 'tm-wrap',
    html: `
      <div class="tm-marker ${expanded ? 'expanded' : ''}" style="--tm-team:${team.color};--tm-team-dark:${darken(team.color)};--tm-side:${sc.bright};--tm-side-deep:${sc.deep}" title="${team.name}">
        <span class="tm-side-ring"></span>
        <span class="tm-team-bg"></span>
        <span class="tm-letter">${team.id}</span>
        <span class="tm-name">${name}</span>
        <span class="tm-action-fan" aria-hidden="true"></span>
        <button class="tm-route" title="绘制${team.name}进攻路线" aria-label="绘制进攻路线" onclick="event.stopPropagation();event.preventDefault();window.__tmRoute('${tm.uid}')"><i class="fa-solid fa-route" aria-hidden="true"></i></button>
        <button class="tm-fireline${tm.fireLineEnabled ? ' active' : ''}" data-fireline-length="${tm.fireLineLength ?? 56}" title="${tm.fireLineEnabled ? '关闭' : '开启'}枪线；长按调整长度" aria-label="切换枪线，长按调整长度" onwheel="event.stopPropagation();event.preventDefault();window.dispatchEvent(new CustomEvent('unit-fireline-length',{detail:{kind:'team',uid:'${tm.uid}',delta:event.deltaY>0?-4:4}}))" onpointerdown="window.__unitFireLineDragStart?.(event,'team','${tm.uid}')" ${fireLineClick}><i class="fa-solid fa-crosshairs"></i></button>
        ${platform.kind === 'android' ? `<button type="button" class="tm-rotate-control unit-rotate-drag" aria-label="按住并拖动旋转队标枪线" onmousedown="event.stopPropagation();event.preventDefault()" ontouchstart="event.stopPropagation();event.preventDefault()" onpointerdown="window.__tmRotateStart(event,'${tm.uid}')"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>` : ''}
        ${platform.kind === 'android' ? `<button class="tm-delete" title="删除队标" aria-label="删除队标" onclick="event.stopPropagation();event.preventDefault();window.__tmDelete('${tm.uid}')"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>` : ''}
      </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

/** 单个队标标记 */
function TeamMarkerItem({
  tm,
  view,
  teamName,
  canDrag,
  interactive,
  posRef,
  onMove,
  onRotate,
  onToggleFireLine,
  onDelete,
  onStartRoute,
}: {
  tm: TeamMarker
  view: Side
  teamName?: string
  canDrag: boolean
  interactive: boolean
  posRef: React.MutableRefObject<Record<string, [number, number]>>
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleFireLine: (uid: string) => void
  onDelete: (uid: string) => void
  onStartRoute: (uid: string) => void
}) {
  const ref = useRef<L.Marker | null>(null)
  const [expanded, setExpanded] = useState(false)
  const map = useMap()
  const rotationRef = useRef(tm.rotation ?? 0)
  rotationRef.current = tm.rotation ?? 0

  useEffect(() => {
    if (platform.kind !== 'android') return
    const w = window as unknown as { __tmRotateStart?: (event: PointerEvent, uid: string) => void; __tmRotateStartHandlers?: Record<string, (event: PointerEvent) => void> }
    if (!w.__tmRotateStart) w.__tmRotateStart = (event, uid) => w.__tmRotateStartHandlers?.[uid]?.(event)
    if (!w.__tmRotateStartHandlers) w.__tmRotateStartHandlers = {}
    w.__tmRotateStartHandlers[tm.uid] = (event) => {
      event.preventDefault(); event.stopPropagation()
      const marker = ref.current?.getElement(); if (!marker) return
      const rect = marker.getBoundingClientRect(); const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2
      const startAngle = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI
      const startRotation = rotationRef.current
      const move = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return
        e.preventDefault(); const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI
        const next = (startRotation + angle - startAngle + 360) % 360
        rotationRef.current = next
        window.dispatchEvent(new CustomEvent('unit-rotation-preview', { detail: { uid: tm.uid, rotation: next } }))
        onRotate(tm.uid, Math.round(next))
      }
      const finish = (e: PointerEvent) => { if (e.pointerId !== event.pointerId) return; document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); window.dispatchEvent(new CustomEvent('unit-rotation-preview', { detail: { uid: tm.uid, rotation: null } })) }
      document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', finish)
    }
    return () => { if (w.__tmRotateStartHandlers) delete w.__tmRotateStartHandlers[tm.uid] }
  }, [tm.uid, onRotate])

  useEffect(() => {
    let element: HTMLElement | null = null
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const next = (rotationRef.current + (event.deltaY > 0 ? 15 : -15) + 360) % 360
      rotationRef.current = next
      onRotate(tm.uid, next)
    }
    const timer = window.setTimeout(() => {
      element = ref.current?.getElement() ?? null
      element?.addEventListener('wheel', onWheel, { passive: false })
    }, 0)
    return () => { window.clearTimeout(timer); element?.removeEventListener('wheel', onWheel) }
  }, [tm.uid, onRotate, expanded])

  useEffect(() => {
    const w = window as unknown as { __tmFireLine?: (uid: string) => void; __tmFireLineHandlers?: Record<string, () => void> }
    if (!w.__tmFireLine) w.__tmFireLine = (uid) => w.__tmFireLineHandlers?.[uid]?.()
    if (!w.__tmFireLineHandlers) w.__tmFireLineHandlers = {}
    w.__tmFireLineHandlers[tm.uid] = () => onToggleFireLine(tm.uid)
    return () => { if (w.__tmFireLineHandlers) delete w.__tmFireLineHandlers[tm.uid] }
  }, [tm.uid, onToggleFireLine])

  useEffect(() => {
    if (platform.kind !== 'android') return
    const collapse = () => setExpanded(false)
    const selectOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== tm.uid) collapse()
    }
    map.on('click', collapse)
    window.addEventListener('mobile-unit-selected', selectOther)
    return () => {
      map.off('click', collapse)
      window.removeEventListener('mobile-unit-selected', selectOther)
    }
  }, [map, tm.uid])

  // 位置注册表：套索框选/整体移动读取
  useEffect(() => {
    if (tm.lat == null || tm.lng == null) {
      delete posRef.current[tm.uid]
      return
    }
    posRef.current[tm.uid] = [tm.lat, tm.lng]
    return () => {
      delete posRef.current[tm.uid]
    }
  }, [tm.uid, tm.lat, tm.lng, posRef])

  const icon = useMemo(
    () => buildTeamIcon(tm, view, teamName, expanded),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tm.uid, tm.team, tm.name, tm.side, tm.fireLineEnabled, view, teamName, expanded],
  )

  useEffect(() => {
    const element = ref.current?.getElement()
    if (!element) return
    const stopButtonPointer = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.('button')) event.stopPropagation()
    }
    for (const name of ['pointerdown', 'mousedown', 'touchstart']) element.addEventListener(name, stopButtonPointer)
    return () => {
      for (const name of ['pointerdown', 'mousedown', 'touchstart']) element.removeEventListener(name, stopButtonPointer)
    }
  }, [tm.uid, expanded, icon])

  // 右键删除队标（原生 contextmenu 绑定）
  useEffect(() => {
    if (platform.kind === 'android') return
    const el = ref.current?.getElement()
    if (!el) return
    const onCtx = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDelete(tm.uid)
    }
    el.addEventListener('contextmenu', onCtx)
    return () => el.removeEventListener('contextmenu', onCtx)
  }, [tm.uid, onDelete, icon])

  useEffect(() => {
    const w = window as unknown as {
      __tmRoute?: (uid: string) => void
      __tmRouteHandlers?: Record<string, () => void>
    }
    if (!w.__tmRoute) w.__tmRoute = (uid: string) => w.__tmRouteHandlers?.[uid]?.()
    if (!w.__tmRouteHandlers) w.__tmRouteHandlers = {}
    w.__tmRouteHandlers[tm.uid] = () => onStartRoute(tm.uid)
    return () => {
      if (w.__tmRouteHandlers) delete w.__tmRouteHandlers[tm.uid]
    }
  }, [tm.uid, onStartRoute])

  useEffect(() => {
    const w = window as unknown as {
      __tmDelete?: (uid: string) => void
      __tmDeleteHandlers?: Record<string, () => void>
    }
    if (!w.__tmDelete) w.__tmDelete = (uid) => w.__tmDeleteHandlers?.[uid]?.()
    if (!w.__tmDeleteHandlers) w.__tmDeleteHandlers = {}
    w.__tmDeleteHandlers[tm.uid] = () => onDelete(tm.uid)
    return () => {
      if (w.__tmDeleteHandlers) delete w.__tmDeleteHandlers[tm.uid]
    }
  }, [tm.uid, onDelete])

  // 未部署（null 坐标）不渲染
  if (tm.lat == null || tm.lng == null) return null

  return (
    <Marker
      ref={ref}
      position={[tm.lat, tm.lng]}
      icon={icon}
      draggable={canDrag}
      zIndexOffset={800}
      interactive={interactive}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e)
          if (platform.kind === 'android') {
            window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: tm.uid }))
            setExpanded((value) => !value)
          }
        },
        dragstart: () => ref.current?.getElement()?.classList.add('mobile-unit-dragging'),
        drag: (e) => {
          const ll = (e.target as L.Marker).getLatLng()
          posRef.current[tm.uid] = [ll.lat, ll.lng]
          window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', {
            detail: { phase: 'move', kind: 'team', uid: tm.uid, lat: ll.lat, lng: ll.lng },
          }))
        },
        dragend: (e) => {
          ref.current?.getElement()?.classList.remove('mobile-unit-dragging')
          const ll = (e.target as L.Marker).getLatLng()
          onMove(tm.uid, ll.lat, ll.lng)
          if (platform.kind === 'android') setExpanded(true)
          window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', {
              detail: { phase: 'end', kind: 'team', uid: tm.uid, lat: ll.lat, lng: ll.lng },
            })))
        },
      }}
    >
      {platform.kind !== 'android' && <Tooltip direction="top" offset={[0, -28]}>
        {teamName?.trim() || tm.name || `${tm.team}队`} · 滚轮旋转 · 右键删除 · 枪线按钮上滚轮调长度
      </Tooltip>}
    </Marker>
  )
}

/**
 * 队标图层（兵棋推演·简化部署，第二十三轮）：
 * 以 Leaflet Marker + divIcon 渲染，队伍色圆底 + 队伍字母 + 小队名，
 * 阵营外圈（我方绿/敌方红），大小 30px 与载具卡片相当。
 * 视角桶内同时含双方队标；支持拖拽移动、右键删除；套索框选/整体移动由 LayerManager 统一处理。
 */
export default function TeamLayer({
  view,
  teams,
  teamNames,
  posRef,
  canDrag,
  interactive,
  onMove,
  onRotate,
  onToggleFireLine,
  onDelete,
  onStartRoute,
}: TeamLayerProps) {
  return (
    <>
      {teams.map((tm) => (
        <TeamMarkerItem
          key={tm.uid}
          tm={tm}
          view={view}
          teamName={teamNames[tm.team]}
          canDrag={canDrag}
          interactive={interactive}
          posRef={posRef}
          onMove={onMove}
          onRotate={onRotate}
          onToggleFireLine={onToggleFireLine}
          onDelete={onDelete}
          onStartRoute={onStartRoute}
        />
      ))}
    </>
  )
}
