import { useState, type DragEvent } from 'react'
import type { ModeZoneRole, Side } from '../types'
import { POINT_ICON_BASE } from '../config/points'

export const MODE_PALETTE_MIME = 'application/x-deltaforce-mode-asset'

export type ModePaletteAsset =
  | { kind: 'spawn'; side: Side }
  | { kind: 'objective'; icon: string }
  | { kind: 'prop'; name: string; icon: string }
  | { kind: 'zone'; role: ModeZoneRole }
  | { kind: 'vehicle-refresh' }

const PROPS = [
  { name: '固定弹药箱', icon: 'q_gddyx' },
  { name: '载具补给站', icon: 'q_zjbjz' },
  { name: '固定防空炮', icon: 'q_gdaap' },
  { name: '密集阵', icon: 'q_mjz' },
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

export function modePaletteAssetKey(asset: ModePaletteAsset): string {
  if (asset.kind === 'spawn') return `spawn:${asset.side}`
  if (asset.kind === 'objective') return `objective:${asset.icon}`
  if (asset.kind === 'prop') return `prop:${asset.icon}`
  if (asset.kind === 'vehicle-refresh') return 'vehicle-refresh'
  return `zone:${asset.role}`
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
  selectedAsset: ModePaletteAsset | null
  onSelectAsset: (asset: ModePaletteAsset) => void
  onToggleCollapsed: () => void
  allowVehicleRefresh?: boolean
}

export default function ModeAssetPalette({ collapsed, selectedAsset, onSelectAsset, onToggleCollapsed, allowVehicleRefresh = true }: ModeAssetPaletteProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const matches = (label: string) => !normalizedQuery || label.toLowerCase().includes(normalizedQuery)
  const pointAssets = [
    { label: '进攻复活点', asset: { kind: 'spawn', side: 'attack' } as ModePaletteAsset, icon: `${POINT_ICON_BASE}/g_jdbsd_g.png` },
    { label: '防守复活点', asset: { kind: 'spawn', side: 'defense' } as ModePaletteAsset, icon: `${POINT_ICON_BASE}/f_jdbsd_r.png` },
    { label: '据点＋占领区', asset: { kind: 'objective', icon: 'q_jd_a' } as ModePaletteAsset, icon: `${POINT_ICON_BASE}/q_jd_a.png` },
  ].filter((item) => matches(item.label))
  const zoneAssets = ZONES.filter((item) => matches(item.label))
  const propAssets = PROPS.filter((item) => matches(item.name))
  const isSelected = (asset: ModePaletteAsset) => selectedAsset != null && modePaletteAssetKey(selectedAsset) === modePaletteAssetKey(asset)

  if (collapsed) {
    return (
      <button
        className="collapse-float left mode-config-panel-float"
        type="button"
        onClick={onToggleCollapsed}
        title="展开左侧工具栏"
        aria-label="展开左侧工具栏"
      >
        <i className="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    )
  }

  return (
    <aside className="mode-asset-palette" aria-label="地图元素工具栏">
      <header>
        <i className="fa-solid fa-shapes" />
        <strong>添加元素</strong>
        <button
          className="mode-panel-collapse"
          type="button"
          onClick={onToggleCollapsed}
          title="收起左侧工具栏"
          aria-label="收起左侧工具栏"
          aria-expanded="true"
        >
          <i className="fa-solid fa-chevron-left" />
        </button>
        <span>选择元素，点击地图放置</span>
      </header>

      <label className="mode-asset-search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input
          value={query}
          name="mode-asset-search"
          autoComplete="off"
          aria-label="搜索地图元素"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索据点、载具或道具…"
        />
        {query ? <button type="button" onClick={() => setQuery('')} aria-label="清除搜索">×</button> : null}
      </label>

      {pointAssets.length > 0 ? <details open><summary><span>关键点位</span><b>{pointAssets.length}</b></summary>
        <div className="mode-asset-grid">
          {pointAssets.map((item) => (
            <button
              key={item.label}
              type="button"
              className={isSelected(item.asset) ? 'active' : ''}
              draggable
              onClick={() => onSelectAsset(item.asset)}
              onDragStart={(event) => dragAsset(event, item.asset)}
              title={`${item.label}：点击选择后在地图放置，也可直接拖入地图`}
            ><img src={item.icon} alt="" /><span><strong>{item.label}</strong></span><em aria-hidden="true">＋</em></button>
          ))}
        </div>
      </details> : null}

      {zoneAssets.length > 0 ? <details open><summary><span>战场区域</span><b>{zoneAssets.length}</b></summary>
        <div className="mode-asset-grid zones">
          {zoneAssets.map((zone) => {
            const asset: ModePaletteAsset = { kind: 'zone', role: zone.role }
            return <button key={zone.role} type="button" className={isSelected(asset) ? 'active' : ''} draggable onClick={() => onSelectAsset(asset)} onDragStart={(event) => dragAsset(event, asset)}><i style={{ borderColor: zone.color, background: `${zone.color}24` }} /><span><strong>{zone.label}</strong><small>绘制区域边界</small></span><em aria-hidden="true">＋</em></button>
          })}
        </div>
      </details> : null}

      {propAssets.length > 0 ? <details open><summary><span>地图设施</span><b>{propAssets.length}</b></summary>
        <div className="mode-asset-grid props">
          {propAssets.map((prop) => {
            const asset: ModePaletteAsset = { kind: 'prop', ...prop }
            return <button key={prop.icon} type="button" className={isSelected(asset) ? 'active' : ''} draggable onClick={() => onSelectAsset(asset)} onDragStart={(event) => dragAsset(event, asset)}><img src={`${POINT_ICON_BASE}/${prop.icon}.png`} alt="" /><span><strong>{prop.name}</strong></span><em aria-hidden="true">＋</em></button>
          })}
        </div>
      </details> : null}

      {pointAssets.length === 0 && zoneAssets.length === 0 && propAssets.length === 0 ? (
        <div className="mode-asset-empty"><i className="fa-regular fa-face-frown" /><span>没有匹配的地图元素</span></div>
      ) : null}

      {allowVehicleRefresh ? <button className={`mode-asset-refresh-entry${selectedAsset?.kind === 'vehicle-refresh' ? ' active' : ''}`} type="button" onClick={() => onSelectAsset({ kind: 'vehicle-refresh' })}>
        <i className="fa-solid fa-truck-fast" /><span><strong>胜者为王载具刷新</strong><small>导入规则并标注刷新位置</small></span><i className="fa-solid fa-chevron-right" />
      </button> : null}
    </aside>
  )
}
