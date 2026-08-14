import { useMemo } from 'react'
import { Polygon } from 'react-leaflet'
import type { Side, StageConfig } from '../types'

/** 区域颜色统一规则（问题3）：己方=绿、敌方=红、中立=白 */
const COLORS = {
  own: '#01ff84',
  deny: '#e0453a',
} as const

interface ActivityZonesProps {
  stages: StageConfig[]
  capturedStageIndex: number
  view: Side
  /** 是否显示活动区域图层 */
  visible: boolean
}

interface ZoneRender {
  key: string
  name: string
  latlngs: [number, number][]
  color: string
  dash: string
}

/**
 * 攻守双方活动区域覆盖层（问题3 + 问题6 + 第九轮问题1）：
 * - 己方可活动区域 = 绿色（进攻方视角=攻方基地，防守方视角=守方基地）
 * - 敌方区域（不可活动）= 半透明红色
 * - 仅渲染当前争夺阶段；切换攻防视角时颜色自动联动。
 * - 第九轮：活动区仅作为视觉背景元素，固定 interactive: false，
 *   点击/悬停不会产生任何选中、高亮或名称提示（不影响其他图层交互）。
 */
export default function ActivityZones({ stages, capturedStageIndex, view, visible }: ActivityZonesProps) {
  const zone: ZoneRender[] = useMemo(() => {
    const stage: StageConfig | undefined = stages[capturedStageIndex]
    if (!stage) return []
    const out: ZoneRender[] = []

    const attackZone = stage.attackBaseZone
    if (attackZone.length >= 3) {
      const isOwn = view === 'attack'
      out.push({
        key: 'atk-base',
        name: isOwn ? '进攻方可活动区域（己方）' : '进攻方区域 · 不可活动（敌方）',
        latlngs: attackZone,
        color: isOwn ? COLORS.own : COLORS.deny,
        dash: isOwn ? '0' : '6 4',
      })
    }

    const defZone = stage.defenseBaseZone
    if (defZone.length >= 3) {
      const isOwn = view === 'defense'
      out.push({
        key: 'def-base',
        name: isOwn ? '防守方可活动区域（己方）' : '防守方区域 · 不可活动（敌方）',
        latlngs: defZone,
        color: isOwn ? COLORS.own : COLORS.deny,
        dash: isOwn ? '0' : '6 4',
      })
    }
    return out
  }, [stages, capturedStageIndex, view])

  if (!visible || zone.length === 0) return null

  return (
    <>
      {zone.map((z) => (
        <Polygon
          key={z.key}
          positions={z.latlngs}
          pathOptions={{
            color: z.color,
            weight: 2,
            opacity: 0.9,
            dashArray: z.dash,
            fillColor: z.color,
            fillOpacity: 0,
            className: 'demo-map-activity',
            // 第九轮：活动区纯视觉背景，永久禁用交互（无选中/高亮/提示）
            interactive: false,
          }}
        />
      ))}
    </>
  )
}
