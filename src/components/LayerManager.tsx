import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { ActiveTextEdit, ArrowHeadStyle, DashType, DrawSettings, OperatorUnit, Side, TeamMarker, TextStyleProps, ToolMode, VehicleItem } from '../types'
import { DEFAULT_TEXT_STYLE, ellipsePoints, genUid, textIcon, textStyleFromProps, textStyleToProps } from '../utils/geo'
import { platform } from '../platform'

export const SIDE_COLORS: Record<Side, string> = {
  attack: '#2f6fed',
  defense: '#e0453a',
}

/**
 * 绘制图层专用 Pane（问题1）：
 * z-index 700 > markerPane(600) / tooltipPane(650)，与 popupPane 同级，
 * 确保画笔图形始终显示在瓦片、点位、载具、道具、区域之上。
 */
const DRAW_PANE = 'drawPane'
/** Leaflet 会把 pane 名 drawPane 转换成 DOM 类名 leaflet-draw-pane。 */
const DRAW_PANE_SELECTOR = '.leaflet-draw-pane'
/** 图形命中区向路径两侧各扩展 10px；5px 内的位移仍按单击处理。 */
const HIT_PADDING_PX = 10
const CLICK_DRAG_THRESHOLD_PX = 5

/** 锁定图形被删除/擦除时的提示文案 */
const LOCKED_TOAST_MSG = '该图样已经锁定，请解锁后再删除'

// 锁定/解锁图标（美术资源/锁定.svg、解锁.svg，iconfont 1024×1024 填充式；
// gizmo 浮动按钮为 Leaflet DOM，只能以 innerHTML 内联 SVG 字符串注入）。
const LOCK_BODY_PATH =
  'M758.5 931h-497c-50.453 0-91.5-41.047-91.5-91.5v-335c0-50.453 41.047-91.5 91.5-91.5h497c50.453 0 91.5 41.047 91.5 91.5v335c0 50.453-41.047 91.5-91.5 91.5z m-497-454c-15.164 0-27.5 12.336-27.5 27.5v335c0 15.163 12.336 27.5 27.5 27.5h497c15.163 0 27.5-12.337 27.5-27.5v-335c0-15.164-12.337-27.5-27.5-27.5h-497z'
const LOCK_SHACKLE_PATH =
  'M512.1 791c-17.673 0-32-14.327-32-32V588.999c0-17.673 14.327-32 32-32 17.673 0 32 14.327 32 32V759c0 17.673-14.328 32-32 32zM297.472 446.595c-17.673 0-32-14.327-32-32 0-109.504 25.127-192.098 74.684-245.486 22.309-24.034 49.483-42.036 80.767-53.505 27.139-9.95 57.454-14.995 90.101-14.995 76.909 0 134.36 20.286 175.638 62.018 51.002 51.562 75.166 134.096 73.874 252.317-0.191 17.552-14.481 31.649-31.99 31.65-0.12 0-0.237 0-0.357-0.002-17.672-0.193-31.842-14.676-31.648-32.348 1.08-98.854-17.552-168.368-55.379-206.611-28.637-28.952-71.205-43.025-130.137-43.025-52.665 0-94.371 16.163-123.96 48.04-38.214 41.169-57.59 109.113-57.59 201.946-0.003 17.674-14.329 32.001-32.003 32.001z'
const UNLOCK_SHACKLE_PATH =
  'M512.1 791c-17.673 0-32-14.327-32-32V588.999c0-17.673 14.327-32 32-32 17.673 0 32 14.327 32 32V759c0 17.673-14.328 32-32 32zM297.472 446.595c-17.673 0-32-14.327-32-32 0-109.504 25.127-192.098 74.684-245.486 22.309-24.034 49.483-42.036 80.767-53.505 27.139-9.95 57.454-14.995 90.101-14.995 64.215 0 114.448 14.036 153.567 42.911 22.108 16.319 40.617 37.577 55.012 63.183 14.526 25.841 25.306 56.97 32.037 92.523 3.288 17.365-8.124 34.106-25.488 37.395-17.363 3.291-34.106-8.123-37.395-25.488-19.446-102.703-72.6-146.523-177.733-146.523-52.665 0-94.371 16.163-123.96 48.04-38.214 41.169-57.59 109.113-57.59 201.946-0.002 17.674-14.329 31.999-32.002 31.999z'
const LOCK_ICON_SVG = `<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${LOCK_BODY_PATH}"/><path d="${LOCK_SHACKLE_PATH}"/></svg>`
const UNLOCK_ICON_SVG = `<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${LOCK_BODY_PATH}"/><path d="${UNLOCK_SHACKLE_PATH}"/></svg>`

function offsetGeoCoordinates(value: unknown, dLng: number, dLat: number): unknown {
  if (!Array.isArray(value)) return value
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0] + dLng, value[1] + dLat, ...value.slice(2)]
  }
  return value.map((item) => offsetGeoCoordinates(item, dLng, dLat))
}

/** 绘制拖拽期间让已有图形/命中层完全穿透鼠标，保证跨图形轨迹不中断。 */
function setDrawingGestureActive(map: L.Map, active: boolean) {
  map.getContainer().classList.toggle('drawing-gesture-active', active)
}

type MarkerWithFeature = L.Marker & { feature?: Feature }
type PathWithFeature = L.Path & { feature?: Feature }
type AnyWithFeature = MarkerWithFeature | PathWithFeature

interface LayerManagerProps {
  view: Side
  tool: ToolMode
  geoJson: string
  /** 画笔设置（问题4：颜色/线宽/线型） */
  draw: DrawSettings
  /** 绘制操作提交（App 统一入历史栈 + 落盘）：上报操作前/后的本层 GeoJSON */
  onCommitDraw: (before: string, after: string) => void
  /** 删除选中信号（第十二轮：App 点击"删除选中"按钮 +1） */
  deleteSelectedTick: number
  /** 清空本层绘制信号（锁定图形保留，只清空未锁定图形；App 确认后 +1） */
  clearDrawTick: number
  /** 是否有选中图形上报（第十二轮：驱动"删除选中"按钮置灰/可用） */
  onDeleteSelCount: (n: number) => void
  onDrawSaved: (side: Side, geoJson: string) => void
  onStartEdit: (edit: ActiveTextEdit) => void
  // ---- 套索支持载具（第十四轮：框选载具部署图标，整体移动/删除） ----
  /** 当前地图全部载具（供套索框选判定） */
  vehicles: VehicleItem[]
  /** 载具位置引用（uid → 当前 lat/lng），由 VehicleLayer 注册，套索移动实时更新 */
  vehiclePosRef?: MutableRefObject<Record<string, [number, number]>>
  /** 批量更新载具位置（套索整体移动后提交，App 入历史栈） */
  onMoveVehicles: (updates: Record<string, [number, number]>) => void
  /** 批量删除载具（套索 Delete/删除按钮，App 入历史栈） */
  onDeleteVehicles: (uids: string[]) => void
  // ---- 套索支持兵棋干员（第十七轮：框选干员棋子，整体移动/删除） ----
  /** 当前视角全部干员（供套索框选判定） */
  operators?: OperatorUnit[]
  /** 干员位置引用（uid → 当前 lat/lng），由 OperatorLayer 注册，套索移动实时更新 */
  operatorPosRef?: MutableRefObject<Record<string, [number, number]>>
  /** 批量更新干员位置（套索整体移动后提交，App 入历史栈） */
  onMoveOperators?: (updates: Record<string, [number, number]>) => void
  /** 批量删除干员（套索 Delete/删除按钮，App 入历史栈） */
  onDeleteOperators?: (uids: string[]) => void
  // ---- 套索支持兵棋队标（第二十三轮：框选队标棋子，整体移动/删除） ----
  /** 当前视角全部队标（供套索框选判定） */
  teams?: TeamMarker[]
  /** 队标位置引用（uid → 当前 lat/lng），由 TeamLayer 注册，套索移动实时更新 */
  teamPosRef?: MutableRefObject<Record<string, [number, number]>>
  /** 批量更新队标位置（套索整体移动后提交，App 入历史栈） */
  onMoveTeams?: (updates: Record<string, [number, number]>) => void
  /** 批量删除队标（套索 Delete/删除按钮，App 入历史栈） */
  onDeleteTeams?: (uids: string[]) => void
}

/** 线型 → dashArray */
function dashArrayOf(dash: DashType): string | undefined {
  if (dash === 'dashed') return '10 6'
  if (dash === 'dotted') return '2 5'
  return undefined
}

/**
 * 二次贝塞尔曲线采样（第二十二轮：线条"曲线"样式，绘制时拖控制点调曲度）。
 * s=起点、c=控制点、e=终点，采样 N 段为多点折线；存储为多点 LineString，
 * Leaflet 直接渲染 polyline（无额外渲染依赖）。地图为 CRS.Simple，lat/lng 即像素。
 */
function bezierPoints(s: L.LatLng, c: L.LatLng, e: L.LatLng, N = 30): L.LatLng[] {
  const out: L.LatLng[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const it = 1 - t
    out.push(L.latLng(it * it * s.lat + 2 * it * t * c.lat + t * t * e.lat, it * it * s.lng + 2 * it * t * c.lng + t * t * e.lng))
  }
  return out
}

/**
 * 拖动手绘路径端点时按路径累计长度渐进分配位移。
 * 起点拖动：影响从 100% 衰减到 0%；终点拖动：从 0% 增强到 100%。
 */
function deformFreehandEndpoint(pts: L.LatLng[], cur: L.LatLng, endIndex: 0 | 1): L.LatLng[] {
  if (pts.length < 2) return pts
  const oldEnd = endIndex === 0 ? pts[0] : pts[pts.length - 1]
  const dLat = cur.lat - oldEnd.lat
  const dLng = cur.lng - oldEnd.lng
  const distances = [0]
  for (let index = 1; index < pts.length; index++) {
    distances.push(distances[index - 1] + Math.hypot(
      pts[index].lat - pts[index - 1].lat,
      pts[index].lng - pts[index - 1].lng,
    ))
  }
  const total = distances[distances.length - 1]
  return pts.map((point, index) => {
    const progress = total > 1e-9 ? distances[index] / total : index / Math.max(1, pts.length - 1)
    const ratio = endIndex === 0 ? 1 - progress : progress
    return L.latLng(point.lat + dLat * ratio, point.lng + dLng * ratio)
  })
}

/**
 * 防线要素生成（第二十二轮再改：纯三角形组成的线条——战略地图防线带）。
 * 三角形尺寸随画笔粗细（weight）等比缩放：底边 = weight、尖端外凸 = weight、
 * 间距 = weight（底边首尾相接，形成连续锯齿条带），不绘制主线。
 * 整体再乘 0.5 缩小系数：粗细 1px → 每个三角形整体约 0.5px；粗细 4px → 约 2px。
 * 采样修复：以路径起点为基准按 spacing 精确等距采样，累积余量传递到下一段，
 * 避免首点缺失 / 末尾重叠导致的三角形重复或断档。
 * 返回 { triangles: LatLng[][]（每个三角 3 顶点） }
 */
function defenseFeatures(pts: L.LatLng[], weight: number): { triangles: L.LatLng[][] } {
  const w = Math.max(1, weight) * 0.5 // 缩小系数：三角整体为粗细的一半
  const spacing = w // 间距 = 底边宽 → 三角首尾相接
  const half = w / 2 // 底边半宽
  const tip = w // 尖端外凸长度
  const triangles: L.LatLng[][] = []
  if (pts.length < 2) return { triangles }

  // 精确等距采样：next 为下一个待采样的路径距离（从起点起，以 spacing 为步长）
  let next = 0
  const samples: { p: L.LatLng; t: { lat: number; lng: number } }[] = []
  // 累计路径长度
  let cum = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const segLen = Math.hypot(b.lat - a.lat, b.lng - a.lng)
    if (segLen < 1e-9) continue
    const tx = (b.lat - a.lat) / segLen
    const ty = (b.lng - a.lng) / segLen
    // 若当前段的结束距离 >= next，则 next 落在本段内
    while (next < cum + segLen) {
      const d = next - cum // 距段起点的距离
      samples.push({ p: L.latLng(a.lat + tx * d, a.lng + ty * d), t: { lat: tx, lng: ty } })
      next += spacing
    }
    cum += segLen
  }
  // 极短路径（不足一个间距）：在起点采样一个三角，避免空白
  if (samples.length === 0) {
    const a = pts[0]
    const b = pts[pts.length - 1]
    const segLen = Math.hypot(b.lat - a.lat, b.lng - a.lng) || 1
    const tx = (b.lat - a.lat) / segLen
    const ty = (b.lng - a.lng) / segLen
    samples.push({ p: L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2), t: { lat: tx, lng: ty } })
  }
  for (const s of samples) {
    // 法线（顺时针旋转切线 90°：lat,lng 坐标系，n = (-t.lng, t.lat)）
    const nx = -s.t.lng
    const ny = s.t.lat
    // 顶点顺序：尖端 → 底边两角（顺时针）
    triangles.push([
      L.latLng(s.p.lat + nx * tip, s.p.lng + ny * tip),
      L.latLng(s.p.lat + s.t.lat * half, s.p.lng + s.t.lng * half),
      L.latLng(s.p.lat - s.t.lat * half, s.p.lng - s.t.lng * half),
    ])
  }
  return { triangles }
}

/** 默认箭头头部设置（旧数据无 arrowStyle/arrowSize 时回退） */
const DEFAULT_ARROW_STYLE: ArrowHeadStyle = 'triangle'
const DEFAULT_ARROW_SIZE = 12

/** 选中属性面板的箭头类型/大小选项（第十六轮） */
const SEL_ARROW_TYPES: { value: ArrowHeadStyle; label: string }[] = [
  { value: 'solid', label: '实心' },
  { value: 'outline', label: '空心' },
  { value: 'triangle', label: '三角形' },
]
const SEL_ARROW_SIZES: { value: number; label: string }[] = [
  { value: 8, label: '小' },
  { value: 12, label: '中' },
  { value: 18, label: '大' },
]

/** 箭头头部形状 → SVG path（viewBox 0 0 10 10，顶点在 (10,5)） */
const ARROW_STYLE_PATHS: Record<ArrowHeadStyle, { d: string; stroke?: boolean }> = {
  // 实心三角
  triangle: { d: 'M 0 0 L 10 5 L 0 10 z' },
  // 经典箭头：内凹实心
  classic: { d: 'M 0 0 L 10 5 L 0 10 L 3.5 5 z' },
  // V形箭头：折线描边
  chevron: { d: 'M 0 0 L 8 5 L 0 10', stroke: true },
  // 菱形（旋转方块）
  diamond: { d: 'M 5 0 L 10 5 L 5 10 L 0 5 z' },
  // 第十六轮：实心箭头（内凹实心，同经典）/ 空心箭头（内凹描边）/ 三角形箭头（实心三角）
  solid: { d: 'M 0 0 L 10 5 L 0 10 L 3.5 5 z' },
  // 空心箭头使用开放式 V 形轮廓；旧版闭合路径会额外画出尾部封口线。
  outline: { d: 'M 0 0 L 10 5 L 0 10', stroke: true },
}

/** 箭头 marker id（按形状+大小区分，如 draw-arrow-triangle-12） */
function arrowMarkerId(style: ArrowHeadStyle, size: number, color: string): string {
  return `draw-arrow-${style}-${size}-${color.replace(/[^a-z0-9]/gi, '')}`
}

/** 已注入的箭头 marker 缓存（按地图） */
const arrowDefCache = new WeakMap<L.Map, Set<string>>()

/**
 * 为指定形状/大小的箭头创建 SVG marker def（惰性注入到 DRAW_PANE 的 SVG）：
 * marker-end 由 decorateArrowMarker 手动设置（Leaflet 渲染层不处理该选项）。
 * markerUnits=userSpaceOnUse 保证箭头像素大小恒定、不随缩放变形；fill 用
 * context-stroke 使箭头颜色始终跟随线条颜色。
 */
function ensureArrowMarkerDef(map: L.Map, style: ArrowHeadStyle, size: number, color: string) {
  const pane = map.getPane(DRAW_PANE)
  const svg = pane?.querySelector('svg')
  if (!svg) return
  const id = arrowMarkerId(style, size, color)
  let cache = arrowDefCache.get(map)
  if (!cache) {
    cache = new Set()
    arrowDefCache.set(map, cache)
  }
  if (cache.has(id)) return
  const NS = 'http://www.w3.org/2000/svg'
  const defs = svg.querySelector('defs') ?? (() => {
    const d = document.createElementNS(NS, 'defs')
    svg.appendChild(d)
    return d
  })()
  const spec = ARROW_STYLE_PATHS[style]
  const marker = document.createElementNS(NS, 'marker')
  marker.id = id
  marker.setAttribute('viewBox', '0 0 10 10')
  marker.setAttribute('refX', '9')
  marker.setAttribute('refY', '5')
  marker.setAttribute('markerWidth', String(size))
  marker.setAttribute('markerHeight', String(size))
  marker.setAttribute('markerUnits', 'userSpaceOnUse')
  marker.setAttribute('orient', 'auto')
  const path = document.createElementNS(NS, 'path')
  path.setAttribute('d', spec.d)
  path.setAttribute('fill', spec.stroke ? 'none' : color)
  if (spec.stroke) {
    path.setAttribute('stroke', color)
    // viewBox 会随 marker 尺寸整体缩放，描边无需再乘一次尺寸系数。
    path.setAttribute('stroke-width', '1.6')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
  }
  marker.appendChild(path)
  defs.appendChild(marker)
  cache.add(id)
}

/**
 * 为箭头线条挂载 marker-end：Leaflet 的 SVG renderer 不处理 markerEnd 选项
 * （_updateStyle 仅设置 stroke/fill 相关属性），必须在 path 创建后手动 setAttribute。
 * 监听 'add' 事件，确保每次添加到地图（含重建）后箭头都会渲染。
 * props 缺省箭头样式/大小时回退默认值（兼容旧数据）。
 */
function decorateArrowMarker(line: L.Layer, props: Record<string, unknown>) {
  const style = (String(props.arrowStyle ?? DEFAULT_ARROW_STYLE) as ArrowHeadStyle) || DEFAULT_ARROW_STYLE
  const size = Number(props.arrowSize ?? DEFAULT_ARROW_SIZE) || DEFAULT_ARROW_SIZE
  const color = String(props.color ?? '#ffd54a')
  line.on('add', () => {
    // _path 为 Leaflet 内部 SVG 元素，类型未暴露
    const path = (line as unknown as { _path?: SVGElement })._path
    if (path) {
      // 确保对应形状/大小的 marker def 已注入
      ensureArrowMarkerDef((line as unknown as { _map?: L.Map })._map as L.Map, style, size, color)
      path.setAttribute('marker-end', `url(#${arrowMarkerId(style, size, color)})`)
    }
  })
}

/** 从特征属性读取样式（问题4：每个图形记录自己的颜色/线宽/线型）。
 *  注：箭头末端不在此设置 markerEnd——Leaflet 渲染层不处理该选项，
 *  由 decorateArrowMarker 在 path 创建后手动设置 SVG 属性。 */
function styleFromProps(props: Record<string, unknown>, view: Side): L.PathOptions {
  const color = String(props.color ?? SIDE_COLORS[view])
  const weight = Number(props.weight ?? 3)
  const dash = String(props.dash ?? 'solid') as DashType
  const isArea = props.type === 'rect' || props.type === 'circle'
  const fillEnabled = isArea && props.fillEnabled === true
  return {
    color,
    weight,
    opacity: 0.95,
    fillColor: String(props.fillColor ?? color),
    fillOpacity: fillEnabled ? 0.28 : 0,
    dashArray: dashArrayOf(dash),
    // 问题1：所有绘制图形进入顶层 drawPane
    pane: DRAW_PANE,
  }
}

function ensureProps(feature: Feature): Record<string, unknown> {
  const p = (feature.properties ?? {}) as Record<string, unknown>
  if (!p.uid) p.uid = genUid('draw')
  // 旧版箭头兼容：早期箭头两个子图层共享 group 值作为 uid（uid === group），
  // 导致套索选中/高亮无法区分箭杆与箭头。还原时检测到这种格式就重新分配独立 uid，
  // 与新版绘制逻辑保持一致（group 仍用于关联整组）。
  if (p.group && p.uid === p.group) p.uid = genUid('draw')
  // 锁定标记默认 false：锁定图形不可移动/编辑/删除（选中框只留"解锁"按钮）
  if (p.locked == null) p.locked = false
  return p
}

/** 递归平移一组 latlng（问题4：框选整体移动） */
function translateLatLngs(ls: unknown, dLat: number, dLng: number): unknown {
  if (Array.isArray(ls)) return ls.map((v) => translateLatLngs(v, dLat, dLng))
  const ll = ls as L.LatLng
  return [ll.lat + dLat, ll.lng + dLng]
}

// ---- 第十五轮：编辑工具几何工具 ----

/** 取图层全部顶点（Polygon 环 / Polyline 点，拍平为一维） */
function flatLatLngs(layer: L.Layer): L.LatLng[] {
  const raw = (layer as L.Polyline).getLatLngs?.() ?? []
  return (raw as unknown as L.LatLng[][]).flat(Infinity) as L.LatLng[]
}

/** 按图层类型回写顶点（Polygon 需要保持环结构） */
function setFlatLatLngs(layer: L.Layer, pts: L.LatLng[]) {
  if (layer instanceof L.Polygon) {
    ;(layer as L.Polygon).setLatLngs([pts] as never)
  } else if (layer instanceof L.Polyline) {
    ;(layer as L.Polyline).setLatLngs(pts as never)
  }
}

/** 由若干图层求统一包围盒（取各图层 bounds 并集） */
function unionBounds(layers: L.Layer[]): L.LatLngBounds {
  const pts: L.LatLng[] = []
  for (const l of layers) {
    if (l instanceof L.Marker) {
      pts.push((l as L.Marker).getLatLng())
    } else if (l instanceof L.Polyline) {
      const b = (l as L.Polyline).getBounds()
      pts.push(b.getNorthEast(), b.getSouthWest())
    }
  }
  return L.latLngBounds(pts)
}

/** 由采样曲线反推二次贝塞尔控制点（中间采样点 t=0.5：m = (s+2c+e)/4 → c = 2m-(s+e)/2） */
function deriveCurveCtrl(pts: L.LatLng[]): L.LatLng {
  const s = pts[0]
  const e = pts[pts.length - 1]
  const m = pts[Math.floor(pts.length / 2)] ?? s
  return L.latLng(2 * m.lat - (s.lat + e.lat) / 2, 2 * m.lng - (s.lng + e.lng) / 2)
}

type DefenseCurve = 'straight' | 'smooth' | 'freehand'

function storedDefensePathOf(layer: L.Layer): L.LatLng[] {
  const props = ((layer as AnyWithFeature).feature?.properties ?? {}) as Record<string, unknown>
  const rawPath = props.defensePath
  return Array.isArray(rawPath)
    ? rawPath.flatMap((point) => (
        Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
          ? [L.latLng(Number(point[1]), Number(point[0]))]
          : []
      ))
    : []
}

function setStoredDefensePath(layer: L.Layer, path: L.LatLng[]) {
  if (path.length < 2) return
  const props = ((layer as AnyWithFeature).feature?.properties ?? {}) as Record<string, unknown>
  if (props.type !== 'defense') return
  props.defensePath = path.map((point) => [point.lng, point.lat])
}

/** 从防线三角组恢复逻辑中心路径；新数据优先读取绘制时保存的原始路径。 */
function reconstructDefensePath(layers: L.Layer[]): {
  path: L.LatLng[]
  weight: number
  curve: DefenseCurve
  curveCtrl?: L.LatLng
} {
  const props = ((layers[0] as AnyWithFeature | undefined)?.feature?.properties ?? {}) as Record<string, unknown>
  const weight = Number(props.weight ?? 3)
  const storedPath = layers[0] ? storedDefensePathOf(layers[0]) : []
  const storedCurve: DefenseCurve = props.curve === 'smooth' || props.curve === 'freehand' ? props.curve : 'straight'
  if (storedPath.length >= 2) {
    return {
      path: storedPath,
      weight,
      curve: storedCurve,
      curveCtrl: storedCurve === 'smooth' ? deriveCurveCtrl(storedPath) : undefined,
    }
  }

  const mids: L.LatLng[] = []
  for (const l of layers) {
    const ring = flatLatLngs(l)
    if (ring.length >= 3) {
      mids.push(L.latLng((ring[1].lat + ring[2].lat) / 2, (ring[1].lng + ring[2].lng) / 2))
    }
  }
  if (mids.length <= 1) return { path: mids, weight, curve: 'straight' }
  // 最近邻串联：从第一个三角开始，每次取最近的未访问点
  const path: L.LatLng[] = [mids[0]]
  const rest = mids.slice(1)
  while (rest.length > 0) {
    const last = path[path.length - 1]
    let best = 0
    let bestD = Infinity
    rest.forEach((m, i) => {
      const d = Math.hypot(m.lat - last.lat, m.lng - last.lng)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    path.push(rest[best])
    rest.splice(best, 1)
  }
  // 兼容旧数据：共线采样点按直线处理；否则按平滑曲线近似恢复。
  const start = path[0]
  const end = path[path.length - 1]
  const chord = Math.hypot(end.lat - start.lat, end.lng - start.lng)
  const maxDeviation = chord < 1e-9
    ? 0
    : Math.max(...path.map((point) => Math.abs(
        (end.lng - start.lng) * (start.lat - point.lat)
        - (start.lng - point.lng) * (end.lat - start.lat),
      ) / chord))
  const curve: DefenseCurve = maxDeviation <= Math.max(0.25, weight * 0.15) ? 'straight' : 'smooth'
  const logicalPath = curve === 'straight' ? [start, end] : path
  return {
    path: logicalPath,
    weight,
    curve,
    curveCtrl: curve === 'smooth' ? deriveCurveCtrl(logicalPath) : undefined,
  }
}

/** 编辑交互会话（第十五轮；第十六轮：支持多选 keys） */
interface EditInteract {
  kind: 'move' | 'rotate' | 'scale' | 'stretch' | 'endpoint' | 'curve'
  /** 触发的图形逻辑键（group||uid；多选时为选中集合） */
  uid: string
  /** 本次操作涉及的逻辑键集合（move/scale/rotate 作用于整个选中集合） */
  keys: string[]
  /** 按下时鼠标位置（位移基准） */
  start: L.LatLng
  /** 操作前快照（提交历史用） */
  before: string
  /** 手柄起始位置（缩放/旋转基准） */
  h0?: L.LatLng
  /** 图形中心（缩放/旋转） */
  center?: L.LatLng
  /** 各图层基准顶点（Marker 存 [位置]） */
  layers: { layer: L.Layer; pts: L.LatLng[]; defensePath?: L.LatLng[] }[]
  /** 文字框变换基准 */
  text?: { pos: L.LatLng; fontSize: number; width: number; rotation: number }
  /** 圆形/椭圆（方向拉伸） */
  circle?: { center: L.LatLng; rx: number; ry: number; axis?: 'n' | 's' | 'e' | 'w' }
  /** 防线重建路径 */
  path?: L.LatLng[]
  weight?: number
  defenseCurve?: DefenseCurve
  defenseCurveCtrl?: L.LatLng
  /** 平滑曲线端点调整时保留的原二次贝塞尔控制点。 */
  curveCtrl?: L.LatLng
  /** 等比例缩放（Shift） */
  uniform?: boolean
  /** 端点下标（0=起点 1=终点） */
  endIndex?: 0 | 1
}

/** 图形本体上的一次按下会话：mouseup 时才决定是单击还是拖拽。 */
interface ShapePointerPress {
  key: string
  additive: boolean
  wasSelected: boolean
  startPoint: L.Point
  downEvent: L.LeafletMouseEvent
  dragging: boolean
}

interface AndroidPinchScaleSession {
  before: string
  startDistance: number
  center: L.LatLng
  layers: Array<{
    layer: AnyWithFeature
    pts: L.LatLng[]
    defensePath?: L.LatLng[]
    textStyle?: TextStyleProps
    text?: string
    radius?: number
    radiusY?: number
  }>
}

/**
 * 图层管理器 v2（问题4 全面升级）：
 * - 绘制：点击起点 → 拖动 → 释放（线条/箭头/矩形/圆形），绘制过程实时半透明预览
 * - 橡皮擦：点击已绘制图形删除（箭头按分组整体删除），不影响地图本身
 * - 框选：开启后拖拽框选多个图形（黄色高亮），再拖拽任一选中图形可整体移动
 * - 设置：颜色/线宽(2/4/6/8)/线型(实线/虚线/点线) 由 draw prop 传入
 * - 文字标注：点击放置 + 双击编辑
 */
export default function LayerManager({
  view,
  tool,
  geoJson,
  draw,
  onCommitDraw,
  deleteSelectedTick,
  clearDrawTick,
  onDeleteSelCount,
  onDrawSaved,
  onStartEdit,
  vehicles,
  vehiclePosRef,
  onMoveVehicles,
  onDeleteVehicles,
  operators,
  operatorPosRef,
  onMoveOperators,
  onDeleteOperators,
  teams,
  teamPosRef,
  onMoveTeams,
  onDeleteTeams,
}: LayerManagerProps) {
  const map = useMap()
  const fgRef = useRef<L.FeatureGroup | null>(null)
  const hlRef = useRef<L.FeatureGroup | null>(null)
  const refreshTextHitRef = useRef<(marker: MarkerWithFeature) => void>(() => {})
  const [fg, setFg] = useState<L.FeatureGroup | null>(null)
  const [hl, setHl] = useState<L.FeatureGroup | null>(null)
  // 当前工具的 ref 快照（闭包/回调内读取最新值，避免依赖数组引起重订阅）
  const toolRef = useRef(tool)
  toolRef.current = tool
  // 回调 ref（供 restoreLayer 等早期定义的闭包在 render 后读取最新回调，第十一轮）
  const onFeatureClickRef = useRef<(e: L.LeafletMouseEvent) => void>(() => {})
  const openEditorRef = useRef<(m: MarkerWithFeature) => void>(() => {})
  const clearEditSelectionRef = useRef<(commitPanel: boolean) => void>(() => {})

  // 当前选中的图形 uid 集合（套索/整体移动，问题4）
  const selectedRef = useRef<Set<string>>(new Set())
  /** 编辑图形/控制点的指针会话锁：防止当前绘图工具同时创建新图形。 */
  const editPointerActiveRef = useRef(false)
  /** Android 双指缩放选中图形的桥接回调；实现位于编辑器辅助函数之后。 */
  const androidPinchActiveRef = useRef(false)
  const androidPinchStartRef = useRef<(a: L.Point, b: L.Point) => boolean>(() => false)
  const androidPinchMoveRef = useRef<(a: L.Point, b: L.Point) => void>(() => {})
  const androidPinchEndRef = useRef<() => void>(() => {})
  const androidPinchSessionRef = useRef<AndroidPinchScaleSession | null>(null)
  // 拖拽位移标记（第十二轮：区分"点击"与"拖动"。拖动结束后 Leaflet 仍会派发 click，
  // 若位移超过阈值则视为拖动，抑制 click 取消选中逻辑）
  const dragMovedRef = useRef(false)
  // 整体移动的拖拽状态（套索整体移动，问题4；第十二轮：含操作前快照）
  const moveDragRef = useRef<{
    start?: L.LatLng
    base?: Map<string, unknown>
    before?: string
    /** 套索包围矩形的起始范围（拖动时矩形跟随平移） */
    boxBounds?: L.LatLngBounds
    /** 选中载具的基准位置（uid → [lat, lng]，拖动时同步移动） */
    vehBase?: Record<string, [number, number]>
    /** 选中干员的基准位置（uid → [lat, lng]，拖动时同步移动，第十七轮） */
    opBase?: Record<string, [number, number]>
    /** 选中队标的基准位置（uid → [lat, lng]，拖动时同步移动，第二十三轮） */
    tmBase?: Record<string, [number, number]>
  }>({})
  // 套索包围矩形（第十五轮：圈中图形后显示矩形区域，区域内按住可整体移动）
  const lassoBoxRef = useRef<L.Rectangle | null>(null)
  const drawClipboardRef = useRef<Feature[]>([])

  const save = useCallback(() => {
    const g = fgRef.current
    if (g) onDrawSaved(view, JSON.stringify(g.toGeoJSON()))
  }, [onDrawSaved, view])

  // 撤回/恢复重构：历史栈已上移到 App（覆盖绘制 + 载具）。
  // LayerManager 不再持有栈，只上报"操作前/操作后"两帧 GeoJSON。
  const EMPTY_FC = '{"type":"FeatureCollection","features":[]}'
  const onCommitDrawRef = useRef(onCommitDraw)
  onCommitDrawRef.current = onCommitDraw
  const onDeleteSelCountRef = useRef(onDeleteSelCount)
  onDeleteSelCountRef.current = onDeleteSelCount
  // 载具批量操作回调 ref（供套索删除/移动的闭包读取最新值）
  const onDeleteVehiclesRef = useRef(onDeleteVehicles)
  onDeleteVehiclesRef.current = onDeleteVehicles
  const onMoveVehiclesRef = useRef(onMoveVehicles)
  onMoveVehiclesRef.current = onMoveVehicles
  const onMoveOperatorsRef = useRef(onMoveOperators)
  onMoveOperatorsRef.current = onMoveOperators
  const onDeleteOperatorsRef = useRef(onDeleteOperators)
  onDeleteOperatorsRef.current = onDeleteOperators
  // 队标批量操作回调 ref（第二十三轮）
  const onMoveTeamsRef = useRef(onMoveTeams)
  onMoveTeamsRef.current = onMoveTeams
  const onDeleteTeamsRef = useRef(onDeleteTeams)
  onDeleteTeamsRef.current = onDeleteTeams
  // 载具选中集合（套索框选载具部署图标，第十四轮）
  const selVehiclesRef = useRef<Set<string>>(new Set())
  // 干员选中集合（套索框选兵棋干员，第十七轮）
  const selOperatorsRef = useRef<Set<string>>(new Set())
  // 队标选中集合（套索框选兵棋队标，第二十三轮）
  const selTeamsRef = useRef<Set<string>>(new Set())
  const notifySelection = useCallback(() => {
    const n =
      selectedRef.current.size > 0 || selVehiclesRef.current.size > 0 || selOperatorsRef.current.size > 0 || selTeamsRef.current.size > 0
        ? 1
        : 0
    onDeleteSelCountRef.current(n)
  }, [])
  /** 当前画笔图层完整 GeoJSON 快照 */
  const snapshotNow = useCallback(() => {
    const g = fgRef.current
    return g ? JSON.stringify(g.toGeoJSON()) : EMPTY_FC
  }, [])
  /** 绘制操作提交：上报 before/after 给 App（App 统一入历史栈 + 落盘） */
  const commitDraw = useCallback(
    (before: string) => {
      onCommitDrawRef.current(before, snapshotNow())
    },
    [snapshotNow],
  )

  // ---- 绘制组件锁定：locked 标记 + 轻量提示 ----
  /** 轻量提示（锁定图形被删除/擦除时）：底部居中，2 秒自动消失 */
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
    setToast({ msg, key: Date.now() })
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, 2000)
  }, [])
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast

  /** 当前已锁定的逻辑键集合（group||uid；组内任一 feature 锁定即整组锁定） */
  const lockedKeys = useCallback((): Set<string> => {
    const keys = new Set<string>()
    fgRef.current?.eachLayer((l) => {
      const p = ((l as AnyWithFeature).feature?.properties ?? {}) as Record<string, unknown>
      if (p.locked === true) keys.add(String(p.group ?? p.uid ?? ''))
    })
    return keys
  }, [])
  const lockedKeysRef = useRef(lockedKeys)
  lockedKeysRef.current = lockedKeys

  // 绘制/套索/橡皮擦模式下禁用地图拖动，避免误拖
  useEffect(() => {
    const lockDrag = tool !== 'pan'
    const container = map.getContainer()
    if (lockDrag) {
      map.dragging.disable()
      container.classList.add('draw-cursor')
    } else {
      map.dragging.enable()
      container.classList.remove('draw-cursor')
    }
    return () => {
      map.dragging.enable()
      container.classList.remove('draw-cursor')
    }
  }, [map, tool])

  // Android WebView 的触控不会稳定地产生 Leaflet mousedown/mousemove/mouseup，
  // 而现有绘制器以这组三段事件为统一协议。仅在 Android 绘制模式下桥接触控指针，
  // PC 端继续走原生鼠标事件，避免改变桌面交互。
  useEffect(() => {
    if (platform.kind !== 'android') return
    const container = map.getContainer()
    let activePointerId: number | null = null
    let activePointerOnDrawLayer = false
    let activePointerClearsSelection = false
    let lastTouchPointerAt = 0
    let lastValidPointerEvent: PointerEvent | null = null
    const activePointers = new Map<number, PointerEvent>()
    const bridgedMouseEvents = new WeakSet<MouseEvent>()

    const pointerPoint = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      return L.point(event.clientX - rect.left - container.clientLeft, event.clientY - rect.top - container.clientTop)
    }

    const fireLeafletPointer = (type: 'mousedown' | 'mousemove' | 'mouseup' | 'click', event: PointerEvent) => {
      // WebView 中直接以当前地图容器的 CSS 像素矩形换算，避免挖孔安全区、
      // edge-to-edge 窗口或页面缩放使 Leaflet 的鼠标坐标换算产生二次偏移。
      const rect = container.getBoundingClientRect()
      const containerPoint = L.point(
        event.clientX - rect.left - container.clientLeft,
        event.clientY - rect.top - container.clientTop,
      )
      const layerPoint = map.containerPointToLayerPoint(containerPoint)
      const latlng = map.layerPointToLatLng(layerPoint)
      map.fire(type, { latlng, layerPoint, containerPoint, originalEvent: event })
    }

    const fireDrawLayerMouseDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return false
      // Leaflet 的图形命中层和编辑手柄依赖各自的 mousedown 监听来建立拖拽会话。
      // 只 map.fire('mousedown') 会绕过这些图层监听，因此在 Android 上向实际命中 DOM
      // 补发一次鼠标按下；后续移动/松开仍通过地图事件统一驱动编辑主循环。
      const mouse = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: 0,
        buttons: 1,
      })
      bridgedMouseEvents.add(mouse)
      target.dispatchEvent(mouse)
      return true
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return
      if ((event.target as HTMLElement | null)?.closest('.leaflet-control-container')) return
      const onDrawLayer = !!(event.target as HTMLElement | null)?.closest(DRAW_PANE_SELECTOR)
      if (activePointerId != null) {
        // 第二根手指只有在第一根手指从已选图形/编辑框开始时才由图形编辑器接管；
        // 地图空白上的双指手势继续交给 Leaflet touchZoom。
        if (!activePointerOnDrawLayer || activePointers.size !== 1) return
        activePointers.set(event.pointerId, event)
        const [first, second] = [...activePointers.values()]
        if (!androidPinchStartRef.current(pointerPoint(first), pointerPoint(second))) {
          activePointers.delete(event.pointerId)
          return
        }
        androidPinchActiveRef.current = true
        lastTouchPointerAt = performance.now()
        try { container.setPointerCapture?.(event.pointerId) } catch { /* WebView may reject capture */ }
        event.preventDefault()
        return
      }
      // 平移模式的地图空白仍完全交给 Leaflet 原生触控拖图；只有命中已有图形或
      // 编辑手柄时才接管，从而让移动端在 pan 模式也能编辑既有图形。
      // 物理触摸交给 Leaflet 原生处理；影视 Demo 派发的非受信任 PointerEvent
      // 不会获得浏览器的后续兼容 click，因此继续走下方桥接以形成完整点击。
      if (tool === 'pan' && !onDrawLayer && event.isTrusted) {
        // 清除上一轮图形手势的兼容鼠标抑制窗口，确保紧接着点击空白能触发
        // Leaflet click，从而立即取消图形选中。
        lastTouchPointerAt = Number.NEGATIVE_INFINITY
        return
      }
      lastTouchPointerAt = performance.now()
      activePointerId = event.pointerId
      activePointerOnDrawLayer = onDrawLayer
      activePointerClearsSelection = !onDrawLayer && selectedRef.current.size > 0
      activePointers.set(event.pointerId, event)
      lastValidPointerEvent = event
      try { container.setPointerCapture?.(event.pointerId) } catch { /* WebView may reject capture during handoff */ }
      event.preventDefault()
      if (onDrawLayer) {
        // 在补发 Leaflet mousedown 之前先上编辑锁。这样即使 WebView/Leaflet 的事件
        // 调度顺序发生变化，当前仍处于激活状态的防线绘制器也绝不会启动新线。
        editPointerActiveRef.current = true
        fireDrawLayerMouseDown(event)
      }
      else if (!activePointerClearsSelection && tool !== 'text') fireLeafletPointer('mousedown', event)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!activePointers.has(event.pointerId)) return
      lastTouchPointerAt = performance.now()
      lastValidPointerEvent = event
      activePointers.set(event.pointerId, event)
      event.preventDefault()
      if (androidPinchActiveRef.current && activePointers.size >= 2) {
        const [first, second] = [...activePointers.values()]
        androidPinchMoveRef.current(pointerPoint(first), pointerPoint(second))
        return
      }
      if (activePointerId !== event.pointerId) return
      if (!activePointerClearsSelection && tool !== 'text') fireLeafletPointer('mousemove', event)
    }
    const finishPointer = (event: PointerEvent) => {
      if (!activePointers.has(event.pointerId)) return
      lastTouchPointerAt = performance.now()
      lastValidPointerEvent = event
      event.preventDefault()
      if (androidPinchActiveRef.current) {
        androidPinchEndRef.current()
        androidPinchActiveRef.current = false
        for (const id of activePointers.keys()) {
          try { container.releasePointerCapture?.(id) } catch { /* capture may already be released */ }
        }
        activePointers.clear()
        activePointerId = null
        activePointerOnDrawLayer = false
        activePointerClearsSelection = false
        lastValidPointerEvent = null
        return
      }
      if (activePointerId !== event.pointerId) return
      fireLeafletPointer(activePointerClearsSelection || (tool === 'text' && !activePointerOnDrawLayer) ? 'click' : 'mouseup', event)
      try { container.releasePointerCapture?.(event.pointerId) } catch { /* capture may already be released */ }
      activePointerId = null
      activePointerOnDrawLayer = false
      activePointerClearsSelection = false
      activePointers.clear()
      lastValidPointerEvent = null
    }
    const cancelPointer = (event: PointerEvent) => {
      if (!activePointers.has(event.pointerId)) return
      lastTouchPointerAt = performance.now()
      event.preventDefault()
      if (androidPinchActiveRef.current) {
        androidPinchEndRef.current()
        androidPinchActiveRef.current = false
        for (const id of activePointers.keys()) {
          try { container.releasePointerCapture?.(id) } catch { /* already released */ }
        }
        activePointerId = null
        activePointerOnDrawLayer = false
        activePointerClearsSelection = false
        activePointers.clear()
        lastValidPointerEvent = null
        return
      }
      if (activePointerId !== event.pointerId) return
      // pointercancel 在部分 Android WebView 中会报告 (0,0)。绝不能用取消事件本身
      // 作为终点，否则所有图形都会跳向地图左上角。用最后一个有效采样点收尾；
      // 文字工具的取消则不产生任何标注。
      if (!activePointerClearsSelection && tool !== 'text' && lastValidPointerEvent) {
        fireLeafletPointer('mouseup', lastValidPointerEvent)
      }
      try { container.releasePointerCapture?.(event.pointerId) } catch { /* already released */ }
      activePointerId = null
      activePointerOnDrawLayer = false
      activePointerClearsSelection = false
      activePointers.clear()
      lastValidPointerEvent = null
    }

    // Chromium 会在触控 PointerEvent 之后补发 mousedown/mousemove/mouseup/click。
    // 绘制器已由上面的桥接收到完整事件，必须在捕获阶段拦截这组兼容事件，
    // 否则一次手势会被提交两次，第二次坐标会令图形跳到错误位置。
    const suppressCompatibilityMouse = (event: MouseEvent) => {
      if (bridgedMouseEvents.has(event)) return
      if (performance.now() - lastTouchPointerAt > 900) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    container.addEventListener('pointerdown', onPointerDown, { passive: false })
    container.addEventListener('pointermove', onPointerMove, { passive: false })
    container.addEventListener('pointerup', finishPointer, { passive: false })
    container.addEventListener('pointercancel', cancelPointer, { passive: false })
    container.addEventListener('mousedown', suppressCompatibilityMouse, true)
    container.addEventListener('mousemove', suppressCompatibilityMouse, true)
    container.addEventListener('mouseup', suppressCompatibilityMouse, true)
    container.addEventListener('click', suppressCompatibilityMouse, true)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', finishPointer)
      container.removeEventListener('pointercancel', cancelPointer)
      container.removeEventListener('mousedown', suppressCompatibilityMouse, true)
      container.removeEventListener('mousemove', suppressCompatibilityMouse, true)
      container.removeEventListener('mouseup', suppressCompatibilityMouse, true)
      container.removeEventListener('click', suppressCompatibilityMouse, true)
    }
  }, [map, tool])

  // 绘制工具激活时：捕获阶段拦截非绘制层的一切"选择型"鼠标事件，
  // 鼠标在绘制模式下完全失去普通用途——点击/悬停/右键不会选中任何区域、标记或弹出提示。
  // 绘制层 drawPane 自身的事件保留（编辑文字/橡皮擦/框选仍可用）；
  // 地图控件（缩放按钮等）不受影响；文字工具的 click 是放置标注的动作，不拦截。
  useEffect(() => {
    if (tool === 'pan') return
    const container = map.getContainer()
    const inDraw = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest(DRAW_PANE_SELECTOR)
    const inControl = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('.leaflet-control-container')
    const swallow = (e: Event) => {
      if (inDraw(e.target) || inControl(e.target)) return
      e.stopPropagation()
      e.preventDefault()
    }
    // 第十六轮：click 一律放行（点击空白 = 取消选中，绘制工具点击空白仍可绘制）；
    // 仅屏蔽 dblclick/mouseover/contextmenu 等（避免非绘制层弹出提示/菜单干扰）
    const types = ['dblclick', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'contextmenu']
    types.forEach((t) => container.addEventListener(t, swallow, true))
    return () => {
      types.forEach((t) => container.removeEventListener(t, swallow, true))
    }
  }, [map, tool])

  // 按视角创建 / 切换 FeatureGroup（画笔）与高亮组（问题1：均挂载到顶层 drawPane）
  useEffect(() => {
    if (!map.getPane(DRAW_PANE)) {
      const pane = map.createPane(DRAW_PANE)
      pane.style.zIndex = '700'
    }
    const g = L.featureGroup([], { pane: DRAW_PANE })
    const h = L.featureGroup([], { pane: DRAW_PANE })
    map.addLayer(g)
    map.addLayer(h)
    fgRef.current = g
    hlRef.current = h
    setFg(g)
    setHl(h)
    // 视角切换：历史栈由 App 按「地图+视角」分桶管理，LayerManager 无需清理
    return () => {
      map.removeLayer(g)
      map.removeLayer(h)
      // 第十五轮：视角切换时移除套索包围矩形（独立图层，不随 fg 清理）
      if (lassoBoxRef.current) {
        lassoBoxRef.current.remove()
        lassoBoxRef.current = null
      }
      // 第十六轮：视角切换时清空套索选中集（载具/图形已按视角分桶，旧选中失效）
      selectedRef.current.clear()
      selVehiclesRef.current.clear()
      selOperatorsRef.current.clear()
      onDeleteSelCountRef.current(0)
      fgRef.current = null
      hlRef.current = null
      setFg(null)
      setHl(null)
    }
  }, [map, view])

  /** 在当前 fg 中按 uid 查找图层（问题：文本放置后立即 save() 会触发 geoJson 还原重建，原 marker 被替换） */
  const findByUid = useCallback((uid: string): AnyWithFeature | null => {
    const g = fgRef.current
    if (!g) return null
    let found: AnyWithFeature | null = null
    g.eachLayer((l) => {
      const fl = l as AnyWithFeature
      if (fl.feature && String((fl.feature.properties as Record<string, unknown>).uid) === uid) found = fl
    })
    return found
  }, [])

  // 打开文字标注编辑会话
  const openEditor = useCallback(
    (marker: MarkerWithFeature) => {
      const props = (marker.feature?.properties ?? {}) as Record<string, unknown>
      // 锁定图形不可编辑文字（双击不触发编辑会话）
      if (lockedKeysRef.current().has(String(props.group ?? props.uid ?? ''))) return
      const latlng = marker.getLatLng()
      const uid = String(props.uid ?? genUid('text'))
      if (props.uid !== uid) props.uid = uid
      // 第十三轮：记录文字标注在容器内的像素坐标，编辑器浮层跟随其位置显示，
      // 避免固定在顶部时被绘制模式横幅遮挡
      const cp = map.latLngToContainerPoint(latlng)
      onStartEdit({
        uid,
        lat: latlng.lat,
        lng: latlng.lng,
        initialText: String(props.text ?? ''),
        containerPoint: { x: cp.x, y: cp.y },
        commit: (text: string) => {
          // 问题：放置后 marker 可能已被 geoJson 还原重建，必须按 uid 找到当前对象再更新，
          // 否则输入的文字写入旧对象，文本永远无法显示/保存
          const target = findByUid(uid)
          const tp = (target?.feature?.properties ?? {}) as Record<string, unknown>
          tp.text = text
          if (target instanceof L.Marker) {
            target.setIcon(textIcon(text, textStyleFromProps(tp)))
            window.requestAnimationFrame(() => refreshTextHitRef.current(target as MarkerWithFeature))
          }
          save()
        },
        cancel: () => {
          clearEditSelectionRef.current(false)
          const target = findByUid(uid)
          if (target && !String((target.feature?.properties as Record<string, unknown>)?.text ?? '')) {
            const removeByUid = (group: L.FeatureGroup | null) => {
              if (!group) return
              const stale: L.Layer[] = []
              group.eachLayer((layer) => {
                const props = (layer as AnyWithFeature).feature?.properties as Record<string, unknown> | undefined
                if (String(props?.uid ?? '') === uid) stale.push(layer)
              })
              for (const layer of stale) group.removeLayer(layer)
            }
            removeByUid(hitRef.current)
            removeByUid(hlRef.current)
            fgRef.current?.removeLayer(target)
            save()
          }
        },
      })
    },
    [onStartEdit, save, findByUid, map],
  )
  // 同步最新回调到 ref（供 restoreLayer 在闭包外读取，第十一轮）
  openEditorRef.current = openEditor

  /** 高亮图层管理（框选选中图形，问题4） */
  const highlight = useCallback((uid: string, on: boolean) => {
    const h = hlRef.current
    if (!h) return
    // Highlight overlays are independent Leaflet layers. Remove an existing
    // overlay before looking up its source, because cancelling a newly-created
    // empty text marker deletes the source first.
    h.eachLayer((l) => {
      const fl = l as AnyWithFeature
      if (fl.feature && String((fl.feature.properties as Record<string, unknown>).uid) === uid) h.removeLayer(l)
    })
    if (!on) return
    const g = fgRef.current
    const layer = g?.eachLayer
      ? ((() => {
          let found: AnyWithFeature | null = null
          g.eachLayer((l) => {
            const fl = l as AnyWithFeature
            if (fl.feature && String((fl.feature.properties as Record<string, unknown>).uid) === uid) {
              found = fl
            }
          })
          return found
        })() as AnyWithFeature | null)
      : null
    if (!layer) return
    // 用黄色描边叠加高亮（不修改原始图形样式，问题1：高亮也在 drawPane 之上；
    // interactive:false 让高亮为纯视觉层，不拦截鼠标事件，点击/拖拽仍作用于下方图形）
    let hlLayer: L.Layer | null = null
    if (layer instanceof L.Circle) {
      hlLayer = L.circle(layer.getLatLng(), { radius: layer.getRadius(), weight: 5, color: '#01ff84', opacity: 0.9, fillOpacity: 0, pane: DRAW_PANE, interactive: false })
    } else if (layer instanceof L.Marker) {
      const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
      if (props.type === 'text') {
        const textEl = layer.getElement()?.querySelector<HTMLElement>('.text-marker')
        const rect = textEl?.getBoundingClientRect()
        const mapRect = map.getContainer().getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0) {
          const pad = 3
          hlLayer = L.rectangle(L.latLngBounds(
            map.containerPointToLatLng(L.point(rect.left - mapRect.left - pad, rect.top - mapRect.top - pad)),
            map.containerPointToLatLng(L.point(rect.right - mapRect.left + pad, rect.bottom - mapRect.top + pad)),
          ), { weight: 2, color: '#01ff84', opacity: 0.85, fillOpacity: 0, pane: DRAW_PANE, interactive: false })
        }
      } else {
        hlLayer = L.circleMarker(layer.getLatLng(), { radius: 11, weight: 3, color: '#01ff84', opacity: 0.9, fillOpacity: 0, pane: DRAW_PANE, interactive: false })
      }
    } else if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
      const latlngs = layer.getLatLngs()
      const opts = { weight: 6, color: '#01ff84', opacity: 0.8, fillOpacity: 0, pane: DRAW_PANE, interactive: false }
      hlLayer =
        layer instanceof L.Polygon ? L.polygon(latlngs as never, opts) : L.polyline(latlngs as never, opts)
    }
    if (hlLayer) {
      const p = (layer.feature?.properties ?? {}) as Record<string, unknown>
      ;(hlLayer as AnyWithFeature).feature = { type: 'Feature', properties: { uid }, geometry: layer.feature?.geometry ?? { type: 'Point', coordinates: [] } }
      if (p.group) (hlLayer as AnyWithFeature).feature!.properties.group = p.group
      h.addLayer(hlLayer)
      // 关键（第十三轮修复）：interactive:false 只让 Leaflet 不绑定事件，SVG path 元素仍会
      // 接收 DOM 指针事件。高亮描边比原图形更粗，鼠标按下若落在高亮上，事件 target 是高亮层
      // （与原图形是兄弟节点，DOM 冒泡不经过它），原图形的 mousedown/拖拽永远不会触发，
      // 表现为"高亮了但拖不动"。这里强制 pointer-events:none 让事件完全穿透到下方原图形。
      const hlEl = (hlLayer as L.Path).getElement?.() as HTMLElement | null
      if (hlEl) hlEl.style.pointerEvents = 'none'
    }
  }, [map])

  // 组扩展（第十二轮修复）：箭头 = 箭杆 + 箭头两个图层（同 group 不同 uid）。
  // 选中任意一个时，把同 group 的其他图层也加入选中，保证移动/删除整体生效。
  const expandGroupSelection = useCallback(() => {
    const g = fgRef.current
    if (!g) return
    g.eachLayer((l) => {
      const fl = l as AnyWithFeature
      if (!fl.feature) return
      const p = fl.feature.properties as Record<string, unknown>
      const grp = String(p.group ?? '')
      const u = String(p.uid)
      if (!grp || selectedRef.current.has(u)) return
      // 组内任一图层已选中 → 全组选中
      let groupSelected = false
      g.eachLayer((l2) => {
        const fl2 = l2 as AnyWithFeature
        const p2 = fl2.feature?.properties as Record<string, unknown> | undefined
        if (p2 && String(p2.group ?? '') === grp && selectedRef.current.has(String(p2.uid))) groupSelected = true
      })
      if (groupSelected) {
        selectedRef.current.add(u)
        highlight(u, true)
      }
    })
  }, [highlight])

  // ---- 套索包围矩形（第十五轮：圈中图形后形成矩形区域，区域内按住可整体移动） ----

  /** 计算选中图形 + 载具的包围盒（无选中返回 null） */
  const computeSelectionBounds = useCallback((): L.LatLngBounds | null => {
    const pts: L.LatLng[] = []
    fgRef.current?.eachLayer((l) => {
      const fl = l as AnyWithFeature
      if (!fl.feature) return
      const u = String((fl.feature.properties as Record<string, unknown>).uid)
      if (!selectedRef.current.has(u)) return
      if (l instanceof L.Marker || l instanceof L.Circle) {
        pts.push((l as L.Marker).getLatLng())
      } else if (l instanceof L.Polyline || l instanceof L.Polygon) {
        const b = (l as L.Polyline).getBounds()
        pts.push(b.getNorthEast(), b.getSouthWest())
      }
    })
    const posMap = vehiclePosRef?.current ?? {}
    for (const uid of selVehiclesRef.current) {
      const p = posMap[uid]
      if (p) pts.push(L.latLng(p[0], p[1]))
    }
    // 干员位置（第十七轮：套索框选兵棋干员后包围矩形覆盖棋子）
    const opMap = operatorPosRef?.current ?? {}
    for (const uid of selOperatorsRef.current) {
      const p = opMap[uid]
      if (p) pts.push(L.latLng(p[0], p[1]))
    }
    // 队标位置（第二十三轮：套索框选兵棋队标后包围矩形覆盖棋子）
    const tmMap = teamPosRef?.current ?? {}
    for (const uid of selTeamsRef.current) {
      const p = tmMap[uid]
      if (p) pts.push(L.latLng(p[0], p[1]))
    }
    if (pts.length === 0) return null
    return L.latLngBounds(pts)
  }, [])

  /** 启动整体拖拽（已选中图形/载具）：记录基准位置 + 包围矩形起始范围 */
  const startMoveSelected = useCallback(
    (e: L.LeafletMouseEvent) => {
      dragMovedRef.current = false
      const base = new Map<string, unknown>()
      // 锁定图形不随套索整体移动（避免被连带拖走）
      const locked = lockedKeysRef.current()
      fgRef.current?.eachLayer((l) => {
        const fl = l as AnyWithFeature
        if (!fl.feature) return
        const fp = fl.feature.properties as Record<string, unknown>
        const u = String(fp.uid)
        if (!selectedRef.current.has(u)) return
        if (locked.has(String(fp.group ?? u))) return
        if (l instanceof L.Marker || l instanceof L.Circle) base.set(u, (l as L.Marker).getLatLng())
        else if (l instanceof L.Polyline || l instanceof L.Polygon) base.set(u, (l as L.Polyline).getLatLngs())
      })
      // 载具基准位置（与绘制图形一并记录，整体移动时同步）
      const vehBase: Record<string, [number, number]> = {}
      const posMap = vehiclePosRef?.current ?? {}
      for (const uid of selVehiclesRef.current) {
        vehBase[uid] = posMap[uid] ?? [0, 0]
      }
      // 干员基准位置（第十七轮：与图形/载具一并记录，整体移动时同步）
      const opBase: Record<string, [number, number]> = {}
      const opMap = operatorPosRef?.current ?? {}
      for (const uid of selOperatorsRef.current) {
        opBase[uid] = opMap[uid] ?? [0, 0]
      }
      // 队标基准位置（第二十三轮：与图形/载具/干员一并记录，整体移动时同步）
      const tmBase: Record<string, [number, number]> = {}
      const tmMap = teamPosRef?.current ?? {}
      for (const uid of selTeamsRef.current) {
        tmBase[uid] = tmMap[uid] ?? [0, 0]
      }
      moveDragRef.current = {
        start: e.latlng,
        base,
        before: snapshotNow(),
        vehBase,
        opBase,
        tmBase,
        boxBounds: lassoBoxRef.current?.getBounds(),
      }
    },
    [snapshotNow],
  )
  const startMoveSelectedRef = useRef(startMoveSelected)
  startMoveSelectedRef.current = startMoveSelected

  /** 平移 LatLngBounds（整体移动时包围矩形跟随） */
  const translateBounds = useCallback((b: L.LatLngBounds, dLat: number, dLng: number): L.LatLngBounds => {
    return L.latLngBounds(
      [b.getSouth() + dLat, b.getWest() + dLng],
      [b.getNorth() + dLat, b.getEast() + dLng],
    )
  }, [])

  /** 更新套索包围矩形（选中变化时调用）：有选中 → 显示矩形（外扩 padding）；无选中 → 移除 */
  const updateLassoBox = useCallback(() => {
    const existing = lassoBoxRef.current
    lassoBoxRef.current = null
    if (existing) existing.remove()
    if (toolRef.current !== 'lasso') return
    const bounds = computeSelectionBounds()
    if (!bounds) return
    // 按容器像素外扩 14px，让矩形区域比图形略大，便于抓取
    const PAD = 14
    const sw = map.latLngToContainerPoint(bounds.getSouthWest())
    const ne = map.latLngToContainerPoint(bounds.getNorthEast())
    const sw2 = map.containerPointToLatLng(L.point(sw.x - PAD, sw.y + PAD))
    const ne2 = map.containerPointToLatLng(L.point(ne.x + PAD, ne.y - PAD))
    const box = L.rectangle(L.latLngBounds(sw2, ne2), {
      pane: DRAW_PANE,
      color: '#01ff84',
      weight: 1.5,
      dashArray: '6 4',
      fillColor: '#01ff84',
      fillOpacity: 0.05,
      opacity: 0.9,
      interactive: true,
    })
    // 区域内按住：启动整体移动（与"按住已选中图形"相同）
    box.on('mousedown', (e: L.LeafletMouseEvent) => {
      startMoveSelectedRef.current(e)
      L.DomEvent.stopPropagation(e)
    })
    // 矩形内点击不取消选中（地图空白点击逻辑对 drawPane 内的元素本就不处理，双保险）
    box.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e))
    box.addTo(map)
    lassoBoxRef.current = box
  }, [map, computeSelectionBounds])

  // 供 early 定义的回调（clearSelection 等）调用最新版
  const updateLassoBoxRef = useRef(updateLassoBox)
  updateLassoBoxRef.current = updateLassoBox

  const clearSelection = useCallback(() => {
    for (const uid of selectedRef.current) highlight(uid, false)
    selectedRef.current.clear()
    selVehiclesRef.current.clear()
    selOperatorsRef.current.clear()
    selTeamsRef.current.clear()
    updateLassoBoxRef.current()
    notifySelection()
  }, [highlight, notifySelection])

  // 正式版绘制对象复制/粘贴：复制当前多选集合，粘贴时生成全新 uid/group 并轻微偏移。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'c') {
        if (selectedRef.current.size === 0) return
        const current = JSON.parse(snapshotNow()) as FeatureCollection
        drawClipboardRef.current = current.features
          .filter((feature) => selectedRef.current.has(String((feature.properties as Record<string, unknown> | null)?.uid ?? '')))
          .map((feature) => structuredClone(feature))
        if (drawClipboardRef.current.length > 0) event.preventDefault()
      } else if (key === 'v') {
        if (drawClipboardRef.current.length === 0) return
        event.preventDefault()
        const before = snapshotNow()
        const current = JSON.parse(before) as FeatureCollection
        const groupIds = new Map<string, string>()
        const pasted = drawClipboardRef.current.map((source) => {
          const feature = structuredClone(source)
          const properties = { ...(feature.properties as Record<string, unknown> | null) }
          properties.uid = genUid('copy')
          const oldGroup = String(properties.group ?? '')
          if (oldGroup) {
            if (!groupIds.has(oldGroup)) groupIds.set(oldGroup, genUid('copy_group'))
            properties.group = groupIds.get(oldGroup)
          }
          feature.properties = properties
          if ('coordinates' in feature.geometry) {
            feature.geometry = {
              ...feature.geometry,
              coordinates: offsetGeoCoordinates(feature.geometry.coordinates, 2, 2),
            } as Feature['geometry']
          }
          return feature
        })
        selectedRef.current.clear()
        for (const feature of pasted) selectedRef.current.add(String((feature.properties as Record<string, unknown>)?.uid ?? ''))
        const after = JSON.stringify({ ...current, features: [...current.features, ...pasted] })
        onCommitDrawRef.current(before, after)
        notifySelection()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [notifySelection, snapshotNow])

  // ---- 整体移动启动（第十二轮：统一绑定到所有画笔图层，拖拽选中的图形组） ----
  const dragStartRef = useRef<(e: L.LeafletMouseEvent) => void>(() => {})
  const onDragStart = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (toolRef.current !== 'lasso') return
      const layer = e.target as AnyWithFeature
      if (!layer.feature) return
      const props = layer.feature.properties as Record<string, unknown>
      const uid = String(props.uid)
      // 每次 mousedown 都重置拖拽标记（上次拖拽的 click 可能未被消费，避免误吞本次点击）
      dragMovedRef.current = false
      // 未选中图形：仅执行"选中"（含箭头组扩展），不启动拖拽。
      // 修复：点击图形应只是选中，而不是一按住就移动；再次按住已选中的图形才拖拽。
      if (!selectedRef.current.has(uid)) {
        clearSelection()
        selectedRef.current.add(uid)
        highlight(uid, true)
        expandGroupSelection()
        updateLassoBoxRef.current()
        notifySelection()
        // 阻止冒泡到地图（text 等图层没有独立的 stopProp mousedown 监听，避免误启动套索）
        L.DomEvent.stopPropagation(e)
        return
      }
      // 已选中图形：启动整体拖拽（记录所有选中图形/载具的基准位置 + 包围矩形范围）
      startMoveSelectedRef.current(e)
      L.DomEvent.stopPropagation(e)
    },
    [clearSelection, highlight, notifySelection, expandGroupSelection],
  )
  dragStartRef.current = onDragStart
  /** 绑定拖拽启动（图层创建/还原处统一调用；仅 lasso 模式生效） */
  const bindDrag = useCallback((l: L.Layer) => {
    const any = l as AnyWithFeature
    any.off('mousedown', onDragStart as never)
    any.on('mousedown', onDragStart as never)
  }, [onDragStart])

  /** 删除选中的图形组 + 载具 + 干员 + 队标（第十一轮套索 Delete/删除按钮；重构：上报 App 入历史栈） */
  const deleteSelected = useCallback(() => {
    const g = fgRef.current
    const hasDraw = g && selectedRef.current.size > 0
    const hasVeh = selVehiclesRef.current.size > 0
    const hasOp = selOperatorsRef.current.size > 0
    const hasTm = selTeamsRef.current.size > 0
    if (!g || (!hasDraw && !hasVeh && !hasOp && !hasTm)) return
    const before = snapshotNow()
    // 删除选中的绘制图形（含箭头组）
    if (hasDraw && g) {
      // 锁定图形不可删除（组内任一锁定即整组跳过），并提示解锁后再删除
      const locked = lockedKeysRef.current()
      let blockedLocked = false
      const doomed: AnyWithFeature[] = []
      g.eachLayer((l) => {
        const fl = l as AnyWithFeature
        const fp = (fl.feature?.properties ?? {}) as Record<string, unknown>
        const u = String(fp.uid)
        const grp = String(fp.group ?? '')
        if (!(selectedRef.current.has(u) || (grp && selectedRef.current.has(grp)))) return
        if (locked.has(grp || u)) {
          blockedLocked = true
          return
        }
        doomed.push(fl)
      })
      if (blockedLocked) showToastRef.current(LOCKED_TOAST_MSG)
      for (const d of doomed) {
        const u = String((d.feature?.properties as Record<string, unknown>)?.uid ?? '')
        selectedRef.current.delete(u)
        highlight(u, false)
        g.removeLayer(d)
      }
      if (doomed.length > 0) commitDraw(before)
    }
    // 删除选中的载具（第十四轮：套索框选后整体删除）
    if (hasVeh) {
      const uids = [...selVehiclesRef.current]
      selVehiclesRef.current.clear()
      onDeleteVehiclesRef.current(uids)
    }
    // 删除选中的干员（第十七轮：套索框选后整体删除，兵棋棋子回未部署）
    if (hasOp) {
      const uids = [...selOperatorsRef.current]
      selOperatorsRef.current.clear()
      onDeleteOperatorsRef.current?.(uids)
    }
    // 删除选中的队标（第二十三轮：套索框选后整体删除，队标回未部署）
    if (hasTm) {
      const uids = [...selTeamsRef.current]
      selTeamsRef.current.clear()
      onDeleteTeamsRef.current?.(uids)
    }
    updateLassoBoxRef.current()
    notifySelection()
  }, [highlight, snapshotNow, commitDraw, notifySelection])

  // 监听"删除选中"信号（第十二轮：工具栏按钮触发；必须放在 deleteSelected 之后，避免 TDZ）
  const prevDeleteSelTick = useRef(deleteSelectedTick)
  useEffect(() => {
    if (deleteSelectedTick !== prevDeleteSelTick.current) {
      prevDeleteSelTick.current = deleteSelectedTick
      deleteSelected()
    }
  }, [deleteSelectedTick, deleteSelected])

  // 监听"清空本层绘制"信号：锁定图形保留，只清空未锁定图形；有锁定图形被保留时提示
  const prevClearDrawTick = useRef(clearDrawTick)
  useEffect(() => {
    if (clearDrawTick === prevClearDrawTick.current) return
    prevClearDrawTick.current = clearDrawTick
    const g = fgRef.current
    if (!g) return
    const locked = lockedKeys()
    const doomed: AnyWithFeature[] = []
    g.eachLayer((l) => {
      const fl = l as AnyWithFeature
      if (!fl.feature) return
      const p = fl.feature.properties as Record<string, unknown>
      if (!locked.has(String(p.group ?? p.uid ?? ''))) doomed.push(fl)
    })
    if (doomed.length > 0) {
      const before = snapshotNow()
      for (const d of doomed) {
        const u = String((d.feature?.properties as Record<string, unknown> | undefined)?.uid ?? '')
        selectedRef.current.delete(u)
        highlight(u, false)
        g.removeLayer(d)
      }
      commitDraw(before)
      updateLassoBoxRef.current()
      buildGizmoRef.current()
      notifySelection()
    }
    if (locked.size > 0) showToast(LOCKED_TOAST_MSG)
  }, [clearDrawTick, lockedKeys, snapshotNow, commitDraw, highlight, notifySelection, showToast])

  /** 删除图形（橡皮擦）：箭头按 group 整体删除（问题4；重构：上报 App 入历史栈） */
  const deleteFeature = useCallback(
    (layer: AnyWithFeature) => {
      const g = fgRef.current
      if (!g) return
      const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
      const key = String(props.group ?? props.uid)
      // 锁定图形不可擦除：提示解锁后再删除
      if (lockedKeysRef.current().has(key)) {
        showToastRef.current(LOCKED_TOAST_MSG)
        return
      }
      const before = snapshotNow()
      const doomed: AnyWithFeature[] = []
      g.eachLayer((l) => {
        const fl = l as AnyWithFeature
        const fp = (fl.feature?.properties ?? {}) as Record<string, unknown>
        if (String(fp.group ?? fp.uid) === key) doomed.push(fl)
      })
      for (const d of doomed) {
        const uid = String((d.feature?.properties as Record<string, unknown>)?.uid ?? '')
        selectedRef.current.delete(uid)
        highlight(uid, false)
        g.removeLayer(d)
      }
      commitDraw(before)
    },
    [snapshotNow, commitDraw, highlight],
  )

  /** 图形点击：橡皮擦模式删除；套索模式单选/取消选中（第十一轮） */
  const onFeatureClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      const layer = e.target as AnyWithFeature
      if (tool === 'eraser') {
        // 实际擦除由地图级轨迹采样统一处理；保留点击兜底只用于整图擦除。
        if (draw.eraserMode === 'shape' && fgRef.current?.hasLayer(layer)) deleteFeature(layer)
        L.DomEvent.stopPropagation(e)
        return
      }
      if (tool === 'lasso') {
        // 拖动结束后 Leaflet 派发的 click 不处理（避免误取消选中，第十二轮）
        if (dragMovedRef.current) {
          dragMovedRef.current = false
          return
        }
        const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
        const uid = String(props.uid)
        // 点击图形只增不减：未选中则选中（含箭头组扩展），已选中则保持不动。
        // 用户要求：松开鼠标不得取消选中；取消选中仅通过点击空白 / Esc / 删除 / 新选中替换。
        if (!selectedRef.current.has(uid)) {
          selectedRef.current.add(uid)
          highlight(uid, true)
          expandGroupSelection()
          updateLassoBoxRef.current()
          notifySelection()
        }
        // 阻止冒泡到地图，避免空白点击逻辑清空选中
        L.DomEvent.stopPropagation(e)
      }
    },
    [tool, draw.eraserMode, deleteFeature, highlight, notifySelection, expandGroupSelection],
  )
  // 同步最新回调到 ref（供 restoreLayer 在闭包外读取，第十一轮）
  onFeatureClickRef.current = onFeatureClick

  // GeoJSON -> 图层（还原 + 绑定交互）
  useEffect(() => {
    if (!fg || !hl) return
    // 本图层刚完成的真实交互已经直接修改了 Leaflet 对象；App 回写的 GeoJSON
    // 若与当前快照一致，无需先清空再还原，否则每次点击/拖动都会产生一帧闪烁。
    if (snapshotNow() === geoJson) return
    fg.clearLayers()
    hl.clearLayers()
    // 第十二轮：重建后恢复选中高亮（套索移动/删除触发保存会重建图层，选中状态不应丢失）
    const keep = new Set(selectedRef.current)
    selectedRef.current = keep
    let parsed: FeatureCollection
    try {
      parsed = JSON.parse(geoJson) as FeatureCollection
    } catch {
      return
    }
    const layer = L.geoJSON(parsed, {
      // 问题1：还原的图形同样进入 drawPane，保证刷新后仍显示在最上层
      pane: DRAW_PANE,
      // 旧版箭头兼容：箭头头部 Polygon 由原生 marker-end 替代，跳过渲染避免双重箭头
      filter: (feature) => {
        const p = feature.properties as Record<string, unknown> | null
        if (p?.type === 'arrow' && feature.geometry.type === 'Polygon') return false
        return true
      },
      pointToLayer: (feature, latlng) => {
        const props = ensureProps(feature)
        // 圆形：Point + radius/radiusY 属性持久化，还原为椭圆多边形（第十五轮：
        // 与矩形一致走 Polygon 渲染管线，支持方向拉伸成椭圆；旧数据 radiusY 缺失时为正圆）
        if (props.type === 'circle') {
          const rx = Math.max(2, Number(props.radius ?? 100))
          const ry = Math.max(2, Number(props.radiusY ?? rx))
          const poly = L.polygon(ellipsePoints(latlng, rx, ry), {
            ...styleFromProps(props, view),
          }) as PathWithFeature
          poly.feature = feature
          poly.on('click', onFeatureClick)
          if (tool === 'lasso') {
            poly.on('mousedown', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e))
          }
          bindDrag(poly)
          return poly
        }
      const marker = L.marker(latlng, {
        icon: textIcon(String(props.text ?? ''), textStyleFromProps(props)),
        pane: DRAW_PANE,
      }) as MarkerWithFeature
      marker.feature = feature
      marker.on('dblclick', () => openEditor(marker))
      marker.on('click', onFeatureClick)
      bindDrag(marker)
      window.requestAnimationFrame(() => refreshTextHitRef.current(marker))
      return marker
    },
    onEachFeature: (feature, l) => {
      const props = ensureProps(feature)
      const pl = l as PathWithFeature
      pl.feature = feature
      // 圆/椭圆：Point 几何走 pointToLayer 已带样式；Polygon 几何（拉成椭圆后保存）走这里补样式
      if (l instanceof L.Path) {
        pl.setStyle(styleFromProps(props, view))
      }
      if (l instanceof L.Marker) return // 标记类已在 pointToLayer 绑定交互
      // 箭头（新/旧数据均为 LineString type='arrow'）：挂载原生 marker-end 渲染箭头（形状/大小读 props）
      if (props.type === 'arrow' && l instanceof L.Polyline) decorateArrowMarker(l, props)
      // 防线三角（Polygon）：实心填充（与绘制成稿一致）
      if (props.type === 'defense' && l instanceof L.Polygon) {
        const c = String(props.color ?? SIDE_COLORS[view])
        pl.setStyle({ color: c, weight: 0, fillColor: c, fillOpacity: 0.95, opacity: 1, pane: DRAW_PANE })
      }
      pl.on('click', onFeatureClick)
      // 套索模式：图形可拖拽移动（阻止冒泡避免触发地图套索）
      if (tool === 'lasso') {
        pl.on('mousedown', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e))
      }
      bindDrag(pl)
    },
  })
  layer.eachLayer((l) => fg.addLayer(l))
  // 重建后恢复视觉状态：套索用绿色描边；普通编辑由蓝色选框/手柄表示选中。
  for (const uid of keep) highlight(uid, tool === 'lasso')
  // 第十五轮：重建后更新包围矩形（图层对象已替换，矩形位置按新图层重算）
  updateLassoBoxRef.current()
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fg, hl, geoJson, view, tool, onFeatureClick, openEditor, bindDrag, highlight])

  // ---- 拖拽式绘制：点击起点 → 拖动预览 → 释放成稿（问题4；第二十二轮：+防线/曲线） ----
  // 线条工具（line/arrow/defense）在手绘模式下不进入此 effect（由下方自由绘制 effect 处理）
  useEffect(() => {
    if (!fg) return
    if (tool === 'line' || tool === 'arrow' || tool === 'defense') {
      if (draw.curve === 'freehand') return
    } else if (!['rect', 'circle'].includes(tool)) {
      return
    }

    const isLineTool = tool === 'line' || tool === 'arrow' || tool === 'defense'
    const isSmooth = draw.curve === 'smooth'

    const st: {
      phase: 'idle' | 'drawing' | 'adjusting'
      start?: L.LatLng
      end?: L.LatLng
      ctrl?: L.LatLng
      /** 控制点是否正在被拖拽（调整曲度） */
      ctrlDragging: boolean
      ctrlMoved: boolean
      ctrlDownPoint?: L.Point
      ctrlMarker?: L.Marker
      previews: L.Layer[]
    } = { phase: 'idle', ctrlDragging: false, ctrlMoved: false, previews: [] }

    const stylePreview = {
      color: draw.color,
      weight: draw.weight,
      opacity: 0.55,
      fillColor: draw.fillColor,
      fillOpacity: (tool === 'rect' || tool === 'circle') && draw.fillEnabled ? 0.28 : 0,
      dashArray: dashArrayOf(draw.dash),
      // 问题1：绘制预览同样进入顶层 drawPane
      pane: DRAW_PANE,
    }

    /** 按 起/终点（+控制点）生成预览：ctrl 存在 → 曲线；否则直线 */
    const previewShape = (s: L.LatLng, e: L.LatLng, ctrl?: L.LatLng): L.Layer[] => {
      const pts = ctrl ? bezierPoints(s, ctrl, e) : [s, e]
      if (tool === 'defense') {
        const df = defenseFeatures(pts, draw.weight)
        const layers: L.Layer[] = []
        for (const tri of df.triangles) {
          layers.push(L.polygon(tri, { ...stylePreview, fillOpacity: 0.9, weight: 0 }))
        }
        return layers
      }
      if (tool === 'arrow') {
        const line = L.polyline(pts, stylePreview)
        decorateArrowMarker(line, {
          arrowStyle: draw.arrowStyle,
          arrowSize: draw.arrowSize,
          color: draw.color,
        })
        return [line]
      }
      if (tool === 'rect') return [L.rectangle(L.latLngBounds(s, e), stylePreview)]
      // 圆形（第十五轮：点击为外接矩形左上角，拖至右下角确定，圆内切于矩形框）
      if (tool === 'circle') {
        const mid = L.latLng((s.lat + e.lat) / 2, (s.lng + e.lng) / 2)
        const r = Math.max(0, Math.min(Math.abs(e.lng - s.lng), Math.abs(e.lat - s.lat)) / 2)
        return [
          L.rectangle(L.latLngBounds(s, e), { ...stylePreview, fillOpacity: 0, dashArray: '6 4' }),
          L.polygon(ellipsePoints(mid, r, r), stylePreview),
        ]
      }
      return [L.polyline(pts, stylePreview)]
    }

    const clearPreviews = () => {
      st.previews.forEach((p) => p.remove())
      st.previews = []
    }
    const setPreviews = (s: L.LatLng, e: L.LatLng, ctrl?: L.LatLng) => {
      clearPreviews()
      st.previews = previewShape(s, e, ctrl)
      st.previews.forEach((p) => p.addTo(map))
    }

    /** 提交成稿：s=起点 e=终点；pts 可选（曲线采样路径，直线时省略） */
    const commitShape = (s: L.LatLng, e: L.LatLng, pts?: L.LatLng[]) => {
      const uid = genUid('draw')
      const props = {
        type: tool,
        uid,
        color: draw.color,
        weight: draw.weight,
        dash: draw.dash,
        fillColor: draw.fillColor,
        fillEnabled: draw.fillEnabled,
        // 箭头专属：形状 + 大小（存于 feature，还原时读取）
        arrowStyle: draw.arrowStyle,
        arrowSize: draw.arrowSize,
      }
      const make = (geometry: Feature['geometry'], extraProps: Record<string, unknown> = {}): Feature => ({
        type: 'Feature',
        properties: { ...props, ...extraProps },
        geometry,
      })
      const coords = (lls: L.LatLng[]) => lls.map((ll) => [ll.lng, ll.lat])
      const commitLayer = (f: Feature, layer: L.Layer) => {
        const any = layer as AnyWithFeature
        any.feature = f
        if (layer instanceof L.Marker) {
          ;(layer as MarkerWithFeature).on('dblclick', () => openEditor(layer as MarkerWithFeature))
        }
        layer.on('click', onFeatureClick as never)
        if (tool === 'lasso') layer.on('mousedown', (ev: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(ev))
        if (layer instanceof L.Path) layer.setStyle(styleFromProps(f.properties as Record<string, unknown>, view))
        bindDrag(layer)
        fg.addLayer(layer)
      }
      // 第十二轮：绘制前快照（供撤回/恢复）
      const before = snapshotNow()
      const linePts = pts ?? [s, e]
      const isCurve = !!pts

      if (tool === 'defense') {
        // 防线：纯实心三角形组成的线条（无主线），group 关联整组（移动/删除/选中）
        const df = defenseFeatures(linePts, draw.weight)
        const triStyle: L.PathOptions = {
          color: draw.color,
          weight: 0,
          fillColor: draw.color,
          fillOpacity: 0.95,
          opacity: 1,
          pane: DRAW_PANE,
        }
        for (const tri of df.triangles) {
          const poly = L.polygon(tri, triStyle)
          commitLayer(make(
            { type: 'Polygon', coordinates: [coords(tri)] },
            { group: uid, curve: isCurve ? 'smooth' : 'straight', defensePath: coords(linePts) },
          ), poly)
        }
      } else if (tool === 'arrow') {
        // 原生箭头：单条 LineString（type='arrow'），末端由 SVG marker-end 渲染箭头。
        // group 保留用于橡皮擦/移动/选中整组操作。曲线箭头：路径沿贝塞尔采样，箭头沿末端切线方向。
        const line = L.polyline(linePts, styleFromProps(props, view))
        decorateArrowMarker(line, props)
        commitLayer(make({ type: 'LineString', coordinates: coords(linePts) }, { group: uid, curve: isCurve ? 'smooth' : 'straight' }), line)
      } else if (tool === 'circle') {
        // 圆形（第十五轮：点击为外接矩形左上角，拖至右下角确定，圆内切于矩形框；
        // 存 Point 中心 + radius/radiusY 半轴，渲染为椭圆多边形）
        const mid = L.latLng((s.lat + e.lat) / 2, (s.lng + e.lng) / 2)
        const r = Math.max(2, Math.min(Math.abs(e.lng - s.lng), Math.abs(e.lat - s.lat)) / 2)
        const ring = ellipsePoints(mid, r, r)
        const feature = make({ type: 'Point', coordinates: [mid.lng, mid.lat] }, { radius: r, radiusY: r })
        commitLayer(feature, L.polygon(ring, styleFromProps(props, view)))
      } else if (tool === 'rect') {
        // 问题：此前把 GeoJSON 的 [lng,lat] 数字数组直接传给 L.polygon，
        // Leaflet 会按 [lat,lng] 解释导致坐标交换、图形画到地图外不可见。
        // 改为直接传 LatLng 对象数组（feature.geometry 仍为正确 GeoJSON 顺序，用于保存/还原）
        const corners = [s, L.latLng(s.lat, e.lng), e, L.latLng(e.lat, s.lng)]
        const feature = make({ type: 'Polygon', coordinates: [coords(corners)] })
        commitLayer(feature, L.polygon(corners, styleFromProps(props, view)))
      } else {
        // line：直线（两点）或曲线（采样多点）
        const feature = make({ type: 'LineString', coordinates: coords(linePts) }, { curve: isCurve ? 'smooth' : 'straight' })
        commitLayer(feature, L.polyline(linePts, styleFromProps(props, view)))
      }
      // 绘制完成后保持工具激活，可继续绘制下一个图形
      // 重构：绘制操作上报 App 统一入历史栈（快照式，App 侧含保存）
      commitDraw(before)
    }

    // 初次曲线控制点：用户可拖动后松开确认，也可直接点击空白/右键确认当前形状。
    const ctrlIcon = L.divIcon({
      className: 'curve-ctrl-wrap',
      html: '<div class="curve-ctrl"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
    const showCtrlMarker = (pos: L.LatLng) => {
      hideCtrlMarker()
      const m = L.marker(pos, { icon: ctrlIcon, pane: DRAW_PANE, interactive: true, keyboard: false, zIndexOffset: 1000 })
      m.on('mousedown', (ev: L.LeafletMouseEvent) => {
        if ((ev.originalEvent as MouseEvent).button !== 0) return
        L.DomEvent.stop(ev.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(ev)
        if (st.phase !== 'adjusting') return
        editPointerActiveRef.current = true
        st.ctrlDragging = true
        st.ctrlMoved = false
        st.ctrlDownPoint = map.latLngToContainerPoint(ev.latlng)
      })
      m.on('click', (ev: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(ev))
      m.addTo(map)
      st.ctrlMarker = m
    }
    const hideCtrlMarker = () => {
      if (st.ctrlMarker) {
        st.ctrlMarker.remove()
        st.ctrlMarker = undefined
      }
    }

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      if (editPointerActiveRef.current) return
      const t = e.originalEvent.target as HTMLElement
      // 控制点自己处理按下（拖拽调整）；绘制层已有图形交给 onFeatureClick
      if (t.closest?.('.curve-ctrl, .curve-ctrl-wrap')) return
      if (t.closest?.(DRAW_PANE_SELECTOR)) return
      if (st.phase === 'drawing') return
      if (st.phase === 'adjusting') {
        // 调整阶段点击空白 → 提交当前曲线，回到 idle
        commitCurve()
        return
      }
      // idle：开始新绘制
      st.phase = 'drawing'
      st.start = e.latlng
      setDrawingGestureActive(map, true)
      setPreviews(e.latlng, e.latlng)
    }

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      // 已有图形/编辑手柄正在操作时，本绘制器只能保持空闲。Android 的合成
      // mousemove 会同时到达 map，若不显式隔离会把端点拖动误当成新防线预览。
      if (editPointerActiveRef.current && st.phase !== 'adjusting') {
        if (st.phase === 'drawing') {
          clearPreviews()
          setDrawingGestureActive(map, false)
          st.phase = 'idle'
          st.start = undefined
          st.end = undefined
        }
        return
      }
      if (st.phase === 'drawing' && st.start) {
        st.end = e.latlng
        setPreviews(st.start, e.latlng)
      } else if (st.phase === 'adjusting' && st.ctrlDragging && st.start && st.end) {
        // 拖控制点：实时更新曲线与手柄位置
        const currentPoint = map.latLngToContainerPoint(e.latlng)
        if (st.ctrlDownPoint && st.ctrlDownPoint.distanceTo(currentPoint) > 3) st.ctrlMoved = true
        st.ctrl = e.latlng
        st.ctrlMarker?.setLatLng(e.latlng)
        setPreviews(st.start, st.end, e.latlng)
      }
    }

    const onMouseUp = (e: L.LeafletMouseEvent) => {
      if (editPointerActiveRef.current && st.phase !== 'adjusting') {
        if (st.phase === 'drawing') {
          clearPreviews()
          setDrawingGestureActive(map, false)
          st.phase = 'idle'
          st.start = undefined
          st.end = undefined
        }
        return
      }
      if (st.phase === 'drawing' && st.start) {
        setDrawingGestureActive(map, false)
        const end = e.latlng
        // 距离过小视为误触，不生成图形
        if (st.start.distanceTo(end) < 1) {
          st.phase = 'idle'
          clearPreviews()
          return
        }
        if (isSmooth && isLineTool) {
          // 首次拖动确定端点后进入可选曲率调整；不拖控制点也可以确认当前直线形态。
          st.phase = 'adjusting'
          st.end = end
          st.ctrl = L.latLng((st.start.lat + end.lat) / 2, (st.start.lng + end.lng) / 2)
          setPreviews(st.start, end, st.ctrl)
          showCtrlMarker(st.ctrl)
        } else {
          // 直线/矩形/圆：直接成稿
          clearPreviews()
          commitShape(st.start, end)
          st.phase = 'idle'
        }
      } else if (st.phase === 'adjusting' && st.ctrlDragging) {
        // 初次绘制：弯曲手柄完成一次有效拖动并松开后，立即提交并落盘。
        const shouldCommit = st.ctrlMoved
        st.ctrlDragging = false
        st.ctrlMoved = false
        st.ctrlDownPoint = undefined
        editPointerActiveRef.current = false
        if (shouldCommit) commitCurve()
      }
    }

    const onDocumentMouseUp = () => {
      if (st.phase !== 'adjusting' || !st.ctrlDragging) return
      const shouldCommit = st.ctrlMoved
      st.ctrlDragging = false
      st.ctrlMoved = false
      st.ctrlDownPoint = undefined
      editPointerActiveRef.current = false
      if (shouldCommit) commitCurve()
    }

    /** 提交曲线（调整阶段确认；pts 已含曲线采样） */
    const commitCurve = () => {
      if (!st.start || !st.end) return
      const pts = st.ctrl ? bezierPoints(st.start, st.ctrl, st.end) : [st.start, st.end]
      hideCtrlMarker()
      clearPreviews()
      commitShape(st.start, st.end, pts)
      st.phase = 'idle'
      editPointerActiveRef.current = false
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (st.phase === 'drawing' || st.phase === 'adjusting') {
          setDrawingGestureActive(map, false)
          hideCtrlMarker()
          clearPreviews()
          st.phase = 'idle'
          editPointerActiveRef.current = false
        }
      } else if (ev.key === 'Enter' && st.phase === 'adjusting') {
        commitCurve()
      }
    }

    const container = map.getContainer()
    const onContextMenu = (ev: MouseEvent) => {
      if (st.phase !== 'adjusting' || !st.start || !st.end) return
      ev.preventDefault()
      // 右键确认当前草稿；MapView 会在本事件结束后再切回 pan。
      commitCurve()
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    document.addEventListener('mouseup', onDocumentMouseUp)
    document.addEventListener('keydown', onKey)
    container.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      document.removeEventListener('mouseup', onDocumentMouseUp)
      document.removeEventListener('keydown', onKey)
      container.removeEventListener('contextmenu', onContextMenu, true)
      hideCtrlMarker()
      clearPreviews()
      setDrawingGestureActive(map, false)
      editPointerActiveRef.current = false
    }
  }, [map, fg, tool, draw, view, onFeatureClick, openEditor, commitDraw, snapshotNow, bindDrag])

  // ---- 套索选择（第十一轮：独立绘制工具，tool === 'lasso'）：
  // 拖拽空白区域画自由形状套索 → 选中内部图形（黄色高亮）+ 载具部署图标；
  // 点击空白处取消选中；点击选中图形/载具可整体拖动；Delete 键删除选中图形组与载具。
  // 套索工具保持激活，可连续框选。 ----
  useEffect(() => {
    if (!fg || tool !== 'lasso') return

    const st: { mode: 'lasso' | null; pts: L.LatLng[]; lasso?: L.Polyline } = { mode: null, pts: [] }
    // 载具位置来源：vehiclePosRef（VehicleLayer 实时注册）或 props.vehicles 兜底
    const posRef = vehiclePosRef

    // 射线法（PNPoly）：判断点是否落在闭合套索内（lng=横轴, lat=纵轴）
    const pnpoly = (x: number, y: number, poly: L.LatLng[]): boolean => {
      let inside = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].lng
        const yi = poly[i].lat
        const xj = poly[j].lng
        const yj = poly[j].lat
        const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
        if (intersect) inside = !inside
      }
      return inside
    }

    const lassoSelect = (pts: L.LatLng[]) => {
      fg.eachLayer((l) => {
        const fl = l as AnyWithFeature
        if (!fl.feature) return
        const props = fl.feature.properties as Record<string, unknown>
        const uid = String(props.uid)
        // 以图形中心点判定：Marker/Circle 用自身位置，其余用 bounds 中心
        const center =
          l instanceof L.Marker || l instanceof L.Circle
            ? (l as L.Marker).getLatLng()
            : (l as L.Polyline).getBounds().getCenter()
        if (pnpoly(center.lng, center.lat, pts) && !selectedRef.current.has(uid)) {
          selectedRef.current.add(uid)
          highlight(uid, true)
        }
      })
      // 箭头组扩展：只要组内一个图层在套索内，整组选中（移动/删除整体生效）
      expandGroupSelection()
      // 第十四轮：载具部署图标同样参与框选（位置以实时注册表为准）
      const posMap = posRef?.current ?? {}
      for (const v of vehicles) {
        const p = posMap[v.uid] ?? [v.lat, v.lng]
        if (pnpoly(p[1], p[0], pts)) selVehiclesRef.current.add(v.uid)
      }
      // 第十七轮：兵棋干员同样参与框选（位置以实时注册表为准，仅兵棋启用时注册）
      const opPosMap = operatorPosRef?.current ?? {}
      for (const op of operators ?? []) {
        const p = opPosMap[op.uid]
        if (p && pnpoly(p[1], p[0], pts)) selOperatorsRef.current.add(op.uid)
      }
      // 第二十三轮：兵棋队标同样参与框选（位置以实时注册表为准）
      const tmPosMap = teamPosRef?.current ?? {}
      for (const tm of teams ?? []) {
        const p = tmPosMap[tm.uid]
        if (p && pnpoly(p[1], p[0], pts)) selTeamsRef.current.add(tm.uid)
      }
      // 第十五轮：套索完成后更新包围矩形（区域内可整体移动）
      updateLassoBoxRef.current()
      notifySelection()
    }

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      // 点击到绘制层图形上时由图形 mousedown 处理（已 stopPropagation），此处仅为空白区域画套索。
      // 修复：用 DRAW_PANE 判定（leaflet-interactive 对多段线/组不可靠，第十轮已确认）
      if ((e.originalEvent.target as HTMLElement).closest?.(DRAW_PANE_SELECTOR)) return
      st.mode = 'lasso'
      st.pts = [e.latlng]
      st.lasso = L.polyline([e.latlng], {
        color: '#01ff84',
        weight: 1.5,
        dashArray: '6 4',
        opacity: 0.9,
        pane: DRAW_PANE,
      }).addTo(map)
    }

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (st.mode === 'lasso' && st.lasso) {
        const last = st.pts[st.pts.length - 1]
        const lastPt = map.latLngToContainerPoint(last)
        const curPt = map.latLngToContainerPoint(e.latlng)
        // 按容器像素距离过滤，控制轨迹点密度
        if (lastPt.distanceTo(curPt) > 2) st.pts.push(e.latlng)
        st.lasso.setLatLngs(st.pts)
      }
    }

    // 套索结束抑制窗口（修复"总是套不中"与"第一次点击无法取消"）：
    // 画完套索松开鼠标后，Leaflet 可能向空白地图派发 click，若 onClick 照常 clearSelection，
    // 刚选中的图形会立即被清空；但若终点落在图形上（click 被图形 stopPropagation）或浏览器
    // 未派发 click，布尔标记会残留，导致下一次点击空白被误吞（"第一次点击无法取消"）。
    // 改为时间窗口：仅抑制画完套索后 400ms 内的 click，超时自动失效，不依赖 click 是否派发。
    let suppressUntil = 0
    const onMouseUp = () => {
      if (st.mode === 'lasso') {
        if (st.pts.length >= 3) {
          lassoSelect(st.pts)
          suppressUntil = Date.now() + 400
        }
        st.lasso?.remove()
      }
      st.mode = null
      st.pts = []
      st.lasso = undefined
    }

    // 点击地图空白处取消选中（套索工具保持激活，第十一轮）
    const onClick = (e: L.LeafletMouseEvent) => {
      if (Date.now() < suppressUntil) return
      const t = e.originalEvent.target as HTMLElement
      // 命中绘制层已有图形（onFeatureClick 已处理单选）或地图控件时不处理
      if (t.closest?.(DRAW_PANE_SELECTOR) || t.closest?.('.leaflet-control-container')) return
      clearSelection()
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        clearSelection()
        if (st.lasso) {
          st.lasso.remove()
          st.lasso = undefined
        }
        st.mode = null
        st.pts = []
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        // 第十一轮：Delete 键删除选中的图形组
        deleteSelected()
      }
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    map.on('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.off('click', onClick)
      document.removeEventListener('keydown', onKey)
      if (st.lasso) st.lasso.remove()
      clearSelection()
    }
  }, [map, fg, tool, highlight, clearSelection, deleteSelected, notifySelection, expandGroupSelection, vehicles, vehiclePosRef, operators, operatorPosRef, teams, teamPosRef])

  // ---- 整体移动：mousemove 更新 + mouseup 保存（第十二轮：位移标记 + 快照入栈） ----
  // 第十四轮：选中的载具部署图标随图形一起整体移动（通过 vehiclePosRef 记录位移，
  // mouseup 统一提交 onMoveVehicles，App 更新 state 后 React 自动重绘 Marker 位置）
  useEffect(() => {
    if (tool !== 'lasso') return
    const DRAG_PX = 8 // 超过该像素位移视为拖动（区分点击）
    const onMove = (e: L.LeafletMouseEvent) => {
      const d = moveDragRef.current
      if (!d.start || !d.base) return
      const dLat = e.latlng.lat - d.start.lat
      const dLng = e.latlng.lng - d.start.lng
      // 位移超过阈值 → 标记为拖动（click 不取消选中）
      const sPt = map.latLngToContainerPoint(d.start)
      const cPt = map.latLngToContainerPoint(e.latlng)
      if (sPt.distanceTo(cPt) > DRAG_PX) dragMovedRef.current = true
      fgRef.current?.eachLayer((l) => {
        const fl = l as AnyWithFeature
        if (!fl.feature) return
        const uid = String((fl.feature.properties as Record<string, unknown>).uid)
        const base = d.base?.get(uid)
        if (!base) return
        if (l instanceof L.Marker || l instanceof L.Circle) {
          ;(l as L.Marker).setLatLng([(base as L.LatLng).lat + dLat, (base as L.LatLng).lng + dLng])
        } else if (l instanceof L.Polyline || l instanceof L.Polygon) {
          ;(l as L.Polyline).setLatLngs(translateLatLngs(base, dLat, dLng) as never)
        }
      })
      hlRef.current?.eachLayer((l) => {
        const fl = l as AnyWithFeature
        const uid = String((fl.feature?.properties as Record<string, unknown> | undefined)?.uid ?? '')
        const base = d.base?.get(uid)
        if (!base) return
        if (l instanceof L.Marker || l instanceof L.Circle) {
          ;(l as L.Marker).setLatLng([(base as L.LatLng).lat + dLat, (base as L.LatLng).lng + dLng])
        } else if (l instanceof L.Polyline || l instanceof L.Polygon) {
          ;(l as L.Polyline).setLatLngs(translateLatLngs(base, dLat, dLng) as never)
        }
      })
      // 第十四轮：同步移动选中的载具（基准位置由 startMoveSelected 记录）
      const posMap = vehiclePosRef?.current
      const vehBase = d.vehBase
      if (posMap && vehBase) {
        for (const uid of selVehiclesRef.current) {
          const base = vehBase[uid]
          if (!base) continue
          posMap[uid] = [base[0] + dLat, base[1] + dLng]
        }
      }
      // 第十七轮：同步移动选中的干员（基准位置由 startMoveSelected 记录）
      const opMap = operatorPosRef?.current
      const opBase = d.opBase
      if (opMap && opBase) {
        for (const uid of selOperatorsRef.current) {
          const base = opBase[uid]
          if (!base) continue
          opMap[uid] = [base[0] + dLat, base[1] + dLng]
        }
      }
      // 第二十三轮：同步移动选中的队标（基准位置由 startMoveSelected 记录）
      const tmMap = teamPosRef?.current
      const tmBase = d.tmBase
      if (tmMap && tmBase) {
        for (const uid of selTeamsRef.current) {
          const base = tmBase[uid]
          if (!base) continue
          tmMap[uid] = [base[0] + dLat, base[1] + dLng]
        }
      }
      // 第十五轮：包围矩形跟随平移（整体移动时）
      if (d.boxBounds && lassoBoxRef.current) {
        lassoBoxRef.current.setBounds(translateBounds(d.boxBounds, dLat, dLng))
      }
    }
    const onUp = () => {
      const d = moveDragRef.current
      // 仅当确实发生了拖拽（位移超过阈值）才处理：移动上报 App 入历史栈 / 落盘。
      // 点击已选中图形未拖动：不保存、不重建图层（修复：单击选中图形导致图层重建闪烁）
      if (d.start && d.before && dragMovedRef.current) {
        if (snapshotNow() !== d.before) commitDraw(d.before)
        else save()
        // 第十四轮：提交载具位移（与绘制同一次操作一并入栈）
        if (selVehiclesRef.current.size > 0 && vehiclePosRef?.current) {
          const updates: Record<string, [number, number]> = {}
          for (const uid of selVehiclesRef.current) {
            const p = vehiclePosRef.current[uid]
            if (p) updates[uid] = [p[0], p[1]]
          }
          if (Object.keys(updates).length > 0) onMoveVehiclesRef.current(updates)
        }
        // 第十七轮：提交干员位移（与绘制同一次操作一并入栈）
        if (selOperatorsRef.current.size > 0 && operatorPosRef?.current) {
          const updates: Record<string, [number, number]> = {}
          for (const uid of selOperatorsRef.current) {
            const p = operatorPosRef.current[uid]
            if (p) updates[uid] = [p[0], p[1]]
          }
          if (Object.keys(updates).length > 0) onMoveOperatorsRef.current?.(updates)
        }
        // 第二十三轮：提交队标位移（与绘制同一次操作一并入栈）
        if (selTeamsRef.current.size > 0 && teamPosRef?.current) {
          const updates: Record<string, [number, number]> = {}
          for (const uid of selTeamsRef.current) {
            const p = teamPosRef.current[uid]
            if (p) updates[uid] = [p[0], p[1]]
          }
          if (Object.keys(updates).length > 0) onMoveTeamsRef.current?.(updates)
        }
      }
      moveDragRef.current = {}
    }
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    return () => {
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
    }
  }, [map, tool, save, commitDraw, snapshotNow, vehiclePosRef, operatorPosRef, translateBounds, teamPosRef])

  // ---- 橡皮擦：进入时提示光标（点击图形由 onFeatureClick 处理） ----
  useEffect(() => {
    const container = map.getContainer()
    if (tool !== 'eraser') {
      container.classList.remove('eraser-cursor')
      return
    }
    container.classList.add('eraser-cursor')
    const brush = L.circleMarker(map.getCenter(), {
      radius: draw.eraserSize / 2,
      color: '#ff6b7a',
      weight: 1.5,
      dashArray: '4 3',
      opacity: 0,
      fillColor: '#ff6b7a',
      fillOpacity: 0,
      pane: DRAW_PANE,
      interactive: false,
      className: 'eraser-brush-preview',
    }).addTo(map)
    const onMove = (e: L.LeafletMouseEvent) => {
      brush.setLatLng(e.latlng)
      brush.setStyle({ opacity: 0.9, fillOpacity: 0.08 })
    }
    const onLeave = () => brush.setStyle({ opacity: 0, fillOpacity: 0 })
    map.on('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    return () => {
      container.classList.remove('eraser-cursor')
      map.off('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
      brush.remove()
    }
  }, [map, tool, draw.eraserSize])

  // ---- 橡皮擦：按住鼠标拖动，擦除轨迹触碰到的图形（问题2） ----
  useEffect(() => {
    if (!fg || tool !== 'eraser') return
    const ERASE_R = Math.max(4, draw.eraserSize / 2)
    let erasing = false
    let lastPt: L.Point | null = null
    let before = ''
    let changed = false
    let strokeTrail: L.Point[] = []
    let strokeSources: {
      layer: PathWithFeature
      points: L.LatLng[]
      props: Record<string, unknown>
    }[] = []
    let strokeLiveLayers = new Set<L.Layer>()
    // 锁定图形不参与擦除；每轮擦除（按下→抬起）命中锁定图形时只提示一次
    let strokeLockedSources: { points: L.LatLng[] }[] = []
    let lockedEraseNotified = false
    const notifyLockedErase = () => {
      if (lockedEraseNotified) return
      lockedEraseNotified = true
      showToastRef.current(LOCKED_TOAST_MSG)
    }

    // 收集图形所有顶点对应的容器坐标
    const collectPts = (l: L.Polyline): L.Point[] => {
      const lls = (l.getLatLngs() as L.LatLng[][]).flat(Infinity) as L.LatLng[]
      return lls.map((ll) => map.latLngToContainerPoint(ll))
    }

    const pointInRing = (pt: L.Point, ring: L.Point[]) => {
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]
        const b = ring[j]
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside
      }
      return inside
    }

    // 图形擦除命中：中心/顶点/边线距离，闭合图形内部也算触碰。
    const hitTest = (pt: L.Point): AnyWithFeature[] => {
      const doomed: AnyWithFeature[] = []
      fg.eachLayer((l) => {
        const fl = l as AnyWithFeature
        if (!fl.feature) return
        let hit = false
        if (l instanceof L.Marker || l instanceof L.Circle) {
          hit = map.latLngToContainerPoint((l as L.Marker).getLatLng()).distanceTo(pt) <= ERASE_R
        } else if (l instanceof L.Polyline || l instanceof L.Polygon) {
          const pts = collectPts(l)
          if (l instanceof L.Polygon && pointInRing(pt, pts)) hit = true
          for (const v of pts) {
            if (v.distanceTo(pt) <= ERASE_R) {
              hit = true
              break
            }
          }
          if (!hit) {
            for (let i = 0; i < pts.length - 1; i++) {
              if (L.LineUtil.pointToSegmentDistance(pt, pts[i], pts[i + 1]) <= ERASE_R) {
                hit = true
                break
              }
            }
          }
        }
        if (hit) doomed.push(fl)
      })
      return doomed
    }

    const eraseWholeAt = (pt: L.Point) => {
      const keys = new Set(hitTest(pt).map((d) => {
        const p = (d.feature?.properties ?? {}) as Record<string, unknown>
        return String(p.group ?? p.uid ?? '')
      }))
      if (keys.size === 0) return
      // 锁定图形整组跳过，并提示一次
      const locked = lockedKeysRef.current()
      for (const k of [...keys]) {
        if (locked.has(k)) {
          keys.delete(k)
          notifyLockedErase()
        }
      }
      if (keys.size === 0) return
      const doomed: AnyWithFeature[] = []
      fg.eachLayer((candidate) => {
        const any = candidate as AnyWithFeature
        const p = (any.feature?.properties ?? {}) as Record<string, unknown>
        if (keys.has(String(p.group ?? p.uid ?? ''))) doomed.push(any)
      })
      for (const d of doomed) {
        const uid = String((d.feature?.properties as Record<string, unknown> | undefined)?.uid ?? '')
        selectedRef.current.delete(uid)
        highlight(uid, false)
        fg.removeLayer(d)
      }
      changed = changed || doomed.length > 0
    }

    /** 把当前笔头覆盖的线段裁掉，并把剩余部分拆成独立 LineString。 */
    /** 每一帧都从手势开始前的原始路径重算，保持实时反馈且不重复侵蚀残段。 */
    const renderStrokeTrail = (trail: L.Point[]) => {
      if (trail.length === 0) return
      for (const live of strokeLiveLayers) {
        if (fg.hasLayer(live)) fg.removeLayer(live)
      }
      strokeLiveLayers = new Set<L.Layer>()
      let anyTouched = false
      for (const sourceEntry of strokeSources) {
        const { layer, points: source, props } = sourceEntry
        if (source.length < 2) {
          fg.addLayer(layer)
          strokeLiveLayers.add(layer)
          continue
        }
        const sampled: L.LatLng[] = [source[0]]
        const sampleStep = Math.max(2, Math.min(8, ERASE_R / 2))
        for (let i = 0; i < source.length - 1; i++) {
          const a = map.latLngToContainerPoint(source[i])
          const b = map.latLngToContainerPoint(source[i + 1])
          const steps = Math.max(1, Math.ceil(a.distanceTo(b) / sampleStep))
          for (let n = 1; n <= steps; n++) {
            const t = n / steps
            sampled.push(map.containerPointToLatLng(L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)))
          }
        }
        const chunks: L.LatLng[][] = []
        let chunk: L.LatLng[] = []
        let touched = false
        for (const ll of sampled) {
          const pixel = map.latLngToContainerPoint(ll)
          const erased = trail.some((trailPoint) => pixel.distanceTo(trailPoint) <= ERASE_R)
          if (erased) {
            touched = true
            if (chunk.length >= 2) chunks.push(chunk)
            chunk = []
          } else {
            chunk.push(ll)
          }
        }
        if (chunk.length >= 2) chunks.push(chunk)
        if (!touched) {
          fg.addLayer(layer)
          strokeLiveLayers.add(layer)
          continue
        }
        anyTouched = true
        const wasArrow = props.type === 'arrow'
        const originalEnd = source[source.length - 1]
        chunks.forEach((points, index) => {
          const tailDistance = map.latLngToContainerPoint(points[points.length - 1]).distanceTo(map.latLngToContainerPoint(originalEnd))
          const keepsArrowHead = wasArrow && index === chunks.length - 1 && tailDistance <= sampleStep * 1.5
          const sourceUid = String(props.uid ?? 'draw')
          const fragmentProps: Record<string, unknown> = {
            ...props,
            uid: `${sourceUid}__erase_${index}`,
            type: wasArrow && !keepsArrowHead ? 'line' : props.type,
            curve: 'freehand',
          }
          const feature: Feature = {
            type: 'Feature',
            properties: fragmentProps,
            geometry: { type: 'LineString', coordinates: points.map((ll) => [ll.lng, ll.lat]) },
          }
          const fragment = L.polyline(points, styleFromProps(fragmentProps, view)) as PathWithFeature
          fragment.feature = feature
          if (keepsArrowHead) decorateArrowMarker(fragment, fragmentProps)
          fragment.on('click', onFeatureClick as never)
          bindDrag(fragment)
          fg.addLayer(fragment)
          strokeLiveLayers.add(fragment)
        })
      }
      // 锁定图形不裁断；笔迹触碰到时提示一次（保留原样显示）
      if (!lockedEraseNotified) {
        for (const entry of strokeLockedSources) {
          const hitLocked = entry.points.some((ll) => {
            const pixel = map.latLngToContainerPoint(ll)
            return trail.some((trailPoint) => pixel.distanceTo(trailPoint) <= ERASE_R)
          })
          if (hitLocked) {
            notifyLockedErase()
            break
          }
        }
      }
      changed = anyTouched
    }

    const onDown = (e: L.LeafletMouseEvent) => {
      erasing = true
      before = snapshotNow()
      changed = false
      lockedEraseNotified = false
      lastPt = map.latLngToContainerPoint(e.latlng)
      strokeTrail = draw.eraserMode === 'stroke' ? [lastPt] : []
      if (draw.eraserMode === 'stroke') {
        strokeSources = []
        strokeLockedSources = []
        strokeLiveLayers = new Set<L.Layer>()
        const locked = lockedKeysRef.current()
        fg.eachLayer((candidate) => {
          if (!(candidate instanceof L.Polyline) || candidate instanceof L.Polygon) return
          const layer = candidate as PathWithFeature
          const p = (layer.feature?.properties ?? {}) as Record<string, unknown>
          // 锁定图形不参与笔迹裁断，只记录用于触碰提示
          if (locked.has(String(p.group ?? p.uid ?? ''))) {
            strokeLockedSources.push({ points: flatLatLngs(layer).map((ll) => L.latLng(ll.lat, ll.lng)) })
            return
          }
          strokeSources.push({
            layer,
            points: flatLatLngs(layer).map((ll) => L.latLng(ll.lat, ll.lng)),
            props: { ...p },
          })
          strokeLiveLayers.add(layer)
        })
        renderStrokeTrail(strokeTrail)
      } else {
        eraseWholeAt(lastPt)
      }
      L.DomEvent.stopPropagation(e)
    }
    const onMove = (e: L.LeafletMouseEvent) => {
      if (!erasing) return
      const cur = map.latLngToContainerPoint(e.latlng)
      if (lastPt) {
        // 沿轨迹插值采样，避免快速拖动漏删
        const dist = cur.distanceTo(lastPt)
        const steps = Math.max(1, Math.ceil(dist / Math.max(4, ERASE_R / 2)))
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          const sample = L.point(lastPt.x + (cur.x - lastPt.x) * t, lastPt.y + (cur.y - lastPt.y) * t)
          if (draw.eraserMode === 'stroke') strokeTrail.push(sample)
          else eraseWholeAt(sample)
        }
      } else {
        if (draw.eraserMode === 'stroke') strokeTrail.push(cur)
        else eraseWholeAt(cur)
      }
      lastPt = cur
      if (draw.eraserMode === 'stroke') renderStrokeTrail(strokeTrail)
    }
    const onUp = () => {
      if (erasing && changed && before && snapshotNow() !== before) commitDraw(before)
      erasing = false
      lastPt = null
      before = ''
      changed = false
      strokeTrail = []
      strokeSources = []
      strokeLockedSources = []
      strokeLiveLayers = new Set<L.Layer>()
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    return () => {
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
    }
  }, [map, fg, tool, draw.eraserSize, draw.eraserMode, snapshotNow, commitDraw, highlight, view, onFeatureClick, bindDrag])

  // ---- 手绘模式（第二十二轮）：线条工具（line/arrow/defense）路径=手绘时，
  // 按住拖拽自由绘制轨迹，松开生成最终图形（防线沿线生成三角形带） ----
  useEffect(() => {
    if (!fg || !['line', 'arrow', 'defense'].includes(tool) || draw.curve !== 'freehand') return
    const isDefense = tool === 'defense'
    const st: { drawing: boolean; pts: L.LatLng[]; previews: L.Layer[] } = { drawing: false, pts: [], previews: [] }

    const stylePreview = {
      color: draw.color,
      weight: draw.weight,
      opacity: 0.55,
      fillColor: draw.color,
      fillOpacity: 0.12,
      dashArray: dashArrayOf(draw.dash),
      pane: DRAW_PANE,
    }
    const triStyle = {
      color: draw.color,
      weight: 0,
      fillColor: draw.color,
      fillOpacity: 0.9,
      opacity: 1,
      pane: DRAW_PANE,
    }

    const renderPreview = () => {
      st.previews.forEach((p) => p.remove())
      st.previews = []
      if (isDefense) {
        const df = defenseFeatures(st.pts, draw.weight)
        for (const tri of df.triangles) {
          st.previews.push(L.polygon(tri, triStyle).addTo(map))
        }
      } else {
        const line = L.polyline(st.pts, stylePreview)
        if (tool === 'arrow') decorateArrowMarker(line, { arrowStyle: draw.arrowStyle, arrowSize: draw.arrowSize, color: draw.color })
        st.previews.push(line.addTo(map))
      }
    }

    const onDown = (e: L.LeafletMouseEvent) => {
      if (editPointerActiveRef.current) return
      if (st.drawing) return
      const t = e.originalEvent.target as HTMLElement
      if (t.closest?.(DRAW_PANE_SELECTOR)) return
      st.drawing = true
      st.pts = [e.latlng]
      setDrawingGestureActive(map, true)
      renderPreview()
    }

    const onMove = (e: L.LeafletMouseEvent) => {
      if (editPointerActiveRef.current) {
        if (st.drawing) {
          st.drawing = false
          setDrawingGestureActive(map, false)
          st.previews.forEach((preview) => preview.remove())
          st.previews = []
          st.pts = []
        }
        return
      }
      if (!st.drawing) return
      // 按容器像素距离过滤，控制轨迹点密度（与普通画笔一致）
      const last = st.pts[st.pts.length - 1]
      const lastPt = map.latLngToContainerPoint(last)
      const curPt = map.latLngToContainerPoint(e.latlng)
      if (lastPt.distanceTo(curPt) > 2) {
        st.pts.push(e.latlng)
        renderPreview()
      }
    }

    const onUp = () => {
      if (editPointerActiveRef.current) {
        if (st.drawing) {
          st.drawing = false
          setDrawingGestureActive(map, false)
          st.previews.forEach((preview) => preview.remove())
          st.previews = []
          st.pts = []
        }
        return
      }
      if (!st.drawing) return
      st.drawing = false
      setDrawingGestureActive(map, false)
      st.previews.forEach((p) => p.remove())
      st.previews = []
      if (st.pts.length < 2) {
        st.pts = []
        return
      }
      const uid = genUid('draw')
      // 第十六轮：手绘箭头同样记录箭头样式/大小（供渲染与选中面板修改）
      const props = {
        type: tool,
        uid,
        color: draw.color,
        weight: draw.weight,
        dash: draw.dash,
        arrowStyle: draw.arrowStyle,
        arrowSize: draw.arrowSize,
      }
      const coords = (lls: L.LatLng[]) => lls.map((ll) => [ll.lng, ll.lat])
      // 第十二轮：绘制前快照（供撤回/恢复）
      const before = snapshotNow()
      if (isDefense) {
        // 防线手绘：沿线生成三角形带（group 关联整组）
        const df = defenseFeatures(st.pts, draw.weight)
        for (const tri of df.triangles) {
          const feature: Feature = {
            type: 'Feature',
            properties: { ...props, group: uid, curve: 'freehand', defensePath: coords(st.pts) },
            geometry: { type: 'Polygon', coordinates: [coords(tri)] },
          }
          const layer = L.polygon(tri, triStyle)
          const any = layer as PathWithFeature
          any.feature = feature
          layer.on('click', onFeatureClick as never)
          bindDrag(layer)
          fg.addLayer(layer)
        }
      } else {
        // 手绘线/箭头：单条 LineString（type=line/arrow，curve=freehand）
        const feature: Feature = {
          type: 'Feature',
          properties: { ...props, curve: 'freehand', group: uid },
          geometry: { type: 'LineString', coordinates: coords(st.pts) },
        }
        const layer = L.polyline(st.pts, styleFromProps(props, view))
        if (tool === 'arrow') decorateArrowMarker(layer, props)
        const any = layer as PathWithFeature
        any.feature = feature
        layer.on('click', onFeatureClick as never)
        bindDrag(layer)
        fg.addLayer(layer)
      }
      commitDraw(before)
      st.pts = []
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    return () => {
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      st.previews.forEach((p) => p.remove())
      setDrawingGestureActive(map, false)
    }
  }, [map, fg, tool, draw, view, onFeatureClick, commitDraw, snapshotNow, bindDrag])

  // ---- 普通画笔（自由绘制，第九轮）：按住拖拽收集轨迹点，松开生成手绘线条 ----
  useEffect(() => {
    if (!fg || tool !== 'pen') return
    const st: { drawing: boolean; pts: L.LatLng[]; preview?: L.Polyline } = { drawing: false, pts: [] }

    const onDown = (e: L.LeafletMouseEvent) => {
      if (editPointerActiveRef.current) return
      if (st.drawing) return
      const t = e.originalEvent.target as HTMLElement
      if (t.closest?.(DRAW_PANE_SELECTOR)) return
      st.drawing = true
      st.pts = [e.latlng]
      setDrawingGestureActive(map, true)
      st.preview = L.polyline([e.latlng, e.latlng], {
        color: draw.color,
        weight: draw.weight,
        opacity: 0.55,
        pane: DRAW_PANE,
      }).addTo(map)
    }

    const onMove = (e: L.LeafletMouseEvent) => {
      if (!st.drawing || !st.preview) return
      // 按容器像素距离过滤，控制轨迹点密度
      const last = st.pts[st.pts.length - 1]
      const lastPt = map.latLngToContainerPoint(last)
      const curPt = map.latLngToContainerPoint(e.latlng)
      if (lastPt.distanceTo(curPt) > 2) st.pts.push(e.latlng)
      st.preview.setLatLngs(st.pts)
    }

    const onUp = () => {
      if (!st.drawing) return
      st.preview?.remove()
      st.preview = undefined
      st.drawing = false
      setDrawingGestureActive(map, false)
      if (st.pts.length < 3) {
        st.pts = []
        return
      }
      const uid = genUid('draw')
      const props = { type: 'pen', uid, color: draw.color, weight: draw.weight, dash: draw.dash }
      const feature: Feature = {
        type: 'Feature',
        properties: props,
        geometry: { type: 'LineString', coordinates: st.pts.map((ll) => [ll.lng, ll.lat]) },
      }
      // 第十二轮：绘制前快照（供撤回/恢复）
      const before = snapshotNow()
      const layer = L.polyline(st.pts, styleFromProps(props, view))
      const any = layer as PathWithFeature
      any.feature = feature
      layer.on('click', onFeatureClick as never)
      if (toolRef.current === 'lasso')
        layer.on('mousedown', (ev: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(ev))
      bindDrag(layer)
      fg.addLayer(layer)
      // 重构：绘制操作上报 App 统一入历史栈
      commitDraw(before)
      st.pts = []
    }

    map.on('mousedown', onDown)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    return () => {
      map.off('mousedown', onDown)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      st.preview?.remove()
      setDrawingGestureActive(map, false)
    }
  }, [map, fg, tool, draw, view, onFeatureClick, commitDraw, snapshotNow, bindDrag])

  // ---- 文字标注工具：点击放置，双击编辑 ----
  useEffect(() => {
    if (!fg || tool !== 'text') return
    const onClick = (e: L.LeafletMouseEvent) => {
      // 第十六轮：点击已有图形（drawPane）不放置文字，交由图形选中逻辑处理
      const t = e.originalEvent.target as HTMLElement
      if (t.closest?.(DRAW_PANE_SELECTOR)) return
      const uid = genUid('text')
      const properties: Record<string, unknown> = { type: 'text', uid, text: '' }
      textStyleToProps(properties, DEFAULT_TEXT_STYLE)
      const feature: Feature<Point> = {
        type: 'Feature',
        properties,
        geometry: { type: 'Point', coordinates: [e.latlng.lng, e.latlng.lat] },
      }
      // 第十二轮：放置前快照（供撤回/恢复）
      const before = snapshotNow()
      const marker = L.marker(e.latlng, { icon: textIcon('', DEFAULT_TEXT_STYLE), pane: DRAW_PANE }) as MarkerWithFeature
      marker.feature = feature
      fg.addLayer(marker)
      marker.on('dblclick', () => openEditor(marker))
      marker.on('click', onFeatureClick)
      bindDrag(marker)
      // 重构：绘制操作上报 App 统一入历史栈
      commitDraw(before)
      openEditor(marker)
      // 问题2：文字放置后同样保持工具激活，可连续标注
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map, fg, tool, view, save, openEditor, onFeatureClick, commitDraw, snapshotNow, bindDrag])

  // ================= 第十五轮：编辑工具（选中/移动/缩放/旋转/端点/曲线/拉伸 + 文字样式） =================
  // 透明命中层（悬停高亮 + 放大点击区域）与选中手柄组（选中框/缩放手柄/旋转手柄/端点/曲线控制点）
  const hitRef = useRef<L.FeatureGroup | null>(null)
  const gizmoRef = useRef<L.FeatureGroup | null>(null)
  // 悬停 uid；交互会话；角度标签
  const hoverUidRef = useRef<string | null>(null)
  const hoverEpochRef = useRef(0)
  const shapePressRef = useRef<ShapePointerPress | null>(null)
  const finishShapePointerRef = useRef<() => void>(() => {})
  const interactRef = useRef<EditInteract | null>(null)
  /** pan 模式下拖动控制手柄时临时锁住地图，结束后按原状态恢复。 */
  const handleMapDragLockedRef = useRef(false)
  const angleLabelRef = useRef<L.Marker | null>(null)
  // 文字样式面板会话（before = 首次样式改动前的快照）
  const stylePanelRef = useRef<{ uid: string; before: string | null; dirty: boolean } | null>(null)
  // 选中属性面板：文字样式 或 箭头样式（第十六轮）
  const [selPanel, setSelPanel] = useState<
    | ({ uid: string; x: number; y: number } & { kind: 'text'; style: TextStyleProps })
    | ({ uid: string; x: number; y: number } & {
        kind: 'shape'
        shapeType: string
        color: string
        weight: number
        dash: DashType
        fillColor?: string
        fillEnabled?: boolean
        arrowStyle?: ArrowHeadStyle
        arrowSize?: number
      })
    | null
  >(null)
  const selPanelElRef = useRef<HTMLDivElement | null>(null)
  const selPanelDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const selWeightDraftRef = useRef<number | null>(null)

  const clampSelPanelPosition = useCallback((x: number, y: number) => {
    const panel = selPanelElRef.current
    const width = panel?.offsetWidth ?? 270
    const height = panel?.offsetHeight ?? 240
    const margin = 6
    return {
      x: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin)),
      y: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - height - margin)),
    }
  }, [])

  // Portal 首次渲染后才能取得真实尺寸；测量后立即把整个面板约束回可视区域。
  useEffect(() => {
    if (!selPanel) return
    const frame = window.requestAnimationFrame(() => {
      setSelPanel((current) => {
        if (!current) return current
        const next = clampSelPanelPosition(current.x, current.y)
        return next.x === current.x && next.y === current.y ? current : { ...current, ...next }
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selPanel?.uid, selPanel?.kind, clampSelPanelPosition])

  const startSelPanelDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    const panel = selPanelElRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    selPanelDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const moveSelPanel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = selPanelDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = clampSelPanelPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY)
    setSelPanel((current) => current ? { ...current, ...next } : current)
    event.preventDefault()
    event.stopPropagation()
  }, [clampSelPanelPosition])

  const stopSelPanelDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (selPanelDragRef.current?.pointerId !== event.pointerId) return
    selPanelDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.stopPropagation()
  }, [])

  /** 按 uid（组）收集目标图层：有 group 匹配整组（箭头/防线），否则单图层 */
  const targetLayersOf = useCallback((key: string): AnyWithFeature[] => {
    const g = fgRef.current
    if (!g) return []
    const out: AnyWithFeature[] = []
    g.eachLayer((l) => {
      const fl = l as AnyWithFeature
      const p = fl.feature?.properties as Record<string, unknown> | undefined
      if (!p) return
      const u = String(p.uid ?? '')
      const grp = String(p.group ?? '')
      if (grp && grp === key) out.push(fl)
      else if (!grp && u === key) out.push(fl)
    })
    return out
  }, [])

  /** 当前选中图形的逻辑键（group||uid）集合（第十六轮：支持 Ctrl 多选） */
  const selectedKeys = useCallback((): string[] => {
    const keys = new Set<string>()
    const g = fgRef.current
    if (!g) return []
    g.eachLayer((l) => {
      const fl = l as AnyWithFeature
      const p = fl.feature?.properties as Record<string, unknown> | undefined
      if (!p) return
      const u = String(p.uid ?? '')
      if (!selectedRef.current.has(u)) return
      const grp = String(p.group ?? '')
      keys.add(grp || u)
    })
    return [...keys]
  }, [])

  /** 按一组逻辑键收集全部图层 */
  const layersOfKeys = useCallback((keys: string[]): AnyWithFeature[] => {
    const set = new Set(keys)
    const g = fgRef.current
    if (!g) return []
    const out: AnyWithFeature[] = []
    g.eachLayer((l) => {
      const fl = l as AnyWithFeature
      const p = fl.feature?.properties as Record<string, unknown> | undefined
      if (!p) return
      const u = String(p.uid ?? '')
      const grp = String(p.group ?? '')
      if (set.has(grp || u)) out.push(fl)
    })
    return out
  }, [])

  /** 图形逻辑键是否已在选中集合中 */
  const isKeySelected = useCallback((key: string): boolean => {
    return targetLayersOf(key).some((l) => {
      const u = String((l.feature?.properties as Record<string, unknown>)?.uid ?? '')
      return selectedRef.current.has(u)
    })
  }, [targetLayersOf])
  const isKeySelectedRef = useRef(isKeySelected)
  isKeySelectedRef.current = isKeySelected

  /** 按 uid（组）高亮/取消高亮全部相关图层（防线整组） */
  const highlightKey = useCallback(
    (key: string, on: boolean) => {
      const g = fgRef.current
      if (!g) return
      g.eachLayer((l) => {
        const fl = l as AnyWithFeature
        const p = fl.feature?.properties as Record<string, unknown> | undefined
        if (!p) return
        const u = String(p.uid ?? '')
        const grp = String(p.group ?? '')
        if (u === key || (grp && grp === key)) highlight(u, on)
      })
    },
    [highlight],
  )

  /** 重建防线三角带（端点拖拽时实时重生成） */
  const rebuildDefenseGroup = useCallback(
    (uid: string, path: L.LatLng[], weight: number, curve: DefenseCurve) => {
      const g = fgRef.current
      const hit = hitRef.current
      const highlights = hlRef.current
      if (!g) return
      const doomed = targetLayersOf(uid)
      const doomedUids = new Set(doomed.map((layer) => String((layer.feature?.properties as Record<string, unknown> | undefined)?.uid ?? '')))
      const wasSelected = [...doomedUids].some((id) => selectedRef.current.has(id))
      const props0 = (doomed[0]?.feature?.properties ?? {}) as Record<string, unknown>
      const color = String(props0.color ?? SIDE_COLORS[view])
      // 移除旧三角与旧命中层（先收集再删除，避免迭代中删除）
      const hitDoomed: L.Layer[] = []
      hit?.eachLayer((l) => {
        const p = (l as AnyWithFeature).feature?.properties as Record<string, unknown> | undefined
        const u = String(p?.uid ?? '')
        const grp = String(p?.group ?? '')
        if (u === uid || grp === uid) hitDoomed.push(l)
      })
      for (const d of doomed) g.removeLayer(d)
      for (const d of hitDoomed) hit?.removeLayer(d)
      // 防线编辑会实时替换整组三角形。同步移除旧高亮和旧选中 uid，避免旧防线
      // 作为一条“额外线”残留在画面上，并保证新生成的三角仍属于当前选中组。
      const highlightDoomed: L.Layer[] = []
      highlights?.eachLayer((layer) => {
        const p = (layer as AnyWithFeature).feature?.properties as Record<string, unknown> | undefined
        const layerUid = String(p?.uid ?? '')
        const group = String(p?.group ?? '')
        if (doomedUids.has(layerUid) || group === uid) highlightDoomed.push(layer)
      })
      for (const layer of highlightDoomed) highlights?.removeLayer(layer)
      for (const id of doomedUids) selectedRef.current.delete(id)
      // 重新生成三角
      const df = defenseFeatures(path, weight)
      const triStyle: L.PathOptions = {
        color,
        weight: 0,
        fillColor: color,
        fillOpacity: 0.95,
        opacity: 1,
        pane: DRAW_PANE,
      }
      for (const tri of df.triangles) {
        const uid2 = genUid('draw')
        const feature: Feature = {
          type: 'Feature',
          properties: {
            ...props0,
            uid: uid2,
            group: uid,
            curve,
            defensePath: path.map((point) => [point.lng, point.lat]),
          },
          geometry: { type: 'Polygon', coordinates: [tri.map((ll) => [ll.lng, ll.lat])] },
        }
        const layer = L.polygon(tri, triStyle)
        const any = layer as PathWithFeature
        any.feature = feature
        g.addLayer(layer)
        buildHitRef.current(any)
        if (wasSelected) selectedRef.current.add(uid2)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, targetLayersOf],
  )
  const rebuildDefenseGroupRef = useRef(rebuildDefenseGroup)
  rebuildDefenseGroupRef.current = rebuildDefenseGroup

  /** 构建透明命中层（路径扩展 10px；文字按实际矩形尺寸扩展 10px）。 */
  const buildHit = useCallback(
    (layer: AnyWithFeature) => {
      const h = hitRef.current
      if (!h) return
      const props = layer.feature?.properties as Record<string, unknown> | undefined
      if (!props) return
      let hl: L.Layer | null = null
      if (layer instanceof L.Marker && props.type === 'text') {
        const marker = layer as L.Marker
        const textEl = marker.getElement()?.querySelector<HTMLElement>('.text-marker')
        const rect = textEl?.getBoundingClientRect()
        const style = textStyleFromProps(props)
        const fontSize = Number(style.fontSize ?? 16)
        const lines = String(props.text ?? '标注').split(/\r?\n/)
        const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 0)
        const measuredWidth = rect && rect.width > 0
          ? rect.width
          : Math.min(320, Math.max(96, longestLine * fontSize * 0.65 + 20))
        const measuredHeight = rect && rect.height > 0
          ? rect.height
          : Math.max(34, lines.length * fontSize * 1.3 + 12)
        const hitWidth = Math.ceil(measuredWidth + HIT_PADDING_PX * 2)
        const hitHeight = Math.ceil(measuredHeight + HIT_PADDING_PX * 2)
        hl = L.marker(marker.getLatLng(), {
          icon: L.divIcon({
            className: 'draw-text-hit-wrap',
            html: '<div class="draw-text-hit-area" aria-hidden="true"></div>',
            iconSize: [hitWidth, hitHeight],
            iconAnchor: [hitWidth / 2, hitHeight / 2],
          }),
          pane: DRAW_PANE,
          interactive: true,
          keyboard: false,
          zIndexOffset: 800,
        })
      } else if (layer instanceof L.Marker) {
        hl = L.circleMarker((layer as L.Marker).getLatLng(), {
          radius: 18,
          color: '#fff',
          weight: 1,
          opacity: 0.001,
          fillOpacity: 0.001,
          pane: DRAW_PANE,
          interactive: true,
          className: 'draw-hit-area',
        })
      } else if (layer instanceof L.Polygon || layer instanceof L.Polyline) {
        const pts = flatLatLngs(layer)
        const w = Number(props.weight ?? 3) + HIT_PADDING_PX * 2
        const opts: L.PathOptions = {
          weight: w,
          color: '#fff',
          opacity: 0.001,
          fill: layer instanceof L.Polygon,
          fillColor: '#fff',
          fillOpacity: layer instanceof L.Polygon ? 0.001 : 0,
          pane: DRAW_PANE,
          interactive: true,
          className: 'draw-hit-area',
        }
        hl = layer instanceof L.Polygon ? L.polygon(pts, opts) : L.polyline(pts, opts)
      }
      if (!hl) return
      const any = hl as AnyWithFeature
      any.feature = layer.feature
      const keyOf = () => {
        const p = (any.feature?.properties ?? {}) as Record<string, unknown>
        return String(p.group ?? p.uid ?? '')
      }
      hl.on('mouseover', () => {
        const k = keyOf()
        const previous = hoverUidRef.current
        hoverEpochRef.current += 1
        if (previous && previous !== k && !isKeySelectedRef.current(previous)) {
          highlightKey(previous, false)
        }
        if (k && !isKeySelectedRef.current(k)) {
          hoverUidRef.current = k
          highlightKey(k, true)
        }
      })
      hl.on('mouseout', () => {
        const k = keyOf()
        const epoch = ++hoverEpochRef.current
        // 同组的多个命中路径之间切换时会先 mouseout 再 mouseover；延后一帧可避免闪烁/偶发熄灭。
        window.requestAnimationFrame(() => {
          if (hoverEpochRef.current !== epoch) return
          if (hoverUidRef.current === k && !isKeySelectedRef.current(k)) {
            hoverUidRef.current = null
            highlightKey(k, false)
          }
        })
      })
      hl.on('mousedown', (e: L.LeafletMouseEvent) => {
        // mousedown 只记录候选交互；选中动作在 mouseup 确认，避免“按住才选中”。
        if ((e.originalEvent as MouseEvent).button !== 0) return
        // 必须同时拦截原生事件；仅停止 Leaflet 包装事件仍可能启动地图 Drag handler。
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
        const k = keyOf()
        if (!k) return
        // pan 模式下必须在按下瞬间锁住地图，否则容器上的 Leaflet Drag handler 会竞争本次拖拽。
        if (!handleMapDragLockedRef.current && map.dragging.enabled()) {
          map.dragging.disable()
          handleMapDragLockedRef.current = true
        }
        const ctrl = (e.originalEvent as MouseEvent).ctrlKey || (e.originalEvent as MouseEvent).metaKey
        shapePressRef.current = {
          key: k,
          additive: ctrl,
          wasSelected: isKeySelectedRef.current(k),
          startPoint: map.latLngToContainerPoint(e.latlng),
          downEvent: e,
          dragging: false,
        }
        editPointerActiveRef.current = true
        dragMovedRef.current = false
      })
      hl.on('mouseup', () => finishShapePointerRef.current())
      // click 只负责阻止冒泡；真正的 click 语义已由 mousedown/mouseup + 5px 阈值完成。
      hl.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e))
      hl.on('dblclick', () => {
        const p = (any.feature?.properties ?? {}) as Record<string, unknown>
        if (p.type === 'text') {
          const m = findByUid(String(p.uid ?? ''))
          if (m instanceof L.Marker) openEditorRef.current(m)
        }
      })
      h.addLayer(hl)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [highlightKey, findByUid, map],
  )
  const buildHitRef = useRef(buildHit)
  buildHitRef.current = buildHit

  /** 文字内容或样式改变后，按新的 DOM 宽高替换对应矩形命中层。 */
  const refreshTextHit = useCallback((marker: MarkerWithFeature) => {
    const uid = String((marker.feature?.properties as Record<string, unknown> | undefined)?.uid ?? '')
    const hit = hitRef.current
    if (!uid || !hit) return
    const stale: L.Layer[] = []
    hit.eachLayer((candidate) => {
      const candidateProps = (candidate as AnyWithFeature).feature?.properties as Record<string, unknown> | undefined
      if (String(candidateProps?.uid ?? '') === uid) stale.push(candidate)
    })
    for (const candidate of stale) hit.removeLayer(candidate)
    buildHitRef.current(marker)
    buildGizmoRef.current()
  }, [])
  refreshTextHitRef.current = refreshTextHit

  /** 编辑反馈标签（旋转角度 / 尺寸 / 半径，实时显示） */
  const showEditLabel = useCallback(
    (pos: L.LatLng, text: string) => {
      if (!angleLabelRef.current) {
        angleLabelRef.current = L.marker(pos, {
          icon: L.divIcon({
            className: 'edit-angle-wrap',
            html: '<div class="edit-angle"></div>',
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          pane: DRAW_PANE,
          interactive: false,
          zIndexOffset: 2000,
        }).addTo(map)
      }
      angleLabelRef.current.setLatLng(pos)
      const el = angleLabelRef.current.getElement()?.querySelector('.edit-angle')
      if (el) el.textContent = text
    },
    [map],
  )
  const hideEditLabel = useCallback(() => {
    angleLabelRef.current?.remove()
    angleLabelRef.current = null
  }, [])
  const hideEditLabelRef = useRef(hideEditLabel)
  hideEditLabelRef.current = hideEditLabel

  /** 箭头样式实时应用：更新特征属性 + 重新挂载 SVG marker-end */
  const applyArrowStyle = useCallback(
    (layer: AnyWithFeature, style: ArrowHeadStyle, size: number) => {
      const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
      props.arrowStyle = style
      props.arrowSize = size
      if (layer instanceof L.Polyline) {
        const path = (layer as unknown as { _path?: SVGElement })._path
        if (path) {
          const color = String(props.color ?? '#ffd54a')
          ensureArrowMarkerDef(map, style, size, color)
          path.setAttribute('marker-end', `url(#${arrowMarkerId(style, size, color)})`)
        }
      }
    },
    [map],
  )

  /** 由选中框右侧按钮打开属性面板；选择图形本身不再自动弹出。 */
  const openSelPanel = useCallback(
    (key: string) => {
      // 锁定图形不可修改组件信息：属性面板不打开
      if (lockedKeysRef.current().has(key)) return
      const layers = targetLayersOf(key)
      const first = layers[0]
      if (!first) return
      const props = (first.feature?.properties ?? {}) as Record<string, unknown>
      stylePanelRef.current = { uid: key, before: null, dirty: false }
      const pos = first instanceof L.Marker
        ? (first as L.Marker).getLatLng()
        : L.latLng((first as L.Polyline).getBounds().getCenter().lat, (first as L.Polyline).getBounds().getEast())
      const cp = map.latLngToContainerPoint(pos)
      const rect = map.getContainer().getBoundingClientRect()
      const base = { uid: key, x: rect.left + cp.x + 18, y: rect.top + cp.y }
      if (props.type === 'text' && first instanceof L.Marker) {
        setSelPanel({ ...base, kind: 'text', style: textStyleFromProps(props) })
      } else if (first instanceof L.Path) {
        setSelPanel({
          ...base,
          kind: 'shape',
          shapeType: String(props.type ?? 'line'),
          color: String(props.color ?? SIDE_COLORS[view]),
          weight: Number(props.weight ?? 3),
          dash: (String(props.dash ?? 'solid') as DashType) || 'solid',
          fillColor: String(props.fillColor ?? props.color ?? SIDE_COLORS[view]),
          fillEnabled: props.fillEnabled === true,
          arrowStyle: props.type === 'arrow'
            ? (String(props.arrowStyle ?? DEFAULT_ARROW_STYLE) as ArrowHeadStyle) || DEFAULT_ARROW_STYLE
            : undefined,
          arrowSize: props.type === 'arrow' ? Number(props.arrowSize ?? DEFAULT_ARROW_SIZE) || DEFAULT_ARROW_SIZE : undefined,
        })
      } else {
        setSelPanel(null)
      }
    },
    [map, targetLayersOf, view],
  )
  const openSelPanelRef = useRef(openSelPanel)
  openSelPanelRef.current = openSelPanel

  /** 属性面板实时应用，不逐步写历史；关闭时统一提交并持久化。 */
  const commitStyle = useCallback(
    (uid: string, kind: 'text' | 'shape', patch: TextStyleProps | {
      color: string
      weight: number
      dash: DashType
      fillColor?: string
      fillEnabled?: boolean
      arrowStyle?: ArrowHeadStyle
      arrowSize?: number
    }) => {
      const sp = stylePanelRef.current
      if (sp && sp.uid === uid && !sp.dirty) {
        sp.before = snapshotNow()
        sp.dirty = true
      }
      const targets = targetLayersOf(uid)
      const first = targets[0]
      if (!first) return
      if (kind === 'text' && first instanceof L.Marker) {
        const props = (first.feature?.properties ?? {}) as Record<string, unknown>
        const s = patch as TextStyleProps
        textStyleToProps(props, s)
        ;(first as L.Marker).setIcon(textIcon(String(props.text ?? ''), s))
        // setIcon 会替换文本 DOM；下一帧按新字号/边框重建矩形命中区、选中框和样式按钮。
        window.requestAnimationFrame(() => refreshTextHitRef.current(first as MarkerWithFeature))
      } else if (kind === 'shape') {
        const s = patch as {
          color: string
          weight: number
          dash: DashType
          fillColor?: string
          fillEnabled?: boolean
          arrowStyle?: ArrowHeadStyle
          arrowSize?: number
        }
        for (const target of targets) {
          const props = (target.feature?.properties ?? {}) as Record<string, unknown>
          props.color = s.color
          props.weight = s.weight
          props.dash = props.type === 'defense' ? 'solid' : s.dash
          if (props.type === 'rect' || props.type === 'circle') {
            props.fillColor = s.fillColor ?? props.color
            props.fillEnabled = s.fillEnabled === true
          }
          if (target instanceof L.Path) {
            if (props.type === 'defense') {
              target.setStyle({ color: s.color, weight: 0, fillColor: s.color, fillOpacity: 0.95, opacity: 1 })
            } else {
              target.setStyle(styleFromProps(props, view))
            }
          }
          if (props.type === 'arrow' && s.arrowStyle && s.arrowSize) {
            applyArrowStyle(target, s.arrowStyle, s.arrowSize)
          }
        }
      }
      // 属性面板的每次修改都即时写回 App/localStorage；面板关闭时再合并为一条撤销历史。
      save()
    },
    [targetLayersOf, snapshotNow, applyArrowStyle, view, save],
  )
  const commitStyleRef = useRef(commitStyle)
  commitStyleRef.current = commitStyle

  const closeSelPanel = useCallback(
    (commit: boolean) => {
      const sp = stylePanelRef.current
      if (!sp) return
      stylePanelRef.current = null
      setSelPanel(null)
      if (commit && sp.dirty && sp.before && snapshotNow() !== sp.before) {
        commitDraw(sp.before)
      }
    },
    [commitDraw, snapshotNow],
  )
  const closeSelPanelRef = useRef(closeSelPanel)
  closeSelPanelRef.current = closeSelPanel

  /** 锁定/解锁一组图形（按 group||uid 整组生效；入历史栈可撤销）。锁定后选中框只留"解锁"按钮。 */
  const setKeyLocked = useCallback(
    (key: string, locked: boolean) => {
      const targets = targetLayersOf(key)
      if (targets.length === 0) return
      // 已是目标状态（如 pointerup 与 click 重复触发）则不再重复入栈
      const current = targets.some((t) => ((t.feature?.properties ?? {}) as Record<string, unknown>).locked === true)
      if (current === locked) return
      const before = snapshotNow()
      for (const target of targets) {
        ;(((target as AnyWithFeature).feature?.properties ?? {}) as Record<string, unknown>).locked = locked
      }
      // 锁定前关闭属性面板（不提交：锁定本身才是本次历史记录）
      if (locked) closeSelPanelRef.current(false)
      commitDraw(before)
      buildGizmoRef.current()
    },
    [targetLayersOf, snapshotNow, commitDraw],
  )
  const setKeyLockedRef = useRef(setKeyLocked)
  setKeyLockedRef.current = setKeyLocked

  /** 构建选中手柄组（选中框 + 各类手柄；支持多选：仅单选时显示端点/曲线/拉伸手柄） */
  const buildGizmo = useCallback(() => {
    const gz = gizmoRef.current
    if (!gz) return
    gz.clearLayers()
    const keys = selectedKeys()
    const layers = layersOfKeys(keys)
    if (layers.length === 0) return
    const single = keys.length === 1
    const first = layers[0]
    // 锁定图形（单选）：隐藏样式/删除按钮与全部编辑手柄，只保留"解锁"按钮
    const lockedSel = single && layers.some((l) => ((l.feature?.properties ?? {}) as Record<string, unknown>).locked === true)
    const props = (first.feature?.properties ?? {}) as Record<string, unknown>
    const isCircle = props.type === 'circle'
    const isText = props.type === 'text'
    const isDefense = props.type === 'defense' && !!props.group
    const isLine = props.type === 'line' || props.type === 'arrow' || props.type === 'pen'
    // 包围盒
    let bounds: L.LatLngBounds
    if (isText && single && first instanceof L.Marker) {
      const marker = first as L.Marker
      const textEl = marker.getElement()?.querySelector<HTMLElement>('.text-marker')
      const textRect = textEl?.getBoundingClientRect()
      const mapRect = map.getContainer().getBoundingClientRect()
      if (textRect && textRect.width > 0 && textRect.height > 0) {
        const pad = 4
        const topLeft = L.point(textRect.left - mapRect.left - pad, textRect.top - mapRect.top - pad)
        const bottomRight = L.point(textRect.right - mapRect.left + pad, textRect.bottom - mapRect.top + pad)
        bounds = L.latLngBounds(
          map.containerPointToLatLng(topLeft),
          map.containerPointToLatLng(bottomRight),
        )
      } else {
        const p = map.latLngToContainerPoint(marker.getLatLng())
        bounds = L.latLngBounds(
          map.containerPointToLatLng(p.subtract([52, 21])),
          map.containerPointToLatLng(p.add([52, 21])),
        )
      }
    } else {
      bounds = unionBounds(layers)
    }
    // 选中框同时作为“框内拖动”命中面；控制手柄随后添加，仍会位于选中框之上。
    const selectionBox = L.rectangle(bounds, {
      pane: DRAW_PANE,
      color: '#3f8cff',
      weight: 1.5,
      dashArray: '6 4',
      fillColor: '#3f8cff',
      fillOpacity: 0.04,
      opacity: 0.9,
      interactive: true,
      className: 'edit-selection-box',
    })
    selectionBox.on('mousedown', (e: L.LeafletMouseEvent) => {
      if ((e.originalEvent as MouseEvent).button !== 0) return
      L.DomEvent.stop(e.originalEvent as MouseEvent)
      L.DomEvent.stopPropagation(e)
      const key = keys[0]
      if (!key) return
      // 选中矩形内部拖动与控制手柄一致：先锁地图，再进入 5px 阈值判定。
      if (!handleMapDragLockedRef.current && map.dragging.enabled()) {
        map.dragging.disable()
        handleMapDragLockedRef.current = true
      }
      editPointerActiveRef.current = true
      shapePressRef.current = {
        key,
        additive: false,
        wasSelected: true,
        startPoint: map.latLngToContainerPoint(e.latlng),
        downEvent: e,
        dragging: false,
      }
      dragMovedRef.current = false
    })
    selectionBox.on('mouseup', () => finishShapePointerRef.current())
    selectionBox.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e))
    selectionBox.addTo(gz)
    if (single && !lockedSel) {
      const eastCenter = L.latLng(bounds.getCenter().lat, bounds.getEast())
      const stylePos = map.containerPointToLatLng(map.latLngToContainerPoint(eastCenter).add([34, 0]))
      const styleButton = L.marker(stylePos, {
        icon: L.divIcon({
          className: 'edit-style-trigger-wrap',
          html: '<button type="button" class="edit-style-trigger" title="编辑图形样式" aria-label="编辑图形样式"><i class="fa-solid fa-sliders"></i></button>',
          iconSize: [30, 26],
          iconAnchor: [15, 13],
        }),
        pane: DRAW_PANE,
        interactive: true,
        keyboard: false,
        zIndexOffset: 1100,
      })
      styleButton.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
        // 在按下阶段立即打开，避免绘制模式的后续 click 被地图手势状态机吞掉。
        if (stylePanelRef.current?.uid !== keys[0]) openSelPanelRef.current(keys[0])
      })
      styleButton.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
        // click 只负责隔离地图；面板已在首次 mousedown / pointerdown 中打开。
      })
      styleButton.addTo(gz)
      const styleButtonElement = styleButton.getElement()?.querySelector<HTMLElement>('.edit-style-trigger')
      if (styleButtonElement) {
        L.DomEvent.on(styleButtonElement, 'pointerdown', (event: Event) => {
          L.DomEvent.stop(event)
          if (stylePanelRef.current?.uid !== keys[0]) openSelPanelRef.current(keys[0])
        })
      }

      const deletePos = map.containerPointToLatLng(map.latLngToContainerPoint(eastCenter).add([34, 32]))
      const deleteButton = L.marker(deletePos, {
        icon: L.divIcon({
          className: 'edit-delete-trigger-wrap',
          html: '<button type="button" class="edit-delete-trigger" title="删除图形" aria-label="删除图形"><i class="fa-regular fa-trash-can"></i></button>',
          iconSize: [30, 26],
          iconAnchor: [15, 13],
        }),
        pane: DRAW_PANE,
        interactive: true,
        keyboard: false,
        zIndexOffset: 1100,
      })
      deleteButton.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
      })
      deleteButton.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
        deleteSelected()
      })
      deleteButton.addTo(gz)
      const deleteButtonElement = deleteButton.getElement()?.querySelector<HTMLElement>('.edit-delete-trigger')
      if (deleteButtonElement) {
        L.DomEvent.on(deleteButtonElement, 'pointerdown', (event: Event) => L.DomEvent.stop(event))
        L.DomEvent.on(deleteButtonElement, 'pointerup', (event: Event) => {
          L.DomEvent.stop(event)
          deleteSelected()
        })
      }

      // 锁定按钮（排在删除旁）：点击后同组图形锁定，不可移动/编辑/删除
      const lockPos = map.containerPointToLatLng(map.latLngToContainerPoint(eastCenter).add([34, 64]))
      const lockButton = L.marker(lockPos, {
        icon: L.divIcon({
          className: 'edit-lock-trigger-wrap',
          html: `<button type="button" class="edit-lock-trigger" title="锁定图形" aria-label="锁定图形">${LOCK_ICON_SVG}</button>`,
          iconSize: [30, 26],
          iconAnchor: [15, 13],
        }),
        pane: DRAW_PANE,
        interactive: true,
        keyboard: false,
        zIndexOffset: 1100,
      })
      lockButton.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
      })
      lockButton.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
        setKeyLockedRef.current(keys[0], true)
      })
      lockButton.addTo(gz)
      const lockButtonElement = lockButton.getElement()?.querySelector<HTMLElement>('.edit-lock-trigger')
      if (lockButtonElement) {
        L.DomEvent.on(lockButtonElement, 'pointerdown', (event: Event) => L.DomEvent.stop(event))
        L.DomEvent.on(lockButtonElement, 'pointerup', (event: Event) => {
          L.DomEvent.stop(event)
          setKeyLockedRef.current(keys[0], true)
        })
      }
    }
    if (lockedSel) {
      // 已锁定：只显示"解锁"按钮（样式/删除按钮与编辑手柄全部隐藏）
      const eastCenter = L.latLng(bounds.getCenter().lat, bounds.getEast())
      const unlockPos = map.containerPointToLatLng(map.latLngToContainerPoint(eastCenter).add([34, 0]))
      const unlockButton = L.marker(unlockPos, {
        icon: L.divIcon({
          className: 'edit-lock-trigger-wrap',
          html: `<button type="button" class="edit-unlock-trigger" title="解锁图形" aria-label="解锁图形">${UNLOCK_ICON_SVG}</button>`,
          iconSize: [30, 26],
          iconAnchor: [15, 13],
        }),
        pane: DRAW_PANE,
        interactive: true,
        keyboard: false,
        zIndexOffset: 1100,
      })
      unlockButton.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
      })
      unlockButton.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
        setKeyLockedRef.current(keys[0], false)
      })
      unlockButton.addTo(gz)
      const unlockButtonElement = unlockButton.getElement()?.querySelector<HTMLElement>('.edit-unlock-trigger')
      if (unlockButtonElement) {
        L.DomEvent.on(unlockButtonElement, 'pointerdown', (event: Event) => L.DomEvent.stop(event))
        L.DomEvent.on(unlockButtonElement, 'pointerup', (event: Event) => {
          L.DomEvent.stop(event)
          setKeyLockedRef.current(keys[0], false)
        })
      }
      return
    }
    const mk = (pos: L.LatLng, kind: string, cls: string, radius = 6) => {
      const h = L.marker(pos, {
        icon: L.divIcon({
          className: `edit-handle-wrap ${cls}`,
          html: `<div class="edit-handle-dot"></div>`,
          iconSize: [radius * 2, radius * 2],
          iconAnchor: [radius, radius],
        }),
        pane: DRAW_PANE,
        interactive: true,
        keyboard: false,
        zIndexOffset: 1000,
      })
      ;(h as unknown as { handleMeta?: { kind: string; keys: string[] } }).handleMeta = { kind, keys }
      h.on('mousedown', (e: L.LeafletMouseEvent) => {
        if ((e.originalEvent as MouseEvent).button !== 0) return
        // 控制手柄优先获得本次拖拽，禁止原生 mousedown 继续冒泡到地图容器。
        L.DomEvent.stop(e.originalEvent as MouseEvent)
        L.DomEvent.stopPropagation(e)
        editPointerActiveRef.current = true
        startHandleDragRef.current(kind, keys, e)
      })
      h.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e))
      gz.addLayer(h)
    }
    // 四角缩放手柄（Shift 锁定宽高比；文字四角 = 缩放字号）
    const nw = bounds.getNorthWest()
    const ne = bounds.getNorthEast()
    const se = bounds.getSouthEast()
    const sw = bounds.getSouthWest()
    mk(nw, 'scale', 'corner', 7)
    mk(ne, 'scale', 'corner', 7)
    mk(se, 'scale', 'corner', 7)
    mk(sw, 'scale', 'corner', 7)
    if (single && isCircle) {
      // 圆形：上/下/左/右 方向拉伸 → 椭圆
      const c = bounds.getCenter()
      mk(L.latLng(bounds.getNorth(), c.lng), 'stretch-n', 'dir', 6)
      mk(L.latLng(bounds.getSouth(), c.lng), 'stretch-s', 'dir', 6)
      mk(L.latLng(c.lat, bounds.getEast()), 'stretch-e', 'dir', 6)
      mk(L.latLng(c.lat, bounds.getWest()), 'stretch-w', 'dir', 6)
    } else if (single && isText) {
      // 文本框：左右中点自由调整宽度，并提供顶部旋转手柄。
      const c = bounds.getCenter()
      mk(L.latLng(c.lat, bounds.getEast()), 'stretch-e', 'dir', 7)
      mk(L.latLng(c.lat, bounds.getWest()), 'stretch-w', 'dir', 7)
      const topCenter = L.latLng(bounds.getNorth(), c.lng)
      const p = map.latLngToContainerPoint(topCenter)
      mk(map.containerPointToLatLng(p.subtract([0, 26])), 'rotate', 'rotate', 8)
    } else if (!isCircle) {
      // 旋转手柄（顶部上方 26px；多选时作用于整体包围盒）
      const ct = L.latLng(bounds.getNorth(), bounds.getCenter().lng)
      const p = map.latLngToContainerPoint(ct)
      const rotPos = map.containerPointToLatLng(p.subtract([0, 26]))
      mk(rotPos, 'rotate', 'rotate', 8)
    }
    if (single && isLine && !isDefense) {
      // 线/箭头/画笔：两端端点手柄
      const pts = flatLatLngs(first)
      if (pts.length >= 1) mk(pts[0], 'endpoint-0', 'endpoint', 8)
      if (pts.length >= 2) mk(pts[pts.length - 1], 'endpoint-1', 'endpoint', 8)
    }
    if (single && isDefense) {
      // 防线：路径首尾端点手柄；平滑曲线额外提供独立弯曲手柄。
      const { path, curve, curveCtrl } = reconstructDefensePath(layers)
      if (path.length >= 1) mk(path[0], 'endpoint-0', 'endpoint', 8)
      if (path.length >= 2) mk(path[path.length - 1], 'endpoint-1', 'endpoint', 8)
      if (curve === 'smooth' && curveCtrl) mk(curveCtrl, 'curve', 'curve', 9)
    }
    if (single && isLine && props.curve === 'smooth') {
      // 曲线控制点（绿色，拖拽调曲度）
      const pts = flatLatLngs(first)
      if (pts.length > 2) mk(deriveCurveCtrl(pts), 'curve', 'curve', 9)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedKeys, layersOfKeys])
  const buildGizmoRef = useRef(buildGizmo)
  buildGizmoRef.current = buildGizmo

  /** 选中图形（key = 图形逻辑键；additive = Ctrl 多选追加） */
  const selectKey = useCallback(
    (key: string, additive: boolean) => {
      const layers = targetLayersOf(key)
      if (layers.length === 0) return
      closeSelPanelRef.current(true)
      if (!additive) {
        clearSelection()
      }
      for (const l of layers) {
        const u = String((l.feature?.properties as Record<string, unknown>)?.uid ?? '')
        if (!selectedRef.current.has(u)) {
          selectedRef.current.add(u)
          // 普通编辑选中使用蓝色选框/手柄；绿色描边只用于 hover（套索仍沿用绿色高亮）。
          highlight(u, false)
        }
      }
      interactRef.current = null
      notifySelection()
      buildGizmoRef.current()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearSelection, highlight, notifySelection, targetLayersOf],
  )
  const selectKeyRef = useRef(selectKey)
  selectKeyRef.current = selectKey

  /** 从选中集合移除一个图形（Ctrl + 点击已选图形） */
  const removeKey = useCallback(
    (key: string) => {
      closeSelPanelRef.current(true)
      const layers = targetLayersOf(key)
      for (const l of layers) {
        const u = String((l.feature?.properties as Record<string, unknown>)?.uid ?? '')
        if (selectedRef.current.delete(u)) highlight(u, false)
      }
      interactRef.current = null
      notifySelection()
      buildGizmoRef.current()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [highlight, notifySelection, targetLayersOf],
  )
  const removeKeyRef = useRef(removeKey)
  removeKeyRef.current = removeKey

  /** 清除编辑选中（可关闭属性面板并提交） */
  const clearEditSelection = useCallback(
    (commitPanel: boolean) => {
      closeSelPanelRef.current(commitPanel)
      hoverUidRef.current = null
      interactRef.current = null
      hideEditLabelRef.current()
      gizmoRef.current?.clearLayers()
      clearSelection()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearSelection],
  )
  clearEditSelectionRef.current = clearEditSelection


  /** 启动整体移动（按住已选中的图形本体 → 整个选中集合一起移动） */
  const startBodyMove = useCallback(
    (key: string, e: L.LeafletMouseEvent) => {
      // 锁定图形不可移动：从移动集合中剔除（单击选中不受影响）
      const locked = lockedKeysRef.current()
      const keys = selectedKeys().filter((k) => !locked.has(k))
      const layers = layersOfKeys(keys)
      if (layers.length === 0) return
      interactRef.current = {
        kind: 'move',
        uid: key,
        keys,
        start: e.latlng,
        before: snapshotNow(),
        layers: layers.map((l) => ({
          layer: l,
          pts: l instanceof L.Marker ? [(l as L.Marker).getLatLng()] : flatLatLngs(l),
          defensePath: storedDefensePathOf(l),
        })),
      }
      const first = layers[0]
      const props = (first.feature?.properties ?? {}) as Record<string, unknown>
      if (props.type === 'text' && first instanceof L.Marker && keys.length === 1) {
        const style = textStyleFromProps(props)
        interactRef.current.text = {
          pos: (first as L.Marker).getLatLng(),
          fontSize: Number(style.fontSize ?? 16),
          width: Number(style.width ?? 160),
          rotation: Number(style.rotation ?? 0),
        }
      }
    },
    [selectedKeys, layersOfKeys, snapshotNow],
  )
  const startBodyMoveRef = useRef(startBodyMove)
  startBodyMoveRef.current = startBodyMove

  /** 启动手柄拖拽（缩放/旋转/拉伸/端点/曲线） */
  const startHandleDrag = useCallback(
    (kind: string, keys: string[], e: L.LeafletMouseEvent) => {
      // 锁定图形不参与手柄编辑（组内任一锁定即整组跳过）
      const locked = lockedKeysRef.current()
      keys = keys.filter((k) => !locked.has(k))
      const layers = layersOfKeys(keys)
      if (layers.length === 0) return
      const first = layers[0]
      const props = (first.feature?.properties ?? {}) as Record<string, unknown>
      // pan 模式默认允许拖地图；控制手柄会话期间临时禁用，避免两套拖拽竞争。
      if (!handleMapDragLockedRef.current && map.dragging.enabled()) {
        map.dragging.disable()
        handleMapDragLockedRef.current = true
      }
      dragMovedRef.current = false
      const it: EditInteract = {
        kind: (kind.startsWith('endpoint') ? 'endpoint' : kind.startsWith('stretch') ? 'stretch' : kind) as EditInteract['kind'],
        uid: keys[0] ?? '',
        keys,
        start: e.latlng,
        before: snapshotNow(),
        layers: layers.map((l) => ({
          layer: l,
          pts: l instanceof L.Marker ? [(l as L.Marker).getLatLng()] : flatLatLngs(l),
          defensePath: storedDefensePathOf(l),
        })),
        uniform: !!(e.originalEvent as MouseEvent).shiftKey,
      }
      if (kind === 'rotate' || kind === 'scale' || (props.type === 'text' && kind.startsWith('stretch'))) {
        it.center = props.type === 'text' && first instanceof L.Marker
          ? (first as L.Marker).getLatLng()
          : unionBounds(layers).getCenter()
        it.h0 = e.latlng
      }
      if (props.type === 'text' && first instanceof L.Marker && keys.length === 1) {
        const style = textStyleFromProps(props)
        it.text = {
          pos: (first as L.Marker).getLatLng(),
          fontSize: Number(style.fontSize ?? 16),
          width: Number(style.width ?? 160),
          rotation: Number(style.rotation ?? 0),
        }
      }
      if (props.type === 'circle' && keys.length === 1) {
        const b = unionBounds(layers)
        const c = b.getCenter()
        it.circle = {
          center: c,
          rx: (b.getEast() - b.getWest()) / 2,
          ry: (b.getNorth() - b.getSouth()) / 2,
          axis: kind.startsWith('stretch') ? (kind.slice(8) as 'n' | 's' | 'e' | 'w') : undefined,
        }
        it.center = c
      }
      if (kind === 'endpoint-0' || kind === 'endpoint-1') {
        it.endIndex = kind === 'endpoint-1' ? 1 : 0
        if (props.type === 'defense') {
          const r = reconstructDefensePath(layers)
          it.path = r.path
          it.weight = r.weight
          it.defenseCurve = r.curve
          it.defenseCurveCtrl = r.curveCtrl
        } else if (props.curve === 'smooth') {
          // 平滑曲线端点移动必须重算整条贝塞尔曲线，不能只替换首/尾采样点。
          const pts = it.layers[0]?.pts ?? []
          if (pts.length >= 3) it.curveCtrl = deriveCurveCtrl(pts)
        }
      }
      if (kind === 'curve' && props.type === 'defense') {
        const r = reconstructDefensePath(layers)
        it.path = r.path
        it.weight = r.weight
        it.defenseCurve = 'smooth'
        it.defenseCurveCtrl = r.curveCtrl
      }
      interactRef.current = it
    },
    [layersOfKeys, snapshotNow, map],
  )
  const startHandleDragRef = useRef(startHandleDrag)
  startHandleDragRef.current = startHandleDrag

  /** Android：双指在已选图形上捏合时，对选中集合做等比例缩放。 */
  const startAndroidPinch = useCallback((a: L.Point, b: L.Point): boolean => {
    if (platform.kind !== 'android') return false
    // 结束第一根手指刚建立的普通点击/拖动候选会话，再切换为双指缩放。
    finishShapePointerRef.current()
    // 锁定图形不参与捏合缩放
    const locked = lockedKeysRef.current()
    const keys = selectedKeys().filter((k) => !locked.has(k))
    const layers = layersOfKeys(keys)
    if (layers.length === 0) return false
    const startDistance = a.distanceTo(b)
    if (startDistance < 8) return false
    const center = unionBounds(layers).getCenter()
    androidPinchSessionRef.current = {
      before: snapshotNow(),
      startDistance,
      center,
      layers: layers.map((layer) => {
        const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
        const isText = props.type === 'text' && layer instanceof L.Marker
        return {
          layer,
          pts: layer instanceof L.Marker ? [(layer as L.Marker).getLatLng()] : flatLatLngs(layer),
          defensePath: storedDefensePathOf(layer),
          textStyle: isText ? textStyleFromProps(props) : undefined,
          text: isText ? String(props.text ?? '') : undefined,
          radius: props.type === 'circle' ? Number(props.radius ?? 0) : undefined,
          radiusY: props.type === 'circle' ? Number(props.radiusY ?? props.radius ?? 0) : undefined,
        }
      }),
    }
    if (!handleMapDragLockedRef.current && map.dragging.enabled()) {
      map.dragging.disable()
      handleMapDragLockedRef.current = true
    }
    editPointerActiveRef.current = true
    return true
  }, [layersOfKeys, map, selectedKeys, snapshotNow])

  const moveAndroidPinch = useCallback((a: L.Point, b: L.Point) => {
    const session = androidPinchSessionRef.current
    if (!session) return
    const factor = Math.min(12, Math.max(0.08, a.distanceTo(b) / session.startDistance))
    const c = session.center
    for (const item of session.layers) {
      const { layer, pts } = item
      if (layer instanceof L.Marker) {
        const base = pts[0]
        ;(layer as L.Marker).setLatLng(L.latLng(
          c.lat + (base.lat - c.lat) * factor,
          c.lng + (base.lng - c.lng) * factor,
        ))
        if (item.textStyle) {
          const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
          const style = {
            ...item.textStyle,
            fontSize: Math.min(96, Math.max(8, Math.round(Number(item.textStyle.fontSize ?? 16) * factor))),
            width: Math.min(800, Math.max(48, Math.round(Number(item.textStyle.width ?? 160) * factor))),
          }
          textStyleToProps(props, style)
          ;(layer as L.Marker).setIcon(textIcon(item.text ?? '', style))
        }
        continue
      }
      setFlatLatLngs(layer, pts.map((point) => L.latLng(
        c.lat + (point.lat - c.lat) * factor,
        c.lng + (point.lng - c.lng) * factor,
      )))
      if (item.defensePath) {
        setStoredDefensePath(layer, item.defensePath.map((point) => L.latLng(
          c.lat + (point.lat - c.lat) * factor,
          c.lng + (point.lng - c.lng) * factor,
        )))
      }
      const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
      if (props.type === 'circle') {
        if (item.radius != null) props.radius = item.radius * factor
        if (item.radiusY != null) props.radiusY = item.radiusY * factor
      }
    }
    dragMovedRef.current = true
    buildGizmoRef.current()
  }, [])

  const endAndroidPinch = useCallback(() => {
    const session = androidPinchSessionRef.current
    androidPinchSessionRef.current = null
    if (session && snapshotNow() !== session.before) commitDraw(session.before)
    editPointerActiveRef.current = false
    dragMovedRef.current = false
    if (handleMapDragLockedRef.current) {
      handleMapDragLockedRef.current = false
      if (toolRef.current === 'pan') map.dragging.enable()
    }
    buildGizmoRef.current()
  }, [commitDraw, map, snapshotNow])

  androidPinchStartRef.current = startAndroidPinch
  androidPinchMoveRef.current = moveAndroidPinch
  androidPinchEndRef.current = endAndroidPinch

  /** 应用交互（mousemove：实时更新图形几何） */
  const applyInteract = useCallback(
    (e: L.LeafletMouseEvent) => {
      const it = interactRef.current
      if (!it) return
      dragMovedRef.current = true
      const cur = e.latlng
      const dLat = cur.lat - it.start.lat
      const dLng = cur.lng - it.start.lng
      if (it.kind === 'move') {
        for (const { layer, pts, defensePath } of it.layers) {
          if (layer instanceof L.Marker) {
            const base = it.text?.pos ?? pts[0]
            ;(layer as L.Marker).setLatLng([base.lat + dLat, base.lng + dLng])
          } else {
            setFlatLatLngs(layer, pts.map((p) => L.latLng(p.lat + dLat, p.lng + dLng)))
            if (defensePath) {
              setStoredDefensePath(layer, defensePath.map((point) => L.latLng(point.lat + dLat, point.lng + dLng)))
            }
          }
        }
      } else if (it.kind === 'rotate') {
        const c = it.center
        if (!c || !it.h0) return
        // 使用屏幕像素坐标旋转，避免 lat/lng 轴与屏幕 x/y 方向相反造成角度倒置。
        const cp = map.latLngToContainerPoint(c)
        const h0p = map.latLngToContainerPoint(it.h0)
        const curp = map.latLngToContainerPoint(cur)
        const ang0 = Math.atan2(h0p.y - cp.y, h0p.x - cp.x)
        const ang1 = Math.atan2(curp.y - cp.y, curp.x - cp.x)
        const th = ang1 - ang0
        const cos = Math.cos(th)
        const sin = Math.sin(th)
        if (it.text) {
          const layer = it.layers[0]?.layer
          if (layer instanceof L.Marker) {
            const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
            const rotation = it.text.rotation + (th * 180) / Math.PI
            const style = { ...textStyleFromProps(props), rotation }
            textStyleToProps(props, style)
            ;(layer as L.Marker).setIcon(textIcon(String(props.text ?? ''), style))
            showEditLabelRef.current(cur, `${Math.round(((rotation % 360) + 360) % 360)}°`)
          }
          return
        }
        for (const { layer, pts, defensePath } of it.layers) {
          if (layer instanceof L.Marker) continue
          const rotatePoint = (p: L.LatLng) => {
            const pp = map.latLngToContainerPoint(p)
            const dx = pp.x - cp.x
            const dy = pp.y - cp.y
            return map.containerPointToLatLng(L.point(cp.x + dx * cos - dy * sin, cp.y + dx * sin + dy * cos))
          }
          setFlatLatLngs(layer, pts.map(rotatePoint))
          if (defensePath) setStoredDefensePath(layer, defensePath.map(rotatePoint))
        }
        showEditLabelRef.current(cur, `${Math.round((((th * 180) / Math.PI) % 360 + 360) % 360)}°`)
      } else if (it.kind === 'scale') {
        const c = it.center
        if (!c || !it.h0) return
        const denX = it.h0.lng - c.lng
        const denY = it.h0.lat - c.lat
        if (Math.abs(denX) < 1e-6 || Math.abs(denY) < 1e-6) return
        let sx = (cur.lng - c.lng) / denX
        let sy = (cur.lat - c.lat) / denY
        if (it.uniform) {
          const f = Math.max(Math.abs(sx), Math.abs(sy))
          sx = f
          sy = f
        }
        sx = Math.max(0.05, Math.abs(sx)) * (sx < 0 ? -1 : 1)
        sy = Math.max(0.05, Math.abs(sy)) * (sy < 0 ? -1 : 1)
        if (it.text) {
          // 文字：四角同时缩放字号和文本框宽度；左右手柄仅改变宽度。
          const f = Math.max(Math.abs(sx), Math.abs(sy))
          const size = Math.min(96, Math.max(8, Math.round(it.text.fontSize * f)))
          const width = Math.min(800, Math.max(48, Math.round(it.text.width * Math.abs(sx))))
          const layer = it.layers[0]?.layer
          if (layer instanceof L.Marker) {
            const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
            const style = { ...textStyleFromProps(props), fontSize: size, width }
            textStyleToProps(props, style)
            ;(layer as L.Marker).setIcon(textIcon(String(props.text ?? ''), style))
            showEditLabelRef.current(cur, `${width}px · ${size}px`)
          }
          return
        }
        if (it.circle) {
          // 圆形：角点等比例/自由缩放
          const nrx = Math.max(2, Math.abs(it.circle.rx * sx))
          const nry = Math.max(2, Math.abs(it.circle.ry * sy))
          const layer = it.layers[0]?.layer
          if (layer && !(layer instanceof L.Marker)) {
            setFlatLatLngs(layer, ellipsePoints(it.circle.center, nrx, nry))
            const props = ((layer as AnyWithFeature).feature?.properties ?? {}) as Record<string, unknown>
            props.radius = nrx
            props.radiusY = nry
          }
          showEditLabelRef.current(cur, `半径 ${nrx.toFixed(0)}×${nry.toFixed(0)}`)
          return
        }
        for (const { layer, pts, defensePath } of it.layers) {
          if (layer instanceof L.Marker) continue
          const out = pts.map((p) => L.latLng(c.lat + (p.lat - c.lat) * sy, c.lng + (p.lng - c.lng) * sx))
          setFlatLatLngs(layer, out)
          if (defensePath) {
            setStoredDefensePath(layer, defensePath.map((point) => (
              L.latLng(c.lat + (point.lat - c.lat) * sy, c.lng + (point.lng - c.lng) * sx)
            )))
          }
        }
        // 尺寸反馈（宽 × 高，地图单位）
        const nb = unionBounds(it.layers.map((l) => l.layer))
        showEditLabelRef.current(
          cur,
          `${Math.round(nb.getEast() - nb.getWest())} × ${Math.round(nb.getNorth() - nb.getSouth())}`,
        )
      } else if (it.kind === 'stretch') {
        if (it.text) {
          const layer = it.layers[0]?.layer
          if (!(layer instanceof L.Marker)) return
          const center = it.center ?? it.text.pos
          const cp = map.latLngToContainerPoint(center)
          const curp = map.latLngToContainerPoint(cur)
          const angle = (it.text.rotation * Math.PI) / 180
          const localX = (curp.x - cp.x) * Math.cos(angle) + (curp.y - cp.y) * Math.sin(angle)
          const width = Math.min(800, Math.max(48, Math.round(Math.abs(localX) * 2)))
          const props = (layer.feature?.properties ?? {}) as Record<string, unknown>
          const style = { ...textStyleFromProps(props), width }
          textStyleToProps(props, style)
          ;(layer as L.Marker).setIcon(textIcon(String(props.text ?? ''), style))
          showEditLabelRef.current(cur, `宽度 ${width}px`)
          return
        }
        if (!it.circle) return
        const c = it.circle.center
        let nrx = it.circle.rx
        let nry = it.circle.ry
        const axis = it.circle.axis ?? 'e'
        if (axis === 'n' || axis === 's') nry = Math.max(2, Math.abs(cur.lat - c.lat))
        else nrx = Math.max(2, Math.abs(cur.lng - c.lng))
        const layer = it.layers[0]?.layer
        if (layer && !(layer instanceof L.Marker)) {
          setFlatLatLngs(layer, ellipsePoints(c, nrx, nry))
          const props = ((layer as AnyWithFeature).feature?.properties ?? {}) as Record<string, unknown>
          props.radius = nrx
          props.radiusY = nry
        }
        // 半径反馈
        showEditLabelRef.current(cur, `半径 ${nrx.toFixed(0)}×${nry.toFixed(0)}`)
      } else if (it.kind === 'endpoint') {
        const layer = it.layers[0]?.layer
        if (!layer || layer instanceof L.Marker) return
        if (it.path) {
          // 防线是三角形带，不直接拉某一个三角形。根据保存的逻辑路径重算完整防线，
          // 确保直线仍是直线、贝塞尔曲线整体变化、手绘路径连续形变。
          const source = it.path
          const curve = it.defenseCurve ?? 'straight'
          let path: L.LatLng[]
          if (curve === 'straight') {
            path = it.endIndex === 0
              ? [cur, source[source.length - 1]]
              : [source[0], cur]
          } else if (curve === 'smooth') {
            const start = it.endIndex === 0 ? cur : source[0]
            const end = it.endIndex === 1 ? cur : source[source.length - 1]
            const ctrl = it.defenseCurveCtrl ?? deriveCurveCtrl(source)
            path = bezierPoints(start, ctrl, end)
          } else {
            path = deformFreehandEndpoint(source, cur, it.endIndex ?? 1)
          }
          rebuildDefenseGroupRef.current(it.uid, path, it.weight ?? 3, curve)
        } else {
          const pts = [...it.layers[0].pts]
          const props = ((layer as AnyWithFeature).feature?.properties ?? {}) as Record<string, unknown>
          const isFreehandLine = props.curve === 'freehand' && (props.type === 'line' || props.type === 'arrow')
          if (isFreehandLine) {
            setFlatLatLngs(layer, deformFreehandEndpoint(pts, cur, it.endIndex ?? 1))
          } else if (it.curveCtrl && pts.length >= 2) {
            const start = it.endIndex === 0 ? cur : pts[0]
            const end = it.endIndex === 1 ? cur : pts[pts.length - 1]
            setFlatLatLngs(layer, bezierPoints(start, it.curveCtrl, end))
          } else {
            if (it.endIndex === 0) pts[0] = cur
            else pts[pts.length - 1] = cur
            setFlatLatLngs(layer, pts)
          }
        }
      } else if (it.kind === 'curve') {
        const layer = it.layers[0]?.layer
        if (!layer || layer instanceof L.Marker) return
        if (it.path) {
          const path = bezierPoints(it.path[0], cur, it.path[it.path.length - 1])
          rebuildDefenseGroupRef.current(it.uid, path, it.weight ?? 3, 'smooth')
        } else {
          const pts = it.layers[0].pts
          setFlatLatLngs(layer, bezierPoints(pts[0], cur, pts[pts.length - 1]))
        }
      }
      buildGizmoRef.current()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map],
  )
  const applyInteractRef = useRef(applyInteract)
  applyInteractRef.current = applyInteract
  const showEditLabelRef = useRef(showEditLabel)
  showEditLabelRef.current = showEditLabel

  // 编辑交互主循环（第十六轮：常驻可用——除套索/橡皮擦外所有工具下，图形可直接 悬停高亮/点击选中/拖拽编辑）
  useEffect(() => {
    if (!fg || tool === 'lasso' || tool === 'eraser') return
    const hit = L.featureGroup([], { pane: DRAW_PANE })
    const gizmo = L.featureGroup([], { pane: DRAW_PANE })
    hitRef.current = hit
    gizmoRef.current = gizmo
    map.addLayer(hit)
    map.addLayer(gizmo)
    fg.eachLayer((l) => buildHitRef.current(l as AnyWithFeature))
    // 从套索/橡皮擦切换到本模式：清空残留选中；fg 重建（保存后）时选中保留
    if (toolRef.current === 'lasso' || toolRef.current === 'eraser') {
      clearSelection()
    }
    if (selectedRef.current.size > 0) buildGizmoRef.current()
    const restoreMapDragging = () => {
      if (!handleMapDragLockedRef.current) return
      handleMapDragLockedRef.current = false
      if (toolRef.current === 'pan') map.dragging.enable()
    }
    const finishInteraction = () => {
      const it = interactRef.current
      if (it) {
        const textMarker = it.text && it.layers[0]?.layer instanceof L.Marker
          ? it.layers[0].layer as MarkerWithFeature
          : null
        interactRef.current = null
        hideEditLabelRef.current()
        if (snapshotNow() !== it.before) commitDraw(it.before)
        if (textMarker) window.requestAnimationFrame(() => refreshTextHitRef.current(textMarker))
        else buildGizmoRef.current()
      }
      restoreMapDragging()
    }
    const finishShapePointer = () => {
      const press = shapePressRef.current
      shapePressRef.current = null
      if (press && !press.dragging) {
        if (press.additive && press.wasSelected) {
          removeKeyRef.current(press.key)
        } else if (!press.wasSelected) {
          selectKeyRef.current(press.key, press.additive)
        }
        // 已选图形上的普通单击保持当前选中，不重复清空/重建状态。
      }
      finishInteraction()
      editPointerActiveRef.current = false
    }
    finishShapePointerRef.current = finishShapePointer
    const onMove = (e: L.LeafletMouseEvent) => {
      const press = shapePressRef.current
      if (!press) {
        applyInteractRef.current(e)
        return
      }
      if (!press.dragging) {
        const currentPoint = map.latLngToContainerPoint(e.latlng)
        if (press.startPoint.distanceTo(currentPoint) <= CLICK_DRAG_THRESHOLD_PX) return
        press.dragging = true
        dragMovedRef.current = true
        // 高亮图形可直接拖动：首次拖动先完成选中，再立即进入移动，不要求预先单击一次。
        if (!press.additive) {
          if (!press.wasSelected) selectKeyRef.current(press.key, false)
          startBodyMoveRef.current(press.key, press.downEvent)
        }
      }
      if (interactRef.current) applyInteractRef.current(e)
    }
    const onUp = () => finishShapePointer()
    const onClick = (e: L.LeafletMouseEvent) => {
      // 拖动结束后的 click 不取消选中
      if (dragMovedRef.current) {
        dragMovedRef.current = false
        return
      }
      const t = e.originalEvent.target as HTMLElement
      if (t.closest?.(DRAW_PANE_SELECTOR)) return
      clearEditSelectionRef.current(true)
    }
    // 空白处按下：重置"图形按下"标记，保证随后的点击空白能正常取消选中
    const onMapDown = (e: L.LeafletMouseEvent) => {
      const t = e.originalEvent.target as HTMLElement
      if (!t.closest?.(DRAW_PANE_SELECTOR)) {
        dragMovedRef.current = false
      }
    }
    // 右键任意位置取消选中（第十六轮；容器捕获阶段，先于 Leaflet/屏蔽层）
    const container = map.getContainer()
    const onCtx = () => {
      finishShapePointer()
      clearEditSelectionRef.current(true)
    }
    container.addEventListener('contextmenu', onCtx, true)
    const onKey = (ev: KeyboardEvent) => {
      // 输入框内按键不拦截（文字编辑等）
      const t = ev.target as HTMLElement | null
      if (t && t.closest('input, textarea, select')) return
      if (ev.key === 'Escape') {
        finishShapePointer()
        clearEditSelectionRef.current(true)
      } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (fgRef.current && selectedRef.current.size > 0) {
          deleteSelected()
          clearEditSelectionRef.current(false)
        }
      }
    }
    // 滚轮/手势缩放：选中框（经纬度边界）随地图缩放，但样式/删除/锁定按钮与编辑手柄
    // 是按屏幕像素偏移算出的 Marker，缩放后会脱离图形——缩放过程中持续按新比例重建 gizmo
    const onZoom = () => {
      if (selectedRef.current.size > 0) buildGizmoRef.current()
    }
    map.on('zoom', onZoom)
    map.on('zoomend', onZoom)
    map.on('mousemove', onMove)
    map.on('mouseup', onUp)
    map.on('click', onClick)
    map.on('mousedown', onMapDown)
    // 控制点会在拖动过程中被实时重建；document mouseup 保证原 Marker 消失后仍能结束会话。
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
    return () => {
      map.off('zoom', onZoom)
      map.off('zoomend', onZoom)
      map.off('mousemove', onMove)
      map.off('mouseup', onUp)
      map.off('click', onClick)
      map.off('mousedown', onMapDown)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
      container.removeEventListener('contextmenu', onCtx, true)
      hit.remove()
      gizmo.remove()
      shapePressRef.current = null
      editPointerActiveRef.current = false
      finishShapePointerRef.current = () => {}
      restoreMapDragging()
      hoverEpochRef.current += 1
      const hovered = hoverUidRef.current
      if (hovered && !isKeySelectedRef.current(hovered)) highlightKey(hovered, false)
      hoverUidRef.current = null
      hitRef.current = null
      gizmoRef.current = null
      hideEditLabelRef.current()
      // 切换到套索/橡皮擦（本交互停用）或组件卸载时：清理选中并提交属性面板；fg 重建导致的清理需保留选中
      if (toolRef.current === 'lasso' || toolRef.current === 'eraser') {
        clearEditSelectionRef.current(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fg, tool, geoJson])

  // 选中属性面板（Portal 到 body，fixed 定位；第十六轮：文字样式 / 箭头样式）
  const finishSelectedWeight = () => {
    if (!selPanel || selPanel.kind !== 'shape' || selWeightDraftRef.current == null) return
    const next = { ...selPanel, weight: selWeightDraftRef.current }
    selWeightDraftRef.current = null
    setSelPanel(next)
    commitStyleRef.current(selPanel.uid, 'shape', next)
  }

  const selPanelUI =
    selPanel &&
    createPortal(
      <div ref={selPanelElRef} className="text-style-panel" style={{ left: selPanel.x, top: selPanel.y }} onClick={(e) => e.stopPropagation()}>
        <div
          className="tsp-head"
          onPointerDown={startSelPanelDrag}
          onPointerMove={moveSelPanel}
          onPointerUp={stopSelPanelDrag}
          onPointerCancel={stopSelPanelDrag}
        >
          <span>{selPanel.kind === 'text' ? '文字样式' : '图形样式'}</span>
          <button type="button" className="tsp-close" onClick={() => closeSelPanelRef.current(true)} title="关闭并保存">
            ×
          </button>
        </div>
        {selPanel.kind === 'text' ? (
          <>
            <div className="tsp-row">
              <label>字号</label>
              <input
                type="range"
                min={8}
                max={72}
                step={1}
                value={selPanel.style.fontSize ?? 13}
                onChange={(e) => {
                  const next = { ...selPanel.style, fontSize: Number(e.target.value) }
                  setSelPanel({ ...selPanel, style: next })
                  commitStyleRef.current(selPanel.uid, 'text', next)
                }}
              />
              <span className="tsp-val">{selPanel.style.fontSize ?? 13}px</span>
            </div>
            <div className="tsp-row">
              <label>文字色</label>
              <input
                type="color"
                value={selPanel.style.color ?? '#ffffff'}
                onChange={(e) => {
                  const next = { ...selPanel.style, color: e.target.value }
                  setSelPanel({ ...selPanel, style: next })
                  commitStyleRef.current(selPanel.uid, 'text', next)
                }}
              />
              <span className="tsp-val">{selPanel.style.color ?? '#ffffff'}</span>
            </div>
            <div className="tsp-row">
              <label>底色</label>
              <input
                type="color"
                value={selPanel.style.backgroundColor && selPanel.style.backgroundColor !== 'transparent' ? selPanel.style.backgroundColor : '#000000'}
                onChange={(e) => {
                  const next = { ...selPanel.style, backgroundColor: e.target.value }
                  setSelPanel({ ...selPanel, style: next })
                  commitStyleRef.current(selPanel.uid, 'text', next)
                }}
              />
              <label className="tsp-check">
                <input
                  type="checkbox"
                  checked={!(selPanel.style.backgroundColor && selPanel.style.backgroundColor !== 'transparent')}
                  onChange={(e) => {
                    const next = { ...selPanel.style, backgroundColor: e.target.checked ? 'transparent' : selPanel.style.backgroundColor ?? '#000000' }
                    setSelPanel({ ...selPanel, style: next })
                    commitStyleRef.current(selPanel.uid, 'text', next)
                  }}
                />
                透明
              </label>
            </div>
            <div className="tsp-row">
              <label>边框色</label>
              <input
                type="color"
                value={selPanel.style.borderColor ?? selPanel.style.color ?? '#3f8cff'}
                onChange={(e) => {
                  const next = { ...selPanel.style, borderColor: e.target.value }
                  setSelPanel({ ...selPanel, style: next })
                  commitStyleRef.current(selPanel.uid, 'text', next)
                }}
              />
            </div>
            <div className="tsp-row">
              <label>边框宽</label>
              <input
                type="range"
                min={0}
                max={6}
                step={1}
                value={selPanel.style.borderWidth ?? 0}
                onChange={(e) => {
                  const bw = Number(e.target.value)
                  const next = { ...selPanel.style, borderWidth: bw, borderStyle: bw > 0 ? selPanel.style.borderStyle ?? 'solid' : 'none' }
                  setSelPanel({ ...selPanel, style: next })
                  commitStyleRef.current(selPanel.uid, 'text', next)
                }}
              />
              <span className="tsp-val">{selPanel.style.borderWidth ?? 0}px</span>
            </div>
            <div className="tsp-row">
              <label>边框型</label>
              <div className="tsp-seg">
                {(['none', 'solid', 'dashed', 'dotted'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`seg-btn ${(selPanel.style.borderStyle ?? 'none') === s ? 'active' : ''}`}
                    onClick={() => {
                      const next = { ...selPanel.style, borderStyle: s, borderWidth: s === 'none' ? 0 : selPanel.style.borderWidth ?? 1 }
                      setSelPanel({ ...selPanel, style: next })
                      commitStyleRef.current(selPanel.uid, 'text', next)
                    }}
                  >
                    {s === 'none' ? '无' : s === 'solid' ? '实' : s === 'dashed' ? '虚' : '点'}
                  </button>
                ))}
              </div>
            </div>
            <div className="tsp-row">
              <label>字体</label>
              <select
                value={selPanel.style.fontFamily ?? ''}
                onChange={(e) => {
                  const next = { ...selPanel.style, fontFamily: e.target.value || undefined }
                  setSelPanel({ ...selPanel, style: next })
                  commitStyleRef.current(selPanel.uid, 'text', next)
                }}
              >
                <option value="">默认</option>
                <option value="微软雅黑">微软雅黑</option>
                <option value="Arial">Arial</option>
                <option value="楷体">楷体</option>
                <option value="黑体">黑体</option>
                <option value="宋体">宋体</option>
              </select>
            </div>
            <div className="tsp-row">
              <label>字重</label>
              <div className="tsp-seg">
                <button
                  type="button"
                  className={`seg-btn ${(selPanel.style.fontWeight ?? 'normal') === 'normal' ? 'active' : ''}`}
                  onClick={() => {
                    const next = { ...selPanel.style, fontWeight: 'normal' as const }
                    setSelPanel({ ...selPanel, style: next })
                    commitStyleRef.current(selPanel.uid, 'text', next)
                  }}
                >
                  常规
                </button>
                <button
                  type="button"
                  className={`seg-btn ${(selPanel.style.fontWeight ?? 'normal') === 'bold' ? 'active' : ''}`}
                  onClick={() => {
                    const next = { ...selPanel.style, fontWeight: 'bold' as const }
                    setSelPanel({ ...selPanel, style: next })
                    commitStyleRef.current(selPanel.uid, 'text', next)
                  }}
                >
                  加粗
                </button>
                <button
                  type="button"
                  className={`seg-btn ${(selPanel.style.fontStyle ?? 'normal') === 'italic' ? 'active' : ''}`}
                  onClick={() => {
                    const next = { ...selPanel.style, fontStyle: (selPanel.style.fontStyle ?? 'normal') === 'italic' ? 'normal' as const : 'italic' as const }
                    setSelPanel({ ...selPanel, style: next })
                    commitStyleRef.current(selPanel.uid, 'text', next)
                  }}
                >
                  斜体
                </button>
              </div>
            </div>
            <div className="tsp-row">
              <label>对齐</label>
              <div className="tsp-seg">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`seg-btn ${(selPanel.style.textAlign ?? 'center') === a ? 'active' : ''}`}
                    onClick={() => {
                      const next = { ...selPanel.style, textAlign: a }
                      setSelPanel({ ...selPanel, style: next })
                      commitStyleRef.current(selPanel.uid, 'text', next)
                    }}
                  >
                    {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="tsp-row">
              <label>颜色</label>
              <input
                type="color"
                value={selPanel.color}
                onChange={(e) => {
                  const next = { ...selPanel, color: e.target.value }
                  setSelPanel(next)
                  commitStyleRef.current(selPanel.uid, 'shape', next)
                }}
              />
              <span className="tsp-val">{selPanel.color}</span>
            </div>
            {(selPanel.shapeType === 'rect' || selPanel.shapeType === 'circle') && (
              <div className="tsp-row">
                <label>填充</label>
                <input
                  type="color"
                  value={selPanel.fillColor ?? selPanel.color}
                  onChange={(e) => {
                    const next = { ...selPanel, fillColor: e.target.value, fillEnabled: true }
                    setSelPanel(next)
                    commitStyleRef.current(selPanel.uid, 'shape', next)
                  }}
                />
                <label className="tsp-check">
                  <input
                    type="checkbox"
                    checked={!selPanel.fillEnabled}
                    onChange={(e) => {
                      const next = { ...selPanel, fillEnabled: !e.target.checked }
                      setSelPanel(next)
                      commitStyleRef.current(selPanel.uid, 'shape', next)
                    }}
                  />
                  无填充
                </label>
              </div>
            )}
            {selPanel.shapeType !== 'defense' ? (
              <>
                <div className="tsp-row">
                  <label>粗细</label>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={selPanel.weight}
                    onChange={(e) => {
                      const weight = Number(e.target.value)
                      selWeightDraftRef.current = weight
                      const next = { ...selPanel, weight }
                      setSelPanel(next)
                      // 拖动中只更新当前 Leaflet 图层，不触发 App 全量状态与 localStorage。
                      for (const target of targetLayersOf(selPanel.uid)) {
                        const props = (target.feature?.properties ?? {}) as Record<string, unknown>
                        if (target instanceof L.Path && props.type !== 'defense') target.setStyle({ weight })
                      }
                    }}
                    onPointerUp={finishSelectedWeight}
                    onPointerCancel={finishSelectedWeight}
                    onBlur={finishSelectedWeight}
                    onKeyUp={finishSelectedWeight}
                  />
                  <span className="tsp-val">{selPanel.weight}px</span>
                </div>
                <div className="tsp-row">
                  <label>线型</label>
                  <div className="tsp-seg">
                    {(['solid', 'dashed', 'dotted'] as DashType[]).map((dash) => (
                      <button
                        key={dash}
                        type="button"
                        className={`seg-btn ${selPanel.dash === dash ? 'active' : ''}`}
                        onClick={() => {
                          const next = { ...selPanel, dash }
                          setSelPanel(next)
                          commitStyleRef.current(selPanel.uid, 'shape', next)
                        }}
                      >
                        {dash === 'solid' ? '实线' : dash === 'dashed' ? '虚线' : '点线'}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="tsp-hint">防线保持实线，仅支持修改颜色。</div>
            )}
            {selPanel.shapeType === 'arrow' ? (
              <>
            <div className="tsp-row">
              <label>箭头</label>
              <div className="tsp-seg">
                {SEL_ARROW_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`seg-btn ${(selPanel.arrowStyle ?? DEFAULT_ARROW_STYLE) === t.value ? 'active' : ''}`}
                    onClick={() => {
                      const next = { ...selPanel, arrowStyle: t.value }
                      setSelPanel(next)
                      commitStyleRef.current(selPanel.uid, 'shape', next)
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="tsp-row">
              <label>大小</label>
              <div className="tsp-seg">
                {SEL_ARROW_SIZES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`seg-btn ${(selPanel.arrowSize ?? DEFAULT_ARROW_SIZE) === s.value ? 'active' : ''}`}
                    onClick={() => {
                      const next = { ...selPanel, arrowSize: s.value }
                      setSelPanel(next)
                      commitStyleRef.current(selPanel.uid, 'shape', next)
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="tsp-hint">拖拽端点/曲线控制点可调整箭头形状，改动会自动保存。</div>
              </>
            ) : null}
          </>
        )}
      </div>,
      document.body,
    )

  // 轻量提示（锁定图形被删除/擦除时）：Portal 到 body，fixed 定位底部居中
  const toastUI =
    toast &&
    createPortal(
      <div key={toast.key} className="draw-toast" role="status">
        {toast.msg}
      </div>,
      document.body,
    )

  return (
    <>
      {selPanelUI}
      {toastUI}
    </>
  )
}
