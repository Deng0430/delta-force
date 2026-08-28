import { Marker, Polygon, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { CapturePoint, PointStatus, Side, StageConfig, TacticalObjectiveState } from '../types'
import { POINT_ICON_BASE } from '../config/points'

const ZONE_ZOOM = 4.4

/**
 * 据点归属颜色（问题3，统一三色规则）：
 * - 己方区域 = 绿色
 * - 中立/待争夺 = 白色
 * - 敌方区域 = 红色
 * 已攻下(captured)：攻方视角=己方绿 / 守方视角=敌方红
 * 争夺中(active)：中立白
 * 未激活(locked)：攻方视角=敌方红 / 守方视角=己方绿
 */
export function pointOwnColor(status: PointStatus, view: Side): string {
  if (status === 'captured') return view === 'attack' ? '#01ff84' : '#e0453a'
  if (status === 'active') return '#f4cf67'
  return view === 'attack' ? '#e0453a' : '#01ff84'
}

export function defaultObjectiveState(status: PointStatus): TacticalObjectiveState {
  if (status === 'captured') return { owner: 'attack', capturingSide: null, progress: 100 }
  if (status === 'locked') return { owner: 'defense', capturingSide: null, progress: 100 }
  return { owner: 'neutral', capturingSide: null, progress: 0 }
}

export function objectiveStateColor(state: TacticalObjectiveState, view: Side): string {
  if (state.owner === 'neutral') return '#f4cf67'
  return state.owner === view ? '#01ff84' : '#e0453a'
}

export function objectiveProgressColor(state: TacticalObjectiveState, view: Side): string {
  if (state.owner !== 'neutral') return state.owner === view ? '#01ff84' : '#e0453a'
  if (!state.capturingSide) return '#f4cf67'
  return state.capturingSide === view ? '#01ff84' : '#e0453a'
}

/**
 * progress 始终就是地图需要显示的框线百分比：中立据点由 0% 增长，
 * 已有归属的据点表示原控制方剩余进度，由 100% 递减。
 */
export function objectiveFrameProgress(state: TacticalObjectiveState): number {
  return Math.max(0, Math.min(100, state.progress))
}

/** 按真实矩形边长生成唯一一条连续折线，规避不同浏览器的 SVG dasharray 换算差异。 */
function objectiveProgressPoints(progress: number): string {
  const vertices: Array<[number, number]> = [
    [22, 6.5],
    [37.5, 6.5],
    [37.5, 37.5],
    [6.5, 37.5],
    [6.5, 6.5],
    [22, 6.5],
  ]
  let remaining = (Math.max(0, Math.min(100, progress)) / 100) * 124
  const points: Array<[number, number]> = [vertices[0]]
  for (let index = 1; index < vertices.length && remaining > 0; index += 1) {
    const [fromX, fromY] = vertices[index - 1]
    const [toX, toY] = vertices[index]
    const length = Math.hypot(toX - fromX, toY - fromY)
    if (remaining >= length) {
      points.push(vertices[index])
      remaining -= length
      continue
    }
    const ratio = remaining / length
    points.push([fromX + (toX - fromX) * ratio, fromY + (toY - fromY) * ratio])
    remaining = 0
  }
  return points.map(([x, y]) => `${x},${y}`).join(' ')
}

/** 阶段状态（按推进下标） */
export function stageStatus(stageIdx: number, capturedStageIndex: number): PointStatus {
  if (stageIdx < capturedStageIndex) return 'captured'
  if (stageIdx === capturedStageIndex) return 'active'
  return 'locked'
}

interface PointMarkersProps {
  stages: StageConfig[]
  capturedStageIndex: number
  view: Side
  selectedName: string | null
  selectedStageId: string | null
  /** 是否显示据点与防线图层（区域多边形 + 标识） */
  visible: boolean
  /** 是否显示据点标识（A点图标 + "据点A"字样）；false 时仅隐藏标识，区域多边形保留 */
  labelsVisible: boolean
  /** 是否显示据点图标下方的名称文字。 */
  annotationsVisible: boolean
  /** 是否显示据点可占领区域。 */
  captureVisible: boolean
  /** 是否显示据点所在阶段防线。 */
  frontlineVisible: boolean
  /** 绘制工具激活时禁用点击属性（不弹出详情/不聚焦） */
  interactive: boolean
  onSelect: (point: CapturePoint, stageId: string) => void
  objectiveStates: Record<string, TacticalObjectiveState>
}

/** 攻防据点图层（问题6）：防线区域=虚线边框，据点可占领区域=实线边框 */
export default function PointMarkers({
  stages,
  capturedStageIndex,
  view,
  selectedName,
  selectedStageId,
  visible,
  labelsVisible,
  annotationsVisible,
  captureVisible,
  frontlineVisible,
  interactive,
  onSelect,
  objectiveStates,
}: PointMarkersProps) {
  const map = useMap()
  const activeStage = stages[capturedStageIndex]
  const activeStatus: PointStatus = 'active'

  const makeIcon = (point: CapturePoint, status: PointStatus, selected: boolean) => {
    const objectiveState = objectiveStates[point.name] ?? defaultObjectiveState(status)
    const color = objectiveStateColor(objectiveState, view)
    const progressColor = objectiveProgressColor(objectiveState, view)
    const progress = objectiveFrameProgress(objectiveState)
    const progressPoints = objectiveProgressPoints(progress)
    const showProgress = objectiveState.owner !== 'neutral' || objectiveState.capturingSide !== null
    const img = `${POINT_ICON_BASE}/${point.icon}.png`
    const cls = ['cap-marker', status, selected ? 'selected' : ''].join(' ')
    return L.divIcon({
      className: 'cap-marker-wrap',
      html: `
        <div class="${cls}" style="--c:${color}">
          ${showProgress && progress > 0 ? `<svg class="cap-progress-frame" viewBox="0 0 44 44" aria-hidden="true"><polyline class="value" points="${progressPoints}" style="--progress-color:${progressColor}"/></svg>` : ''}
          <img src="${img}" draggable="false" />
          ${annotationsVisible ? `<span class="cap-tag">${point.name}</span>` : ''}
        </div>`,
      iconSize: [44, 52],
      iconAnchor: [22, 42],
    })
  }

  if (!visible || !activeStage) return null

  return (
    <>
      {/* 防线区域（官网"区域"对象，虚线边框）：仅当前激活阶段 */}
      {frontlineVisible && activeStage.zone ? (
        <Polygon
          key={`zone-${activeStage.id}`}
          positions={activeStage.zone.latlngs}
          pathOptions={{
            color: pointOwnColor(activeStatus, view),
            weight: 2.5,
            dashArray: '10 7',
            opacity: 0.9,
            fillColor: pointOwnColor(activeStatus, view),
            fillOpacity: 0,
            className: 'demo-map-frontline',
            // 绘制工具激活时禁用交互：否则多边形拦截鼠标事件，战斗区域内无法绘制
            interactive,
          }}
        />
      ) : null}

      {/* 据点可占领区域（官网据点对象 border，实线边框）：仅当前阶段 */}
      {captureVisible && activeStage.points.map((point) => {
          if (!point.capturable || point.capturable.length < 3) return null
          const objectiveState = objectiveStates[point.name] ?? defaultObjectiveState(activeStatus)
          const color = objectiveStateColor(objectiveState, view)
          return (
            <Polygon
              key={`cap-${activeStage.id}-${point.name}`}
              positions={point.capturable}
              pathOptions={{
                color,
                weight: 2.2,
                dashArray: '0',
                opacity: 0.85,
                fillColor: color,
                fillOpacity: 0.1,
                className: 'demo-map-capture',
                // 绘制工具激活时禁用交互：据点可占领区域（战斗区域主体）不再拦截绘制
                interactive,
              }}
            />
          )
      })}

      {/* 据点标记（A点图标 + "据点A"字样）：仅当前阶段；labelsVisible=false 时整体隐藏 */}
      {labelsVisible &&
        activeStage.points.map((point) => (
            <Marker
              key={`pt-${activeStage.id}-${point.name}`}
              position={[point.lat, point.lng]}
              icon={makeIcon(point, activeStatus, selectedStageId === activeStage.id && selectedName === point.name)}
              // 绘制工具激活时禁用交互：据点图标不拦截 mousedown，绘制可穿过
              interactive={interactive}
              eventHandlers={{
                click: () => {
                  // 绘制工具激活时忽略点击（不弹属性详情、不聚焦）
                  if (!interactive) return
                  map.flyTo([point.lat, point.lng], ZONE_ZOOM, { duration: 0.6 })
                  onSelect(point, activeStage.id)
                },
              }}
            />
          ))}
    </>
  )
}
