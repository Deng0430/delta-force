import { Fragment, useMemo } from 'react'
import { Marker, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { Side, StageConfig } from '../types'
import { POINT_ICON_BASE } from '../config/points'
import type { StageDeploy } from '../config/deployVehicles'

const SPAWN_ZOOM = 4.2

/**
 * 复活点图标（官网原图，dzc_i 目录）：
 * 文件名后缀 _r = 红色 / _g = 绿色，按「当前攻防视角」动态配色：
 * - 己方复活点 = 绿色（攻方视角→g_jdbsd_g，守方视角→f_jdbsd_g）
 * - 敌方复活点 = 红色（攻方视角→f_jdbsd_r，守方视角→g_jdbsd_r）
 */
const SPAWN_THEME = {
  own: { color: '#01ff84' },
  enemy: { color: '#e0453a' },
} as const

interface SpawnMarkersProps {
  stages: StageConfig[]
  capturedStageIndex: number
  /** 当前攻防视角（决定己方/敌方配色） */
  view: Side
  /** 是否显示复活点图层 */
  visible: boolean
  /** 绘制工具激活时禁用点击聚焦 */
  interactive: boolean
  /** 点击出生点（stageId + 阵营 + 坐标 + 基地名，用于底部载具部署栏） */
  onSelect: (spawn: { uid: string; stageId: string; side: Side; pos: [number, number]; baseName: string | null }) => void
  deployByStage?: Record<string, StageDeploy>
}

interface SpawnEntry {
  uid: string
  pos: [number, number]
  side: Side
  /** 基地名（null=附属复活点，无载具部署） */
  baseName: string | null
  /** 显示标签：有基地名时优先显示基地名，否则显示己方/敌方复活点 */
  label: string
  theme: { icon: string; color: string }
  vehicleDeploy: boolean
}

/**
 * 攻守方复活点图层：
 * 仅渲染「当前激活阶段」的复活点；切换阶段时旧阶段复活点自动清除。
 * 图标随缩放自适应（divIcon 跟随缩放），半透明标签不遮挡地图。
 * 点击出生点 → 回调 onSelect（App 据此弹出底部载具部署栏）。
 */
export default function SpawnMarkers({
  stages,
  capturedStageIndex,
  view,
  visible,
  interactive,
  onSelect,
  deployByStage,
}: SpawnMarkersProps) {
  const map = useMap()
  const stage: StageConfig | undefined = stages[capturedStageIndex]

  // 按当前视角装配己方/敌方主题
  const themes = useMemo(() => {
    const own: Side = view === 'attack' ? 'attack' : 'defense'
    return {
      attack: {
        icon: own === 'attack' ? 'g_jdbsd_g' : 'g_jdbsd_r',
        color: own === 'attack' ? SPAWN_THEME.own.color : SPAWN_THEME.enemy.color,
      },
      defense: {
        icon: own === 'defense' ? 'f_jdbsd_g' : 'f_jdbsd_r',
        color: own === 'defense' ? SPAWN_THEME.own.color : SPAWN_THEME.enemy.color,
      },
    }
  }, [view])

  const entries: SpawnEntry[] = useMemo(() => {
    if (!stage) return []
    const list: SpawnEntry[] = []
    const fallbackLabel = (side: Side) => (side === view ? '己方复活点' : '敌方复活点')
    const hasVehicleDeploy = (uid: string, side: Side) => (deployByStage?.[stage.id]?.[side] ?? []).some((vehicle) => vehicle.spawnUid === uid)
    stage.spawns.forEach((spawn) => {
      const baseName = spawn.name || null
      list.push({
        uid: spawn.uid,
        pos: [spawn.lat, spawn.lng],
        side: spawn.side,
        baseName,
        label: baseName ?? fallbackLabel(spawn.side),
        theme: themes[spawn.side],
        vehicleDeploy: hasVehicleDeploy(spawn.uid, spawn.side),
      })
    })
    return list
  }, [deployByStage, stage, themes, view])

  if (!visible || !stage || entries.length === 0) return null

  const makeIcon = (theme: { icon: string; color: string }, label: string, vehicleDeploy: boolean) => {
    const cls = [
      'spawn-marker',
      theme.color === SPAWN_THEME.own.color ? 'own' : 'enemy',
      vehicleDeploy ? 'vehicle-deploy' : '',
    ].join(' ')
    // 结构对齐据点标记（cap-marker）：图标 + 名称标签，仅颜色变量不同
    return L.divIcon({
      className: 'spawn-marker-wrap',
      html: `
        <div class="${cls}" style="--sp-c:${theme.color}">
          <img src="${POINT_ICON_BASE}/${theme.icon}.png" draggable="false" />
          ${vehicleDeploy ? '<span class="spawn-vehicle-link" role="button" aria-label="打开载具部署" title="打开载具部署"><i aria-hidden="true"><b></b></i></span>' : ''}
          <span class="spawn-tag">${label}</span>
        </div>`,
      iconSize: [44, 52],
      iconAnchor: [22, 42],
    })
  }

  const focus = (pos: [number, number]) => {
    map.flyTo([pos[0], pos[1]], SPAWN_ZOOM, { duration: 0.6 })
  }

  return (
    <>
      {entries.map((e, i) => (
        <Fragment key={e.uid || `spawn-${stage.id}-${i}`}>
          <Marker
            position={[e.pos[0], e.pos[1]]}
            icon={makeIcon(e.theme, e.label, e.vehicleDeploy)}
            zIndexOffset={600}
            // 绘制工具激活时禁用交互：复活点图标不拦截 mousedown
            interactive={interactive}
            eventHandlers={{
              click: (event) => {
                // 绘制工具激活时忽略点击（不聚焦复活点）
                if (!interactive) return
                focus(e.pos)
                const target = event.originalEvent.target as Element | null
                if (e.vehicleDeploy && target?.closest('.spawn-vehicle-link')) {
                  onSelect({ uid: e.uid, stageId: stage.id, side: e.side, pos: e.pos, baseName: e.baseName })
                }
              },
            }}
          />
        </Fragment>
      ))}
    </>
  )
}
