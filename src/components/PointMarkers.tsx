import { Marker, Polygon, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { CapturePoint, PointStatus, Side, StageConfig } from '../types'
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
  /** 是否显示据点与防线图层（区域多边形 + 标识） */
  visible: boolean
  /** 是否显示据点标识（A点图标 + "据点A"字样）；false 时仅隐藏标识，区域多边形保留 */
  labelsVisible: boolean
  /** 是否显示据点可占领区域。 */
  captureVisible: boolean
  /** 是否显示据点所在阶段防线。 */
  frontlineVisible: boolean
  /** 绘制工具激活时禁用点击属性（不弹出详情/不聚焦） */
  interactive: boolean
  onSelect: (point: CapturePoint, stageId: string) => void
}

/** 攻防据点图层（问题6）：防线区域=虚线边框，据点可占领区域=实线边框 */
export default function PointMarkers({
  stages,
  capturedStageIndex,
  view,
  selectedName,
  visible,
  labelsVisible,
  captureVisible,
  frontlineVisible,
  interactive,
  onSelect,
}: PointMarkersProps) {
  const map = useMap()
  const activeStage = stages[capturedStageIndex]
  const activeStatus: PointStatus = 'active'

  const makeIcon = (point: CapturePoint, status: PointStatus, selected: boolean) => {
    const color = pointOwnColor(status, view)
    const img = `${POINT_ICON_BASE}/${point.icon}.png`
    const cls = ['cap-marker', status, selected ? 'selected' : ''].join(' ')
    return L.divIcon({
      className: 'cap-marker-wrap',
      html: `
        <div class="${cls}" style="--c:${color}">
          <img src="${img}" draggable="false" />
          <span class="cap-tag">${point.name}</span>
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
            // 绘制工具激活时禁用交互：否则多边形拦截鼠标事件，战斗区域内无法绘制
            interactive,
          }}
        />
      ) : null}

      {/* 据点可占领区域（官网据点对象 border，实线边框）：仅当前阶段 */}
      {captureVisible && activeStage.points.map((point) => {
          if (!point.capturable || point.capturable.length < 3) return null
          return (
            <Polygon
              key={`cap-${activeStage.id}-${point.name}`}
              positions={point.capturable}
              pathOptions={{
                color: pointOwnColor(activeStatus, view),
                weight: 2.2,
                dashArray: '0',
                opacity: 0.85,
                fillColor: pointOwnColor(activeStatus, view),
                fillOpacity: 0.1,
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
              icon={makeIcon(point, activeStatus, selectedName === point.name)}
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
