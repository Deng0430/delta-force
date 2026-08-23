import { Fragment, useEffect, useRef, useState } from 'react'
import { Circle, Marker, Polygon, Polyline, Tooltip, useMapEvents } from 'react-leaflet'
import * as L from 'leaflet'
import type { OperatorSkillAction, OperatorSkillActionGeometry, OperatorUnit, Side } from '../types'
import { platform } from '../platform'

interface Props {
  actions: OperatorSkillAction[]
  operators: OperatorUnit[]
  view: Side
  onDelete: (uid: string) => void
  onUpdateGeometry: (uid: string, geometry: OperatorSkillActionGeometry) => void
}

const ANDROID_ATTACHED_STEP = 40
const ANDROID_ATTACHED_Y = 56
const ATTACHED_ICON_CENTER = 12

const iconFor = (action: OperatorSkillAction, color: string, attached = false, selected = false, attachedIndex = 0) => {
  const iconUrl = action.iconUrl ?? `/icons/operators/skills/${action.operatorId}/skill_${action.skillSlot}.png`
  const android = platform.kind === 'android'
  const attachedStep = android ? ANDROID_ATTACHED_STEP : 18
  const attachedY = android ? ANDROID_ATTACHED_Y : 46
  const attachedAnchor: [number, number] = action.sourceKind === 'tactical-item'
    ? [32, attachedY]
    : [(android ? -8 : -2) - attachedIndex * attachedStep, attachedY]
  return L.divIcon({
  className: `operator-skill-action-icon${action.skillName === '数据飞刀' ? ' cinematic-data-knife' : ''}${action.skillName === '侦察信标' ? ' cinematic-recon-beacon' : ''}${selected ? ' selected' : ''}`,
    html: `<span class="${action.sourceKind === 'tactical-item' ? 'tactical-item' : ''}" style="--skill-side-color:${color};background-image:url('${iconUrl}')"><img src="${iconUrl}" alt="${action.skillName}" draggable="false" />${action.sourceKind === 'tactical-item' ? '' : `<b>${action.skillSlot}</b>`}</span>`,
  iconSize: [24, 24], iconAnchor: attached ? attachedAnchor : [12, 12],
  })
}

const curveHandleIcon = (color: string) => L.divIcon({ className: 'operator-skill-curve-handle', html: `<span style="--skill-side-color:${color}"></span>`, iconSize: [24, 24], iconAnchor: [12, 12] })

const mobileActionsIcon = (action: OperatorSkillAction, map: L.Map, position: [number, number], expanded: boolean, visualOffset: [number, number] = [0, 0]) => {
  const curveGeometry = action.geometry?.type === 'curve' ? action.geometry : null
  const curve = Boolean(curveGeometry)
  const width = expanded && curve ? 142 : 46
  const height = 50
  const point = map.latLngToContainerPoint(position).add(visualOffset)
  const size = map.getSize()
  const controls: [number, number][] = curveGeometry
    ? (curveGeometry.controls ?? (curveGeometry.control ? [curveGeometry.control] : []))
    : []
  const obstacles = controls.map((control) => map.latLngToContainerPoint(control))
  const gap = 30
  type Placement = { x: number; y: number; direction: string; score: number }
  const candidates: Placement[] = [
    { x: -width / 2, y: -height - gap, direction: 'above', score: 0 },
    { x: -width / 2, y: gap, direction: 'below', score: 0 },
    { x: gap, y: -height / 2, direction: 'right', score: 0 },
    { x: -width - gap, y: -height / 2, direction: 'left', score: 0 },
  ]
  const margin = 6
  const chosen = candidates.reduce((best, candidate) => {
    const left = point.x + candidate.x
    const top = point.y + candidate.y
    const overflow = Math.max(0, margin - left) + Math.max(0, left + width + margin - size.x)
      + Math.max(0, margin - top) + Math.max(0, top + height + margin - size.y)
    const centerX = left + width / 2
    const centerY = top + height / 2
    const nearest = obstacles.length
      ? Math.min(...obstacles.map((obstacle) => Math.hypot(centerX - obstacle.x, centerY - obstacle.y)))
      : 999
    const score = nearest - overflow * 20
    return score > best.score ? { ...candidate, score } : best
  }, { ...candidates[0], score: Number.NEGATIVE_INFINITY } as Placement)
  return L.divIcon({
    className: `operator-skill-mobile-actions-wrap ${chosen.direction}${expanded ? ' expanded' : ' compact'}`,
    iconSize: [width, height],
    iconAnchor: [-chosen.x - visualOffset[0], -chosen.y - visualOffset[1]],
    html: `<div class="operator-skill-mobile-actions">
      ${expanded && curve ? `<button type="button" aria-label="添加弯曲点" onclick="event.stopPropagation();window.dispatchEvent(new CustomEvent('mobile-skill-action',{detail:{uid:'${action.uid}',action:'add-control'}}))"><i class="fa-solid fa-plus"></i></button><button type="button" aria-label="删除弯曲点" onclick="event.stopPropagation();window.dispatchEvent(new CustomEvent('mobile-skill-action',{detail:{uid:'${action.uid}',action:'remove-control'}}))"><i class="fa-solid fa-minus"></i></button>` : ''}
      ${!curve || expanded ? `<button type="button" class="danger" aria-label="删除技能" onclick="event.stopPropagation();window.dispatchEvent(new CustomEvent('mobile-skill-action',{detail:{uid:'${action.uid}',action:'delete'}}))"><i class="fa-regular fa-trash-can"></i></button>` : `<button type="button" aria-label="展开技能操作" onclick="event.stopPropagation();window.dispatchEvent(new CustomEvent('mobile-skill-action',{detail:{uid:'${action.uid}',action:'toggle-actions'}}))"><i class="fa-solid fa-ellipsis"></i></button>`}
    </div>`,
  })
}

function smoothCurve(nodes: [number, number][]): [number, number][] {
  if (nodes.length < 3) return nodes
  const out: [number, number][] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    const p0 = nodes[Math.max(0, i - 1)]
    const p1 = nodes[i]
    const p2 = nodes[i + 1]
    const p3 = nodes[Math.min(nodes.length - 1, i + 2)]
    for (let step = 0; step < 12; step++) {
      const t = step / 12
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        .5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        .5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  out.push(nodes[nodes.length - 1])
  return out
}

export default function OperatorSkillLayer({ actions, operators, view, onDelete, onUpdateGeometry }: Props) {
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [expandedUid, setExpandedUid] = useState<string | null>(null)
  const [hoveredUid, setHoveredUid] = useState<string | null>(null)
  const [operatorPreview, setOperatorPreview] = useState<Record<string, [number, number]>>({})
  const curveLineRefs = useRef(new Map<string, L.Polyline>())
  const curveHelperRefs = useRef(new Map<string, L.Polyline>())
  const map = useMapEvents({})
  const [mapWidth, setMapWidth] = useState(() => map.getSize().x)
  const [, setViewportRevision] = useState(0)
  const beginCurveDrag = () => {
    map.getContainer().classList.add('operator-skill-control-dragging')
  }
  const endCurveDrag = () => {
    map.getContainer().classList.remove('operator-skill-control-dragging')
    setExpandedUid(null)
  }
  useEffect(() => {
    const container = map.getContainer()
    const clearDragVisual = () => container.classList.remove('operator-skill-control-dragging')
    const cancelDrag = () => {
      clearDragVisual()
      setExpandedUid(null)
    }
    document.addEventListener('pointercancel', cancelDrag, true)
    document.addEventListener('touchcancel', cancelDrag, true)
    window.addEventListener('blur', cancelDrag)
    return () => {
      clearDragVisual()
      document.removeEventListener('pointercancel', cancelDrag, true)
      document.removeEventListener('touchcancel', cancelDrag, true)
      window.removeEventListener('blur', cancelDrag)
    }
  }, [map])
  useEffect(() => {
    if (platform.kind !== 'android') return
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; action?: string }>).detail
      const action = actions.find((item) => item.uid === detail?.uid)
      if (!action) return
      if (detail.action === 'toggle-actions') {
        setExpandedUid((current) => current === action.uid ? null : action.uid)
        return
      }
      if (detail.action === 'delete') {
        setSelectedUid(null)
        setExpandedUid(null)
        onDelete(action.uid)
        return
      }
      if (action.geometry?.type !== 'curve') return
      const geometry = action.geometry
      const controls = geometry.controls ?? (geometry.control ? [geometry.control] : [])
      if (detail.action === 'remove-control') {
        if (controls.length === 0) return
        onUpdateGeometry(action.uid, { ...geometry, controls: controls.slice(0, -1), control: undefined })
      } else if (detail.action === 'add-control') {
        const previous = controls[controls.length - 1] ?? geometry.start
        const point: [number, number] = [(previous[0] + geometry.end[0]) / 2, (previous[1] + geometry.end[1]) / 2]
        onUpdateGeometry(action.uid, { ...geometry, controls: [...controls, point], control: undefined })
      }
    }
    window.addEventListener('mobile-skill-action', handle)
    return () => window.removeEventListener('mobile-skill-action', handle)
  }, [actions, onDelete, onUpdateGeometry])
  useEffect(() => {
    const update = () => {
      setMapWidth(map.getSize().x)
      setViewportRevision((revision) => revision + 1)
    }
    map.on('resize zoomend moveend viewreset', update)
    return () => { map.off('resize zoomend moveend viewreset', update) }
  }, [map])
  useEffect(() => {
    const onDrag = (event: Event) => {
      const detail = (event as CustomEvent<{ phase?: string; uid?: string; lat?: number; lng?: number }>).detail
      if (!detail?.uid) return
      if (detail.phase === 'move' && Number.isFinite(detail.lat) && Number.isFinite(detail.lng)) {
        setOperatorPreview((current) => ({ ...current, [detail.uid as string]: [detail.lat as number, detail.lng as number] }))
      } else if (detail.phase === 'end') {
        setOperatorPreview((current) => {
          if (!(detail.uid as string in current)) return current
          const next = { ...current }
          delete next[detail.uid as string]
          return next
        })
      }
    }
    window.addEventListener('mobile-route-anchor-drag', onDrag)
    return () => {
      window.removeEventListener('mobile-route-anchor-drag', onDrag)
    }
  }, [])
  useEffect(() => {
    const container = map.getContainer()
    const intercept = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.operator-skill-curve-hit')) return
      event.preventDefault()
      map.doubleClickZoom?.disable()
      window.setTimeout(() => map.doubleClickZoom?.enable(), 0)
    }
    container.addEventListener('dblclick', intercept, true)
    return () => container.removeEventListener('dblclick', intercept, true)
  }, [map])
  useMapEvents({ dblclick: (event) => {
    const target = event.originalEvent.target as Element | null
    if (target?.closest('.operator-skill-curve-hit')) {
      event.originalEvent.preventDefault()
      event.originalEvent.stopPropagation()
      event.target.doubleClickZoom?.disable()
      window.setTimeout(() => event.target.doubleClickZoom?.enable(), 0)
    }
  }, click: (event) => {
    const target = event.originalEvent.target as Element | null
    // 只有技能自身的交互元素阻止取消选中。其他 Leaflet SVG 图层可能覆盖大片
    // 看似空白的区域，不能因为它们带有 leaflet-interactive 就保留技能选中态。
    if (target?.closest('.operator-skill-curve-hit, .operator-skill-action-icon, .operator-skill-curve-handle')) return
    setSelectedUid(null)
    setExpandedUid(null)
  } })
  const positions = new Map(operators.filter((item) => item.lat != null && item.lng != null).map((item) => [item.uid, [item.lat as number, item.lng as number] as [number, number]]))
  return <>
    {actions.filter((action) => action.visible).map((action) => {
      const source = operatorPreview[action.sourceOperatorUid] ?? positions.get(action.sourceOperatorUid)
      const geometry = action.geometry
      const color = action.side === view ? '#55d68b' : '#ef6b68'
      const selected = selectedUid === action.uid
      const highlighted = selected || hoveredUid === action.uid
      const attachedIndex = actions.filter((candidate) => candidate.visible && !candidate.geometry && candidate.sourceOperatorUid === action.sourceOperatorUid && candidate.sourceKind === action.sourceKind).findIndex((candidate) => candidate.uid === action.uid)
      const safeAttachedIndex = Math.max(0, attachedIndex)
      const attachedCenterY = ATTACHED_ICON_CENTER - ANDROID_ATTACHED_Y
      const attachedVisualOffset: [number, number] = action.sourceKind === 'tactical-item'
        ? [-20, attachedCenterY]
        : [20 + safeAttachedIndex * ANDROID_ATTACHED_STEP, attachedCenterY]
      const attachedTooltipOffset: [number, number] = action.sourceKind === 'tactical-item'
        ? [-20, -50]
        : [14 + Math.max(0, attachedIndex) * 18, -50]
      const marker = (position: [number, number], attached = false, onMove?: (point: [number, number]) => void, onPreview?: (point: [number, number]) => void) => <Fragment key={action.uid}><Marker position={position} icon={iconFor(action, color, attached, highlighted, safeAttachedIndex)} zIndexOffset={highlighted ? 1550 : 1450} draggable={Boolean(onMove)} bubblingMouseEvents={false} eventHandlers={{ mouseover: () => setHoveredUid(action.uid), mouseout: () => setHoveredUid((uid) => uid === action.uid ? null : uid), click: (event) => { L.DomEvent.stop(event.originalEvent); setSelectedUid(action.uid) }, contextmenu: (event) => { L.DomEvent.stop(event.originalEvent); if (platform.kind !== 'android') { setSelectedUid(null); onDelete(action.uid) } }, dragstart: beginCurveDrag, drag: (event) => { if (!onPreview) return; const point = (event.target as L.Marker).getLatLng(); onPreview([point.lat, point.lng]) }, dragend: (event) => { endCurveDrag(); if (!onMove) return; const point = (event.target as L.Marker).getLatLng(); onMove([point.lat, point.lng]) } }}>
        {platform.kind !== 'android' && <Tooltip direction="top" offset={attached ? attachedTooltipOffset : [0, -12]}>{action.skillName}{onMove ? ' · 可直接拖动调整位置' : ' · 点击选中，右键删除'}</Tooltip>}
      </Marker>{selected && platform.kind === 'android' && <Marker position={position} icon={mobileActionsIcon(action, map, position, expandedUid === action.uid, attached ? attachedVisualOffset : [0, 0])} zIndexOffset={1750} interactive bubblingMouseEvents={false} />}</Fragment>
      if (!geometry) return source ? marker(source, true) : null
      if (geometry.type === 'area') {
        const skillBounds = map.options.maxBounds ? L.latLngBounds(map.options.maxBounds as L.LatLngBoundsLiteral) : map.getBounds()
        const mapScale = 230 / Math.max(1, skillBounds.getNorth() - skillBounds.getSouth())
        const radius = geometry.radiusRatio
          ? map.distance(geometry.center, [geometry.center[0] + (skillBounds.getNorth() - skillBounds.getSouth()) * geometry.radiusRatio * mapScale, geometry.center[1]])
          : geometry.radius
        return <Fragment key={action.uid}><Circle center={geometry.center} radius={radius} pathOptions={{ color, weight: 1.5, opacity: .8, fillOpacity: .18 }} interactive={false} />{marker(geometry.center, false, (center) => onUpdateGeometry(action.uid, { ...geometry, center }))}</Fragment>
      }
      if (geometry.type === 'point') {
        const point = action.targetUid ? positions.get(action.targetUid) ?? geometry.position : geometry.position
        return <Fragment key={action.uid}>{action.targetUid && source && <Polyline key={`${action.uid}-target`} positions={[source, point]} pathOptions={{ color, weight: 1.5, dashArray: '4 5', opacity: .7 }} interactive={false} />}{marker(point, false, action.targetUid ? undefined : (position) => onUpdateGeometry(action.uid, { ...geometry, position }))}</Fragment>
      }
      if (geometry.type === 'trajectory') {
        const endpoint = geometry.points[geometry.points.length - 1]
        const livePoints = source && geometry.points.length > 1 ? [source, ...geometry.points.slice(1)] : geometry.points
        return <Fragment key={action.uid}>{(action.placementMode === 'guided-path' || action.sourceKind === 'tactical-item') && <Polyline key={`${action.uid}-line`} positions={livePoints} pathOptions={{ color, weight: 2, dashArray: '8 5' }} interactive={false} />}{marker(endpoint, false, (point) => onUpdateGeometry(action.uid, { ...geometry, points: [...geometry.points.slice(0, -1), point] }))}</Fragment>
      }
      if (geometry.type === 'curve') {
        const start = source ?? geometry.start
        const controls = geometry.controls ?? (geometry.control ? [geometry.control] : [])
        const nodes = [start, ...controls, geometry.end]
        const points = smoothCurve(nodes)
        const previewCurve = (nextControls: [number, number][], nextEnd = geometry.end) => {
          curveLineRefs.current.get(action.uid)?.setLatLngs(smoothCurve([start, ...nextControls, nextEnd]))
          curveHelperRefs.current.get(action.uid)?.setLatLngs([start, ...nextControls, nextEnd])
        }
        const insertControl = (point: [number, number]) => {
          let segment = 0
          let distance = Number.POSITIVE_INFINITY
          for (let index = 0; index < nodes.length - 1; index++) {
            const middle: [number, number] = [(nodes[index][0] + nodes[index + 1][0]) / 2, (nodes[index][1] + nodes[index + 1][1]) / 2]
            const nextDistance = (middle[0] - point[0]) ** 2 + (middle[1] - point[1]) ** 2
            if (nextDistance < distance) { distance = nextDistance; segment = index }
          }
          const next = [...controls]
          next.splice(segment, 0, point)
          onUpdateGeometry(action.uid, { type: 'curve', start, controls: next, end: geometry.end })
        }
        return <Fragment key={action.uid}>
          <Polyline
            key={`${action.uid}-curve`}
            positions={points}
            bubblingMouseEvents={false}
            pathOptions={{ color, weight: 18, opacity: .01, className: 'operator-skill-curve-hit' }}
            eventHandlers={{
              mouseover: () => setHoveredUid(action.uid),
              mouseout: () => setHoveredUid((uid) => uid === action.uid ? null : uid),
              click: (event) => { L.DomEvent.stop(event.originalEvent); setSelectedUid(action.uid) },
              dblclick: (event) => {
                event.originalEvent.preventDefault()
                event.originalEvent.stopPropagation()
                L.DomEvent.stop(event.originalEvent)
                insertControl([event.latlng.lat, event.latlng.lng])
              },
            }}
          />
          <Polyline ref={(layer) => { if (layer) curveLineRefs.current.set(action.uid, layer); else curveLineRefs.current.delete(action.uid) }} key={`${action.uid}-curve-visible`} positions={points} pathOptions={{ color, weight: highlighted ? 4 : 2.5, opacity: highlighted ? 1 : .82 }} interactive={false} />
          {selected && <>
            <Polyline ref={(layer) => { if (layer) curveHelperRefs.current.set(action.uid, layer); else curveHelperRefs.current.delete(action.uid) }} key={`${action.uid}-helper`} positions={nodes} pathOptions={{ color, weight: 1, dashArray: '3 5', opacity: .38 }} interactive={false} />
            {controls.map((control, index) => <Marker key={`${action.uid}-handle-${index}`} position={control} icon={curveHandleIcon(color)} draggable bubblingMouseEvents={false} eventHandlers={{ click: (event) => L.DomEvent.stop(event.originalEvent), contextmenu: (event) => { L.DomEvent.stop(event.originalEvent); const next = controls.filter((_, itemIndex) => itemIndex !== index); onUpdateGeometry(action.uid, { type: 'curve', start, controls: next, end: geometry.end }) }, dragstart: beginCurveDrag, drag: (event) => { const point = (event.target as L.Marker).getLatLng(); const next = [...controls]; next[index] = [point.lat, point.lng]; previewCurve(next) }, dragend: (event) => { endCurveDrag(); const point = (event.target as L.Marker).getLatLng(); const next = [...controls]; next[index] = [point.lat, point.lng]; onUpdateGeometry(action.uid, { type: 'curve', start, controls: next, end: geometry.end }) } }}><Tooltip direction="top">拖动调整曲线 · 右键删除</Tooltip></Marker>)}
          </>}
          {marker(geometry.end, false, (end) => onUpdateGeometry(action.uid, { type: 'curve', start, controls, end }), (end) => previewCurve(controls, end))}
        </Fragment>
      }
      if (geometry.type === 'line') {
        const linePoints = source ? [source, ...geometry.points.slice(1)] : geometry.points
        const start = linePoints[0]
        const end = linePoints[linePoints.length - 1]
        const bounds = map.options.maxBounds ? L.latLngBounds(map.options.maxBounds as L.LatLngBoundsLiteral) : map.getBounds()
        const mapScale = 230 / Math.max(1, bounds.getNorth() - bounds.getSouth())
        const widthDegrees = geometry.widthRatio ? (bounds.getNorth() - bounds.getSouth()) * geometry.widthRatio * mapScale : (geometry.width ?? 12) / Math.max(1, mapWidth) * (bounds.getNorth() - bounds.getSouth())
        const dx = end[1] - start[1]
        const dy = end[0] - start[0]
        const length = Math.hypot(dx, dy) || 1
        const offset: [number, number] = [(-dx / length) * widthDegrees / 2, (dy / length) * widthDegrees / 2]
        const area: [number, number][] = [[start[0] + offset[0], start[1] + offset[1]], [end[0] + offset[0], end[1] + offset[1]], [end[0] - offset[0], end[1] - offset[1]], [start[0] - offset[0], start[1] - offset[1]]]
        return <Fragment key={action.uid}><Polygon key={`${action.uid}-cover`} positions={area} pathOptions={{ color, weight: 1, opacity: 0.8, fillOpacity: 0.25 }} interactive={false} /><Polyline key={`${action.uid}-edge`} positions={[start, end]} pathOptions={{ color, weight: 2, dashArray: '7 5', lineCap: 'butt' }} interactive={false} />{marker(end, false, (point) => onUpdateGeometry(action.uid, { ...geometry, points: [...geometry.points.slice(0, -1), point] }))}</Fragment>
      }
      return null
    })}
  </>
}
