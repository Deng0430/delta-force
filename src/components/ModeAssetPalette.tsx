import type { DragEvent } from 'react'
import type { ModeZoneRole, Side } from '../types'
import { POINT_ICON_BASE } from '../config/points'

export const MODE_PALETTE_MIME = 'application/x-deltaforce-mode-asset'

export type ModePaletteAsset =
  | { kind: 'spawn'; side: Side }
  | { kind: 'objective'; icon: string }
  | { kind: 'prop'; name: string; icon: string }
  | { kind: 'zone'; role: ModeZoneRole }

const PROPS = [
  { name: '固定弹药箱', icon: 'q_gddyx' },
  { name: '载具补给站', icon: 'q_zjbjz' },
  { name: '固定防空炮', icon: 'q_gdaap' },
  { name: '固定机枪', icon: 'q_gdjq' },
  { name: '岸防炮', icon: 'q_afp' },
  { name: '滑索', icon: 'q_hs' },
  { name: '电梯', icon: 'q_dt' },
] as const

const ZONES: { role: ModeZoneRole; label: string; color: string }[] = [
  { role: 'attack-base', label: '进攻活动区', color: '#01ff84' },
  { role: 'defense-base', label: '防守活动区', color: '#e0453a' },
  { role: 'capture', label: '据点占领区', color: '#f4cf67' },
  { role: 'frontline', label: '阶段防线', color: '#f4cf67' },
]

function dragAsset(event: DragEvent, asset: ModePaletteAsset) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(MODE_PALETTE_MIME, JSON.stringify(asset))
}

export function readModePaletteAsset(dataTransfer: DataTransfer): ModePaletteAsset | null {
  try {
    const raw = dataTransfer.getData(MODE_PALETTE_MIME)
    return raw ? JSON.parse(raw) as ModePaletteAsset : null
  } catch {
    return null
  }
}

interface ModeAssetPaletteProps {
  collapsed: boolean
  onToggleCollapsed: () => void
}

export default function ModeAssetPalette({ collapsed, onToggleCollapsed }: ModeAssetPaletteProps) {
  return (
    <aside className={`mode-asset-palette${collapsed ? ' collapsed' : ''}`} aria-label="地图元素工具栏">
      <header>
        <i className="fa-solid fa-grip" />
        <strong>地图元素</strong>
        <button
          className="mode-panel-collapse"
          type="button"
          onClick={onToggleCollapsed}
          title={collapsed ? '展开左侧工具栏' : '收起左侧工具栏'}
          aria-label={collapsed ? '展开左侧工具栏' : '收起左侧工具栏'}
          aria-expanded={!collapsed}
        >
          <i className={`fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-left'}`} />
        </button>
        <span>拖到地图放置</span>
      </header>

      <details open><summary>关键点位</summary>
        <div className="mode-asset-grid">
          <button draggable onDragStart={(event) => dragAsset(event, { kind: 'spawn', side: 'attack' })}><img src={`${POINT_ICON_BASE}/g_jdbsd_g.png`} alt="" /><span>进攻复活点</span></button>
          <button draggable onDragStart={(event) => dragAsset(event, { kind: 'spawn', side: 'defense' })}><img src={`${POINT_ICON_BASE}/f_jdbsd_r.png`} alt="" /><span>防守复活点</span></button>
          <button draggable onDragStart={(event) => dragAsset(event, { kind: 'objective', icon: 'q_jd_a' })}><img src={`${POINT_ICON_BASE}/q_jd_a.png`} alt="" /><span>据点＋占领区</span></button>
        </div>
      </details>

      <details open><summary>区域</summary>
        <div className="mode-asset-grid zones">
          {ZONES.map((zone) => <button key={zone.role} draggable onDragStart={(event) => dragAsset(event, { kind: 'zone', role: zone.role })}><i style={{ borderColor: zone.color, background: `${zone.color}24` }} /><span>{zone.label}</span></button>)}
        </div>
      </details>

      <details open><summary>地图道具</summary>
        <div className="mode-asset-grid props">
          {PROPS.map((prop) => <button key={prop.icon} draggable onDragStart={(event) => dragAsset(event, { kind: 'prop', ...prop })}><img src={`${POINT_ICON_BASE}/${prop.icon}.png`} alt="" /><span>{prop.name}</span></button>)}
        </div>
      </details>
    </aside>
  )
}
