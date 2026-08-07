import { useMemo, useState } from 'react'
import { Marker, Polyline } from 'react-leaflet'
import * as L from 'leaflet'
import type { OperatorConnection, OperatorUnit } from '../types'

/** 阵营色只表达协同双方的归属；关系线本身不包含移动方向。 */
const SIDE_COLOR = { own: '#01ff84', enemy: '#e0453a' } as const

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

interface ConnectionLayerProps {
  connections: OperatorConnection[]
  /** 当前视角干员（响应式数据源：干员移动后此处坐标即最新，连线端点随之更新） */
  operators: OperatorUnit[]
  /** 是否显示协同关系（数据保留可隐藏） */
  visible: boolean
  /** 是否处于关系编辑模式（悬停高亮/可点击解除） */
  connectMode: boolean
  /** 是否可交互（绘制工具激活时禁用） */
  interactive: boolean
  /** 当前视角（决定连线阵营色：连线两端干员同属一方，我方绿/敌方红） */
  view?: 'attack' | 'defense'
  /** 关系编辑模式下点击关系线：解除关系（App 处理） */
  onRemoveConnection?: (id: string) => void
}

/**
 * 单条协同关系（双层 Polyline + 中点关系标记）：
 * - 视觉层：无方向细点线，避免与行动路线混淆；悬停时加粗提亮
 * - 热区层：16px 粗、近乎透明的命中带，负责扩大点击范围 + mouseover/mouseout 高亮 + click 断开
 * - 中点“协”标记明确表示人员协同，不表示移动或命令方向
 */
function ConnectionLine({
  conn,
  from,
  to,
  fromName,
  toName,
  color,
  visible,
  connectMode,
  interactive,
  onRemoveConnection,
}: {
  conn: OperatorConnection
  from: [number, number]
  to: [number, number]
  fromName: string
  toName: string
  color: string
  visible: boolean
  connectMode: boolean
  interactive: boolean
  onRemoveConnection?: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  const positions = useMemo<[number, number][]>(() => [from, to], [from, to])
  const midpoint: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  const relationIcon = useMemo(() => L.divIcon({
    className: 'operator-relation-wrap',
    html: `<span class="operator-relation-badge" style="--relation-color:${color}" title="协同关系：${escapeHtml(fromName)} ↔ ${escapeHtml(toName)}">协</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  }), [color, fromName, toName])

  // 热区仅在关系编辑模式下可交互。
  const hotInteractive = connectMode && interactive && !!onRemoveConnection

  // 热区事件：hover 高亮、点击断开（阻止冒泡避免误关气泡/触发其他）
  const hotHandlers = useMemo(
    () =>
      hotInteractive
        ? {
            click: (e: L.LeafletMouseEvent) => {
              L.DomEvent.stopPropagation(e)
              onRemoveConnection?.(conn.id)
            },
            mouseover: () => setHover(true),
            mouseout: () => setHover(false),
          }
        : undefined,
    [hotInteractive, onRemoveConnection, conn.id],
  )

  if (!visible) return null

  return (
    <>
      {/* 无方向点线：只表达两个干员存在协同关系。 */}
      <Polyline
        positions={positions}
        pathOptions={{
          color,
          weight: hover ? 3.5 : 1.8,
          opacity: connectMode ? (hover ? 1 : 0.78) : 0.58,
          dashArray: '2 7',
          lineCap: 'round',
          interactive: false,
        }}
      />
      <Marker position={midpoint} icon={relationIcon} interactive={false} zIndexOffset={610} />
      {/* 热区层：粗透明命中带，仅在关系编辑模式渲染。 */}
      {hotInteractive && (
        <Polyline
          positions={positions}
          pathOptions={{
            color,
            weight: 16,
            opacity: 0.05,
            dashArray: '2 7',
            interactive: true,
          }}
          eventHandlers={hotHandlers}
        />
      )}
    </>
  )
}

/**
 * 兵棋协同关系图层：
 * 在干员之间绘制无方向关系线，只表示“谁与谁协同”，不表示移动。
 * - 端点直接从 operators（响应式 state）读取 + 干员拖拽 drag 事件实时上报 → 连线实时跟随干员移动
 * - 颜色取连线所属阵营（我方绿 / 敌方红），与干员外圈一致
 * - visible=false 时隐藏但数据保留
 * - 关系编辑模式下：16px 热区扩大点击命中，鼠标悬停高亮，点击解除
 */
export default function ConnectionLayer({
  connections,
  operators,
  visible,
  connectMode,
  interactive,
  view,
  onRemoveConnection,
}: ConnectionLayerProps) {
  // uid → 干员映射（校验端点 + 取坐标 + 判阵营，随 operators 更新）
  const byUid = useMemo(() => {
    const m: Record<string, OperatorUnit> = {}
    for (const op of operators) m[op.uid] = op
    return m
  }, [operators])

  return (
    <>
      {connections.map((conn) => {
        const a = byUid[conn.operatorAId]
        const b = byUid[conn.operatorBId]
        // 端点不存在（干员已删）或未部署：跳过渲染（数据由 App 清理）
        if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null
        // 阵营色：取 A 端点干员阵营；有 view 时我方绿/敌方红，无 view 时按团队色回退
        const own = view != null ? a.side === view : a.side === 'attack'
        const color = view != null ? (own ? SIDE_COLOR.own : SIDE_COLOR.enemy) : '#8f9aa3'
        return (
          <ConnectionLine
            key={conn.id}
            conn={conn}
            from={[a.lat, a.lng]}
            to={[b.lat, b.lng]}
            fromName={a.name}
            toName={b.name}
            color={color}
            visible={visible}
            connectMode={connectMode}
            interactive={interactive}
            onRemoveConnection={onRemoveConnection}
          />
        )
      })}
    </>
  )
}
