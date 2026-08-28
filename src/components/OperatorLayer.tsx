import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Tooltip, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { OperatorUnit, Side } from '../types'
import { operatorClassOf, teamOf } from '../config/operators'
import { profileOf } from '../config/operatorProfiles'
import { platform } from '../platform'

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
  onRotate: (uid: string, rotation: number) => void
  onToggleFireLine: (uid: string) => void
  onClearDeploy: (uid: string) => void
  onStartRoute: (uid: string) => void
  /** 关系编辑点击回调（App 决定建立/解除关系） */
  onConnectClick: (uid: string) => void
  /** 普通模式点击回调：打开更换干员气泡（携带地图容器坐标，用于气泡定位） */
  onEditClick: (uid: string, containerPoint: { x: number; y: number }) => void
  /** 双击代号回调：快捷编辑昵称 */
  onRenameClick: (uid: string, containerPoint: { x: number; y: number }) => void
  skillTargeting?: boolean
  onSkillTarget?: (uid: string) => void
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
function buildOperatorIcon(op: OperatorUnit, view: Side, connectMode: boolean, pending: boolean, expanded = false): L.DivIcon {
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
    expanded ? 'expanded' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const interactionHint = platform.kind === 'android' ? '点击选中，拖动调整位置' : '右键清除部署'
  const activeSkill = op.activeSkillSlot
    ? `<span class="op-active-skill" title="技能 ${op.activeSkillSlot}"><img src="/icons/operators/skills/${op.operatorId}/skill_${op.activeSkillSlot}.png" alt="" draggable="false" /></span>`
    : ''
  const renameHint = platform.kind === 'android' ? '选中兵棋后点击修改名称' : '点击编辑昵称'
  const fireLineClick = ''
  return L.divIcon({
    className: 'op-marker-wrap',
    html: `
      <div class="${classes}" data-op-uid="${op.uid}" tabindex="0" style="--op-team:${team.color};--op-cls:${clsConf.color};--op-side:${sc.bright};--op-side-deep:${sc.deep};--op-team-dark:${darken(team.color)}" title="${profile.name} · ${clsConf.name} · ${status.label} · ${interactionHint}">
        <span class="op-side-ring"></span>
        <span class="op-team-bg"></span>
        <img class="op-cls-main" src="${clsConf.iconUrl}" alt="${clsConf.name}" draggable="false" />
        <span class="op-team-letter" title="${team.name}">${team.id}</span>
        <span class="op-code" title="${renameHint}">${op.name}</span>
        <span class="op-name">${profile.name}</span>
        <span class="op-status-dot" style="background:${op.status === 'alive' ? 'var(--green)' : op.status === 'injured' ? '#f4cf67' : '#7a8185'}"></span>
        ${activeSkill}
        <span class="op-action-fan" aria-hidden="true"></span>
        <button class="op-route" title="为${op.name}创建兵线" aria-label="创建兵线"><i class="fa-solid fa-route" aria-hidden="true"></i></button>
        <button class="op-fireline${op.fireLineEnabled ? ' active' : ''}" data-fireline-length="${op.fireLineLength ?? 56}" title="${op.fireLineEnabled ? '关闭' : '开启'}枪线；长按调整长度" aria-label="切换枪线，长按调整长度" onwheel="event.stopPropagation();event.preventDefault();window.dispatchEvent(new CustomEvent('unit-fireline-length',{detail:{kind:'operator',uid:'${op.uid}',delta:event.deltaY>0?-4:4}}))" onpointerdown="window.__unitFireLineDragStart?.(event,'operator','${op.uid}')" ${fireLineClick}><i class="fa-solid fa-crosshairs" aria-hidden="true"></i></button>
        <button class="op-info" title="干员信息" aria-label="打开干员信息"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>
        ${platform.kind === 'android' ? `<button type="button" class="op-delete" title="撤回部署" aria-label="撤回单兵部署"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>` : ''}
        ${platform.kind === 'android' ? `<button type="button" class="op-rotate-control unit-rotate-drag" aria-label="按住并拖动旋转单兵枪线" onmousedown="event.stopPropagation();event.preventDefault()" ontouchstart="event.stopPropagation();event.preventDefault()" onpointerdown="window.__opRotateStart(event,'${op.uid}')"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>` : ''}
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
  onRotate,
  onToggleFireLine,
  onClearDeploy,
  onStartRoute,
  onConnectClick,
  onEditClick,
  onRenameClick,
  skillTargeting,
  onSkillTarget,
}: {
  op: OperatorUnit
  view: Side
  canDrag: boolean
  connectMode: boolean
  pending: boolean
  interactive: boolean
  posRef: React.MutableRefObject<Record<string, [number, number]>>
  onMove: (uid: string, lat: number, lng: number) => void
  onRotate: (uid: string, rotation: number) => void
  onToggleFireLine: (uid: string) => void
  onClearDeploy: (uid: string) => void
  onStartRoute: (uid: string) => void
  onConnectClick: (uid: string) => void
  onEditClick: (uid: string, containerPoint: { x: number; y: number }) => void
  /** 双击代号快捷编辑昵称 */
  onRenameClick: (uid: string, containerPoint: { x: number; y: number }) => void
  skillTargeting?: boolean
  onSkillTarget?: (uid: string) => void
}) {
  const ref = useRef<L.Marker | null>(null)
  const [expanded, setExpanded] = useState(false)
  const map = useMap()
  const rotationRef = useRef(op.rotation ?? 0)
  rotationRef.current = op.rotation ?? 0

  // 兵棋图标的原生指针事件不能继续冒泡到 Leaflet 地图，否则拖动图标会同时平移地图。
  useEffect(() => {
    let element: HTMLElement | null = null
    let timer: number | undefined
    const stopPointer = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.closest('button')) {
        event.stopPropagation()
        return
      }
      event.stopPropagation()
    }
    const bind = () => {
      element = ref.current?.getElement() ?? null
      if (!element) {
        timer = window.setTimeout(bind, 40)
        return
      }
      L.DomEvent.disableScrollPropagation(element)
      for (const name of ['pointerdown', 'mousedown', 'touchstart', 'dragstart']) element.addEventListener(name, stopPointer)
    }
    bind()
    return () => {
      if (timer) window.clearTimeout(timer)
      if (element) for (const name of ['pointerdown', 'mousedown', 'touchstart', 'dragstart']) element.removeEventListener(name, stopPointer)
    }
  }, [op.uid, expanded])

  // Leaflet 的 Marker 事件类型不包含 wheel。监听稳定的地图容器并按 UID
  // 过滤目标，避免撤回/恢复导致 Marker DOM 替换后丢失旋转监听。
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(`.op-marker[data-op-uid="${op.uid}"]`)
      if (!target || (event.target as HTMLElement | null)?.closest?.('.op-fireline')) return
      event.preventDefault()
      event.stopPropagation()
      const next = (rotationRef.current + (event.deltaY > 0 ? 15 : -15) + 360) % 360
      rotationRef.current = next
      onRotate(op.uid, next)
    }
    const container = map.getContainer()
    container.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      container.removeEventListener('wheel', onWheel, true)
    }
  }, [map, op.uid, onRotate])

  useEffect(() => {
    if (platform.kind !== 'android') return
    const w = window as unknown as {
      __opRotateStart?: (event: PointerEvent, uid: string) => void
      __opRotateStartHandlers?: Record<string, (event: PointerEvent) => void>
    }
    if (!w.__opRotateStart) w.__opRotateStart = (event, uid) => w.__opRotateStartHandlers?.[uid]?.(event)
    if (!w.__opRotateStartHandlers) w.__opRotateStartHandlers = {}
    w.__opRotateStartHandlers[op.uid] = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const marker = ref.current?.getElement()
      if (!marker) return
      ref.current?.dragging?.disable()
      const rect = marker.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const startPointerAngle = Math.atan2(event.clientY - cy, event.clientX - cx) * 180 / Math.PI
      const startRotation = rotationRef.current
      let finalRotation = startRotation
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) return
        moveEvent.preventDefault()
        const pointerAngle = Math.atan2(moveEvent.clientY - cy, moveEvent.clientX - cx) * 180 / Math.PI
        finalRotation = Math.round((startRotation + pointerAngle - startPointerAngle + 360) % 360)
        if (finalRotation === rotationRef.current) return
        rotationRef.current = finalRotation
        window.dispatchEvent(new CustomEvent('unit-rotation-preview', { detail: { uid: op.uid, rotation: finalRotation } }))
        onRotate(op.uid, finalRotation)
      }
      const finish = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== event.pointerId) return
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', finish)
        document.removeEventListener('pointercancel', finish)
        window.dispatchEvent(new CustomEvent('unit-rotation-preview', { detail: { uid: op.uid, rotation: null } }))
        if (canDrag) ref.current?.dragging?.enable()
      }
      document.addEventListener('pointermove', move, { passive: false })
      document.addEventListener('pointerup', finish)
      document.addEventListener('pointercancel', finish)
    }
    return () => {
      if (w.__opRotateStartHandlers) delete w.__opRotateStartHandlers[op.uid]
    }
  }, [op.uid, onRotate, canDrag])

  useEffect(() => {
    const collapse = () => setExpanded(false)
    const selectOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== op.uid) collapse()
    }
    map.on('click', collapse)
    window.addEventListener('mobile-unit-selected', selectOther)
    return () => {
      map.off('click', collapse)
      window.removeEventListener('mobile-unit-selected', selectOther)
    }
  }, [map, op.uid])

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
    () => buildOperatorIcon(op, view, connectMode, pending, expanded),
    // 干员/职业/状态/队伍色/昵称变化需重建图标
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [op.operatorId, op.cls, op.status, op.team, op.name, op.side, op.fireLineEnabled, view, connectMode, pending, expanded],
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
        mousedown: () => { if (platform.kind !== 'android') map.dragging.disable() },
        mouseup: () => { if (platform.kind !== 'android') map.dragging.enable() },
        click: (e) => {
          // 阻止冒泡：避免地图点击事件误关气泡
          L.DomEvent.stopPropagation(e)
          if (skillTargeting) {
            onSkillTarget?.(op.uid)
            return
          }
          const t = e.originalEvent.target as HTMLElement | null
          if (t?.closest?.('.op-info')) {
            onEditClick(op.uid, { x: e.containerPoint.x, y: e.containerPoint.y })
            return
          }
          if (t?.closest?.('.op-fireline')) {
            // Android 在 pointerup 统一派发 unit-fireline-toggle；这里不再重复切换。
            if (platform.kind !== 'android') onToggleFireLine(op.uid)
            return
          }
          if (t?.closest?.('.op-route')) {
            onStartRoute(op.uid)
            return
          }
          if (t?.closest?.('.op-delete')) {
            onClearDeploy(op.uid)
            return
          }
          if (platform.kind === 'android') {
            window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: op.uid }))
            if (t?.closest?.('.op-code') && expanded) {
              onRenameClick(op.uid, { x: e.containerPoint.x, y: e.containerPoint.y })
              return
            }
            setExpanded((value) => !value)
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
            window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: op.uid }))
            setExpanded(true)
          }
        },
        dragstart: (e) => {
          // A route-bound unit also has a live route preview. Stop the native
          // pointer event here so Leaflet's map drag handler cannot start in
          // parallel with the marker drag.
          L.DomEvent.stopPropagation(e as L.LeafletEvent)
          map.dragging.disable()
          ref.current?.getElement()?.classList.add('mobile-unit-dragging')
        },
        drag: (e) => {
          // 拖动期间只更新 Leaflet 原生 Marker 和轻量图层预览；最终位置在 dragend 提交一次。
          const ll = (e.target as L.Marker).getLatLng()
          posRef.current[op.uid] = [ll.lat, ll.lng]
          window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', {
            detail: { phase: 'move', kind: 'operator', uid: op.uid, lat: ll.lat, lng: ll.lng },
          }))
          if (platform.kind !== 'android') window.dispatchEvent(new CustomEvent('desktop-unit-anchor-drag', {
            detail: { phase: 'move', kind: 'operator', uid: op.uid, lat: ll.lat, lng: ll.lng },
          }))
        },
        contextmenu: (e) => {
          L.DomEvent.stop(e.originalEvent)
          if (platform.kind !== 'android') onClearDeploy(op.uid)
        },
        dragend: (e) => {
          map.dragging.enable()
          ref.current?.getElement()?.classList.remove('mobile-unit-dragging')
          const ll = (e.target as L.Marker).getLatLng()
          onMove(op.uid, ll.lat, ll.lng)
          if (platform.kind === 'android') setExpanded(true)
          window.requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('mobile-route-anchor-drag', {
              detail: { phase: 'end', kind: 'operator', uid: op.uid, lat: ll.lat, lng: ll.lng },
            }))
            if (platform.kind !== 'android') window.dispatchEvent(new CustomEvent('desktop-unit-anchor-drag', {
              detail: { phase: 'end', kind: 'operator', uid: op.uid, lat: ll.lat, lng: ll.lng },
            }))
          })
        },
      }}
    >
      {platform.kind !== 'android' && <Tooltip direction="top" offset={[0, -28]}>
        {op.name} · 滚轮旋转 · 右键撤回部署 · 枪线按钮上滚轮调长度
      </Tooltip>}
    </Marker>
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
  onRotate,
  onToggleFireLine,
  onClearDeploy,
  onStartRoute,
  onConnectClick,
  onEditClick,
  onRenameClick,
  skillTargeting,
  onSkillTarget,
}: OperatorLayerProps) {
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
          onRotate={onRotate}
          onToggleFireLine={onToggleFireLine}
          onClearDeploy={onClearDeploy}
          onStartRoute={onStartRoute}
          onConnectClick={onConnectClick}
          onEditClick={onEditClick}
          onRenameClick={onRenameClick}
          skillTargeting={skillTargeting}
          onSkillTarget={onSkillTarget}
        />
      ))}
    </>
  )
}
