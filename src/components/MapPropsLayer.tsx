import { useMemo } from 'react'
import { Marker, Tooltip } from 'react-leaflet'
import * as L from 'leaflet'
import type { MapProp, PropVisibility } from '../types'
import { MAP_PROPS } from '../config/pointsStages'
import { POINT_ICON_BASE } from '../config/points'

/** 道具类型视觉配色 + 显示尺寸（问题4：24-28px，随缩放级别自适应） */
const PROP_THEME: Record<string, { color: string; size: number }> = {
  载具补给站: { color: '#2f6fed', size: 28 },
  固定防空炮: { color: '#e0453a', size: 28 },
  密集阵: { color: '#32b8c6', size: 28 },
  固定机枪: { color: '#f08c2a', size: 26 },
  岸防炮: { color: '#d63f3f', size: 28 },
  滑索: { color: '#2ec4b6', size: 24 },
  电梯: { color: '#8b98ab', size: 24 },
  固定弹药箱: { color: '#f4cf67', size: 24 },
}

function propIcon(name: string, icon: string): L.DivIcon {
  const t = PROP_THEME[name] ?? { color: '#8b98ab', size: 26 }
  return L.divIcon({
    className: 'prop-marker-wrap',
    html: `
      <div class="prop-marker" style="--pc:${t.color}">
        <span class="prop-bg"></span>
        <img src="${POINT_ICON_BASE}/${icon}.png" draggable="false" />
      </div>`,
    iconSize: [t.size, t.size],
    iconAnchor: [t.size / 2, t.size / 2],
  })
}

interface MapPropsLayerProps {
  mapId: string
  /** 地图道具总开关（问题1） */
  visible: boolean
  /** 道具按类型显示开关（问题2） */
  propVis: PropVisibility
  /** 绘制工具激活时禁用交互（不弹名称提示） */
  interactive: boolean
  /** 自定义模式转换后的正式版道具数据；未提供时使用攻防模式内置数据。 */
  propsOverride?: MapProp[]
}

/**
 * 地图道具图层（问题1/2/4）：
 * 渲染官网地图道具（载具补给站/固定防空炮/固定机枪/岸防炮/滑索/电梯/固定弹药箱），
 * 彩色底衬圆标 + 官网图标，24-28px 小尺寸；悬停/点击显示道具名称；
 * 受左侧面板"地图道具"总开关与各类型开关双重控制，开关状态存入 localStorage。
 */
export default function MapPropsLayer({ mapId, visible, propVis, interactive, propsOverride }: MapPropsLayerProps) {
  const props = useMemo(() => propsOverride ?? MAP_PROPS[mapId] ?? [], [mapId, propsOverride])
  if (!visible || props.length === 0) return null

  return (
    <>
      {props.map((p, i) => {
        if (!(propVis[p.name] ?? true)) return null
        return (
          <Marker
            key={`prop-${mapId}-${i}-${p.icon}`}
            position={[p.lat, p.lng]}
            icon={propIcon(p.name, p.icon)}
            zIndexOffset={520}
            interactive={interactive}
          >
            {/* 绘制工具激活时不绑定 tooltip，道具名称提示消失 */}
            {interactive && (
              <Tooltip sticky direction="top" opacity={1}>
                <span className="prop-tip">
                  {p.name}
                  {p.stage ? <em> · {p.stage}</em> : null}
                </span>
              </Tooltip>
            )}
          </Marker>
        )
      })}
    </>
  )
}
